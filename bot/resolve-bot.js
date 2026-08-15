// Gen Markets resolve-and-schedule bot.
//
// Two jobs, each run:
//   1. Resolve any OPEN market whose on-chain deadline has passed.
//   2. Keep exactly one OPEN market running per schedule type (daily,
//      weekly, monthly) — if a type has no OPEN market right now, create
//      one. This self-heals: the moment job 1 resolves an expired daily
//      market, the next run sees no OPEN daily market and creates the
//      next one. The contract derives scheduled deadlines from its
//      deterministic transaction clock; the bot only uses deadline_ts to
//      avoid submitting obviously early resolve transactions.
//
// The wallet running this must already be added as an admin via
// admin_add (owner-only) for job 2 — scheduled market creation is
// owner/admin-gated. Resolution itself is permissionless after the
// contract deadline, so any funded account can call it.
//
// Env vars required:
//   BOT_PRIVATE_KEY     private key of the admin wallet, gas-funded only
//   CONTRACT_ADDRESS    deployed PredictionMarket contract address
//
// Intentionally narrow beyond that: this script only ever calls
// resolve_market and create_*_market. It never touches funds, never
// calls withdraw, never manages the admin list.

import { createClient, createAccount } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'

const CONTRACT     = process.env.CONTRACT_ADDRESS
const PRIVATE_KEY  = process.env.BOT_PRIVATE_KEY
const MAX_PER_RUN  = 2   // throttled on purpose, see design notes below

const SCHEDULE_TYPES = ['daily', 'weekly', 'monthly']
// Scheduled deadlines are derived inside the contract from deterministic
// transaction time; the bot never supplies an authoritative timestamp.

if (!CONTRACT || !PRIVATE_KEY) {
  console.error('Missing required env var: CONTRACT_ADDRESS or BOT_PRIVATE_KEY')
  process.exit(1)
}

const account = createAccount(PRIVATE_KEY)
const client  = createClient({ chain: testnetBradbury, account })

// deadline_ts is Unix seconds. Mirrored here rather than imported since this
// script runs standalone in CI, outside the Vite build. It is only a local
// preflight; the contract re-checks its own clock.
function isDeadlinePassed(deadlineTs) {
  const ts = Number.parseInt(String(deadlineTs || '0'), 10)
  return Number.isFinite(ts) && ts > 0 && Math.floor(Date.now() / 1000) >= ts
}

async function getMarkets() {
  const raw = await client.readContract({
    address: CONTRACT,
    functionName: 'get_all_markets',
    args: [],
    transactionHashVariant: 'latest-nonfinal',
  })
  const markets = (!raw || raw === 'NO_MARKETS') ? [] : JSON.parse(raw)
  return Array.isArray(markets) ? markets : []
}

async function resolveExpired(markets) {
  const expired = markets.filter(m => m.status === 'OPEN' && isDeadlinePassed(m.deadline_ts))
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
}

async function keepScheduledMarketsRunning(markets) {
  for (const type of SCHEDULE_TYPES) {
    const hasOpen = markets.some(m => m.schedule_type === type && m.status === 'OPEN')
    if (hasOpen) {
      console.log(`${type}: an OPEN market already exists, skipping`)
      continue
    }

    console.log(`${type}: no OPEN market, creating one`)
    try {
      const hash = await client.writeContract({
        address: CONTRACT,
        functionName: `create_${type}_market`,
        args: ['', new Date().toUTCString()],
        value: 0n,
      })
      console.log(`  submitted: ${hash}`)
    } catch (e) {
      console.log(`  create_${type}_market failed: ${e.message || e}`)
    }
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] bot starting, contract ${CONTRACT}`)

  const markets = await getMarkets()
  if (markets.length === 0) {
    console.log('No markets found yet')
  } else {
    await resolveExpired(markets)
  }

  // Re-check after resolving, a market that just got resolved above should
  // free up its schedule_type slot for a fresh one in this same run rather
  // than waiting a full extra cycle.
  const freshMarkets = await getMarkets()
  await keepScheduledMarketsRunning(freshMarkets)

  console.log('Run complete')
}

main().catch(e => {
  console.error('Bot run failed:', e)
  process.exit(1)
})
