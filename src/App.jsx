import React, { useEffect, useState } from 'react';
import './App.css';
import { QRCodeSVG } from 'qrcode.react';
import { FUJI_CHAIN_ID, MARKETPLACE_ADDRESS, TEST_MKD_PER_AVAX, connectMetaMask, getMarketplaceContract, mkdToWei, switchMetaMaskToFuji } from './contracts/fujiWallet.js';
import { 
  ShoppingBag, 
  Camera, 
  MapPin, 
  QrCode, 
  ShieldCheck, 
  Sparkles, 
  Clock, 
  TrendingUp, 
  Leaf, 
  Coins, 
  Award,
  CheckCircle2,
  Building2,
  Home,
  Zap,
  LogOut,
} from 'lucide-react';

function PurchaseTicket({ token }) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reservations/verify/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Купонот не може да се провери.');
        return data;
      })
      .then((data) => { if (!cancelled) setTicket(data); })
      .catch((requestError) => { if (!cancelled) setError(requestError.message || 'Купонот не може да се провери.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <main className="auth-screen">
      <section className="auth-card max-w-lg">
        <div className="auth-heading"><div className="auth-logo"><QrCode className="w-7 h-7" /></div><h1>ZeroWaste · купон</h1></div>
        {loading ? <p className="text-center text-emerald-300">Се проверува плаќањето на Fuji…</p> : error ? <p role="alert" className="reservation-error">{error}</p> : (
          <div className="space-y-4 text-center">
            <span className="offer-status-badge offer-status-purchased">{ticket.status === 'completed' ? 'ПОДИГНАТО' : ticket.status === 'paid' ? 'ПЛАТЕНО · ЧЕКА ПОДИГНУВАЊЕ' : 'ВРАТЕНО'}</span>
            <h2 className="text-xl font-bold text-white">{ticket.product}</h2>
            <p className="text-sm text-slate-300">{ticket.description} · {ticket.business}</p>
            <p className="text-sm text-slate-300">Купувач: <strong>{ticket.customer}</strong></p>
            <p className="text-xs text-slate-400 break-all">Wallet: {ticket.customerWallet}</p>
            <p className="text-lg font-bold text-emerald-300">Платено: {ticket.amountMkd} ден.</p>
            <p className="text-xs text-slate-400 break-all">Резервација #{ticket.reservationId} · Tx {ticket.paymentTxHash}</p>
            <a className="text-xs text-emerald-300 underline" href={`https://build.avax.network/explorer/fuji/c-chain/tx/${ticket.paymentTxHash}`} target="_blank" rel="noreferrer">Провери ја трансакцијата на Fuji Explorer</a>
          </div>
        )}
      </section>
    </main>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('user'); // 'user', 'merchant', 'esg'
  const [account, setAccount] = useState(null);
  const [authReady, setAuthReady] = useState(() => !localStorage.getItem('zw-token'));
  const [authMode, setAuthMode] = useState('register');
  const [authRole, setAuthRole] = useState('user');
  const [authUserType, setAuthUserType] = useState('citizen');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [walletChainId, setWalletChainId] = useState(null);
  const [walletError, setWalletError] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('zw-token');
    if (!token) return;
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => { if (!response.ok) throw new Error('session'); return response.json(); })
      .then((data) => {
        setAccount(data.account);
        setActiveTab(data.account.role === 'admin' ? 'admin' : data.account.role === 'business' ? 'merchant' : 'user');
      })
      .catch(() => localStorage.removeItem('zw-token'))
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!account || typeof IntersectionObserver === 'undefined') return;
    const items = document.querySelectorAll('.reveal:not(.is-visible)');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -28px 0px' });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [account, activeTab]);

  useEffect(() => {
    if (!window.ethereum) return undefined;
    const handleAccounts = (accounts) => setWalletAddress(accounts?.[0] || '');
    const handleChain = (chainId) => setWalletChainId(BigInt(chainId));
    window.ethereum.request({ method: 'eth_accounts' }).then(handleAccounts).catch(() => {});
    window.ethereum.request({ method: 'eth_chainId' }).then(handleChain).catch(() => {});
    window.ethereum.on?.('accountsChanged', handleAccounts);
    window.ethereum.on?.('chainChanged', handleChain);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', handleAccounts);
      window.ethereum.removeListener?.('chainChanged', handleChain);
    };
  }, []);

  const [offers, setOffers] = useState([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState('');
  const [myReservations, setMyReservations] = useState([]);
  const [businessReservations, setBusinessReservations] = useState([]);
  const [businessReservationError, setBusinessReservationError] = useState('');
  const [completingReservation, setCompletingReservation] = useState('');
  const [publishError, setPublishError] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [businessSubscription, setBusinessSubscription] = useState(null);
  const [subscriptionError, setSubscriptionError] = useState('');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [reservationError, setReservationError] = useState('');
  const [adminOffers, setAdminOffers] = useState([]);
  const [adminAllOffers, setAdminAllOffers] = useState([]);
  const [adminOffersError, setAdminOffersError] = useState('');
  const [adminReviewingOffer, setAdminReviewingOffer] = useState('');
  const [adminSubscriptions, setAdminSubscriptions] = useState(null);
  const [adminSubscriptionsError, setAdminSubscriptionsError] = useState('');
  const [withdrawingSubscriptionRevenue, setWithdrawingSubscriptionRevenue] = useState(false);
  const [myOffers, setMyOffers] = useState([]);

  const loadOffers = async () => {
    try {
      const response = await fetch('/api/offers', { cache: 'no-store', headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Понудите не можеа да се вчитаат.');
      setOffers(data.offers);
      setOffersError('');
    } catch (error) {
      setOffersError(error.message || 'Понудите не можеа да се вчитаат.');
    } finally { setOffersLoading(false); }
  };

  const loadMyReservations = async () => {
    const response = await fetch('/api/reservations/mine', { headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Резервациите не можеа да се вчитаат.');
    setMyReservations(data.reservations || []);
  };

  const loadBusinessSubscription = async () => {
    try {
      const response = await fetch('/api/subscriptions/me', { headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Членарината не може да се провери.');
      setBusinessSubscription(data);
      setSubscriptionError('');
    } catch (error) {
      setBusinessSubscription(null);
      setSubscriptionError(error.message || 'Членарината не може да се провери.');
    }
  };

  const loadMyOffers = async () => {
    try {
      const response = await fetch('/api/offers/mine', { headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` } });
      const data = await response.json();
      if (response.ok) setMyOffers(data.offers || []);
    } catch { /* Keep the existing merchant offer list visible. */ }
  };

  const loadAdminOffers = async () => {
    try {
      const response = await fetch('/api/admin/offers/pending', { headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Понудите за преглед не можеа да се вчитаат.');
      setAdminOffers(data.offers || []);
      setAdminOffersError('');
    } catch (error) { setAdminOffersError(error.message || 'Понудите за преглед не можеа да се вчитаат.'); }
  };

  const loadAdminAllOffers = async () => {
    try {
      const response = await fetch('/api/admin/offers/all', { headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Објавите не можеа да се вчитаат.');
      setAdminAllOffers(data.offers || []);
    } catch (error) { setAdminOffersError(error.message || 'Објавите не можеа да се вчитаат.'); }
  };

  const loadAdminSubscriptions = async () => {
    try {
      const response = await fetch('/api/admin/subscriptions', { headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Членарините не можеа да се вчитаат.');
      setAdminSubscriptions(data);
      setAdminSubscriptionsError('');
    } catch (error) { setAdminSubscriptionsError(error.message || 'Членарините не можеа да се вчитаат.'); }
  };

  const handleAdminDeleteOffer = async (offer) => {
    if (!window.confirm(`Да се отстрани објавата „${offer.title}“ од понудите? Постојните купони и нарачки ќе останат зачувани.`)) return;
    setAdminReviewingOffer(offer.chainOfferId);
    setAdminOffersError('');
    try {
      const response = await fetch(`/api/admin/offers/${offer.chainOfferId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Објавата не може да се отстрани.');
      setAdminAllOffers((current) => current.map((item) => item.chainOfferId === offer.chainOfferId ? data.offer : item));
      setAdminOffers((current) => current.filter((item) => item.chainOfferId !== offer.chainOfferId));
      await loadOffers();
    } catch (error) { setAdminOffersError(error.message || 'Објавата не може да се отстрани.'); }
    finally { setAdminReviewingOffer(''); }
  };

  const handleWithdrawSubscriptionRevenue = async () => {
    setAdminSubscriptionsError('');
    setWithdrawingSubscriptionRevenue(true);
    try {
      if (!walletAddress) throw new Error('Поврзи го MetaMask wallet-от на сопственикот на договорот.');
      if (walletChainId !== FUJI_CHAIN_ID) throw new Error('Смени ја MetaMask мрежата на Avalanche Fuji.');
      const { contract } = await getMarketplaceContract();
      const [owner, revenue] = await Promise.all([contract.owner(), contract.subscriptionRevenue()]);
      if (owner.toLowerCase() !== walletAddress.toLowerCase()) throw new Error('Овој MetaMask wallet не е сопственик на договорот што го прима приходот.');
      if (revenue === 0n) throw new Error('Во договорот нема собрани членарини за повлекување.');
      const transaction = await contract.withdrawSubscriptionRevenue(walletAddress, revenue);
      await transaction.wait();
      await loadAdminSubscriptions();
    } catch (error) {
      setAdminSubscriptionsError(error.code === 4001 ? 'Трансакцијата беше одбиена во MetaMask.' : error.message || 'Приходот не може да се повлече.');
    } finally { setWithdrawingSubscriptionRevenue(false); }
  };

  useEffect(() => {
    if (!account || activeTab !== 'user') return undefined;
    let cancelled = false;
    const fetchOffers = async () => {
      try {
        const response = await fetch('/api/offers', { cache: 'no-store', headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Понудите не можеа да се вчитаат.');
        if (!cancelled) { setOffers(data.offers); setOffersError(''); }
      } catch (error) {
        if (!cancelled) setOffersError(error.message || 'Понудите не можеа да се вчитаат.');
      } finally { if (!cancelled) setOffersLoading(false); }
    };
    void fetchOffers();
    const interval = window.setInterval(fetchOffers, 5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [account, activeTab]);

  useEffect(() => {
    if (account?.role !== 'user') return undefined;
    let cancelled = false;
    const refreshReservations = () => fetch('/api/reservations/mine', { headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message); return data.reservations || []; })
      .then((reservations) => { if (!cancelled) setMyReservations(reservations); })
      .catch(() => {});
    void refreshReservations();
    const interval = activeTab === 'user' ? window.setInterval(refreshReservations, 15000) : undefined;
    return () => { cancelled = true; if (interval) window.clearInterval(interval); };
  }, [account, activeTab]);

  useEffect(() => {
    if (account?.role !== 'business' || activeTab !== 'merchant') return undefined;
    let cancelled = false;
    fetch('/api/reservations/business', { headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message); return data.reservations || []; })
      .then((reservations) => { if (!cancelled) { setBusinessReservations(reservations); setBusinessReservationError(''); } })
      .catch((error) => { if (!cancelled) setBusinessReservationError(error.message || 'Резервациите не можеа да се вчитаат.'); });
    return () => { cancelled = true; };
  }, [account, activeTab]);

  useEffect(() => {
    if (account?.role === 'business' && activeTab === 'merchant') void loadBusinessSubscription();
  }, [account, activeTab]);

  useEffect(() => {
    if (account?.role !== 'business' || !['merchant', 'myOffers'].includes(activeTab)) return undefined;
    void loadMyOffers();
    if (activeTab !== 'myOffers') return undefined;
    const interval = window.setInterval(() => { void loadMyOffers(); }, 12000);
    return () => window.clearInterval(interval);
  }, [account, activeTab]);

  useEffect(() => {
    if (account?.role === 'admin' && activeTab === 'admin') {
      void loadAdminOffers();
      void loadAdminAllOffers();
      void loadAdminSubscriptions();
    }
  }, [account, activeTab]);

  const handleWalletConnect = async () => {
    setWalletBusy(true); setWalletError('');
    try {
      const wallet = await connectMetaMask();
      setWalletAddress(wallet.address); setWalletChainId(wallet.chainId);
    } catch (error) { setWalletError(error.message || 'MetaMask не може да се поврзе.'); }
    finally { setWalletBusy(false); }
  };

  const handleWalletSwitch = async () => {
    setWalletBusy(true); setWalletError('');
    try {
      const wallet = await switchMetaMaskToFuji();
      setWalletAddress(wallet.address); setWalletChainId(wallet.chainId);
    } catch (error) { setWalletError(error.message || 'Не може да се смени на Fuji.'); }
    finally { setWalletBusy(false); }
  };

  const handleSubscribe = async () => {
    setSubscriptionError('');
    setIsSubscribing(true);
    try {
      if (!walletAddress) throw new Error('Поврзи го MetaMask wallet-от на бизнисот.');
      if (walletChainId !== FUJI_CHAIN_ID) throw new Error('Смени ја MetaMask мрежата на Avalanche Fuji.');
      if (businessSubscription?.active && businessSubscription.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) throw new Error('Поврзи го wallet-от со кој е платена активната членарина.');
      const { contract } = await getMarketplaceContract();
      const fee = await contract.SUBSCRIPTION_FEE();
      const transaction = await contract.subscribe({ value: fee });
      const receipt = await transaction.wait();
      const response = await fetch('/api/subscriptions/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('zw-token')}` },
        body: JSON.stringify({ txHash: receipt.hash, walletAddress }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`${data.message || 'Членарината не може да се потврди.'} Tx: ${receipt.hash}`);
      setBusinessSubscription((current) => ({ ...current, active: true, expiresAt: data.expiresAt }));
      await loadBusinessSubscription();
    } catch (error) {
      setSubscriptionError(error.code === 4001 ? 'Плаќањето беше одбиено во MetaMask.' : error.message || 'Членарината не може да се плати.');
    } finally { setIsSubscribing(false); }
  };

  const handleAdminOfferDecision = async (offer, decision) => {
    const reason = decision === 'reject' ? window.prompt('Причина за одбивање (по избор):', '') : '';
    if (reason === null) return;
    setAdminReviewingOffer(offer.chainOfferId);
    setAdminOffersError('');
    try {
      const response = await fetch(`/api/admin/offers/${offer.chainOfferId}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('zw-token')}` },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Одлуката не може да се зачува.');
      setAdminOffers((current) => current.filter((item) => item.chainOfferId !== offer.chainOfferId));
      if (decision === 'approve') await loadOffers();
    } catch (error) { setAdminOffersError(error.message || 'Одлуката не може да се зачува.'); }
    finally { setAdminReviewingOffer(''); }
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    setAuthError(''); setAuthBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = { email: form.get('email'), password: form.get('password'), role: authRole };
    if (authMode === 'register') Object.assign(payload, {
      name: form.get('name'), phone: form.get('phone'), address: form.get('address'),
      userType: authRole === 'user' ? authUserType : undefined,
      businessName: authRole === 'business' ? form.get('businessName') : undefined,
    });
    try {
      const response = await fetch(`/api/auth/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Настана грешка. Обидете се повторно.');
      localStorage.setItem('zw-token', data.token); setAccount(data.account); setMyReservations([]); setBusinessReservations([]);
      setActiveTab(data.account.role === 'admin' ? 'admin' : data.account.role === 'business' ? 'merchant' : 'user');
    } catch (error) { setAuthError(error.message === 'Failed to fetch' ? 'Серверот не е достапен. Стартувајте го npm run dev:full и проверете ја MongoDB врската.' : error.message); }
    finally { setAuthBusy(false); }
  };

  // State for Merchant flow
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiDetected, setAiDetected] = useState(false);
  const [published, setPublished] = useState(false);
  const [offerDraft, setOfferDraft] = useState({
    title: 'МЕГА XL Пакет - Дневна Заштеда',
    count: '10 пецива (Мешано свежо)',
    originalPrice: '420',
    price: '60',
    quantity: '2',
    pickupHours: '2',
  });

  // State for User flow
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [_isReserving, setIsReserving] = useState(false);
  const [voucher, setVoucher] = useState(null);

  // Simulate AI Scan
  const handleAiScan = () => {
    setIsAnalyzing(true);
    setTimeout(() => {
      setIsAnalyzing(false);
      setAiDetected(true);
    }, 1500);
  };

  // Publish Offer
  const handlePublish = async () => {
    setPublishError('');
    setIsPublishing(true);
    try {
      if (!walletAddress) throw new Error('Прво поврзи го MetaMask wallet.');
      if (walletChainId !== FUJI_CHAIN_ID) throw new Error('Смени ја MetaMask мрежата на Avalanche Fuji.');
      if (!businessSubscription?.active) throw new Error('Плати ја месечната членарина пред да објавуваш.');
      if (businessSubscription.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) throw new Error('Користи го MetaMask wallet-от што ја плати членарината.');
      const { signer } = await getMarketplaceContract();
      const quantity = Number(offerDraft.quantity);
      const originalPrice = Number(offerDraft.originalPrice);
      const price = Number(offerDraft.price);
      const priceWei = mkdToWei(offerDraft.price);
      const deadline = Math.floor(Date.now() / 1000) + Number(offerDraft.pickupHours) * 60 * 60;
      const draftResponse = await fetch('/api/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('zw-token')}` },
        body: JSON.stringify({
          title: offerDraft.title,
          count: offerDraft.count,
          originalPrice,
          price,
          quantity,
          pickupDeadline: new Date(deadline * 1000).toISOString(),
          image: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&q=80&w=600',
        }),
      });
      const draftData = await draftResponse.json();
      if (!draftResponse.ok) throw new Error(draftData.message || 'Не може да се подготви понудата.');
      const offer = draftData.offer;
      const signature = await signer.signTypedData(
        { name: 'ZeroWasteMarketplace', version: '3', chainId: Number(FUJI_CHAIN_ID), verifyingContract: MARKETPLACE_ADDRESS },
        { Offer: [
          { name: 'offerId', type: 'bytes32' },
          { name: 'merchant', type: 'address' },
          { name: 'detailsHash', type: 'bytes32' },
          { name: 'priceWei', type: 'uint256' },
          { name: 'quantity', type: 'uint32' },
          { name: 'pickupDeadline', type: 'uint64' },
        ] },
        { offerId: offer.chainOfferId, merchant: walletAddress, detailsHash: offer.detailsHash, priceWei, quantity, pickupDeadline: deadline },
      );
      const confirmResponse = await fetch(`/api/offers/${offer.chainOfferId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('zw-token')}` },
        body: JSON.stringify({ signature, walletAddress }),
      });
      const confirmData = await confirmResponse.json();
      if (!confirmResponse.ok) throw new Error(confirmData.message || 'Не може да се потврди потписот за објавата.');
      setPublished(true);
      setAiDetected(false);
      await loadMyOffers();
      setActiveTab('myOffers');
      await loadOffers();
      setTimeout(() => setPublished(false), 2500);
    } catch (error) {
      setPublishError(error.code === 4001 ? 'MetaMask потписот беше одбиен.' : error.message || 'Објавата не успеа.');
    } finally { setIsPublishing(false); }
  };

  const handleReserve = async (offer) => {
    setSelectedOffer(offer);
    setVoucher(null);
    setReservationError('');
    setIsReserving(true);
    let intentId = '';
    let paymentTxHash = '';
    try {
      if (!walletAddress) throw new Error('Поврзи го MetaMask wallet за да резервираш.');
      if (walletChainId !== FUJI_CHAIN_ID) throw new Error('Смени ја MetaMask мрежата на Avalanche Fuji.');
      if (walletAddress.toLowerCase() === offer.merchantWallet?.toLowerCase()) throw new Error('Поврзаниот MetaMask wallet е wallet-от на бизнисот што ја објавил понудата. Смени на друга MetaMask сметка за купување.');
      const token = localStorage.getItem('zw-token');
      const intentResponse = await fetch(`/api/offers/${offer.chainOfferId}/purchases/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ walletAddress }),
      });
      const intentData = await intentResponse.json();
      if (!intentResponse.ok) throw new Error(intentData.message || 'Не може да се подготви купувањето.');
      intentId = intentData.intentId;
      if (intentData.merchantWallet?.toLowerCase() !== offer.merchantWallet?.toLowerCase() || intentData.priceWei !== offer.priceWei) throw new Error('Деталите за плаќањето се смениле. Освежи ја страницата.');
      const { signer } = await getMarketplaceContract();
      if ((await signer.getAddress()).toLowerCase() !== walletAddress.toLowerCase()) throw new Error('MetaMask сметката се сменила. Поврзи го wallet-от и повтори.');
      const transaction = await signer.sendTransaction({ to: intentData.merchantWallet, value: BigInt(intentData.priceWei) });
      const receipt = await transaction.wait();
      paymentTxHash = receipt.hash;
      const response = await fetch(`/api/offers/${offer.chainOfferId}/purchases/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ intentId, txHash: receipt.hash, walletAddress }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`${data.message || 'Не може да се зачува купувањето.'} Tx: ${receipt.hash}`);
      setVoucher({
        id: `ZW-${receipt.hash.slice(2, 10).toUpperCase()}`,
        offer,
        txHash: receipt.hash,
        ticketToken: data.reservation.ticketToken,
        amountPaidMkd: offer.priceMkd || offer.price,
        status: 'active',
      });
      await loadOffers();
      await loadMyReservations().catch(() => {});
    } catch (error) {
      if (intentId && !paymentTxHash) {
        fetch(`/api/offers/${offer.chainOfferId}/purchases/intent/${intentId}/cancel`, {
          method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('zw-token')}` },
        }).catch(() => {});
      }
      setReservationError(paymentTxHash ? `Плаќањето е потврдено на Fuji, но нарачката не се зачува. Испрати го овој Tx до администраторот за рачна проверка: ${paymentTxHash}` : error.code === 4001 ? 'Трансакцијата беше одбиена во MetaMask.' : error.message || 'Купувањето не успеа.');
      setIsReserving(false);
    } finally { setIsReserving(false); }
  };

  const handleCompleteReservation = async (reservation) => {
    setCompletingReservation(reservation.id);
    setBusinessReservationError('');
    try {
      let txHash;
      let merchantWallet = reservation.offer?.merchantWallet || walletAddress;
      if (reservation.paymentMethod !== 'direct') {
        if (!walletAddress) throw new Error('Поврзи го MetaMask wallet-от на бизнисот.')
        if (walletChainId !== FUJI_CHAIN_ID) throw new Error('Смени ја MetaMask мрежата на Avalanche Fuji.')
        const { contract } = await getMarketplaceContract();
        const transaction = await contract.markCollected(reservation.chainReservationId);
        const receipt = await transaction.wait();
        txHash = receipt.hash;
        merchantWallet = walletAddress;
      }
      const response = await fetch(`/api/reservations/${reservation.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('zw-token')}` },
        body: JSON.stringify({ txHash, walletAddress: merchantWallet }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`${data.message || 'Подигнувањето не може да се потврди.'}${txHash ? ` Tx: ${txHash}` : ''}`);
      setBusinessReservations((current) => current.map((item) => item.id === reservation.id ? { ...item, status: 'completed', completionTxHash: data.completionTxHash } : item));
      await loadOffers();
    } catch (error) {
      setBusinessReservationError(error.code === 4001 ? 'Трансакцијата беше одбиена во MetaMask.' : error.message || 'Подигнувањето не успеа.');
    } finally { setCompletingReservation(''); }
  };

  const ticketToken = new URLSearchParams(window.location.search).get('ticket');
  if (ticketToken) return <PurchaseTicket token={ticketToken} />;
  if (!authReady) return <div className="min-h-screen bg-slate-900 text-emerald-400 flex items-center justify-center">Се проверува сесијата...</div>;
  if (!account) return (
    <div className="auth-screen">
      <form onSubmit={handleAuth} className="auth-card">
        <div className="auth-heading"><div className="auth-logo"><Leaf className="w-7 h-7" /></div><h1>ZeroWaste AI</h1><p>{authMode === 'register' ? 'Креирајте сметка и спасувајте храна.' : 'Најавете се на вашата сметка.'}</p></div>
        <div className="auth-roles">
          {[['user', 'Корисник'], ['business', 'Бизнис']].map(([role, label]) => <button type="button" key={role} onClick={() => setAuthRole(role)} className={`auth-role ${authRole === role ? 'selected' : ''}`}>{role === 'user' ? '👤 ' : '🏪 '}{label}</button>)}
        </div>
        {authMode === 'register' && <>
          <label className="block text-sm text-slate-300">Име и презиме<input name="name" required maxLength="100" autoComplete="name" className="auth-input" /></label>
          {authRole === 'user' ? <fieldset className="space-y-2"><legend className="text-sm text-slate-300 mb-2">Изберете тип на корисник</legend><label className="choice-row"><input type="radio" name="userType" checked={authUserType === 'citizen'} onChange={() => setAuthUserType('citizen')} /> Граѓанин</label><label className="choice-row"><input type="radio" name="userType" checked={authUserType === 'social_case'} onChange={() => setAuthUserType('social_case')} /> Социјален случај</label></fieldset> : <label className="block text-sm text-slate-300">Име на бизнис<input name="businessName" required maxLength="120" autoComplete="organization" className="auth-input" /></label>}
          <label className="block text-sm text-slate-300">Телефон (опционално)<input name="phone" type="tel" maxLength="30" autoComplete="tel" className="auth-input" /></label>
          <label className="block text-sm text-slate-300">Адреса (опционално)<input name="address" maxLength="250" autoComplete="street-address" className="auth-input" /></label>
        </>}
        <label className="block text-sm text-slate-300">Е-пошта<input name="email" type="email" required autoComplete="email" className="auth-input" /></label>
        <label className="block text-sm text-slate-300">Лозинка<input name="password" type="password" required minLength={authMode === 'register' ? 8 : 1} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} className="auth-input" />{authMode === 'register' && <span className="text-xs text-slate-500">Најмалку 8 знаци</span>}</label>
        {authError && <p role="alert" className="text-sm text-rose-300 bg-rose-950/50 border border-rose-900 rounded-xl p-3">{authError}</p>}
        <button disabled={authBusy} className="auth-submit">{authBusy ? 'Почекајте...' : authMode === 'register' ? 'Креирај сметка' : 'Најави се'}</button>
        <p className="text-center text-sm text-slate-400">{authMode === 'register' ? 'Веќе имате сметка?' : 'Немате сметка?'} <button type="button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setAuthError(''); }} className="text-emerald-400 font-semibold">{authMode === 'register' ? 'Најавете се' : 'Регистрирајте се'}</button></p>
      </form>
    </div>
  );
  
  return (
    <div className="app-shell min-h-screen bg-slate-900 text-slate-100 font-sans pb-12">
      {/* HEADER / NAVIGATION */}
      <header className="app-header sticky top-0 z-50">
        <div className="header-inner max-w-6xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="brand-lockup flex items-center gap-3">
            <div className="brand-mark bg-emerald-500 text-slate-950 p-2 rounded-xl font-bold flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Leaf className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-emerald-400 to-teal-200 bg-clip-text text-transparent">
                ZeroWaste AI
              </h1>
              <p className="text-xs text-slate-400">{account.name} · {account.role === 'business' ? account.businessName : account.role === 'admin' ? 'Администратор' : account.userType === 'social_case' ? 'Социјален случај' : 'Граѓанин'}</p>
            </div>
          </div>
          <button onClick={() => { localStorage.removeItem('zw-token'); setAccount(null); setMyReservations([]); setBusinessReservations([]); }} className="logout-button flex items-center gap-2 text-xs text-slate-400 hover:text-white"><LogOut className="w-4 h-4" /> Одјави се</button>

          <div className="wallet-controls">
            {walletAddress ? <>
              <span className={`wallet-chip ${walletChainId === FUJI_CHAIN_ID ? 'wallet-chip-ready' : 'wallet-chip-warn'}`} title={walletAddress}>
                <span className="wallet-dot" /> {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)} · {walletChainId === FUJI_CHAIN_ID ? 'Fuji' : `Chain ${walletChainId?.toString() || '?'}`}
              </span>
              {walletChainId !== FUJI_CHAIN_ID && <button onClick={handleWalletSwitch} disabled={walletBusy} className="wallet-action">{walletBusy ? 'Чекај...' : 'Смени на Fuji'}</button>}
            </> : <button onClick={handleWalletConnect} disabled={walletBusy} className="wallet-action">{walletBusy ? 'Поврзување...' : 'Поврзи MetaMask'}</button>}
            {walletError && <span role="alert" className="wallet-error">{walletError}</span>}
            {!MARKETPLACE_ADDRESS && <span className="contract-status">Договорот чека Fuji deploy</span>}
          </div>

          {/* ROLE SWITCHER */}
          <div className="app-tabs flex bg-slate-900/80 p-1 rounded-xl border border-slate-700/80 text-xs sm:text-sm">
            <button
              onClick={() => setActiveTab('user')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === 'user' 
                  ? 'bg-emerald-500 text-slate-950 shadow-md font-semibold' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Home className="w-4 h-4" />
              Почетна
            </button>
            {account.role === 'user' && <button
              onClick={() => { void loadMyReservations(); setActiveTab('cart'); }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all ${activeTab === 'cart' ? 'bg-emerald-500 text-slate-950 shadow-md font-semibold' : 'text-slate-400 hover:text-white'}`}
            >
              <ShoppingBag className="w-4 h-4" /> Мои нарачки <span className="rounded-full bg-slate-700/70 px-1.5 text-[10px]">{myReservations.filter((item) => ['active', 'completed'].includes(item.status)).length}</span>
            </button>}
            {account.role === 'business' && <button
              onClick={() => setActiveTab('merchant')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === 'merchant' 
                  ? 'bg-emerald-500 text-slate-950 shadow-md font-semibold' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Camera className="w-4 h-4" />
              🏪 Објави понуда
            </button>}
            {account.role === 'business' && <button
              onClick={() => { void loadMyOffers(); setActiveTab('myOffers'); }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all ${activeTab === 'myOffers' ? 'bg-emerald-500 text-slate-950 shadow-md font-semibold' : 'text-slate-400 hover:text-white'}`}
            >
              <ShoppingBag className="w-4 h-4" /> Мои објави
            </button>}
            {account.role === 'admin' && <button
              onClick={() => setActiveTab('admin')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all ${activeTab === 'admin' ? 'bg-emerald-500 text-slate-950 shadow-md font-semibold' : 'text-slate-400 hover:text-white'}`}
            >
              <ShieldCheck className="w-4 h-4" /> Админ · одобрувања
            </button>}
            <button
              onClick={() => setActiveTab('esg')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === 'esg' 
                  ? 'bg-emerald-500 text-slate-950 shadow-md font-semibold' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Building2 className="w-4 h-4" />
              📊 Општина & ESG
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="page-container max-w-6xl mx-auto px-4 mt-6">

        {/* ------------------ VIEW 1: USER / CITIZEN ------------------ */}
        {activeTab === 'user' && (
          <div className="view-panel user-view space-y-6">
            {/* HERO BANNER */}
              <div className="hero-panel reveal bg-gradient-to-r from-emerald-900/40 via-slate-800 to-slate-800 border border-emerald-500/30 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                <ShoppingBag className="w-48 h-48 text-emerald-400" />
              </div>
              <div className="max-w-xl space-y-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Zap className="w-3.5 h-3.5" /> Зачувај храна во Прилеп
                </span>
                <h2 className="text-2xl sm:text-3xl font-bold text-white">
                  Купи вишок храна во Прилеп
                </h2>
                <p className="text-slate-300 text-sm">
                  Цените се прикажани во денари. Плаќањето оди директно до бизнисот преку MetaMask на Avalanche Fuji.
                </p>
              </div>
            </div>

            {/* MAP & OFFERS GRID */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* MOCK MAP */}
              <div className="map-panel reveal lg:col-span-1 bg-slate-800 rounded-2xl p-4 border border-slate-700 flex flex-col h-[320px] lg:h-auto">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-400" /> Интерактивна Мапа - Прилеп
                  </h3>
                  <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">{offers.length} понуди</span>
                </div>
                
                {/* Visual Map Representation */}
                <div className="relative flex-1 bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center">
                  {/* Decorative Map Lines */}
                  <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px]"></div>
                  
                  {offers.slice(0, 3).map((offer, index) => <div key={offer.id} className={`map-pin map-pin-${index + 1}`}>
                    <div>{offer.price} ден.</div><MapPin className="w-7 h-7 text-emerald-300" />
                  </div>)}

                  <p className="text-xs text-slate-500 relative z-10 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800">
                    📍 {offers.length ? 'Активни понуди во Прилеп' : 'Нови понуди наскоро во Прилеп'}
                  </p>
                </div>
              </div>

              {/* OFFERS LIST */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <ShoppingBag className="w-5 h-5 text-emerald-400" /> Понуди во близина
                  </h3>
                  <button type="button" className="reservation-complete-button" onClick={loadOffers}>Освежи понуди</button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!offersLoading && offers.length === 0 && <div className="empty-offers">{offersError ? <><ShieldCheck className="w-6 h-6" /><p>{offersError}</p></> : <><Leaf className="w-7 h-7" /><h4>Сè уште нема активни понуди</h4><p>Врати се малку подоцна или покани локален бизнис да објави пакет.</p></>}</div>}
                  {offers.map((offer) => {
                    const myReservation = myReservations.find((reservation) => reservation.chainOfferId === offer.chainOfferId && ['active', 'completed'].includes(reservation.status));
                    const isPurchased = myReservation?.status === 'completed';
                    const isReserved = myReservation?.status === 'active';
                    const isSoldOut = offer.available <= 0;
                    const canReserve = account.role === 'user' && !myReservation && !isSoldOut && Boolean(MARKETPLACE_ADDRESS);
                    return (
                    <div key={offer.id} className={`offer-card reveal bg-slate-800 border border-slate-700/80 hover:border-emerald-500/50 transition-all rounded-2xl overflow-hidden flex flex-col justify-between group ${isSoldOut ? 'offer-card-soldout' : ''}`}>
                      <div>
                        <div className="relative h-36 overflow-hidden bg-slate-950">
                          <img 
                            src={offer.image} 
                            alt={offer.title} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="absolute top-2 right-2 bg-slate-900/90 backdrop-blur text-emerald-400 text-xs font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 border border-emerald-500/30">
                            <Clock className="w-3.5 h-3.5" /> {offer.timer}
                          </div>
                          <div className="absolute bottom-2 left-2 bg-emerald-500 text-slate-950 text-xs font-bold px-2 py-0.5 rounded">
                            {offer.count}
                          </div>
                          {(isPurchased || isReserved || isSoldOut) && <span className={`offer-status-badge ${isPurchased ? 'offer-status-purchased' : isReserved ? 'offer-status-reserved' : 'offer-status-soldout'}`}>
                            {isPurchased ? 'ПОДИГНАТО' : isReserved ? 'ПЛАТЕНО' : 'РАСПРОДАДЕНО'}
                          </span>}
                        </div>

                        <div className="p-4 space-y-2">
                          <p className="text-xs text-slate-400 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-slate-500" /> {offer.store}
                          </p>
                          <h4 className="font-bold text-base text-white group-hover:text-emerald-300 transition-colors">
                            {offer.title}
                          </h4>
                          <p className="offer-availability">Достапни: <strong>{offer.available}</strong> од {offer.quantity}</p>
                          
                          <div className="flex items-baseline gap-2 pt-1">
                            <span className="text-2xl font-black text-emerald-400">{offer.priceMkd || offer.price} ден.</span>
                            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-bold border border-emerald-500/20">
                              -{offer.originalPrice > 0 ? Math.round((1 - offer.price / offer.originalPrice) * 100) : 0}%
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 pt-0">
                        <button
                          onClick={() => { if (!canReserve) return; if (!walletAddress) handleWalletConnect(); else if (walletChainId !== FUJI_CHAIN_ID) handleWalletSwitch(); else handleReserve(offer); }}
                          disabled={!canReserve || _isReserving}
                          className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm shadow-md shadow-emerald-500/10"
                        >
                          <Coins className="w-4 h-4" /> {account.role === 'business' ? 'Понуда на пазарот' : isPurchased ? 'Купено' : isReserved ? 'Платено · покажи QR' : isSoldOut ? 'Распродадено' : !MARKETPLACE_ADDRESS ? 'Договорот се поставува' : !walletAddress ? 'Поврзи MetaMask' : walletChainId !== FUJI_CHAIN_ID ? 'Смени на Fuji' : `Купи · ${offer.priceMkd || offer.price} ден.`}
                        </button>
                      </div>
                    </div>
                  )})}
                </div>
              </div>

            </div>
          </div>
        )}

        {activeTab === 'cart' && account.role === 'user' && (
          <section className="view-panel max-w-4xl mx-auto space-y-5">
            <div className="merchant-panel reveal bg-slate-800 border border-emerald-500/30 rounded-2xl p-6">
              <h2 className="text-xl font-bold flex items-center gap-2"><ShoppingBag className="w-5 h-5 text-emerald-400" /> Мои нарачки</h2>
              <p className="text-sm text-slate-300 mt-2">Купените пакети се чуваат тука. Плаќањето е директно од твојот MetaMask wallet до wallet-от на бизнисот.</p>
            </div>
            {reservationError && <p role="alert" className="reservation-error">{reservationError}</p>}
            {myReservations.filter((item) => ['active', 'completed'].includes(item.status)).length === 0 ? (
              <div className="empty-offers"><ShoppingBag className="w-7 h-7" /><h3>Сè уште немаш нарачки</h3><p>Купените пакети ќе се појават тука со зелена ознака „Купено“.</p></div>
            ) : myReservations.filter((item) => ['active', 'completed'].includes(item.status)).map((reservation) => (
              <article key={reservation.id} className="reservation-row">
                <div className="reservation-details">
                  <span className="reservation-state reservation-state-complete">{reservation.status === 'completed' ? 'ПОДИГНАТО' : 'КУПЕНО'}</span>
                  <h3>{reservation.offer?.title || 'Пакет'}</h3>
                  <p>{reservation.offer?.store} · {reservation.offer?.count} · {reservation.amountPaidMkd || reservation.offer?.priceMkd} ден.</p>
                  <p className="text-xs text-slate-500">Плаќање: директно до бизнисот · Tx {reservation.chainTxHash?.slice(0, 12)}…</p>
                </div>
                <button type="button" className="reservation-complete-button" onClick={() => { setSelectedOffer(reservation.offer); setVoucher({
                  id: `ZW-${reservation.chainReservationId}`,
                  offer: reservation.offer,
                  txHash: reservation.chainTxHash,
                  ticketToken: reservation.ticketToken,
                  amountPaidMkd: reservation.amountPaidMkd || reservation.offer?.priceMkd,
                  status: reservation.status,
                }); }}>Покажи QR</button>
              </article>
            ))}
          </section>
        )}

        {activeTab === 'admin' && account.role === 'admin' && (
          <section className="view-panel max-w-4xl mx-auto space-y-5">
            <div className="merchant-panel reveal bg-slate-800 border border-emerald-500/30 rounded-2xl p-6 space-y-2">
              <h2 className="text-xl font-bold flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-400" /> Преглед на објави</h2>
              <p className="text-sm text-slate-300">Бизнисите можат да објавуваат дури откако ќе платат месечна членарина. Секој пакет го проверуваш тука; одобрените се појавуваат на почетната страница.</p>
              <button type="button" className="reservation-complete-button" onClick={loadAdminOffers}>Освежи листа</button>
              {adminOffersError && <p role="alert" className="publish-error">{adminOffersError}</p>}
            </div>
            <div className="merchant-panel reveal bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Месечни членарини</h2>
                  <p className="text-sm text-slate-400">Членарината се активира веднаш по успешната Fuji трансакција. Овде можеш да ја провериш уплатата.</p>
                  {adminSubscriptions && <p className="text-emerald-300 font-semibold mt-2">Во договорот: {adminSubscriptions.revenueMkd} ден. ({adminSubscriptions.revenueAvax} AVAX) · членарина {adminSubscriptions.monthlyFeeMkd} ден.</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="reservation-complete-button" onClick={loadAdminSubscriptions}>Освежи членарини</button>
                  <button type="button" className="reservation-complete-button" disabled={withdrawingSubscriptionRevenue || !adminSubscriptions?.revenueAvax || Number(adminSubscriptions.revenueAvax) <= 0} onClick={handleWithdrawSubscriptionRevenue}>
                    {withdrawingSubscriptionRevenue ? 'Се повлекува…' : 'Повлечи приход преку MetaMask'}
                  </button>
                </div>
              </div>
              {adminSubscriptionsError && <p role="alert" className="publish-error">{adminSubscriptionsError}</p>}
              {adminSubscriptions?.businesses?.length ? <div className="space-y-2">
                {adminSubscriptions.businesses.map((business) => <article key={business.email} className="reservation-row">
                  <div className="reservation-details">
                    <span className={`reservation-state ${business.active ? 'reservation-state-complete' : 'reservation-state-active'}`}>{business.active ? 'ЧЛЕНАРИНА АКТИВНА' : 'НЕМА АКТИВНА ЧЛЕНАРИНА'}</span>
                    <h3>{business.name}</h3>
                    <p>{business.email}{business.expiresAt ? ` · важи до ${new Date(business.expiresAt).toLocaleString('mk-MK')}` : ''}</p>
                    {business.walletAddress && <code>{business.walletAddress}</code>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {business.txHash && <a className="reservation-complete-button" href={`https://build.avax.network/explorer/fuji/c-chain/tx/${business.txHash}`} target="_blank" rel="noreferrer">Види уплата ↗</a>}
                  </div>
                </article>)}
              </div> : !adminSubscriptionsError && <p className="text-sm text-slate-400">Сè уште нема бизнис-сметки.</p>}
            </div>
            {adminOffers.length === 0 ? <div className="empty-offers"><CheckCircle2 className="w-7 h-7" /><h3>Нема понуди за преглед</h3><p>Новите пакети од бизнисите ќе се појават тука.</p></div> : adminOffers.map((offer) => <article key={offer.chainOfferId} className="merchant-panel reveal bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4">
                <img src={offer.image} alt={offer.title} className="w-full h-32 object-cover rounded-xl bg-slate-950" />
                <div className="space-y-2">
                  <span className="offer-status-badge offer-status-reserved">ЧЕКА ОДОБРУВАЊЕ</span>
                  <h3 className="text-lg font-bold text-white">{offer.title}</h3>
                  <p className="text-sm text-slate-300">{offer.count}</p>
                  <p className="text-emerald-300 font-bold">Цена: {offer.priceMkd || offer.price} ден. · Количина: {offer.quantity}</p>
                  <p className="text-xs text-slate-400">Бизнис: {offer.business} · {offer.businessEmail}{offer.businessContact ? ` · ${offer.businessContact}` : ''}</p>
                  <p className="text-xs text-slate-400">Подигнување до: {new Date(offer.pickupDeadline).toLocaleString('mk-MK')}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" className="reservation-complete-button admin-offer-approve" disabled={adminReviewingOffer === offer.chainOfferId} onClick={() => handleAdminOfferDecision(offer, 'approve')}>{adminReviewingOffer === offer.chainOfferId ? 'Се зачувува…' : 'Одобри и објави'}</button>
                <button type="button" className="reservation-complete-button admin-offer-reject" disabled={adminReviewingOffer === offer.chainOfferId} onClick={() => handleAdminOfferDecision(offer, 'reject')}>Одбиј</button>
              </div>
            </article>)}
            <div className="merchant-panel reveal bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-lg font-bold">Сите објави</h2><p className="text-sm text-slate-400">Отстрани несоодветна објава од понудите. Постојните нарачки и QR купони остануваат зачувани.</p></div>
                <button type="button" className="reservation-complete-button" onClick={loadAdminAllOffers}>Освежи објави</button>
              </div>
              {adminAllOffers.map((offer) => <article key={offer.chainOfferId} className="reservation-row">
                <div className="reservation-details">
                  <span className={`reservation-state ${offer.status === 'active' ? 'reservation-state-complete' : 'reservation-state-active'}`}>{offer.status === 'pending' ? 'ЧЕКА ОДОБРУВАЊЕ' : offer.status === 'active' ? 'ОБЈАВЕНО' : offer.status === 'soldout' ? 'РАСПРОДАДЕНО' : offer.status === 'closed' ? 'ОТСТРАНЕТО' : offer.status === 'rejected' ? 'ОДБИЕНО' : offer.status.toUpperCase()}</span>
                  <h3>{offer.title}</h3><p>{offer.business} · {offer.businessEmail} · {offer.priceMkd || offer.price} ден.</p>
                </div>
                {offer.status !== 'closed' && <button type="button" className="reservation-complete-button" disabled={adminReviewingOffer === offer.chainOfferId} onClick={() => handleAdminDeleteOffer(offer)}>{adminReviewingOffer === offer.chainOfferId ? 'Се отстранува…' : 'Отстрани објава'}</button>}
              </article>)}
            </div>
          </section>
        )}

        {/* ------------------ VIEW 2: MERCHANT / AI SCANNER ------------------ */}
        {activeTab === 'merchant' && (
          <div className="view-panel merchant-view max-w-4xl mx-auto space-y-6">
            <div className="merchant-panel reveal bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-6">
              
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-emerald-400" /> Објави вишок храна <span className="prototype-tag">AI скенер: прототип</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Скенирањето сè уште е демо. Членарината важи 30 дена; објавувањето бара бесплатен MetaMask потпис, без gas-трансакција.
                </p>
              </div>

              {/* CAMERA SIMULATOR BOX */}
              <div className="relative border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-2xl p-8 text-center bg-slate-950/50 transition-colors flex flex-col items-center justify-center min-h-[260px]">
                {!aiDetected && !isAnalyzing && (
                  <div className="space-y-4">
                    <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto text-emerald-400 border border-slate-700">
                      <Camera className="w-8 h-8" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">Подготви демо-предлог за пакетот</p>
                      <p className="text-xs text-slate-500 mt-1">AI обработка на фотографија ќе додадеме како следен модул.</p>
                    </div>
                    <button
                      onClick={handleAiScan}
                      className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl transition-all text-sm shadow-lg shadow-emerald-500/20"
                    >
                      ✨ Прикажи демо-предлог
                    </button>
                  </div>
                )}

                {isAnalyzing && (
                  <div className="space-y-3">
                    <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="text-sm font-medium text-emerald-400 animate-pulse">
                      Се подготвува демо-предлог...
                    </p>
                  </div>
                )}

                {aiDetected && !isAnalyzing && (
                  <div className="w-full space-y-4 text-left">
                    <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold">
                        <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> AI Препознавање Успешно</span>
                        <span>Точност: 98.4%</span>
                      </div>
                        <h4 className="font-bold text-white text-base">Предлог пакет за проверка</h4>
                      <p className="text-xs text-slate-300">
                        • Содржина: ~10 пецива (3 Буреци, 4 Кифли, 3 Ѓевреци)
                      </p>
                      <div className="pt-2 border-t border-emerald-500/20 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-400">Редовна вредност: <span className="line-through">{offerDraft.originalPrice || '—'} МКД</span></p>
                          <p className="text-lg font-black text-emerald-400">Цена што ќе ја внесете подолу</p>
                        </div>
                      </div>
                    </div>

                    <div className="offer-form">
                      <label>Наслов на понудата<input value={offerDraft.title} maxLength={120} onChange={(event) => setOfferDraft({ ...offerDraft, title: event.target.value })} /></label>
                      <label>Содржина на пакетот<input value={offerDraft.count} maxLength={180} onChange={(event) => setOfferDraft({ ...offerDraft, count: event.target.value })} /></label>
                      <div className="offer-form-row">
                        <label>Редовна вредност · МКД<input type="number" min="0" step="1" value={offerDraft.originalPrice} onChange={(event) => setOfferDraft({ ...offerDraft, originalPrice: event.target.value })} /></label>
                        <label>Цена на пакет · МКД<input type="number" min="1" step="1" value={offerDraft.price} onChange={(event) => setOfferDraft({ ...offerDraft, price: event.target.value })} /></label>
                      </div>
                      <p className="text-sm text-slate-300">Цената за купувачите се прикажува во денари. Во Fuji тестот износот автоматски се пресметува во AVAX по фиксниот курс 1 AVAX = {TEST_MKD_PER_AVAX.toLocaleString('mk-MK')} денари.</p>
                      <div className="offer-form-row">
                        <label>Достапна количина<input type="number" min="1" max="500" step="1" value={offerDraft.quantity} onChange={(event) => setOfferDraft({ ...offerDraft, quantity: event.target.value })} /></label>
                        <label>Време за подигнување<select value={offerDraft.pickupHours} onChange={(event) => setOfferDraft({ ...offerDraft, pickupHours: event.target.value })}><option value="1">Во следниот 1 час</option><option value="2">Во следните 2 часа</option><option value="4">Во следните 4 часа</option><option value="8">Во следните 8 часа</option></select></label>
                      </div>
                      <p>По потпишувањето, пакетот ќе чека одобрување од администраторот. Купувачот го плаќа пакетот во Fuji; бизнисот ја потврдува испораката.</p>
                    </div>

                    {publishError && <p role="alert" className="publish-error">{publishError}</p>}
                    <button
                      onClick={handlePublish}
                      disabled={published || isPublishing}
                      className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl transition-all text-sm flex items-center justify-center gap-2"
                    >
                        {isPublishing ? (
                        <> <span className="publish-spinner" /> Потпиши ја објавата во MetaMask… </>
                      ) : published ? (
                        <> <CheckCircle2 className="w-5 h-5" /> Испратено за одобрување </>
                      ) : (
                        <> <Zap className="w-4 h-4" /> Потпиши и испрати на преглед </>
                      )}
                    </button>
                  </div>
                )}
              </div>

            </div>

            <section className="merchant-panel reveal bg-slate-800 border border-emerald-500/30 rounded-2xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Месечна членарина</h2>
                  <p className="text-sm text-slate-300">500 денари месечно, што во овој Fuji тест е 0.01 AVAX. По успешната уплата членарината се активира веднаш за 30 дена.</p>
                  {businessSubscription?.active && <p className="text-xs text-emerald-300 mt-2">Активна до {new Date(Number(businessSubscription.expiresAt) * 1000).toLocaleString('mk-MK')}</p>}
                  {subscriptionError && <p role="alert" className="publish-error mt-2">{subscriptionError}</p>}
                </div>
                <button type="button" onClick={handleSubscribe} disabled={isSubscribing || (businessSubscription?.active && businessSubscription.walletAddress?.toLowerCase() !== walletAddress.toLowerCase())} className="shrink-0 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold px-5 py-3 rounded-xl">
                  {isSubscribing ? 'Се плаќа…' : businessSubscription?.active ? 'Продолжи за 500 ден. / 30 дена' : 'Плати 500 ден. / месец'}
                </button>
              </div>
            </section>

            <section className="merchant-panel reveal bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-5">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2"><ShoppingBag className="w-5 h-5 text-emerald-400" /> Резервации и подигнувања</h2>
              <p className="text-xs text-slate-400 mt-1">Купувачот плаќа директно на твојот wallet на Fuji. Потврди го подигнувањето во апликацијата откако ќе го предадеш пакетот.</p>
              </div>
              {businessReservationError && <p role="alert" className="publish-error">{businessReservationError}</p>}
              {businessReservations.length === 0 ? <div className="empty-offers"><ShoppingBag className="w-6 h-6" /><h4>Сè уште нема резервации</h4><p>Новите резервации од граѓаните ќе се појават тука.</p></div> : (
                <div className="reservation-list">
                  {businessReservations.map((reservation) => (
                    <article key={reservation.id} className="reservation-row">
                      <div className="reservation-details">
                        <span className={`reservation-state ${reservation.status === 'completed' ? 'reservation-state-complete' : 'reservation-state-active'}`}>
                          {reservation.status === 'completed' ? 'ПОДИГНАТО' : reservation.status === 'active' ? 'ПЛАТЕНО' : reservation.status === 'cancelled' ? 'ОТКАЖАНО' : 'ИСТЕЧЕНО'}
                        </span>
                        <h3>{reservation.offer?.title || 'Понуда'}</h3>
                        <p>{reservation.offer?.store} · {reservation.offer?.count} · {reservation.amountPaidMkd} ден.</p>
                        <code>Купувач: {reservation.customerName ? `${reservation.customerName} · ` : ''}{reservation.customerWallet.slice(0, 6)}…{reservation.customerWallet.slice(-4)}</code>
                      </div>
                      {reservation.status === 'active' && <button
                        type="button"
                        onClick={() => handleCompleteReservation(reservation)}
                        disabled={completingReservation === reservation.id}
                        className="reservation-complete-button"
                      >
                        {completingReservation === reservation.id ? 'Се потврдува...' : 'Потврди подигнување'}
                      </button>}
                      {reservation.status === 'completed' && <span className="reservation-complete-note"><CheckCircle2 className="w-4 h-4" /> Подигнато и потврдено</span>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'myOffers' && account.role === 'business' && (
          <section className="view-panel max-w-4xl mx-auto space-y-5">
            <div className="merchant-panel reveal bg-slate-800 border border-emerald-500/30 rounded-2xl p-6 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="text-xl font-bold">Мои објави</h2><p className="text-sm text-slate-300 mt-1">Следи го статусот. Одобрените пакети веднаш се појавуваат на почетната страница за корисниците и бизнисите.</p></div>
                <button type="button" className="reservation-complete-button" onClick={loadMyOffers}>Освежи</button>
              </div>
            </div>
            {myOffers.length === 0 ? <div className="empty-offers"><ShoppingBag className="w-7 h-7" /><h3>Сè уште немаш објави</h3><p>Подготви пакет во табот „Објави понуда“.</p></div> : myOffers.map((offer) => <article key={offer.chainOfferId} className="merchant-panel reveal bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <div className="reservation-details">
                <span className={`reservation-state ${offer.status === 'active' ? 'reservation-state-complete' : offer.status === 'rejected' ? 'reservation-state-rejected' : 'reservation-state-active'}`}>
                  {offer.status === 'pending' ? 'ЧЕКА ОДОБРУВАЊЕ' : offer.status === 'active' ? 'ОДОБРЕНО · ОБЈАВЕНО' : offer.status === 'rejected' ? 'ОДБИЕНА' : offer.status === 'soldout' ? 'РАСПРОДАДЕНО' : 'ОТСТРАНЕНО'}
                </span>
                <h3>{offer.title}</h3>
                <p>{offer.priceMkd || offer.price} ден. · {offer.available} од {offer.quantity} достапни</p>
                {offer.status === 'rejected' && <p className="offer-rejection-feedback">Одбиена од администратор.{offer.adminDecisionReason ? ` Причина: ${offer.adminDecisionReason}` : ''}</p>}
              </div>
            </article>)}
          </section>
        )}

        {/* ------------------ VIEW 3: ESG DASHBOARD / MUNICIPALITY ------------------ */}
        {activeTab === 'esg' && (
          <div className="view-panel esg-view space-y-6">
            <div className="dashboard-panel reveal bg-slate-800 border border-slate-700 rounded-2xl p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-700 pb-4">
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-emerald-400" /> Општина Прилеп & ESG Корпоративен Панел
                  </h2>
                  <p className="text-xs text-slate-400">
                    Демо-приказ. ESG бројките ќе се пресметуваат од потврдени подигнувања на Fuji.
                  </p>
                </div>
                <button className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold px-4 py-2 rounded-xl border border-slate-600 transition-colors flex items-center gap-2 self-start sm:self-auto">
                  <Award className="w-4 h-4 text-emerald-400" /> Генерирај ESG Сертификат
                </button>
              </div>

              {/* STATS METRICS */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                <div className="metric-card reveal bg-slate-900/60 border border-slate-700/80 p-4 rounded-xl">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Спасена Храна (Прилеп)</span>
                    <ShoppingBag className="w-4 h-4 text-emerald-400" />
                  </div>
                  <p className="text-2xl font-black text-white">1,420 kg</p>
                  <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> +18% овој месец
                  </p>
                </div>

                <div className="metric-card reveal bg-slate-900/60 border border-slate-700/80 p-4 rounded-xl">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Спречени CO₂ Емисии</span>
                    <Leaf className="w-4 h-4 text-teal-400" />
                  </div>
                  <p className="text-2xl font-black text-white">3,550 kg</p>
                  <p className="text-[10px] text-teal-400 mt-1 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Верификувано на Avalanche
                  </p>
                </div>

                <div className="metric-card reveal bg-slate-900/60 border border-slate-700/80 p-4 rounded-xl">
                  <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
                    <span>Социјални Ваучери (НВО/Општина)</span>
                    <Coins className="w-4 h-4 text-amber-400" />
                  </div>
                  <p className="text-2xl font-black text-white">450 Пакети</p>
                  <p className="text-[10px] text-amber-400 mt-1">
                    100% Транспарентни донации
                  </p>
                </div>
              </div>

              {/* AVALANCHE CONTRACT LOGS */}
              <div className="transactions-panel reveal mt-6 space-y-3">
                <h3 className="text-sm font-semibold text-slate-300">
                  ⛓️ Пример Fuji трансакции — демо податоци
                </h3>
                <div className="bg-slate-950 rounded-xl p-3 border border-slate-800 text-xs space-y-2 font-mono">
                  <div className="flex items-center justify-between text-slate-400 border-b border-slate-800/80 pb-2">
                    <span>Tx Hash</span>
                    <span>Бизнис / Локација</span>
                    <span>Параметри</span>
                    <span>Статус</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-emerald-400">0x8f3a...c92b</span>
                    <span>Пекарница Билјана</span>
                    <span>10 пар. / 60 MKD</span>
                    <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Confirmed</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-emerald-400">0x3e1d...f40a</span>
                    <span>Слаткарница Деликатес</span>
                    <span>8 пар. / 60 MKD</span>
                    <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Confirmed</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* MODAL FOR VOUCHER / QR CODE */}
      {selectedOffer && (
        <div className="voucher-backdrop fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="voucher-card bg-slate-800 border border-slate-700 rounded-2xl max-w-sm w-full p-6 space-y-5 text-center relative shadow-2xl">
            
            {!voucher && !_isReserving && reservationError ? (
              <div className="py-5 space-y-4"><div className="reservation-error"><ShieldCheck className="w-6 h-6" /><p>{reservationError}</p></div><button onClick={() => { setSelectedOffer(null); setReservationError(''); }} className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-xs">Затвори</button></div>
            ) : !voucher ? (
              <div className="py-8 space-y-3">
                <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-sm font-semibold text-emerald-400">
                  Чекаме потврда за купувањето на Fuji...
                </p>
                <p className="text-xs text-slate-500">Потврди ја тест-уплатата во MetaMask.</p>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {voucher.status === 'completed' ? 'ПОДИГНАТО' : 'ПЛАТЕНО · ЧЕКА ПОДИГНУВАЊЕ'}
                  </span>
                  <h3 className="text-lg font-bold text-white">{voucher.offer.title}</h3>
                  <p className="text-xs text-slate-400">{voucher.offer.store}</p>
                </div>

                {/* QR opens a Fuji-verified ticket linked to the buyer and product. */}
                <div className="voucher-qr-frame bg-white p-3 rounded-xl mx-auto shadow-inner">
                  <QRCodeSVG className="voucher-qr" value={`${window.location.origin}/?ticket=${encodeURIComponent(voucher.ticketToken)}`} size={256} level="M" marginSize={4} title="ZeroWaste платен купон" />
                  <p className="text-[10px] text-slate-600 font-mono mt-1">{voucher.id}</p>
                </div>

                <div className="bg-slate-900 p-3 rounded-xl text-left text-xs space-y-1 border border-slate-700/60 font-mono">
                  <div className="flex justify-between text-slate-400">
                    <span>Сума:</span>
                  <span className="text-emerald-400 font-bold">{voucher.amountPaidMkd || voucher.offer.priceMkd || voucher.offer.price} ден. · директно платено на Fuji</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Avalanche Tx:</span>
                    <span className="text-slate-300 truncate max-w-[140px]">{voucher.txHash}</span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400">
                  QR-кодот ги потврдува купувачот, производот и плаќањето. Покажи го во продавницата при подигнување.
                </p>

                <button
                  onClick={() => { setSelectedOffer(null); setVoucher(null); }}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-2.5 rounded-xl text-xs transition-colors"
                >
                  Затвори
                </button>
              </>
            )}

          </div>
        </div>
      )}

    </div>
  );
}

