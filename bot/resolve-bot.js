// Gen Markets resolve-and-schedule bot.
//
// Two jobs, each run:
//   1. Resolve OPEN markets whose on-chain deadline has passed.
//   2. Keep one OPEN market per schedule type: daily, weekly, monthly.
//
// Scheduled creation is deterministic inside the contract.
// The bot waits for every write to reach ACCEPTED before continuing.
// UNDETERMINED, CANCELED, or execution errors fail the run.

import { createClient, createAccount } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'

const CONTRACT    = process.env.CONTRACT_ADDRESS
const PRIVATE_KEY = process.env.BOT_PRIVATE_KEY
const MAX_PER_RUN = 2

const SCHEDULE_TYPES = ['daily', 'weekly', 'monthly']

if (!CONTRACT || !PRIVATE_KEY) {
  console.error('Missing required env var: CONTRACT_ADDRESS or BOT_PRIVATE_KEY')
  process.exit(1)
}

const account = createAccount(PRIVATE_KEY)
const client = createClient({
  chain: testnetBradbury,
  account,
})

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

  const markets = (!raw || raw === 'NO_MARKETS')
    ? []
    : JSON.parse(raw)

  return Array.isArray(markets) ? markets : []
}

async function waitForOpenScheduledMarket(type, timeoutMs = 60000) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    let markets = []
    try {
      markets = await getMarkets()
    } catch (error) {
      console.warn(`${type}: state visibility read failed, retrying: ${error.message || error}`)
    }
    const visible = markets.some(
      m => m.schedule_type === type && m.status === 'OPEN'
    )

    if (visible) {
      console.log(`${type}: OPEN market confirmed on-chain`)
      return
    }

    const elapsed = Math.floor((Date.now() - started) / 1000)
    console.log(`${type}: waiting for state visibility (${elapsed}s/${Math.floor(timeoutMs / 1000)}s)`)
    const remaining = timeoutMs - (Date.now() - started)
    if (remaining <= 0) break
    await sleep(Math.min(3000, remaining))
  }

  throw new Error(
    `${type} transaction was accepted but no OPEN ${type} market is visible after ${timeoutMs}ms`
  )
}

async function waitForAccepted(hash, label, timeoutMs = 180000) {
  const started = Date.now()
  let lastStatus = ''

  while (Date.now() - started < timeoutMs) {
    const tx = await client.getTransaction({ hash })

    const status = String(
      tx?.statusName ||
      tx?.status_name ||
      tx?.status ||
      ''
    ).toUpperCase()

    const execution = String(
      tx?.txExecutionResultName ||
      tx?.txExecutionResult_name ||
      ''
    ).toUpperCase()

    if (status && status !== lastStatus) {
      console.log(`  ${label}: ${status}`)
      lastStatus = status
    }

    if (
      status === 'UNDETERMINED' ||
      status === 'CANCELED' ||
      status === 'CANCELLED'
    ) {
      throw new Error(`${label} ended ${status}: ${hash}`)
    }

    if (
      execution.includes('ERROR') ||
      execution.includes('FAILED')
    ) {
      throw new Error(`${label} execution failed: ${execution} (${hash})`)
    }

    if (status === 'ACCEPTED' || status === 'FINALIZED') {
      if (execution && execution !== 'FINISHED_WITH_RETURN') {
        throw new Error(
          `${label} reached ${status} with execution ${execution}: ${hash}`
        )
      }

      console.log(`  ${label}: accepted ${hash}`)
      return tx
    }

    await sleep(3000)
  }

  throw new Error(`${label} timed out waiting for ACCEPTED: ${hash}`)
}

async function submitAndConfirm(functionName, args, label) {
  const hash = await client.writeContract({
    address: CONTRACT,
    functionName,
    args,
    value: 0n,
  })

  console.log(`  submitted: ${hash}`)
  await waitForAccepted(hash, label)
  return hash
}

async function resolveExpired(markets) {
  const expired = markets.filter(
    m => m.status === 'OPEN' && isDeadlinePassed(m.deadline_ts)
  )

  console.log(
    `${markets.length} total markets, ${expired.length} OPEN and past deadline`
  )

  if (expired.length === 0) return

  const batch = expired.slice(0, MAX_PER_RUN)

  for (const m of batch) {
    const label = (m.question || '').slice(0, 60)
    console.log(`Resolving market #${m.id}: "${label}"`)

    try {
      await submitAndConfirm(
        'resolve_market',
        [m.id],
        `resolve market #${m.id}`
      )
    } catch (e) {
      console.error(`  resolve failed for #${m.id}: ${e.message || e}`)
      throw e
    }
  }
}

async function keepScheduledMarketsRunning() {
  for (const type of SCHEDULE_TYPES) {
    const markets = await getMarkets()

    const hasOpen = markets.some(
      m => m.schedule_type === type && m.status === 'OPEN'
    )

    if (hasOpen) {
      console.log(`${type}: an OPEN market already exists, skipping`)
      continue
    }

    console.log(`${type}: no OPEN market, creating one`)

    await submitAndConfirm(
      `create_${type}_market`,
      ['', ''],
      `create ${type} market`
    )

    console.log(`${type}: accepted, waiting for state visibility`)
    await waitForOpenScheduledMarket(type)
  }
}

async function main() {
  console.log(
    `[${new Date().toISOString()}] bot starting, contract ${CONTRACT}`
  )

  const markets = await getMarkets()

  if (markets.length === 0) {
    console.log('No markets found yet')
  } else {
    await resolveExpired(markets)
  }

  await keepScheduledMarketsRunning()

  console.log('Run complete')
}

main().catch(e => {
  console.error('Bot run failed:', e)
  process.exit(1)
})
