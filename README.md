<div align="center">

<img src="https://raw.githubusercontent.com/genlayer-foundation/genlayer-design/main/assets/GenLayer_Mark_White.svg" width="48" height="48" alt="GenLayer Mark"/>

# Gen Markets

**Prediction market dApp built on GenLayer Bradbury Testnet**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-prediction--market--eight--mocha.vercel.app-6366F1?style=flat-square&logo=vercel)](https://prediction-market-eight-mocha.vercel.app)
[![Built on GenLayer](https://img.shields.io/badge/Built%20on-GenLayer-110FFF?style=flat-square)](https://genlayer.com)
[![Network](https://img.shields.io/badge/Network-Bradbury%20Testnet-9B6AF6?style=flat-square)](https://explorer-bradbury.genlayer.com)

</div>

---

## What it is

Gen Markets is a prediction market platform running on GenLayer Bradbury. The AI sets opening odds, generates fresh markets on a schedule, and resolves outcomes through on-chain validator consensus. Every bet, payout, and market fee moves in real GEN. No internal points ledger, no oracle, no off-chain resolution.

---

## Features

**Prediction Markets**
- Anyone can create a market for a fixed 0.5 GEN fee, paid to the contract
- AI sets opening probabilities inside the same transaction as market creation
- Auto-generate daily, weekly, and monthly markets on crypto/DeFi topics, no cooldown
- Place predictions with real GEN as the stake
- AI evaluates evidence and resolves markets through GenLayer validator consensus
- Resolution is owner-only; cancellation and refunds are owner-only and bettor-only respectively
- Cancelled markets return the original GEN stake to each bettor

**Quick Games**
- Coin Flip: call heads or tails, win 2x your stake
- Dice Roll: set a target, pick over/under, multiplier scales with win probability
- Rock Paper Scissors: beat the house for 2x, ties return your stake
- Minimum stake 0.1 GEN, maximum win capped at 5 GEN per game (protects the house bankroll)
- Win/loss history shown per game card, feeds into the global leaderboard

**Profile and Rankings**
- Claim an on-chain username (3-20 chars, alphanumeric + underscore)
- Send real GEN to any wallet address or @username directly from your profile
- XP from wins drives the leaderboard, combined across markets and games
- Rank badges: Rookie, Trader, Shark, Whale, Legend, based on XP
- Streak tracking for current and best winning run

---

## Architecture

```
React + Vite (Vercel)
  Markets / Games / Rankings / Profile
        |
        | genlayer-js SDK (real GEN value transfers)
        |
GenLayer Bradbury Testnet
  Contract    0x0AeA8a6D89E8F2BE6411C7323C5C2D5daC01272A
  RPC         https://rpc-bradbury.genlayer.com
  Explorer    https://explorer-bradbury.genlayer.com
```

**Key technical decisions**

`transaction_hash_variant: 'latest-nonfinal'` on every read is critical. Without it, reads only return finalized state and contract updates from `ACCEPTED` consensus stay invisible until the finality window closes (around 30 minutes).

Every write uses `genlayer-js`, GenLayer's official SDK, rather than hand-built calldata. This matters specifically for GEN value transfers, where the SDK correctly forwards `value` into `gl.message.value` inside the contract.

Sending GEN out of the contract uses `_Recipient`/`@gl.evm.contract_interface`, confirmed against a live, currently-deployed GenLayer contract processing real payouts with this exact pattern. `gl.ContractAt(...)` and `gl.message.recipient_transfer(...)` were both tried and do not reliably work for this on Bradbury.

Each write function has at most one `gl.eq_principle` call. Nesting consensus calls causes GenVM `exit_code 1`. Functions passed to `prompt_non_comparative` capture exactly one pre-built string; multi-variable closures also cause `exit_code 1`.

The current time is fetched from a time API inside the resolve prompt so the AI has an unambiguous reference to compare against a market's deadline, rather than guessing from evidence-page timestamps alone.

---

## Contract

**Address:** `0x0AeA8a6D89E8F2BE6411C7323C5C2D5daC01272A`
**Network:** GenLayer Bradbury Testnet
**Language:** Python Intelligent Contract (GenLayer GenVM)
**Source:** [`prediction_market.py`](./prediction_market.py)

### Public methods

| Method | Access | What it does |
|--------|--------|--------------|
| `create_market(question, outcomes_csv, evidence_url, deadline_note, deadline_ts)` | Anyone, 0.5 GEN fee | Creates market and sets AI odds in the same tx |
| `create_daily_market(deadline_note)` | Anyone | AI generates daily crypto/DeFi question and odds |
| `create_weekly_market(deadline_note)` | Anyone | AI generates weekly question and odds |
| `create_monthly_market(deadline_note)` | Anyone | AI generates monthly macro question and odds |
| `place_bet(market_id, outcome)` | Anyone, payable | Place a prediction, GEN sent as tx value |
| `resolve_market(market_id)` | Owner only | AI evaluates the market and sets the winner |
| `claim_winnings(market_id)` | Bettor | Claim GEN payout on a won prediction |
| `cancel_market(market_id)` | Owner | Cancel a market |
| `refund(market_id)` | Bettor | Claim GEN refund on a cancelled market |
| `play_coinflip(side)` | Anyone, payable | Coin flip game |
| `play_dice(direction, target)` | Anyone, payable | Dice roll game |
| `play_rps(choice)` | Anyone, payable | Rock Paper Scissors |
| `set_username(name)` | Anyone | Claim an on-chain username |
| `send_gen(recipient)` | Anyone, payable | Send GEN to an address or username |
| `fund()` | Anyone, payable | Add GEN to the house bankroll |
| `withdraw()` | Owner only | Withdraw the full contract GEN balance |

### AI methods

| Method | Principle | What it does |
|--------|-----------|--------------|
| `_generate_odds` | `prompt_non_comparative` | Sets opening probabilities for any market |
| `_ai_generate_market` | `prompt_non_comparative` | Generates question and odds together in one consensus call |
| `resolve_market` via `get_verdict` | `strict_eq` | All validators must agree on the winner independently |
| `_roll` via `get_entropy` | `strict_eq` | Mixes drand beacon randomness into the game RNG seed |

### Economics

- Market creation fee: 0.5 GEN, fixed
- Minimum stake (bets and games): 0.1 GEN
- Maximum win per game: 5 GEN
- House fee on arbitrated disputes: not applicable to this contract

---

## Frontend

**Stack:** React 18, Vite, `genlayer-js`, pure CSS, MetaMask via `window.ethereum`, Vercel

```
gm/
├── api/
│   └── rpc.js                 # Vercel serverless RPC proxy
├── src/
│   ├── lib/
│   │   ├── config.js          # Contract address, chain config, helpers
│   │   └── gl.js              # genlayer-js client, readContract, writeContract
│   ├── components/
│   │   ├── Header.jsx         # Nav, wallet pill, notification bell, theme toggle
│   │   ├── Home.jsx           # Hero, live stats ticker
│   │   ├── Markets.jsx        # Market list, bet/create modals, resolve/cancel
│   │   ├── MarketCard.jsx     # Market card with outcomes and probabilities
│   │   ├── Games.jsx          # Coin flip, dice, RPS with continuous animations
│   │   ├── Leaderboard.jsx    # XP rankings with win rate
│   │   ├── Profile.jsx        # Stats, bet history, send GEN, username
│   │   ├── Toast.jsx          # Notification toasts
│   │   └── Ticker.jsx         # Scrolling stats bar
│   ├── App.jsx                # Wallet connection, state, routing
│   ├── ErrorBoundary.jsx      # Catches render crashes, shows recoverable screen
│   ├── index.css              # Design system
│   └── main.jsx
├── prediction_market.py       # Intelligent Contract source
├── vercel.json
└── vite.config.js
```

**Design**
- Dark by default (`#080B18` background)
- Light mode uses a warm off-white (`#F8F6F0`) from GenLayer's parchment palette
- Brand gradient `#E37DF7 / #9B6AF6 / #110FFF` from the official GenLayer design system
- Fonts: Syne for display, DM Sans for body, DM Mono for data
- Background watermark uses the real GenLayer SVG mark with the official animated gradient treatment
- Mochi (GenLayer's official CC0 mascot) appears on game result screens

---

## Running locally

```bash
git clone https://github.com/Iniwura/prediction-market.git
cd prediction-market
npm install
npm run dev
```

MetaMask required. Add GenLayer Bradbury manually:

| Field | Value |
|-------|-------|
| Network Name | GenLayer Bradbury |
| RPC URL | `https://rpc-bradbury.genlayer.com` |
| Chain ID | `4221` (0x107D) |
| Currency | GEN |
| Explorer | `https://explorer-bradbury.genlayer.com` |

Get testnet GEN from the [GenLayer faucet](https://testnet-faucet.genlayer.foundation/).

---

## Deployment

Push to `main` and Vercel deploys automatically. The `api/rpc.js` serverless function proxies RPC calls server-side to avoid CORS issues with the public GenLayer endpoint.

---

## Known testnet limitations

`gl.message_raw["timestamp"]` is not reliably populated in this GenVM version so `_now()` falls back to `0`. Deadlines are stored as absolute UTC strings calculated client-side rather than relying on on-chain time.

Game randomness mixes in a drand beacon value which raises the bar over a pure nonce, but drand is public so it's not a cryptographic guarantee. A commit-reveal scheme would be needed before these games handle stakes with real-world value beyond testnet GEN.

The contract holds a house bankroll funded via `fund()`. Game payouts and market winnings are only guaranteed if the contract balance covers them; the owner is responsible for keeping it funded.

---

## Built with

- [GenLayer](https://genlayer.com)
- [GenLayer Bradbury Testnet](https://explorer-bradbury.genlayer.com)
- [GenLayer Design System](https://github.com/genlayer-foundation/genlayer-design)
- [Mochi Mascot](https://github.com/genlayer-foundation/genlayer-mascot) (CC0)
- React, Vite, Vercel, genlayer-js

---

<div align="center">Built on GenLayer · Bradbury Testnet Phase 1</div>
