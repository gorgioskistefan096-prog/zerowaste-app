import 'dotenv/config'
import express from 'express'
import { Account, Offer, Reservation, PurchaseIntent, connectDatabase, databaseConnected } from './postgres.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { Contract, formatEther, getAddress, Interface, isAddress, JsonRpcProvider, keccak256, toUtf8Bytes, verifyTypedData } from 'ethers'
import { MARKETPLACE_ABI } from '../src/contracts/marketplaceAbi.js'

const app = express()
const TEST_MKD_PER_AVAX = 50000n
const isProduction = process.env.NODE_ENV === 'production'
if (isProduction) app.set('trust proxy', 1)
app.use(helmet({
  contentSecurityPolicy: isProduction ? { directives: {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'", 'https://api.avax-test.network'],
    fontSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  } } : false,
}))
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '20kb' }))
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Премногу обиди. Почекајте 15 минути и обидете се повторно.' },
})
app.use('/api/auth/login', authRateLimit)
app.use('/api/auth/register', authRateLimit)

const marketplaceInterface = new Interface(MARKETPLACE_ABI)
const fujiProvider = new JsonRpcProvider(process.env.FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc')
const offerTypedDataTypes = {
  Offer: [
    { name: 'offerId', type: 'bytes32' },
    { name: 'merchant', type: 'address' },
    { name: 'detailsHash', type: 'bytes32' },
    { name: 'priceWei', type: 'uint256' },
    { name: 'quantity', type: 'uint32' },
    { name: 'pickupDeadline', type: 'uint64' },
  ],
}

function offerSigningDomain(contractAddress) {
  return { name: 'ZeroWasteMarketplace', version: '3', chainId: 43113, verifyingContract: contractAddress }
}

function calculateOfferDetailsHash(offer) {
  return keccak256(toUtf8Bytes(JSON.stringify({
    merchantName: offer.merchantName,
    merchantWallet: offer.merchantWallet,
    title: offer.title,
    count: offer.count,
    price: offer.price,
    originalPrice: offer.originalPrice,
    priceWei: offer.priceWei,
    quantity: offer.quantity,
    pickupDeadline: Math.floor(new Date(offer.pickupDeadline).getTime() / 1000),
    image: offer.image || '',
  })))
}

function hasAuthenticOfferDetails(offer) {
  return calculateOfferDetailsHash(offer).toLowerCase() === offer.detailsHash?.toLowerCase()
}

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const account = await Account.findById(payload.sub)
    if (!account) return res.status(401).json({ message: 'Сметката не е пронајдена.' })
    req.account = account
    next()
  } catch {
    res.status(401).json({ message: 'Најавете се повторно.' })
  }
}

function cleanOffer(offer) {
  const secondsLeft = Math.max(0, Math.floor((offer.pickupDeadline.getTime() - Date.now()) / 1000))
  const hours = String(Math.floor(secondsLeft / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((secondsLeft % 3600) / 60)).padStart(2, '0')
  const seconds = String(secondsLeft % 60).padStart(2, '0')
  return {
    id: offer._id,
    chainOfferId: offer.chainOfferId,
    contractAddress: offer.contractAddress,
    detailsHash: offer.detailsHash,
    store: offer.merchantName,
    title: offer.title,
    count: offer.count,
    price: offer.price,
    originalPrice: offer.originalPrice,
    priceWei: offer.priceWei,
    priceAvax: formatEther(offer.priceWei),
    priceMkd: String(offer.price),
    quantity: offer.quantity,
    timer: `${hours}:${minutes}:${seconds}`,
    distance: 'Прилеп',
    available: offer.availableUnits,
    coords: 'Прилеп',
    image: offer.image,
    merchantWallet: offer.merchantWallet,
    signature: offer.merchantSignature,
    reservedUnits: Math.max(0, offer.quantity - offer.availableUnits),
    pickupDeadline: offer.pickupDeadline,
    subscriptionExpiresAt: offer.subscriptionExpiresAt,
    chainTxHash: offer.chainTxHash,
    status: offer.status,
    adminDecisionReason: offer.adminDecisionReason || '',
  }
}

async function verifiedContractEvent(txHash, walletAddress, eventName, contractAddress = process.env.MARKETPLACE_ADDRESS) {
  if (!contractAddress || !isAddress(contractAddress)) throw new Error('Договорот сè уште не е поставен во .env.')
  if (!/^0x[\da-fA-F]{64}$/.test(txHash || '')) throw new Error('Невалиден transaction hash.')
  if (!isAddress(walletAddress || '')) throw new Error('Невалидна wallet адреса.')
  const network = await fujiProvider.getNetwork()
  if (network.chainId !== 43113n) throw new Error('RPC врската не е на Avalanche Fuji.')
  const receipt = await fujiProvider.getTransactionReceipt(txHash)
  if (!receipt || receipt.status !== 1) throw new Error('Успешната Fuji трансакција не е најдена.')
  if (receipt.to?.toLowerCase() !== getAddress(contractAddress).toLowerCase()) throw new Error('Трансакцијата не е испратена до ZeroWaste договорот.')
  if (receipt.from.toLowerCase() !== getAddress(walletAddress).toLowerCase()) throw new Error('Трансакцијата не е потпишана со поврзаниот wallet.')
  const parsedEvent = receipt.logs.map((log) => {
    try { return marketplaceInterface.parseLog(log) } catch { return null }
  }).find((event) => event?.name === eventName)
  if (!parsedEvent) throw new Error(`Во трансакцијата нема ${eventName} настан од договорот.`)
  return { receipt, args: parsedEvent.args, walletAddress: getAddress(walletAddress) }
}

function publicAccount(account) {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const role = adminEmail && account.email === adminEmail && account.role === 'admin' ? 'admin' : account.role
  return { id: account._id, name: account.name, email: account.email, role,
    userType: account.userType, businessName: account.businessName, phone: account.phone, address: account.address }
}

function isAdmin(account) {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  return Boolean(adminEmail && account?.role === 'admin' && account.email === adminEmail)
}

async function ensureAdminAccount() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return
  if (password.length < 12) throw new Error('ADMIN_PASSWORD мора да има најмалку 12 знаци.')
  const existing = await Account.findOne({ email })
  const hashedPassword = await bcrypt.hash(password, 12)
  if (!existing) {
    await Account.create({ name: 'ZeroWaste Admin', email, password: hashedPassword, role: 'admin' })
    return
  }
  if (existing.role !== 'admin') existing.role = 'admin'
  existing.password = hashedPassword
  await existing.save()
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.account)) return res.status(403).json({ message: 'Оваа опција е само за администратор.' })
  next()
}

async function releaseExpiredPurchaseIntents() {
  const expiredIntents = await PurchaseIntent.find({ status: { $in: ['creating', 'pending'] }, expiresAt: { $lte: new Date() } }).limit(100)
  for (const intent of expiredIntents) {
    const released = await PurchaseIntent.findOneAndUpdate(
      { _id: intent._id, status: { $in: ['creating', 'pending'] } },
      { $set: { status: 'expired' } },
      { new: true },
    )
    if (!released) continue
    const offer = await Offer.findByIdAndUpdate(released.offer, { $inc: { availableUnits: 1 } }, { new: true })
    if (offer && offer.availableUnits > 0 && offer.status === 'soldout' && offer.pickupDeadline > new Date() && offer.subscriptionExpiresAt > new Date()) {
      offer.status = 'active'
      await offer.save()
    }
  }
}

async function verifyDirectPayment(txHash, buyerWallet, merchantWallet, amountWei) {
  if (!/^0x[\da-fA-F]{64}$/.test(txHash || '')) throw new Error('Невалиден transaction hash.')
  const network = await fujiProvider.getNetwork()
  if (network.chainId !== 43113n) throw new Error('RPC врската не е на Avalanche Fuji.')
  const [receipt, transaction] = await Promise.all([
    fujiProvider.getTransactionReceipt(txHash),
    fujiProvider.getTransaction(txHash),
  ])
  if (!receipt || receipt.status !== 1 || !transaction) throw new Error('Успешната Fuji трансакција не е најдена.')
  if (transaction.chainId !== 43113n) throw new Error('Плаќањето не е испратено на Avalanche Fuji.')
  if (transaction.from.toLowerCase() !== getAddress(buyerWallet).toLowerCase()) throw new Error('Трансакцијата не е од поврзаниот wallet на купувачот.')
  if (transaction.to?.toLowerCase() !== getAddress(merchantWallet).toLowerCase()) throw new Error('Трансакцијата не е испратена директно до wallet-от на бизнисот.')
  if (transaction.value.toString() !== amountWei) throw new Error('Износот на Fuji трансакцијата не се совпаѓа со цената.')
  return { receipt, transaction, walletAddress: getAddress(buyerWallet) }
}

function weiToMkd(value) {
  return (BigInt(value) * TEST_MKD_PER_AVAX / 10n ** 18n).toString()
}
function issueToken(account) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured')
  return jwt.sign({ sub: account._id.toString(), role: account.role }, process.env.JWT_SECRET, { expiresIn: '7d' })
}

let databaseConnectionPromise
async function ensureDatabase(req, res, next) {
  if (databaseConnected()) return next()
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, database: 'disconnected', message: 'DATABASE_URL не е поставен во околината на серверот.' })
  try {
    databaseConnectionPromise ||= connectDatabase()
    await databaseConnectionPromise
    await ensureAdminAccount()
    next()
  } catch (error) {
    databaseConnectionPromise = undefined
    console.error('Supabase PostgreSQL connection failed:', error.message)
    res.status(503).json({ ok: false, database: 'disconnected', message: 'Базата моментално не е достапна.' })
  }
}
app.use('/api', ensureDatabase)

app.get('/api/health', (_req, res) => {
  const connected = databaseConnected()
  res.status(connected ? 200 : 503).json({ ok: connected, database: connected ? 'connected' : 'disconnected' })
})
app.get('/api/subscriptions/me', authenticate, async (req, res) => {
  try {
    if (req.account.role !== 'business') return res.status(403).json({ message: 'Членарината е само за бизнис-сметки.' })
    const marketplace = new Contract(process.env.MARKETPLACE_ADDRESS, MARKETPLACE_ABI, fujiProvider)
    if (await marketplace.version() !== 3n) return res.status(503).json({ message: 'Постави го новиот V3 договор за членарина.' })
    const priceWei = await marketplace.SUBSCRIPTION_FEE()
    const expiry = req.account.subscriptionWallet ? await marketplace.subscriptionExpiry(req.account.subscriptionWallet) : 0n
    const chainActive = expiry > BigInt(Math.floor(Date.now() / 1000))
    if (expiry > 0n) {
      req.account.subscriptionExpiresAt = new Date(Number(expiry) * 1000)
      await req.account.save()
    }
    res.json({ walletAddress: req.account.subscriptionWallet || '', active: chainActive, expiresAt: expiry.toString(), priceWei: priceWei.toString(), priceMkd: weiToMkd(priceWei) })
  } catch (error) {
    console.error(error)
    res.status(503).json({ message: 'Членарината не може да се провери на Fuji.' })
  }
})

app.post('/api/subscriptions/confirm', authenticate, async (req, res) => {
  try {
    if (req.account.role !== 'business') return res.status(403).json({ message: 'Само бизнис може да плати членарина.' })
    const { receipt, args, walletAddress } = await verifiedContractEvent(req.body.txHash, req.body.walletAddress, 'SubscriptionPaid')
    if (args.merchant.toLowerCase() !== walletAddress.toLowerCase()) return res.status(400).json({ message: 'Членарината не е платена од поврзаниот бизнис wallet.' })
    const marketplace = new Contract(process.env.MARKETPLACE_ADDRESS, MARKETPLACE_ABI, fujiProvider)
    if (await marketplace.version() !== 3n) return res.status(503).json({ message: 'Овој договор нема V3 членарина.' })
    const fee = await marketplace.SUBSCRIPTION_FEE()
    const expiry = await marketplace.subscriptionExpiry(walletAddress)
    if (args.amountWei.toString() !== fee.toString() || args.expiresAt.toString() !== expiry.toString()) return res.status(400).json({ message: 'Fuji не ја потврдува целосната членарина.' })
    req.account.subscriptionWallet = walletAddress.toLowerCase()
    req.account.subscriptionExpiresAt = new Date(Number(expiry) * 1000)
    req.account.subscriptionTxHash = receipt.hash.toLowerCase()
    await req.account.save()
    await Offer.updateMany({ merchantAccount: req.account._id, status: { $in: ['pending', 'active', 'soldout'] } }, { $set: { subscriptionExpiresAt: req.account.subscriptionExpiresAt } })
    res.json({ paid: true, active: true, expiresAt: expiry.toString(), priceMkd: weiToMkd(fee) })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'Членарината не може да се потврди.' })
  }
})
app.get('/api/offers', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store')
    await releaseExpiredPurchaseIntents()
    const filter = { contractAddress: process.env.MARKETPLACE_ADDRESS?.toLowerCase(), merchantSignature: { $exists: true }, subscriptionExpiresAt: { $gt: new Date() }, status: 'active', availableUnits: { $gt: 0 }, pickupDeadline: { $gt: new Date() } }
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET)
        if (payload.sub) {
          const purchased = await Reservation.find({ customerAccount: payload.sub, status: { $in: ['active', 'completed'] } }).distinct('chainOfferId')
          if (purchased.length) filter.chainOfferId = { $nin: purchased }
        }
      } catch { /* Public offer browsing remains available for expired sessions. */ }
    }
    const offers = await Offer.find(filter).sort({ createdAt: -1 }).limit(100)
    res.json({ offers: offers.filter(hasAuthenticOfferDetails).map(cleanOffer) })
  } catch (error) { console.error(error); res.status(500).json({ message: 'Понудите не можеа да се вчитаат.' }) }
})

app.post('/api/offers/:offerId/purchases/intent', authenticate, async (req, res) => {
  let intent
  let reservedOfferId
  try {
    if (req.account.role !== 'user') return res.status(403).json({ message: 'Купување е достапно само за кориснички профили.' })
    const walletAddress = getAddress(req.body.walletAddress || '')
    await releaseExpiredPurchaseIntents()
    const candidate = await Offer.findOne({ chainOfferId: req.params.offerId, status: 'active', availableUnits: { $gt: 0 }, subscriptionExpiresAt: { $gt: new Date() }, pickupDeadline: { $gt: new Date() } })
    if (!candidate || !hasAuthenticOfferDetails(candidate)) return res.status(409).json({ message: 'Пакетот веќе не е достапен или неговиот потпис не е валиден.' })
    if (walletAddress.toLowerCase() === candidate.merchantWallet?.toLowerCase()) return res.status(400).json({ message: 'MetaMask е на wallet-от на бизнисот што ја објавил понудата. Смени на друга MetaMask сметка за да купиш.' })
    if (await Reservation.exists({ customerAccount: req.account._id, chainOfferId: candidate.chainOfferId, status: { $in: ['active', 'completed'] } })) {
      return res.status(409).json({ message: 'Овој пакет веќе е во твојата корпа.' })
    }
    intent = await PurchaseIntent.create({
      intentId: randomBytes(24).toString('hex'),
      offer: candidate._id,
      customerAccount: req.account._id,
      customerWallet: walletAddress.toLowerCase(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      status: 'creating',
    })
    const offer = await Offer.findOneAndUpdate(
      { _id: candidate._id, status: 'active', availableUnits: { $gt: 0 }, subscriptionExpiresAt: { $gt: new Date() }, pickupDeadline: { $gt: new Date() } },
      { $inc: { availableUnits: -1 } },
      { new: true },
    )
    if (!offer) {
      await PurchaseIntent.findByIdAndUpdate(intent._id, { $set: { status: 'cancelled' } })
      return res.status(409).json({ message: 'Пакетот веќе не е достапен или членарината е истечена.' })
    }
    reservedOfferId = offer._id
    intent.offer = offer._id
    intent.status = 'pending'
    await intent.save()
    if (offer.availableUnits === 0) await Offer.updateOne({ _id: offer._id }, { $set: { status: 'soldout' } })
    res.status(201).json({ intentId: intent.intentId, merchantWallet: offer.merchantWallet, priceWei: offer.priceWei, expiresAt: intent.expiresAt })
  } catch (error) {
    if (intent?._id) await PurchaseIntent.findByIdAndUpdate(intent._id, { $set: { status: 'cancelled' } }).catch(() => {})
    if (reservedOfferId) {
      const offer = await Offer.findByIdAndUpdate(reservedOfferId, { $inc: { availableUnits: 1 } }, { new: true }).catch(() => null)
      if (offer && offer.status === 'soldout') { offer.status = 'active'; await offer.save().catch(() => {}) }
    }
    console.error(error)
    res.status(400).json({ message: error.message || 'Не може да се подготви купувањето.' })
  }
})

app.post('/api/offers/:offerId/purchases/intent/:intentId/cancel', authenticate, async (req, res) => {
  try {
    const intent = await PurchaseIntent.findOneAndUpdate(
      { intentId: req.params.intentId, customerAccount: req.account._id, status: { $in: ['creating', 'pending'] } },
      { $set: { status: 'cancelled' } },
      { new: true },
    )
    if (intent) {
      const offer = await Offer.findByIdAndUpdate(intent.offer, { $inc: { availableUnits: 1 } }, { new: true })
      if (offer && offer.status === 'soldout' && offer.pickupDeadline > new Date() && offer.subscriptionExpiresAt > new Date()) {
        offer.status = 'active'
        await offer.save()
      }
    }
    res.json({ cancelled: Boolean(intent) })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Купувањето не може да се откаже.' })
  }
})

app.post('/api/offers/:offerId/purchases/confirm', authenticate, async (req, res) => {
  try {
    if (req.account.role !== 'user') return res.status(403).json({ message: 'Купување е достапно само за кориснички профили.' })
    const intent = await PurchaseIntent.findOne({ intentId: req.body.intentId, customerAccount: req.account._id, status: 'pending' })
    if (!intent || intent.expiresAt <= new Date()) return res.status(409).json({ message: 'Сесијата за купување истече. Освежи ја понудата и обиди се повторно.' })
    const offer = await Offer.findOne({ _id: intent.offer, chainOfferId: req.params.offerId, contractAddress: process.env.MARKETPLACE_ADDRESS?.toLowerCase() })
    if (!offer || !hasAuthenticOfferDetails(offer)) return res.status(404).json({ message: 'Понудата не е пронајдена или нејзиниот потпис не е валиден.' })
    if (intent.customerWallet !== req.body.walletAddress?.toLowerCase()) return res.status(403).json({ message: 'Поврзи го wallet-от што го започна купувањето.' })
    const { receipt, transaction, walletAddress } = await verifyDirectPayment(req.body.txHash, intent.customerWallet, offer.merchantWallet, offer.priceWei)
    const contractReservationId = `direct:${receipt.hash.toLowerCase()}`
    let reservation = await Reservation.findOne({ contractReservationId })
    if (reservation && (!reservation.offer.equals(offer._id) || !reservation.customerAccount.equals(req.account._id))) return res.status(409).json({ message: 'Оваа трансакција веќе е поврзана со друга нарачка.' })
    if (!reservation) {
      reservation = await Reservation.create({
        contractReservationId,
        chainReservationId: `direct-${receipt.hash.toLowerCase()}`,
        contractAddress: offer.contractAddress,
        chainOfferId: offer.chainOfferId,
        offer: offer._id,
        customerAccount: req.account._id,
        customerWallet: walletAddress.toLowerCase(),
        ticketToken: randomBytes(32).toString('hex'),
        amountPaidWei: transaction.value.toString(),
        paymentMethod: 'direct',
        chainTxHash: receipt.hash.toLowerCase(),
      })
    }
    await PurchaseIntent.updateOne({ _id: intent._id, status: 'pending' }, { $set: { status: 'confirmed' } })
    res.status(201).json({ reservation: { id: reservation._id, chainReservationId: reservation.chainReservationId, ticketToken: reservation.ticketToken }, paymentMethod: 'direct' })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'Директното Fuji плаќање не може да се потврди.' })
  }
})

app.get('/api/offers/mine', authenticate, async (req, res) => {
  if (req.account.role !== 'business') return res.status(403).json({ message: 'Оваа опција е достапна само за бизниси.' })
  const offers = await Offer.find({ merchantAccount: req.account._id, contractAddress: process.env.MARKETPLACE_ADDRESS?.toLowerCase(), merchantSignature: { $exists: true }, status: { $in: ['pending', 'active', 'soldout', 'rejected', 'closed'] } }).sort({ createdAt: -1 }).limit(100)
  res.json({ offers: offers.filter(hasAuthenticOfferDetails).map(cleanOffer) })
})

app.get('/api/admin/offers/pending', authenticate, requireAdmin, async (_req, res) => {
  const offers = await Offer.find({ status: 'pending', merchantSignature: { $exists: true }, pickupDeadline: { $gt: new Date() } })
    .populate('merchantAccount', 'name email businessName phone address')
    .sort({ createdAt: 1 }).limit(100)
  res.json({ offers: offers.filter(hasAuthenticOfferDetails).map((offer) => ({
    ...cleanOffer(offer),
    business: offer.merchantAccount?.businessName || offer.merchantName,
    businessEmail: offer.merchantAccount?.email || '',
    businessContact: offer.merchantAccount?.phone || '',
    submittedAt: offer.createdAt,
  })) })
})

app.get('/api/admin/offers/all', authenticate, requireAdmin, async (_req, res) => {
  const offers = await Offer.find({ merchantSignature: { $exists: true } })
    .populate('merchantAccount', 'name email businessName phone')
    .sort({ createdAt: -1 }).limit(250)
  res.json({ offers: offers.filter(hasAuthenticOfferDetails).map((offer) => ({
    ...cleanOffer(offer),
    business: offer.merchantAccount?.businessName || offer.merchantName,
    businessEmail: offer.merchantAccount?.email || '',
  })) })
})

app.delete('/api/admin/offers/:offerId', authenticate, requireAdmin, async (req, res) => {
  try {
    const offer = await Offer.findOneAndUpdate(
      { chainOfferId: req.params.offerId, status: { $ne: 'closed' } },
      { $set: { status: 'closed', adminReviewedAt: new Date(), adminReviewedBy: req.account.email, adminDecisionReason: 'Отстранета од администратор.' } },
      { new: true },
    )
    if (!offer) return res.status(404).json({ message: 'Објавата не е пронајдена или веќе е отстранета.' })
    res.json({ offer: cleanOffer(offer) })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Објавата не може да се отстрани.' })
  }
})

app.get('/api/admin/subscriptions', authenticate, requireAdmin, async (_req, res) => {
  try {
    const marketplace = new Contract(process.env.MARKETPLACE_ADDRESS, MARKETPLACE_ABI, fujiProvider)
    if (await marketplace.version() !== 3n) return res.status(503).json({ message: 'Постави го V3 договорот за месечни членарини.' })
    const [businesses, revenueWei, feeWei] = await Promise.all([
      Account.find({ role: 'business' }).select('name email businessName subscriptionWallet subscriptionExpiresAt subscriptionTxHash').sort({ updatedAt: -1 }).limit(100),
      marketplace.subscriptionRevenue(),
      marketplace.SUBSCRIPTION_FEE(),
    ])
    res.json({
      revenueAvax: formatEther(revenueWei),
      revenueMkd: weiToMkd(revenueWei),
      monthlyFeeMkd: weiToMkd(feeWei),
      businesses: businesses.map((business) => ({
        id: business._id,
        name: business.businessName || business.name,
        email: business.email,
        walletAddress: business.subscriptionWallet || '',
        expiresAt: business.subscriptionExpiresAt || null,
        active: Boolean(business.subscriptionExpiresAt && business.subscriptionExpiresAt > new Date()),
        txHash: business.subscriptionTxHash || '',
      })),
    })
  } catch (error) {
    console.error(error)
    res.status(503).json({ message: 'Не може да се вчитаат членарините. Провери ја Fuji врската.' })
  }
})

app.post('/api/admin/offers/:offerId/approve', authenticate, requireAdmin, async (req, res) => {
  try {
    const offer = await Offer.findOne({ chainOfferId: req.params.offerId, status: 'pending' })
    if (!offer) return res.status(404).json({ message: 'Понудата не е пронајдена или веќе е прегледана.' })
    if (offer.pickupDeadline <= new Date() || offer.subscriptionExpiresAt <= new Date()) return res.status(409).json({ message: 'Рокот на понудата или членарината е истечен.' })
    const marketplace = new Contract(offer.contractAddress, MARKETPLACE_ABI, fujiProvider)
    const expiresAt = await marketplace.subscriptionExpiry(offer.merchantWallet)
    if (expiresAt <= BigInt(Math.floor(Date.now() / 1000))) return res.status(409).json({ message: 'Членарината на бизнисот е истечена.' })
    offer.status = 'active'
    offer.adminReviewedAt = new Date()
    offer.adminReviewedBy = req.account.email
    offer.adminDecisionReason = ''
    await offer.save()
    res.json({ offer: cleanOffer(offer) })
  } catch (error) {
    console.error(error)
    res.status(503).json({ message: 'Не може да се одобри понудата. Провери ја Fuji врската.' })
  }
})

app.post('/api/admin/offers/:offerId/reject', authenticate, requireAdmin, async (req, res) => {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 500) : ''
    const offer = await Offer.findOneAndUpdate(
      { chainOfferId: req.params.offerId, status: 'pending' },
      { $set: { status: 'rejected', adminReviewedAt: new Date(), adminReviewedBy: req.account.email, adminDecisionReason: reason } },
      { new: true },
    )
    if (!offer) return res.status(404).json({ message: 'Понудата не е пронајдена или веќе е прегледана.' })
    res.json({ offer: cleanOffer(offer) })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Понудата не може да се одбие.' })
  }
})

app.post('/api/offers', authenticate, async (req, res) => {
  try {
    if (req.account.role !== 'business') return res.status(403).json({ message: 'Само бизнис профил може да објави понуда.' })
    const { title, count, price, originalPrice, quantity, pickupDeadline, image } = req.body
    const parsedPrice = Number(price)
    const parsedOriginalPrice = Number(originalPrice)
    const parsedQuantity = Number(quantity)
    const deadline = new Date(pickupDeadline)
    if (!process.env.MARKETPLACE_ADDRESS || !isAddress(process.env.MARKETPLACE_ADDRESS)) return res.status(503).json({ message: 'Новиот V3 ZeroWaste договор сè уште не е поставен.' })
    if (!req.account.subscriptionWallet) return res.status(403).json({ message: 'Прво плати месечна членарина од MetaMask.' })
    let subscriptionExpiry
    try {
      const marketplace = new Contract(process.env.MARKETPLACE_ADDRESS, MARKETPLACE_ABI, fujiProvider)
      if (await marketplace.version() !== 3n) return res.status(503).json({ message: 'На оваа адреса нема V3 договор со членарина.' })
      subscriptionExpiry = await marketplace.subscriptionExpiry(req.account.subscriptionWallet)
      if (subscriptionExpiry <= BigInt(Math.floor(Date.now() / 1000))) return res.status(403).json({ message: 'Членарината е истечена. Обнови ја пред да објавуваш.' })
    } catch {
      return res.status(503).json({ message: 'V3 ZeroWaste договорот со членарина не е достапен на Fuji.' })
    }
    let priceWei
    try {
      if (!Number.isInteger(parsedPrice) || parsedPrice < 1) throw new Error('invalid price')
      priceWei = (BigInt(parsedPrice) * 10n ** 18n / TEST_MKD_PER_AVAX).toString()
    } catch { return res.status(400).json({ message: 'Внесете валидна цена во цели денари.' }) }
    if (!title?.trim() || !count?.trim() || title.length > 120 || count.length > 180) return res.status(400).json({ message: 'Внесете наслов и опис на понудата.' })
    if (!Number.isFinite(parsedPrice) || parsedPrice < 1 || !Number.isFinite(parsedOriginalPrice) || parsedOriginalPrice < 0 || BigInt(priceWei) <= 0n) return res.status(400).json({ message: 'Проверете ги цените во денари.' })
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 500) return res.status(400).json({ message: 'Количината мора да биде од 1 до 500.' })
    if (!Number.isFinite(deadline.getTime()) || deadline <= new Date() || deadline.getTime() > Date.now() + 24 * 60 * 60 * 1000 || deadline.getTime() > Number(subscriptionExpiry) * 1000) return res.status(400).json({ message: 'Времето за подигнување мора да биде во следните 24 часа и пред истекот на членарината.' })
    const normalizedTitle = title.trim()
    const normalizedCount = count.trim()
    const normalizedImage = typeof image === 'string' && image.startsWith('https://') ? image.slice(0, 500) : ''
    const pickupDeadlineSeconds = Math.floor(deadline.getTime() / 1000)
    const detailsHash = keccak256(toUtf8Bytes(JSON.stringify({
      merchantName: req.account.businessName,
      merchantWallet: req.account.subscriptionWallet,
      title: normalizedTitle,
      count: normalizedCount,
      price: parsedPrice,
      originalPrice: parsedOriginalPrice,
      priceWei,
      quantity: parsedQuantity,
      pickupDeadline: pickupDeadlineSeconds,
      image: normalizedImage,
    })))
    const offer = await Offer.create({
      chainOfferId: `0x${randomBytes(32).toString('hex')}`,
      contractAddress: getAddress(process.env.MARKETPLACE_ADDRESS).toLowerCase(),
      detailsHash,
      merchantAccount: req.account._id,
      merchantName: req.account.businessName,
      merchantWallet: req.account.subscriptionWallet,
      subscriptionExpiresAt: new Date(Number(subscriptionExpiry) * 1000),
      title: normalizedTitle, count: normalizedCount, price: parsedPrice, originalPrice: parsedOriginalPrice, priceWei,
      quantity: parsedQuantity, availableUnits: parsedQuantity, pickupDeadline: deadline,
      image: normalizedImage,
    })
    res.status(201).json({ offer: cleanOffer(offer) })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Не може да се зачува нацртот за понудата.' })
  }
})

app.post('/api/offers/:offerId/confirm', authenticate, async (req, res) => {
  try {
    if (req.account.role !== 'business') return res.status(403).json({ message: 'Само бизнис може да потврди објава.' })
    const offer = await Offer.findOne({ chainOfferId: req.params.offerId, merchantAccount: req.account._id })
    if (!offer) return res.status(404).json({ message: 'Нацртот за понудата не е пронајден.' })
    if (offer.status === 'pending' && offer.merchantSignature === req.body.signature) return res.json({ offer: cleanOffer(offer) })
    if (offer.status !== 'draft') return res.status(409).json({ message: 'Понудата веќе е обработена.' })
    const walletAddress = getAddress(req.body.walletAddress || '')
    if (walletAddress.toLowerCase() !== req.account.subscriptionWallet || walletAddress.toLowerCase() !== offer.merchantWallet) return res.status(403).json({ message: 'Потпиши ја објавата со wallet-от што ја плати членарината.' })
    const marketplace = new Contract(offer.contractAddress, MARKETPLACE_ABI, fujiProvider)
    if (await marketplace.version() !== 3n || await marketplace.subscriptionExpiry(walletAddress) <= BigInt(Math.floor(Date.now() / 1000))) return res.status(403).json({ message: 'Членарината е истечена или договорот не е V3.' })
    const message = {
      offerId: offer.chainOfferId,
      merchant: walletAddress,
      detailsHash: offer.detailsHash,
      priceWei: offer.priceWei,
      quantity: offer.quantity,
      pickupDeadline: Math.floor(offer.pickupDeadline.getTime() / 1000),
    }
    const recoveredAddress = verifyTypedData(offerSigningDomain(offer.contractAddress), offerTypedDataTypes, message, req.body.signature || '')
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase() || !hasAuthenticOfferDetails(offer)) return res.status(400).json({ message: 'MetaMask потписот не ги потврдува деталите на понудата.' })
    offer.merchantSignature = req.body.signature
    offer.status = 'pending'
    await offer.save()
    res.status(201).json({ offer: cleanOffer(offer), transactionRequired: false, pendingAdminApproval: true })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'Трансакцијата не може да се потврди.' })
  }
})

app.post('/api/offers/:offerId/reservations/confirm', authenticate, async (req, res) => {
  try {
    if (req.account.role !== 'user') return res.status(403).json({ message: 'Резервација е достапна за кориснички профили.' })
    const offer = await Offer.findOne({ chainOfferId: req.params.offerId, contractAddress: process.env.MARKETPLACE_ADDRESS?.toLowerCase(), status: { $in: ['active', 'soldout'] } })
    if (!offer) return res.status(404).json({ message: 'Активната понуда не е пронајдена.' })
    if (!hasAuthenticOfferDetails(offer)) return res.status(409).json({ message: 'Деталите на понудата не се совпаѓаат со хешот на Fuji.' })
    const { receipt, args, walletAddress } = await verifiedContractEvent(req.body.txHash, req.body.walletAddress, 'ReservationCreated', offer.contractAddress)
    if (args.offerId.toLowerCase() !== offer.chainOfferId.toLowerCase() || args.customer.toLowerCase() !== walletAddress.toLowerCase() || args.priceWei.toString() !== offer.priceWei) return res.status(400).json({ message: 'Податоците или AVAX плаќањето од Fuji резервацијата не се совпаѓаат.' })
    const reservationId = args.reservationId.toString()
    const contractReservationId = `${offer.contractAddress}:${reservationId}`
    const existing = await Reservation.findOne({ contractReservationId })
    if (existing) return res.json({ reservation: { id: existing._id, chainReservationId: existing.chainReservationId, ticketToken: existing.ticketToken }, offer: cleanOffer(offer) })
    const contract = new Contract(offer.contractAddress, MARKETPLACE_ABI, fujiProvider)
    const chainOffer = await contract.getOffer(offer.chainOfferId)
    if (!chainOffer.active) return res.status(409).json({ message: 'Понудата е затворена на Fuji.' })
    if (chainOffer.detailsHash.toLowerCase() !== offer.detailsHash.toLowerCase() || chainOffer.priceWei.toString() !== offer.priceWei) return res.status(409).json({ message: 'Податоците или AVAX цената на понудата не се совпаѓаат со договорот.' })
    const chainReservation = await contract.reservations(reservationId)
    if (chainReservation.offerId.toLowerCase() !== offer.chainOfferId.toLowerCase() || chainReservation.customer.toLowerCase() !== walletAddress.toLowerCase() || chainReservation.merchant.toLowerCase() !== offer.merchantWallet || chainReservation.amountPaid.toString() !== offer.priceWei || chainOffer.merchant.toLowerCase() !== offer.merchantWallet) return res.status(400).json({ message: 'Fuji договорот не потврдува целосно платена резервација од точниот бизнис.' })
    offer.availableUnits = Number(chainOffer.availableUnits)
    offer.status = offer.availableUnits === 0 ? 'soldout' : 'active'
    const reservation = await Reservation.create({
      contractReservationId, chainReservationId: reservationId, contractAddress: offer.contractAddress,
      chainOfferId: offer.chainOfferId, offer: offer._id, customerAccount: req.account._id,
      customerWallet: walletAddress.toLowerCase(), ticketToken: randomBytes(32).toString('hex'),
      amountPaidWei: args.priceWei.toString(), chainTxHash: receipt.hash.toLowerCase(),
    })
    await offer.save()
    res.status(201).json({ reservation: { id: reservation._id, chainReservationId: reservation.chainReservationId, ticketToken: reservation.ticketToken }, offer: cleanOffer(offer) })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'Резервацијата не може да се потврди.' })
  }
})

app.get('/api/reservations/mine', authenticate, async (req, res) => {
  const reservations = await Reservation.find({ customerAccount: req.account._id }).populate('offer').sort({ createdAt: -1 }).limit(100)
  res.json({ reservations: reservations.filter((item) => item.offer?.priceWei).map((item) => ({
    id: item._id,
    chainReservationId: item.chainReservationId,
    chainOfferId: item.chainOfferId,
    ticketToken: item.ticketToken,
    customerWallet: item.customerWallet,
    amountPaidWei: item.amountPaidWei,
    amountPaidAvax: formatEther(item.amountPaidWei),
    amountPaidMkd: String(item.offer.price),
    chainTxHash: item.chainTxHash,
    paymentMethod: item.paymentMethod,
    status: item.status,
    createdAt: item.createdAt,
    offer: cleanOffer(item.offer),
  })) })
})

app.get('/api/reservations/verify/:ticketToken', async (req, res) => {
  try {
    const reservation = await Reservation.findOne({ ticketToken: req.params.ticketToken }).populate('offer').populate('customerAccount')
    if (!reservation?.offer || !reservation.customerAccount) return res.status(404).json({ message: 'Купонот не е пронајден.' })
    if (!reservation.offer.priceWei || !hasAuthenticOfferDetails(reservation.offer)) return res.status(409).json({ message: 'Податоците на понудата не може да се потврдат.' })
    let status
    if (reservation.paymentMethod === 'direct') {
      await verifyDirectPayment(reservation.chainTxHash, reservation.customerWallet, reservation.offer.merchantWallet, reservation.amountPaidWei)
      status = reservation.status === 'completed' ? 'completed' : 'paid'
    } else {
      const contract = new Contract(reservation.contractAddress, MARKETPLACE_ABI, fujiProvider)
      const [chainOffer, chainReservation] = await Promise.all([
        contract.getOffer(reservation.chainOfferId),
        contract.reservations(reservation.chainReservationId),
      ])
      const verified = chainReservation.offerId.toLowerCase() === reservation.chainOfferId.toLowerCase()
        && chainReservation.customer.toLowerCase() === reservation.customerWallet
        && chainReservation.merchant.toLowerCase() === reservation.offer.merchantWallet
        && chainReservation.amountPaid.toString() === reservation.amountPaidWei
        && chainOffer.merchant.toLowerCase() === reservation.offer.merchantWallet
        && chainOffer.priceWei.toString() === reservation.amountPaidWei
        && chainOffer.detailsHash.toLowerCase() === reservation.offer.detailsHash.toLowerCase()
      if (!verified) return res.status(409).json({ message: 'Купонот не се совпаѓа со уплатата на Fuji.' })
      const chainStatus = Number(chainReservation.status)
      status = chainStatus === 0 ? 'paid' : chainStatus === 2 ? 'completed' : chainStatus === 3 || chainStatus === 1 ? 'refunded' : 'unknown'
    }
    res.json({
      verified: true,
      status,
      reservationId: reservation.chainReservationId,
      customer: reservation.customerAccount.name,
      customerWallet: reservation.customerWallet,
      paymentMethod: reservation.paymentMethod,
      product: reservation.offer.title,
      description: reservation.offer.count,
      business: reservation.offer.merchantName,
      amountMkd: String(reservation.offer.price),
      paidAt: reservation.createdAt,
      paymentTxHash: reservation.chainTxHash,
      contractAddress: reservation.contractAddress,
    })
  } catch (error) {
    console.error(error)
    res.status(503).json({ message: 'Купонот моментално не може да се провери на Fuji.' })
  }
})

app.get('/api/reservations/business', authenticate, async (req, res) => {
  if (req.account.role !== 'business') return res.status(403).json({ message: 'Оваа опција е достапна само за бизниси.' })
  const offers = await Offer.find({ merchantAccount: req.account._id }).select('_id')
  const reservations = await Reservation.find({ offer: { $in: offers.map((offer) => offer._id) }, amountPaidWei: { $exists: true } }).populate('offer').populate('customerAccount').sort({ createdAt: -1 }).limit(100)
  res.json({ reservations: reservations.map((reservation) => ({
    id: reservation._id,
    chainReservationId: reservation.chainReservationId,
    chainOfferId: reservation.chainOfferId,
    status: reservation.status,
    paymentMethod: reservation.paymentMethod,
    customerName: reservation.customerAccount?.name || '',
    customerWallet: reservation.customerWallet,
    amountPaidAvax: formatEther(reservation.amountPaidWei),
    amountPaidMkd: String(reservation.offer?.price ?? weiToMkd(reservation.amountPaidWei)),
    chainTxHash: reservation.chainTxHash,
    createdAt: reservation.createdAt,
    completionTxHash: reservation.completionTxHash,
    offer: reservation.offer ? {
      title: reservation.offer.title,
      store: reservation.offer.merchantName,
      merchantWallet: reservation.offer.merchantWallet,
      count: reservation.offer.count,
      price: reservation.offer.price,
      priceAvax: formatEther(reservation.amountPaidWei),
      priceMkd: String(reservation.offer?.price ?? weiToMkd(reservation.amountPaidWei)),
    } : null,
  })) })
})

app.post('/api/reservations/:reservationId/complete', authenticate, async (req, res) => {
  try {
    if (req.account.role !== 'business') return res.status(403).json({ message: 'Само бизнис може да потврди подигнување.' })
    const reservation = await Reservation.findById(req.params.reservationId).populate('offer')
    if (!reservation?.offer || !reservation.offer.merchantAccount.equals(req.account._id)) return res.status(404).json({ message: 'Резервацијата не е пронајдена за овој бизнис.' })
    if (reservation.status === 'completed' && reservation.completionTxHash === req.body.txHash?.toLowerCase()) return res.json({ status: 'completed' })
    if (reservation.status !== 'active') return res.status(409).json({ message: 'Оваа резервација веќе не е активна.' })
    if (!reservation.offer.merchantWallet || reservation.offer.merchantWallet !== req.body.walletAddress?.toLowerCase()) return res.status(403).json({ message: 'Потврдете го подигнувањето со MetaMask wallet-от на бизнисот.' })
    if (reservation.paymentMethod === 'direct') {
      reservation.status = 'completed'
      await reservation.save()
      return res.json({ status: reservation.status })
    }
    const { receipt, args, walletAddress } = await verifiedContractEvent(req.body.txHash, req.body.walletAddress, 'ReservationUpdated', reservation.contractAddress)
    if (args.reservationId.toString() !== reservation.chainReservationId || args.offerId.toLowerCase() !== reservation.chainOfferId.toLowerCase() || Number(args.status) !== 2 || walletAddress.toLowerCase() !== reservation.offer.merchantWallet) return res.status(400).json({ message: 'Fuji трансакцијата не ја потврдува оваа резервација како подигната.' })
    reservation.status = 'completed'
    reservation.completionTxHash = receipt.hash.toLowerCase()
    await reservation.save()
    res.json({ status: reservation.status, completionTxHash: reservation.completionTxHash })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'Подигнувањето не може да се потврди.' })
  }
})

app.post('/api/reservations/:reservationId/refund', authenticate, async (req, res) => {
  try {
    if (req.account.role !== 'user') return res.status(403).json({ message: 'Само купувачот може да побара враќање на уплатата.' })
    const reservation = await Reservation.findById(req.params.reservationId).populate('offer')
    if (!reservation || !reservation.customerAccount.equals(req.account._id)) return res.status(404).json({ message: 'Купонот не е пронајден за оваа корисничка сметка.' })
    if (reservation.status === 'expired' && reservation.refundTxHash === req.body.txHash?.toLowerCase()) return res.json({ status: 'expired', refundTxHash: reservation.refundTxHash })
    if (reservation.status !== 'active' || reservation.offer.pickupDeadline > new Date()) return res.status(409).json({ message: 'Враќање е достапно по истекот на времето за подигнување.' })
    if (reservation.customerWallet !== req.body.walletAddress?.toLowerCase()) return res.status(403).json({ message: 'Поврзи го истиот MetaMask wallet што го платил производот.' })
    const { receipt, args, walletAddress } = await verifiedContractEvent(req.body.txHash, req.body.walletAddress, 'ReservationUpdated', reservation.contractAddress)
    if (args.reservationId.toString() !== reservation.chainReservationId || args.offerId.toLowerCase() !== reservation.chainOfferId.toLowerCase() || Number(args.status) !== 3 || walletAddress.toLowerCase() !== reservation.customerWallet) return res.status(400).json({ message: 'Fuji трансакцијата не го потврдува враќањето на уплатата.' })
    reservation.status = 'expired'
    reservation.refundTxHash = receipt.hash.toLowerCase()
    await reservation.save()
    res.json({ status: reservation.status, refundTxHash: reservation.refundTxHash })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'Уплатата не може да се врати.' })
  }
})

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, userType, businessName, phone, address } = req.body
    if (!name?.trim() || !email?.trim() || !password) return res.status(400).json({ message: 'Внесете име, е-пошта и лозинка.' })
    if (password.length < 8) return res.status(400).json({ message: 'Лозинката мора да има најмалку 8 знаци.' })
    if (!['user', 'business'].includes(role)) return res.status(400).json({ message: 'Изберете корисник или бизнис.' })
    if (role === 'user' && !['citizen', 'social_case'].includes(userType)) return res.status(400).json({ message: 'Изберете тип на корисник.' })
    if (role === 'business' && !businessName?.trim()) return res.status(400).json({ message: 'Внесете име на бизнисот.' })
    const normalizedEmail = email.trim().toLowerCase()
    if (await Account.exists({ email: normalizedEmail })) return res.status(409).json({ message: 'Оваа е-пошта веќе е регистрирана.' })
    const account = await Account.create({ name: name.trim(), email: normalizedEmail, password: await bcrypt.hash(password, 12), role,
      userType: role === 'user' ? userType : undefined, businessName: role === 'business' ? businessName.trim() : undefined,
      phone: phone?.trim(), address: address?.trim() })
    res.status(201).json({ token: issueToken(account), account: publicAccount(account) })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Оваа е-пошта веќе е регистрирана.' })
    console.error(error)
    res.status(500).json({ message: 'Регистрацијата не успеа. Проверете ја врската со базата.' })
  }
})
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body
    const normalizedEmail = email?.trim().toLowerCase()
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase()
    const account = await Account.findOne({ email: normalizedEmail, ...(normalizedEmail === adminEmail || !role ? {} : { role }) }).select('+password')
    if (!account || !await bcrypt.compare(password || '', account.password)) return res.status(401).json({ message: 'Погрешна е-пошта или лозинка.' })
    res.json({ token: issueToken(account), account: publicAccount(account) })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'Најавата не успеа. Проверете дали MongoDB е активен.' })
  }
})
app.get('/api/auth/me', async (req, res) => {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const account = await Account.findById(payload.sub)
    if (!account) return res.status(401).json({ message: 'Сметката не е пронајдена.' })
    res.json({ account: publicAccount(account) })
  } catch { res.status(401).json({ message: 'Сесијата е истечена. Најавете се повторно.' }) }
})

if (isProduction) {
  const webDirectory = path.resolve('public')
  app.use(express.static(webDirectory, { index: false, maxAge: '1h' }))
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'API endpoint не е пронајден.' })
    res.sendFile(path.join(webDirectory, 'index.html'), (error) => { if (error) next(error) })
  })
}

export default app

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 3001)
  if (!process.env.DATABASE_URL) {
    console.error('Недостасува DATABASE_URL. Поставете Supabase connection string.')
    process.exit(1)
  }
  try {
    await connectDatabase()
    await ensureAdminAccount()
    console.log('Supabase PostgreSQL е поврзан')
    const host = isProduction ? '0.0.0.0' : '127.0.0.1'
    app.listen(port, host, () => console.log(`ZeroWaste апликацијата работи на ${host}:${port}`))
  } catch (error) {
    console.error('Не може да се поврзе со Supabase PostgreSQL:', error.message)
    process.exit(1)
  }
}

