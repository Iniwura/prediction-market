[README (1).md](https://github.com/user-attachments/files/28574764/README.1.md)
# prediction-market# GenLayer Intelligent Contracts

Smart contracts built on [GenLayer](https://genlayer.com) Bradbury Testnet as part of the Builder Program.

These contracts demonstrate GenLayer's core capability: combining **live web data fetching**, **LLM reasoning**, and **on-chain state** — all verified through Optimistic Democracy consensus.

---

## Contracts

### 1. Crypto Price Checker (`crypto_price_checker.py`)
Fetches the live price of any cryptocurrency from CoinGecko, uses an LLM to parse the response, and stores an ABOVE/BELOW/EQUAL status on-chain relative to a user-defined target.

**Deploy:** No constructor args needed
**Call:** `check_price("bitcoin", 60000)`
**Read:** `get_last_result()`

---

### 2. AI Content Moderator (`content_moderator.py`)
Accepts user-submitted text and uses an LLM to evaluate it against a custom ruleset, returning APPROVED or REJECTED on-chain with a reason.

**Deploy:** Pass your moderation rules as a string, e.g. `"No hate speech. No spam."`
**Call:** `moderate("text to review")`
**Read:** `get_last_verdict()`

---

### 3. Prediction Market (`prediction_market.py`)
A fully on-chain YES/NO prediction market. Users place bets, the contract fetches live evidence from the web, and an LLM referee resolves the outcome automatically. No human oracle needed.

**Deploy:** No constructor args needed
**Step 1:** `create_market("Will BTC exceed $100k before July 2026?", "https://coinmarketcap.com/currencies/bitcoin/", "End of June 2026")`
**Step 2:** `place_bet("YES")` or `place_bet("NO")`
**Step 3:** `resolve_market()` — triggers live web fetch + LLM verdict
**Read:** `get_market_info()`, `get_leaderboard()`, `get_outcome()`

---

## How to Deploy

1. Open [GenLayer Studio](https://studio.genlayer.com)
2. Create a new file and paste the contract code
3. Click **Deploy**
4. Interact via the Write/Read Methods panel on the left

## Network
- **Testnet:** Bradbury
- **Language:** Python (GenVM runtime)
- **SDK:** `py-genlayer`
- **Dependency header:** `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }`

## Key SDK Patterns Used
All contracts follow the official GenLayer documentation patterns:
- Web fetch: `gl.nondet.web.request(url, method='GET')` → `.body.decode("utf-8")`
- LLM call: `gl.nondet.exec_prompt(prompt, response_format='json')`
- Consensus: `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`
- Error handling: `gl.UserError("message")`
- Native types: `u64`, `u256`, `str`, `bool` (no Python `float` or `int`)

## Research
These contracts are referenced in my performance benchmarking article:
[Performance Benchmarking of GenLayer Intelligent Contracts](https://medium.com/@iniwuraakuru/performance-benchmarking-of-genlayer-intelligent-contracts-execution-patterns-llm-response-0069f2660ce4)

---

*Built by Iniwura Akuru — GenLayer Builder Program, 2026*
