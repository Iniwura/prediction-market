export const CONTRACT  = '0x36584c3D7B1C382DF1A240d18AA61759F15a0B86'
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
