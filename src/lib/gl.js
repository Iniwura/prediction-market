// ── GenLayer client — real SDK, not hand-built calldata ────────────
//
// Previous versions of this file manually reverse-engineered the
// Consensus contract's transaction calldata format. That approach
// worked for simple method calls but had no reliable path for
// forwarding GEN value into gl.message.value inside GenVM — confirmed
// by testing fund() on a payable contract: outer transaction accepted,
// but contract-side gl.message.value read as 0.
//
// This version uses genlayer-js, the official SDK, which handles all
// encoding — including value transfers — correctly and is what every
// working GenLayer dApp (including the reference contracts we studied)
// actually uses in production.
import { createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'

let _client = null

function getClient(account) {
  // Recreate the client if the active account changes, since the SDK
  // binds the signing account at client-creation time.
  if (!_client || _client._account !== account) {
    _client = createClient({
      chain: testnetBradbury,
      account: account || undefined,   // just the address — MetaMask signs
      provider: window.ethereum,        // wires up MetaMask as the signer
    })
    _client._account = account
  }
  return _client
}

// ── readContract ──────────────────────────────
// transactionHashVariant 'latest-nonfinal' is critical — without it,
// reads only return FINALIZED state, which lags far behind ACCEPTED
// state during GenLayer's appeal/finality window.
export async function readContract(addr, method, args = []) {
  const client = getClient(window._glAccount)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1200 * attempt))
    try {
      const result = await client.readContract({
        address: addr,
        functionName: method,
        args,
        transactionHashVariant: 'latest-nonfinal',
      })
      if (result === null || result === undefined) return null
      // Contract methods in this app return JSON strings — pass through as-is.
      // Non-string results (rare) get stringified so callers can JSON.parse uniformly.
      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (e) {
      if (attempt === 2) throw e
    }
  }
  return null
}

// ── writeContract ─────────────────────────────
// value is now a real bigint GEN amount (in wei units), not a hex string.
// The SDK handles all calldata encoding, including forwarding value into
// gl.message.value inside the contract — this is the piece the old
// hand-built encoder never did correctly.
export async function writeContract(contractAddr, account, method, args = [], leaderOnly = false, value = 0n) {
  const client = getClient(account)
  const hash = await client.writeContract({
    address: contractAddr,
    functionName: method,
    args,
    value: typeof value === 'bigint' ? value : BigInt(value),
    leaderOnly,
  })
  return hash
}

// ── getTxCreatedAt ─────────────────────────────
// Fetches the transaction's on-chain Created timestamp (Unix seconds).
export async function getTxCreatedAt(hash) {
  try {
    const client = getClient(window._glAccount)
    const raw = await client.request({ method: 'gen_getTransaction', params: [hash] })
    const ts = raw?.timestamps?.Created || raw?.timestamps?.created || 0
    return parseInt(ts) || 0
  } catch (e) {
    return 0
  }
}

// ── waitForTxStatus ────────────────────────────
export async function waitForTxStatus(hash, onStatus, timeoutMs = 90000) {
  const client = getClient(window._glAccount)
  const start = Date.now()
  let lastStatus = ''
  while (Date.now() - start < timeoutMs) {
    try {
      const raw = await client.request({ method: 'gen_getTransactionStatus', params: [hash] })
      const status = (typeof raw === 'string' ? raw : raw?.status || raw?.Status || '').toUpperCase()
      if (status && status !== lastStatus) {
        lastStatus = status
        onStatus && onStatus(status)
      }
      if (status === 'ACCEPTED' || status === 'FINALIZED') return status
      if (status === 'CANCELED' || status === 'UNDETERMINED') return status
    } catch (e) { /* best-effort channel */ }
    await new Promise(r => setTimeout(r, 2500))
  }
  return lastStatus
}

// ── pollForChange ──────────────────────────────
// Reliable completion driver — polls actual contract state via the
// fixed (latest-nonfinal) readContract above until checkFn is truthy.
export async function pollForChange(checkFn, { intervalMs = 2500, timeoutMs = 120000 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await checkFn()
      if (result) return result
    } catch (e) { /* keep polling through transient read errors */ }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error('Still waiting on confirmation — check explorer-bradbury.genlayer.com for this transaction')
}

export const CHAIN_ID = '0x107D'
export const NET = {
  chainId: CHAIN_ID, chainName: 'GenLayer Bradbury',
  rpcUrls: ['https://rpc-bradbury.genlayer.com'],
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  blockExplorerUrls: ['https://explorer-bradbury.genlayer.com'],
}
