export const CONTRACT  = '0x0AeA8a6D89E8F2BE6411C7323C5C2D5daC01272A'
export const CONSENSUS = '0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D'
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
