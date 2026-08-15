export const CONTRACT  = '0x434a71EE1E6D139B62Ea9E4728d4fBCdBC793ABf'
export const CHAIN_ID  = '0x107D'
export const RPC_URL   = 'https://rpc-bradbury.genlayer.com'
export const EXPLORER  = 'https://explorer-bradbury.genlayer.com'
export const NET_CFG   = {
  chainId: CHAIN_ID, chainName: 'GenLayer Bradbury',
  rpcUrls: [RPC_URL],
  nativeCurrency: { name:'GEN', symbol:'GEN', decimals:18 },
  blockExplorerUrls: [EXPLORER]
}
export const sh  = a  => a?.length > 10 ? a.slice(0,6)+'…'+a.slice(-4) : (a||'')
export const fmt = n  => Number(n||0).toLocaleString()

// Exact decimal helpers for GEN values. Never route wei through Number:
// JavaScript loses precision above 2^53, while wallet and contract values are
// 18-decimal integers.
export function genToWei(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Invalid GEN amount')
  const [whole, fraction = ''] = text.split('.')
  if (fraction.length > 18) throw new Error('GEN amount has more than 18 decimals')
  return BigInt(whole) * 1000000000000000000n + BigInt((fraction + '0'.repeat(18)).slice(0, 18))
}

export function weiToGen(wei, decimals = 4) {
  const amount = BigInt(String(wei ?? 0))
  const base = 1000000000000000000n
  const whole = amount / base
  if (decimals <= 0) return whole.toString()
  const scale = 10n ** BigInt(decimals)
  const fraction = ((amount % base) * scale) / base
  return whole.toString() + '.' + fraction.toString().padStart(decimals, '0')
}
