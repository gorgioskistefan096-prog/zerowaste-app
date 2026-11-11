import { MARKETPLACE_ABI } from './marketplaceAbi.js'

export const FUJI_CHAIN_ID = 43113n
export const MARKETPLACE_ADDRESS = import.meta.env.VITE_MARKETPLACE_ADDRESS || ''
export const TEST_MKD_PER_AVAX = 50000n

export function mkdToWei(value) {
  const amount = String(value).trim()
  if (!/^[1-9]\d*$/.test(amount)) throw new Error('Внеси цена во цели денари поголема од нула.')
  return (BigInt(amount) * 10n ** 18n / TEST_MKD_PER_AVAX).toString()
}

export function weiToMkd(value) {
  return (BigInt(value) * TEST_MKD_PER_AVAX / 10n ** 18n).toString()
}

export function parseAvaxToWei(value) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(String(value).trim())
  if (!match) throw new Error('Внеси AVAX сума со најмногу 18 децимали.')
  const fractionWei = BigInt((match[2] || '').padEnd(18, '0') || '0')
  return (BigInt(match[1]) * 10n ** 18n + fractionWei).toString()
}

function getInjectedWallet() {
  if (!window.ethereum) throw new Error('Не е најден MetaMask. Инсталирај MetaMask и отвори ја апликацијата во негов прелистувач.')
  return window.ethereum
}

export async function connectMetaMask() {
  const { BrowserProvider } = await import('ethers')
  const ethereum = getInjectedWallet()
  const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
  if (!accounts?.length) throw new Error('Не избра wallet сметка.')
  const provider = new BrowserProvider(ethereum)
  const network = await provider.getNetwork()
  return { address: accounts[0], chainId: network.chainId }
}

export async function switchMetaMaskToFuji() {
  const ethereum = getInjectedWallet()
  try {
    await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa869' }] })
  } catch (error) {
    if (error.code !== 4902) throw error
    await ethereum.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: '0xa869', chainName: 'Avalanche Fuji C-Chain',
      nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
      rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
      blockExplorerUrls: ['https://explorer-test.avax.network/c-chain'],
    }] })
  }
  return connectMetaMask()
}

export async function getMarketplaceContract() {
  const { BrowserProvider, Contract, isAddress } = await import('ethers')
  if (!MARKETPLACE_ADDRESS || !isAddress(MARKETPLACE_ADDRESS)) {
    throw new Error('Договорот сè уште не е поставен. По Fuji деплојот додај ја адресата во VITE_MARKETPLACE_ADDRESS во .env.')
  }
  const ethereum = getInjectedWallet()
  const provider = new BrowserProvider(ethereum)
  const network = await provider.getNetwork()
  if (network.chainId !== FUJI_CHAIN_ID) throw new Error('Смени ја MetaMask мрежата на Avalanche Fuji пред да продолжиш.')
  const deployedCode = await provider.getCode(MARKETPLACE_ADDRESS)
  if (deployedCode === '0x') throw new Error('На оваа адреса нема smart contract на Fuji. Провери ја адресата во .env.')
  const signer = await provider.getSigner()
  const contract = new Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer)
  try {
    const version = await contract.version()
    if (version !== 3n) throw new Error('Потребен е новиот ZeroWaste договор со членарина и AVAX плаќање.')
  } catch (error) {
    if (error.message === 'Потребен е новиот ZeroWaste договор со членарина и AVAX плаќање.') throw error
    throw new Error('Поставениот договор е стара верзија. Постави го новиот ZeroWaste договор со членарина на Fuji и смени ја адресата во .env.')
  }
  return { contract, signer }
}
