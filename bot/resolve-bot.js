// Gen Markets resolve-bot.
//
// Reads every market, finds any that are still OPEN with a deadline that
// has already passed, and calls resolve_market on a small batch of them.
// The wallet running this must already be added as an admin via
// admin_add (owner-only) — resolve_market checks owner-or-admin on-chain,
// this script does not bypass that, it just holds admin credentials.
//
// Env vars required:
//   BOT_PRIVATE_KEY     private key of the admin wallet, gas-funded only
//   CONTRACT_ADDRESS    deployed PredictionMarket contract address
//
// Intentionally narrow: this script only ever calls resolve_market. It
// does not refresh odds, create markets, or touch funds in any way.

import { createClient, createAccount } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'

const CONTRACT     = process.env.CONTRACT_ADDRESS
const PRIVATE_KEY  = process.env.BOT_PRIVATE_KEY
const MAX_PER_RUN  = 2   // throttled on purpose, see design notes below

if (!CONTRACT || !PRIVATE_KEY) {
  console.error('Missing required env var: CONTRACT_ADDRESS or BOT_PRIVATE_KEY')
  process.exit(1)
}

const account = createAccount(PRIVATE_KEY)
const client  = createClient({ chain: testnetBradbury, account })

// Deadlines are stored as toUTCString() output, same format the frontend
// already relies on (see MarketCard.jsx isDeadlinePassed). Mirrored here
// rather than imported since this script runs standalone in CI, outside
// the Vite build.
function isDeadlinePassed(raw) {
  if (!raw || raw === 'No deadline') return false
  const t = Date.parse(raw)
  if (isNaN(t)) return false
  return Date.now() > t
}

async function main() {
  console.log(`[${new Date().toISOString()}] resolve-bot starting, contract ${CONTRACT}`)

  const raw = await client.readContract({
    address: CONTRACT,
    functionName: 'get_all_markets',
    args: [],
    transactionHashVariant: 'latest-nonfinal',
  })

  const markets = (!raw || raw === 'NO_MARKETS') ? [] : JSON.parse(raw)
  if (!Array.isArray(markets) || markets.length === 0) {
    console.log('No markets found, nothing to do')
    return
  }

  const expired = markets.filter(m => m.status === 'OPEN' && isDeadlinePassed(m.deadline))
  console.log(`${markets.length} total markets, ${expired.length} OPEN and past deadline`)

  if (expired.length === 0) return

  // One or two per run, not the whole backlog at once. A bug in a single
  // resolve call shouldn't be able to burn through the whole batch's gas
  // in one run, and the next scheduled run picks up whatever's left.
  const batch = expired.slice(0, MAX_PER_RUN)

  for (const m of batch) {
    const label = (m.question || '').slice(0, 60)
    console.log(`Resolving market #${m.id}: "${label}"`)
    try {
      const hash = await client.writeContract({
        address: CONTRACT,
        functionName: 'resolve_market',
        args: [m.id],
        value: 0n,
      })
      console.log(`  submitted: ${hash}`)
    } catch (e) {
      // resolve_market can legitimately throw a real contract-level
      // exception, e.g. the AI referee judging the deadline hasn't
      // truly passed yet. That is expected occasionally, not a bot
      // failure, log it and move on to the next market in the batch.
      console.log(`  resolve failed for #${m.id}: ${e.message || e}`)
    }
  }

  console.log('Run complete')
}

main().catch(e => {
  console.error('Bot run failed:', e)
  process.exit(1)
})
