# GenLayer Prediction Market

A fully on-chain YES/NO prediction market built as a GenLayer Intelligent Contract on Bradbury Testnet.

Users place bets on real-world questions. The contract fetches live evidence directly from the web, and an LLM referee resolves the outcome automatically — no human oracle, no intermediary, no waiting.

---

## How It Works

```
1. Owner creates a market with a YES/NO question + evidence URL
2. Users place YES or NO bets on-chain
3. Owner calls resolve_market()
4. Contract fetches live data from the evidence URL
5. LLM referee reads the evidence and returns a verdict
6. Outcome stored on-chain — winners identified instantly
```

---

## Methods

| Method | Type | Description |
|---|---|---|
| `create_market(question, evidence_url, deadline_note)` | write | Create the market |
| `place_bet(side)` | write | Bet "YES" or "NO" |
| `resolve_market()` | write | Owner only — triggers LLM resolution |
| `cancel_market()` | write | Owner only — cancel if needed |
| `get_market_info()` | view | Full market status, bets, outcome |
| `get_my_bet(address)` | view | Check a specific address's bet |
| `get_outcome()` | view | Returns YES, NO, or unresolved |
| `get_leaderboard()` | view | Winners and losers after resolution |

---

## Deploy & Test in GenLayer Studio

**1. Deploy**
Go to [studio.genlayer.com](https://studio.genlayer.com), paste the contract, deploy. No constructor args needed.

**2. Create a market**
```
create_market(
  question:     "Will Bitcoin exceed $100,000 before July 2026?",
  evidence_url: "https://coinmarketcap.com/currencies/bitcoin/",
  deadline_note: "End of June 2026"
)
```

**3. Place bets**
```
place_bet("YES")
place_bet("NO")
```

**4. Resolve**
```
resolve_market()
```
The contract fetches live data from CoinMarketCap, passes it to the LLM referee, and stores the verdict on-chain.

**5. Check results**
```
get_market_info()
get_leaderboard()
```

---

## Good Evidence URLs to Use

| Question type | URL |
|---|---|
| Crypto prices | `https://coinmarketcap.com/currencies/bitcoin/` |
| ETH price | `https://coinmarketcap.com/currencies/ethereum/` |
| News events | `https://news.google.com/search?q=your+topic` |
| Sports results | Any sports news URL |
| Election results | Any news URL covering the event |

---

## Technical Details

- **Network:** GenLayer Bradbury Testnet
- **Language:** Python (GenVM runtime)
- **SDK:** `py-genlayer`

### SDK Patterns Used
```python
# Web fetch (official docs pattern)
response = gl.nondet.web.request(url, method='GET')
raw_text = response.body.decode("utf-8")

# LLM inference
result = gl.nondet.exec_prompt(prompt, response_format='json')

# Consensus
result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

# Error handling
raise gl.UserError("message")
```

---

## Why This Is Novel

Traditional prediction markets require:
- A trusted human oracle to resolve outcomes
- Off-chain data feeds with centralization risks
- Manual intervention for edge cases

This contract replaces all of that with GenLayer's Optimistic Democracy consensus — multiple AI validators independently fetch the evidence and judge the outcome. No single point of failure, no human bottleneck.

---

*Built by Iniwura Akuru — GenLayer Builder Program, 2026*
*Part of the GenLayer Incentivized Builder Program on Bradbury Testnet*
