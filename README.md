<div align="center">

# Gen Markets

**Prediction markets and quick games on GenLayer Bradbury Testnet**

[![Built on GenLayer](https://img.shields.io/badge/Built%20on-GenLayer-110FFF?style=flat-square)](https://genlayer.com)
[![Network](https://img.shields.io/badge/Network-Bradbury%20Testnet-9B6AF6?style=flat-square)](https://explorer-bradbury.genlayer.com)

</div>

Gen Markets is a React/Vite dApp backed by a GenLayer Intelligent Contract. Markets use real GEN stakes, validator consensus for AI-generated odds and settlement, and an on-chain custody ledger for unclaimed liabilities and committed external payouts.

## Safety model

- `book_balance` is the synchronous economic ledger. Payable ingress increases it; every outbound message decreases it when committed. `reserved_liabilities` is the sum of every unclaimed bet/refund liability. A bet increases it; a resolution replaces the market's stake liability with the exact winner payout liability; claims and refunds decrease it only after the parent transaction has emitted and committed the external payout message. Successful transitions preserve `book_balance >= reserved_liabilities`.
- Contract-funded games must pass a maximum-payout solvency check before randomness is consumed. Market liabilities cannot be spent on games, user transfers, or owner withdrawals.
- `get_solvency()` and `get_surplus()` expose observed chain balance separately from book balance, reserved liabilities, economically available surplus, cumulative committed outbound value, and a solvent flag. `withdraw(amount_wei)` is owner-only and can withdraw only positive amounts within the current book surplus; stale `self.balance` cannot authorize a second withdrawal while an earlier message is pending.
- Payout/refund transfers use the GenLayer EVM `_Recipient` interface. `emit_transfer` queues an external message for finalization and deducts/holds the value when emitted; it is not synchronous EOA delivery, and a child failure does not automatically return the value. The parent marks the payout committed exactly once after emission, with no documented EOA delivery acknowledgement or automatic retry.

## Market lifecycle

Manual creation requires exactly `0.5 GEN`, a future `deadline_ts`, 2–6 unique outcomes, and an HTTPS evidence URL. Bets are payable, require at least `0.1 GEN`, and are rejected at or after the on-chain deadline.

`resolve_market(market_id)` is permissionless after the contract's deterministic deadline. The resolver fetches rendered evidence, fences it as untrusted data, and accepts only an exact configured outcome under `strict_eq` consensus. Missing, empty, or failed evidence returns `PENDING` and leaves the market open; validators never settle from model memory.

Owner/admin cancellation is allowed only before the deadline. Cancellation preserves the full refund reserve; each bettor calls `refund(market_id)` once. Expired markets must be resolved, not cancelled.

Scheduled daily, weekly, and monthly market creation is owner/admin-gated. The contract derives deadlines as 24 hours, 7 days, and 30 days from its own transaction clock; browser-supplied deadline text is display-only. The scheduled generator validates/falls back to safe HTTPS evidence and sanitizes generated outcomes.

## Contract

**Address:** `0xB1Ce30c4742a8D156ec92cE05A1ec86601Fd60Ff`
**Network:** GenLayer Bradbury Testnet
**Source:** [`prediction_market.py`](./prediction_market.py)

| Method | Access | Notes |
|---|---|---|
| `create_market(question, outcomes_csv, evidence_url, deadline_note, deadline_ts)` | Anyone, payable | Exact `0.5 GEN` fee; deadline is on-chain Unix seconds |
| `create_daily_market(deadline_note, current_date_note)` | Owner/admin | Deadline derived in contract |
| `create_weekly_market(deadline_note, current_date_note)` | Owner/admin | Deadline derived in contract |
| `create_monthly_market(deadline_note, current_date_note)` | Owner/admin | Deadline derived in contract |
| `place_bet(market_id, outcome)` | Anyone, payable | Exact GEN value becomes reserved liability |
| `resolve_market(market_id)` | Anyone after deadline | Consensus settlement; evidence failure remains pending |
| `claim_winnings(market_id)` | Winning bettor | External message committed, then claim-state update; no EOA delivery acknowledgement |
| `cancel_market(market_id)` | Owner/admin before deadline | Full refunds remain reserved |
| `refund(market_id)` | Bettor | External message committed, then refund-state update; no EOA delivery acknowledgement |
| `refresh_odds(market_id)` | Anyone while open | Existing bets and liabilities unchanged |
| `play_coinflip(side)` / `play_dice(direction, target)` / `play_rps(choice)` | Anyone, payable | 0.1 GEN minimum, 5 GEN maximum win, solvency guarded; winning/tie payout is an external message commitment |
| `send_gen(recipient)` | Anyone, payable | Cannot spend reserved liabilities; recipient delivery is external/finalization-time |
| `fund()` | Anyone, payable | Adds house bankroll |
| `withdraw(amount_wei)` | Owner | Surplus-only external message commitment |
| `get_solvency()` | View | Custody health summary |

The contract uses one consensus call per write path, `strict_eq` for discrete settlement/randomness, and `_Recipient.emit_transfer` for outbound GEN. A cumulative `committed_outbound` counter records parent-side external-message commitments for auditability; it is not a delivery receipt and is not subtracted from observed balance because finalized messages would then be double-counted. `deadline_ts` is the authority; `deadline_note` is human-readable metadata only.

## Frontend and bot

The frontend uses `genlayer-js`, `latest-nonfinal` reads, exact decimal-to-wei `BigInt` helpers, transaction-status polling, and state polling before showing a parent write/message commitment as confirmed. For external payouts, this status is not an EOA delivery receipt. Wallet-scoped notification/history keys prevent cross-account leakage.

`bot/resolve-bot.js` is optional. Its GitHub Actions workflow uses a read-only contents permission, a concurrency lock, and a ten-minute timeout. The bot resolves expired markets (resolution is permissionless) and invokes scheduled creation using its owner/admin wallet. It never withdraws funds or manages admins. Keep `BOT_PRIVATE_KEY` and `CONTRACT_ADDRESS` in CI secrets only.

## Local development

```bash
npm ci
npm run dev
```

MetaMask should be connected to GenLayer Bradbury (`https://rpc-bradbury.genlayer.com`, chain ID `4221` / `0x107D`). Test GEN is available from the [GenLayer faucet](https://testnet-faucet.genlayer.foundation/).

Run contract tests and lint:

```bash
py -m pytest -q
genvm-lint check prediction_market.py
```

The Direct Mode tests cover deadline enforcement, exact liability accounting, cancellation/refund reserve behavior, surplus-only withdrawal, permissionless settlement structure, and single-commit state ordering after parent message emission. Direct Mode does not execute external EOA messages at finalization or simulate child failure/delivery, so live Bradbury verification is still required for outbound transfer settlement.

## Known residual risks and validation status

Drand is public/timing-sensitive; it improves game entropy over a nonce but is not commit-reveal-grade randomness. Web evidence can be stale or unavailable, in which case settlement remains pending. External EOA GEN messages have a residual finalization/delivery risk: parent emission is deterministic, but the child executes later and a failed child does not auto-refund the sender; this contract therefore makes each payout terminal after emission and does not offer retry safety or claim a delivery callback. The pinned SDK exposes an errored-message hook for failed message execution, but no documented EOA success/delivery acknowledgement is available, so the payout path does not depend on it. The frontend build requires a normal Vite/esbuild environment; this repository's sandbox validation may be unable to traverse the external Downloads path. Before real-value use, run Bradbury integration tests for payable ingress, `_Recipient` payouts/refunds, deadline clock behavior, undercollateralized transactions, and finalization failure behavior.

No deployment, commit, push, merge, or history rewrite is performed by the maintenance workflow.

## Stack

GenLayer Intelligent Contracts · React 18 · Vite · `genlayer-js` · MetaMask · GitHub Actions · Vercel
