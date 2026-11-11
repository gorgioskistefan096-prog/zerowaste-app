// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ZeroWasteMarketplace
/// @notice Fuji marketplace with monthly merchant subscriptions, signed off-chain listings, and AVAX escrow payments.
contract ZeroWasteMarketplace {
    uint256 public constant SUBSCRIPTION_FEE = 0.01 ether;
    uint64 public constant SUBSCRIPTION_DURATION = 30 days;
    uint256 public constant VERSION = 3;

    address public immutable owner;
    uint256 public subscriptionRevenue;
    uint256 public escrowLiabilities;
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant OFFER_TYPEHASH = keccak256(
        "Offer(bytes32 offerId,address merchant,bytes32 detailsHash,uint256 priceWei,uint32 quantity,uint64 pickupDeadline)"
    );
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    struct Offer {
        address merchant;
        bytes32 detailsHash;
        uint32 totalUnits;
        uint32 soldUnits;
        uint32 activeReservations;
        uint64 pickupDeadline;
        bool active;
        uint256 priceWei;
    }

    struct Reservation {
        bytes32 offerId;
        address customer;
        address merchant;
        uint8 status; // 0 paid/active, 1 cancelled/refunded, 2 collected, 3 expired/refunded
        uint256 amountPaid;
    }

    mapping(address => uint64) public subscriptionExpiry;
    mapping(bytes32 => Offer) private offers;
    mapping(uint256 => Reservation) public reservations;
    uint256 public nextReservationId = 1;
    bool private entered;

    event SubscriptionPaid(address indexed merchant, uint64 expiresAt, uint256 amountWei);
    event OfferClosed(bytes32 indexed offerId, address indexed merchant);
    event ReservationCreated(uint256 indexed reservationId, bytes32 indexed offerId, address indexed customer, uint32 remainingUnits, uint256 priceWei);
    event ReservationUpdated(uint256 indexed reservationId, bytes32 indexed offerId, uint8 status, uint32 remainingUnits);

    modifier nonReentrant() {
        require(!entered, "Reentrant call");
        entered = true;
        _;
        entered = false;
    }

    constructor() {
        owner = msg.sender;
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("ZeroWasteMarketplace")),
            keccak256(bytes("3")),
            block.chainid,
            address(this)
        ));
    }

    function version() external pure returns (uint256) {
        return VERSION;
    }

    function isSubscribed(address merchant) external view returns (bool) {
        return subscriptionExpiry[merchant] > block.timestamp;
    }

    function subscribe() external payable {
        require(msg.value == SUBSCRIPTION_FEE, "Incorrect subscription payment");
        uint256 start = subscriptionExpiry[msg.sender] > block.timestamp ? subscriptionExpiry[msg.sender] : block.timestamp;
        uint256 expiry = start + SUBSCRIPTION_DURATION;
        require(expiry <= type(uint64).max, "Subscription date overflow");
        subscriptionExpiry[msg.sender] = uint64(expiry);
        subscriptionRevenue += msg.value;
        emit SubscriptionPaid(msg.sender, uint64(expiry), msg.value);
    }

    function withdrawSubscriptionRevenue(address payable recipient, uint256 amount) external nonReentrant {
        require(msg.sender == owner, "Only owner can withdraw subscription revenue");
        require(recipient != address(0) && amount > 0 && amount <= subscriptionRevenue, "Invalid withdrawal");
        subscriptionRevenue -= amount;
        require(address(this).balance >= escrowLiabilities + amount, "Insufficient subscription revenue");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "Revenue withdrawal failed");
    }

    function buyOffer(
        bytes32 offerId,
        address merchant,
        bytes32 detailsHash,
        uint256 priceWei,
        uint32 quantity,
        uint64 pickupDeadline,
        bytes calldata signature
    ) external payable returns (uint256 reservationId) {
        require(merchant != address(0) && msg.sender != merchant, "Merchant cannot reserve own offer");
        require(subscriptionExpiry[merchant] > block.timestamp, "Merchant subscription is inactive");
        require(detailsHash != bytes32(0) && quantity > 0 && priceWei > 0, "Invalid offer details");
        require(block.timestamp < pickupDeadline, "Offer has expired");
        require(msg.value == priceWei, "Incorrect AVAX payment");

        bytes32 structHash = keccak256(abi.encode(OFFER_TYPEHASH, offerId, merchant, detailsHash, priceWei, quantity, pickupDeadline));
        address signer = _recover(keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)), signature);
        require(signer == merchant, "Invalid merchant offer signature");

        Offer storage offer = offers[offerId];
        if (offer.merchant == address(0)) {
            offer.merchant = merchant;
            offer.detailsHash = detailsHash;
            offer.totalUnits = quantity;
            offer.pickupDeadline = pickupDeadline;
            offer.active = true;
            offer.priceWei = priceWei;
        } else {
            require(offer.active, "Offer is closed");
            require(
                offer.merchant == merchant && offer.detailsHash == detailsHash && offer.priceWei == priceWei
                    && offer.totalUnits == quantity && offer.pickupDeadline == pickupDeadline,
                "Offer signature does not match listing"
            );
        }
        require(offer.soldUnits < offer.totalUnits, "Offer is sold out");
        offer.soldUnits += 1;
        offer.activeReservations += 1;
        escrowLiabilities += msg.value;
        reservationId = nextReservationId++;
        reservations[reservationId] = Reservation({
            offerId: offerId,
            customer: msg.sender,
            merchant: merchant,
            status: 0,
            amountPaid: msg.value
        });
        emit ReservationCreated(reservationId, offerId, msg.sender, offer.totalUnits - offer.soldUnits, msg.value);
    }

    function cancelReservation(uint256 reservationId) external nonReentrant {
        Reservation storage reservation = reservations[reservationId];
        require(reservation.customer == msg.sender, "Not reservation customer");
        require(reservation.status == 0, "Reservation is not active");
        Offer storage offer = offers[reservation.offerId];
        require(block.timestamp < offer.pickupDeadline, "Reservation has expired");

        reservation.status = 1;
        offer.soldUnits -= 1;
        offer.activeReservations -= 1;
        escrowLiabilities -= reservation.amountPaid;
        _refund(reservation.customer, reservation.amountPaid);
        emit ReservationUpdated(reservationId, reservation.offerId, 1, offer.totalUnits - offer.soldUnits);
    }

    function markCollected(uint256 reservationId) external nonReentrant {
        Reservation storage reservation = reservations[reservationId];
        require(reservation.status == 0, "Reservation is not active");
        Offer storage offer = offers[reservation.offerId];
        require(msg.sender == reservation.merchant && msg.sender == offer.merchant, "Only merchant can confirm pickup");
        reservation.status = 2;
        offer.activeReservations -= 1;
        escrowLiabilities -= reservation.amountPaid;
        (bool sent,) = payable(offer.merchant).call{value: reservation.amountPaid}("");
        require(sent, "AVAX payout failed");
        emit ReservationUpdated(reservationId, reservation.offerId, 2, offer.totalUnits - offer.soldUnits);
    }

    function expireReservation(uint256 reservationId) external nonReentrant {
        Reservation storage reservation = reservations[reservationId];
        require(reservation.status == 0, "Reservation is not active");
        Offer storage offer = offers[reservation.offerId];
        require(block.timestamp >= offer.pickupDeadline, "Pickup deadline has not passed");
        reservation.status = 3;
        offer.activeReservations -= 1;
        escrowLiabilities -= reservation.amountPaid;
        _refund(reservation.customer, reservation.amountPaid);
        emit ReservationUpdated(reservationId, reservation.offerId, 3, offer.totalUnits - offer.soldUnits);
    }

    function closeOffer(bytes32 offerId) external {
        Offer storage offer = offers[offerId];
        require(msg.sender == offer.merchant, "Only merchant can close offer");
        require(offer.active, "Offer is not active");
        offer.active = false;
        emit OfferClosed(offerId, msg.sender);
    }

    function getOffer(bytes32 offerId) external view returns (
        address merchant,
        bytes32 detailsHash,
        uint32 totalUnits,
        uint32 availableUnits,
        uint32 activeReservations,
        uint64 pickupDeadline,
        bool active,
        uint256 priceWei
    ) {
        Offer storage offer = offers[offerId];
        return (offer.merchant, offer.detailsHash, offer.totalUnits, offer.totalUnits - offer.soldUnits, offer.activeReservations, offer.pickupDeadline, offer.active, offer.priceWei);
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        require((v == 27 || v == 28) && uint256(s) <= SECP256K1_HALF_ORDER, "Invalid signature");
        signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "Invalid signature signer");
    }

    function _refund(address customer, uint256 amount) private {
        (bool sent,) = payable(customer).call{value: amount}("");
        require(sent, "AVAX refund failed");
    }
}
