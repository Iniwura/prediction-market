# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
import json
import re
from genlayer import *

@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass

HOUSE_FEE        = 5
MAX_WIN          = 5000000000000000000    # 5 GEN in wei, maximum payout per game
MIN_BET          = 100000000000000000     # 0.1 GEN in wei, minimum stake
CREATION_FEE     = 500000000000000000     # 0.5 GEN in wei, fixed, not adjustable
BASE_XP          = 100

def _gen(wei: int) -> str:
    return str(wei / 1000000000000000000)

class PredictionMarket(gl.Contract):

    owner:            str
    admins:           TreeMap[str, str]
    market_count:     u64
    game_nonce:       u64
    markets:        TreeMap[str, str]
    market_ids:     DynArray[str]
    lb_stats:       TreeMap[str, str]
    lb_addresses:   DynArray[str]
    last_game:      TreeMap[str, str]
    usernames:      TreeMap[str, str]
    username_index: TreeMap[str, str]

    def __init__(self):
        self.owner        = str(gl.message.sender_address).lower().strip()
        self.market_count = u64(0)
        self.game_nonce   = u64(0)

    def _addr(self) -> str:
        return str(gl.message.sender_address).lower().strip()

    # Owner is a separate, permanent role, never just "first admin". Owner
    # can always manage the admin list regardless of its contents, and
    # can't be removed via admin_remove (checked there, not here).
    def _is_admin_or_owner(self, addr: str) -> bool:
        a = addr.lower().strip()
        return a == self.owner or a in self.admins

    def _now(self) -> int:
        try:
            return int(gl.message_raw.get("timestamp", 0))
        except:
            return 0

    def _get_market(self, market_id: int) -> dict:
        raw = self.markets.get(str(market_id), None)
        if raw is None:
            raise gl.vm.UserError("Market " + str(market_id) + " does not exist")
        return json.loads(raw)

    def _save_market(self, market_id: int, m: dict):
        self.markets[str(market_id)] = json.dumps(m)

    def _get_lb(self, addr: str) -> dict:
        raw = self.lb_stats.get(addr, None)
        if raw is None:
            return {"wins":0,"losses":0,"xp":0,"streak":0,"best_streak":0,"wagered":0,"won":0}
        return json.loads(raw)

    def _save_lb(self, addr: str, s: dict):
        existing = self.lb_stats.get(addr, None)
        if existing is None:
            self.lb_addresses.append(addr)
        self.lb_stats[addr] = json.dumps(s)

    def _add_xp(self, addr: str, xp: int, won: bool, wagered: int, payout: int):
        s = self._get_lb(addr)
        s["xp"]     += xp
        s["wagered"]+= wagered
        if won:
            s["wins"]  += 1
            s["won"]   += payout
            s["streak"]+= 1
            if s["streak"] > s["best_streak"]:
                s["best_streak"] = s["streak"]
        else:
            s["losses"]+= 1
            s["streak"] = 0
        self._save_lb(addr, s)

    def _roll(self, salt: str, mod: int) -> int:
        def get_entropy() -> str:
            try:
                resp = gl.nondet.web.get("https://api.drand.sh/public/latest")
                data = json.loads(resp.body.decode("utf-8", "replace"))
                return str(data.get("randomness", ""))
            except:
                return ""

        beacon = gl.eq_principle.strict_eq(get_entropy)

        nonce = int(self.game_nonce)
        self.game_nonce = u64(nonce + 1)
        seed = self._addr() + ":" + salt + ":" + str(nonce) + ":" + str(beacon)
        h = 5381
        for ch in seed:
            h = ((h << 5) + h + ord(ch)) & 0xFFFFFFFF
        return h % mod

    def _payout_for_winner(self, m: dict, winner: str, stake: int) -> int:
        pools       = m.get("pools", {})
        winner_pool = pools.get(winner, 0)
        total_pool  = sum(pools.values())
        loser_pool  = total_pool - winner_pool
        if winner_pool <= 0:
            return stake
        fee       = (loser_pool * HOUSE_FEE) // 100
        net_loser = loser_pool - fee
        payout    = stake + (stake * net_loser // winner_pool)
        return max(stake, payout)

    def _generate_odds(self, outcomes: list) -> dict:
        outcomes_str = ", ".join(outcomes)
        keys_hint    = ", ".join('"' + o + '": <integer>' for o in outcomes)
        full_prompt  = (
            "Assign a realistic starting probability (integer %) to each outcome.\n"
            "OUTCOMES: " + outcomes_str + "\n"
            "JSON only: {" + keys_hint + "}\n"
            "Values must sum to exactly 100. Minimum 1 per outcome."
        )

        def get_probs() -> str:
            result = gl.nondet.exec_prompt(full_prompt, response_format="json")
            try:
                if not isinstance(result, dict):
                    raise ValueError("not a dict")
                vals  = [max(1, int(result.get(o, 0))) for o in outcomes]
                total = sum(vals)
                if total <= 0:
                    raise ValueError("zero total")
                norm  = [max(1, round(v * 100 / total)) for v in vals]
                diff  = 100 - sum(norm)
                norm[0] += diff
                return json.dumps({outcomes[i]: norm[i] for i in range(len(outcomes))})
            except Exception:
                even = round(100 / len(outcomes))
                probs = {o: even for o in outcomes}
                probs[outcomes[0]] += 100 - sum(probs.values())
                return json.dumps(probs)

        raw = gl.eq_principle.prompt_non_comparative(
            get_probs,
            task="Assign realistic starting probability percentages to prediction market outcomes.",
            criteria="Accept if valid JSON, keys match outcomes, all values integers 1-99, sum=100.",
        )
        try:
            parsed = json.loads(str(raw))
            if not isinstance(parsed, dict):
                raise ValueError("not a dict")
            probs  = {o: max(1, int(parsed.get(o, 0))) for o in outcomes}
            if sum(probs.values()) != 100:
                raise ValueError("sum != 100")
            return probs
        except Exception:
            even  = round(100 / len(outcomes))
            probs = {o: even for o in outcomes}
            probs[outcomes[0]] += 100 - sum(probs.values())
            return probs

    def _create_and_open_market(self, question: str, outcomes: list,
                                evidence_url: str, deadline_note: str,
                                schedule_type: str, deadline_ts: int = 0) -> int:
        mid = int(self.market_count)

        probs = self._generate_odds(outcomes)

        self._save_market(mid, {
            "question":        question.strip(),
            "outcomes":        outcomes,
            "evidence_url":    evidence_url.strip(),
            "deadline_note":   deadline_note.strip() or "No deadline",
            "deadline_ts":     int(deadline_ts),
            "schedule_type":   schedule_type,
            "category":        "other",
            "status":          "OPEN",
            "outcome_winner":  "",
            "resolution_note": "",
            "ai_probs":        probs,
            "ai_reasoning":    "",
            "pools":           {o: 0 for o in outcomes},
            "bet_counts":      {o: 0 for o in outcomes},
            "bets":            {},
            "created_at":      str(self._now()),
        })
        self.market_ids.append(str(mid))
        self.market_count = u64(mid + 1)
        return mid

    @gl.public.view
    def get_market_count(self) -> str:
        return str(int(self.market_count))

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner

    @gl.public.view
    def get_market(self, market_id: int) -> str:
        m     = self._get_market(market_id)
        out   = m["outcomes"]
        pools = m.get("pools", {})
        total = sum(pools.get(o, 0) for o in out)
        bets  = sum(m.get("bet_counts", {}).get(o, 0) for o in out)

        live_odds = {}
        for o in out:
            op = pools.get(o, 0)
            if op > 0 and total > 0:
                live_odds[o] = round(total / op, 2)
            else:
                live_odds[o] = round(100 / len(out), 2)

        return json.dumps({
            "id":            market_id,
            "question":      m["question"],
            "status":        m["status"],
            "deadline":      m.get("deadline_note", ""),
            "deadline_ts":   int(m.get("deadline_ts", 0)),
            "evidence_url":  m.get("evidence_url", ""),
            "outcomes":      out,
            "ai_probs":      [m.get("ai_probs", {}).get(o, 0) for o in out],
            "live_odds":     [live_odds[o] for o in out],
            "pools":         [pools.get(o, 0) for o in out],
            "total_pool":    total,
            "bet_counts":    [m.get("bet_counts", {}).get(o, 0) for o in out],
            "total_bets":    bets,
            "winner":        m.get("outcome_winner", ""),
            "schedule_type": m.get("schedule_type", "manual"),
            "category":      m.get("category", "other"),
            "created_at":    m.get("created_at", ""),
        })

    @gl.public.view
    def get_all_markets(self) -> str:
        total = len(self.market_ids)
        if total == 0:
            return "NO_MARKETS"
        result = []
        for i in range(total):
            mid = self.market_ids[i]
            raw = self.markets.get(mid, None)
            if raw is None:
                continue
            m     = json.loads(raw)
            out   = m["outcomes"]
            pools = m.get("pools", {})
            tp    = sum(pools.get(o, 0) for o in out)
            bets  = sum(m.get("bet_counts", {}).get(o, 0) for o in out)
            live_odds = []
            for o in out:
                op = pools.get(o, 0)
                live_odds.append(round(tp / op, 2) if op > 0 and tp > 0 else round(100 / len(out), 2))
            result.append({
                "id":            int(mid),
                "question":      m["question"],
                "status":        m["status"],
                "outcomes":      out,
                "ai_probs":      [m.get("ai_probs", {}).get(o, 0) for o in out],
                "live_odds":     live_odds,
                "pools":         [pools.get(o, 0) for o in out],
                "total_pool":    tp,
                "bet_counts":    [m.get("bet_counts", {}).get(o, 0) for o in out],
                "total_bets":    bets,
                "deadline":      m.get("deadline_note", ""),
                "deadline_ts":   int(m.get("deadline_ts", 0)),
                "winner":        m.get("outcome_winner", ""),
                "schedule_type": m.get("schedule_type", "manual"),
                "category":      m.get("category", "other"),
                "created_at":    m.get("created_at", ""),
            })
        return json.dumps(result)

    @gl.public.view
    def get_my_bet(self, market_id: int, address: str) -> str:
        m    = self._get_market(market_id)
        addr = address.lower().strip()
        bets = m.get("bets", {})
        if addr not in bets:
            return "NONE"
        b      = bets[addr]
        winner = m.get("outcome_winner", "")
        if b.get("claimed", False):
            status = "CLAIMED"
        elif m["status"] == "CANCELLED":
            status = "CANCELLED"
        elif m["status"] == "RESOLVED" and b["outcome"] == winner:
            status = "WON"
        elif m["status"] == "RESOLVED":
            status = "LOST"
        else:
            status = "OPEN"
        payout = self._payout_for_winner(m, b["outcome"], int(b["amount"])) if status == "WON" else 0
        return json.dumps({"outcome": b["outcome"], "amount": b["amount"], "status": status, "payout": payout})

    @gl.public.view
    def get_my_bets_all(self, address: str) -> str:
        addr   = address.lower().strip()
        total  = len(self.market_ids)
        result = []
        for i in range(total):
            mid = self.market_ids[i]
            raw = self.markets.get(mid, None)
            if raw is None:
                continue
            m    = json.loads(raw)
            bets = m.get("bets", {})
            if addr not in bets:
                continue
            b      = bets[addr]
            winner = m.get("outcome_winner", "")
            if b.get("claimed", False):
                s = "CLAIMED"
            elif m["status"] == "CANCELLED":
                s = "CANCELLED"
            elif m["status"] == "RESOLVED" and b["outcome"] == winner:
                s = "WON"
            elif m["status"] == "RESOLVED":
                s = "LOST"
            else:
                s = "OPEN"
            result.append({"id": int(mid), "outcome": b["outcome"], "amount": int(b["amount"]), "status": s})
        return json.dumps(result)

    @gl.public.view
    def get_last_game(self, address: str) -> str:
        return self.last_game.get(address.lower().strip(), "")

    @gl.public.view
    def get_username(self, address: str) -> str:
        return self.usernames.get(address.lower().strip(), "")

    @gl.public.view
    def get_address_by_username(self, name: str) -> str:
        return self.username_index.get(name.lower().strip(), "")

    @gl.public.view
    def get_scheduled_times(self) -> str:
        return json.dumps({
            "daily_ready":   True,
            "weekly_ready":  True,
            "monthly_ready": True,
        })

    @gl.public.view
    def get_leaderboard(self, top_n: int) -> str:
        total = len(self.lb_addresses)
        if total == 0:
            return "[]"
        entries = []
        for i in range(total):
            addr = self.lb_addresses[i]
            raw  = self.lb_stats.get(addr, None)
            if raw is None:
                continue
            s    = json.loads(raw)
            name = self.usernames.get(addr, "")
            entries.append({
                "address":  addr,
                "username": name,
                "xp":       s.get("xp", 0),
                "wins":     s.get("wins", 0),
                "losses":   s.get("losses", 0),
                "streak":   s.get("best_streak", 0),
                "wagered":  s.get("wagered", 0),
            })
        entries.sort(key=lambda x: x["xp"], reverse=True)
        n = max(1, min(top_n, 50))
        return json.dumps(entries[:n])

    @gl.public.view
    def get_user_stats(self, address: str) -> str:
        addr = address.lower().strip()
        s    = self._get_lb(addr)
        s["address"]  = addr
        s["username"] = self.usernames.get(addr, "")
        return json.dumps(s)

    @gl.public.write
    def set_username(self, name: str):
        name = name.strip()
        if len(name) < 3 or len(name) > 20:
            raise gl.vm.UserError("Username must be 3-20 characters")
        for ch in name:
            if not (ch.isalnum() or ch == "_"):
                raise gl.vm.UserError("Letters, numbers, underscores only")
        addr     = self._addr()
        key      = name.lower()
        existing = self.username_index.get(key, None)
        if existing and existing != addr:
            raise gl.vm.UserError("Username taken")
        old = self.usernames.get(addr, "")
        if old:
            try:
                del self.username_index[old.lower()]
            except:
                pass
        self.usernames[addr]   = name
        self.username_index[key] = addr

    @gl.public.write.payable
    def send_gen(self, recipient: str):
        amount = int(gl.message.value)
        if amount == 0:
            raise gl.vm.UserError("No GEN sent")

        sender = self._addr()
        target = recipient.strip()

        if target.startswith("@"):
            target = target[1:]

        if target.lower().startswith("0x") and len(target) >= 10:
            to_addr = target.lower()
        else:
            resolved = self.username_index.get(target.lower(), "")
            if not resolved:
                raise gl.vm.UserError("No address or username found for '" + recipient + "'")
            to_addr = resolved

        if to_addr == sender:
            raise gl.vm.UserError("Cannot send to yourself")

        _Recipient(Address(to_addr)).emit_transfer(value=amount)

    @gl.public.write.payable
    def create_market(self, question: str, outcomes_csv: str,
                      evidence_url: str, deadline_note: str, deadline_ts: int = 0):
        fee = CREATION_FEE
        if int(gl.message.value) < fee:
            raise gl.vm.UserError("Market creation requires 0.5 GEN fee")
        if not question.strip():
            raise gl.vm.UserError("Question required")
        outcomes = [o.strip() for o in outcomes_csv.split(",") if o.strip()]
        if len(outcomes) < 2 or len(outcomes) > 6:
            raise gl.vm.UserError("Need 2-6 outcomes")
        self._create_and_open_market(question, outcomes, evidence_url, deadline_note, "manual", int(deadline_ts))

    def _ai_generate_market(self, base_prompt: str, topics: list, deadline_str: str, schedule_type: str, current_date_note: str = "", deadline_ts: int = 0):
        market_count = int(self.market_count)
        topic_idx    = market_count % len(topics)
        chosen_topic, chosen_category = topics[topic_idx]

        # Real date, calculated client-side the same way deadline_str
        # already is, never guessed by the AI. This replaces an earlier
        # attempt at grounding via a live news page fetch, which worked
        # sometimes but wasn't reliable, a news homepage's date signal can
        # be buried under navigation and headlines. A frontend-supplied
        # date has no failure mode at all, same reasoning that already
        # made deadline_str reliable.
        real_date = current_date_note.strip() if current_date_note.strip() else ""
        date_line = (
            "TODAY'S REAL DATE IS: " + real_date + ". This is a fact, not a guess, use it.\n"
            if real_date else ""
        )

        full_prompt = (
            base_prompt
            + date_line
            + "If you reference any date or timeframe in the question, it must be accurate "
            + "relative to today's real date above, for example if today is in August, 'by "
            + "the end of August' is correct, a past year like 2024 or 2025 would be wrong "
            + "since that has already passed relative to today's real date.\n\n"
            + "Your topic for this specific question is: " + chosen_topic + ". "
            + "Write a question specifically and only about this topic.\n\n"
            + "CRITICAL, resolvability: the event or condition in your question MUST have a "
            + "definite, checkable, real answer by the deadline. Never write about an event "
            + "that happens on a longer cycle than the market's own window, for example, "
            + "never write about 'the next Bitcoin halving' on a market that only runs 30 days, "
            + "since halvings happen roughly every 4 years and won't have occurred by the "
            + "deadline. If you are not certain the underlying event will have concluded or "
            + "the data point will exist by the deadline, pick a different, definitely-"
            + "resolvable angle on the same general topic instead (e.g. current sentiment or "
            + "price movement around an anticipated event, not the far-future event itself).\n\n"
            + "Outcomes and phrasing: most questions should be a plain YES/NO. Only use a "
            + "ranged (e.g. 'Under $60k', '$60k-70k', 'Over $70k') or multiple-choice structure "
            + "occasionally, when it is clearly the more natural fit for that specific question, "
            + "not as your default. The question doesn't have to start with 'Will' every "
            + "single time, but YES/NO as the two outcomes should be the common case.\n\n"
            + "Return ONLY valid JSON with these exact keys, no markdown:\n"
            + '{"question": "...", "outcomes": ["<2 to 4 outcome strings, YES/NO by default>"], '
            + '"probs": {"<outcome>": <int>, ...}, '
            + '"evidence_url": "https://..."}\n'
            + "For evidence_url, choose the most specific real URL that would confirm this question's outcome: "
            + "price questions -> CoinGecko or CoinMarketCap coin page for the specific asset; "
            + "DeFi TVL -> defillama.com; protocol events -> official docs or blog; "
            + "crypto news -> coindesk.com or cointelegraph.com; governance -> snapshot.org; "
            + "sports -> espn.com or the official league site for the specific match or event. "
            + "Rules: 2-4 outcomes, probs are integers summing to exactly 100, "
            + "each prob at least 1."
        )

        real_year = ""
        if real_date:
            _m = re.search(r'\b((?:19|20)\d{2})\b', real_date)
            real_year = _m.group(1) if _m else ""

        def _fix_wrong_year(text: str) -> str:
            # Deterministic correction, not another instruction hoping the
            # AI complies. Retrying and asking nicely a second and third
            # time already proved unreliable, "$100k by end of 2024" is
            # apparently memorized strongly enough to survive both the
            # base prompt and a direct correction prompt. This just swaps
            # any wrong year for the real one in code, guaranteed correct
            # regardless of what the AI generated.
            if not real_year:
                return text
            years_found = set(re.findall(r'\b((?:19|20)\d{2})\b', text))
            for y in years_found:
                if y != real_year:
                    text = text.replace(y, real_year)
            return text

        def _has_long_horizon_mismatch(text: str) -> bool:
            # Same problem as the wrong-year check, but for phrases with
            # no year number at all, "next month" or "the end of the
            # year" on a 24-hour daily market. No year digit for
            # _fix_wrong_year to swap, and no safe surgical edit exists
            # for an arbitrary sentence, so this flags the mismatch
            # rather than trying to patch it, the caller falls back to a
            # proven-safe generic question instead.
            low = text.lower()
            if schedule_type in ("daily", "weekly"):
                return "month" in low or "year" in low
            if schedule_type == "monthly":
                return "year" in low
            return False

        def gen() -> str:
            result = gl.nondet.exec_prompt(full_prompt, response_format="json")
            if isinstance(result, dict):
                q = str(result.get("question", ""))
                result["question"] = _fix_wrong_year(q)
                return json.dumps(result, sort_keys=True)
            return str(result).strip()

        raw = gl.eq_principle.prompt_non_comparative(
            gen,
            task="Generate a prediction market question with starting probabilities.",
            criteria=(
                "Accept if the response is valid JSON with keys: "
                "question (any non-empty string, any phrasing style or opening word), "
                "outcomes (array of 2-4 strings, these may be YES/NO, a price range, "
                "named candidates, or any other short label, any style is acceptable), "
                "probs (object with one integer value per outcome, integers summing to 100), "
                "evidence_url (a URL string). Do not reject for question phrasing style, "
                "outcome style, or topic choice, only reject if the JSON structure itself "
                "is invalid or a required key is missing."
            ),
        )

        data = None
        try:
            parsed = json.loads(str(raw))
            if isinstance(parsed, dict):
                data = parsed
        except Exception:
            pass

        if data is None:
            data = {
                "question":     "Will DeFi TVL increase this period?",
                "outcomes":     ["YES", "NO"],
                "probs":        {"YES": 50, "NO": 50},
                "evidence_url": "https://defillama.com",
            }

        outcomes = data.get("outcomes", ["YES", "NO"])
        if not isinstance(outcomes, list) or len(outcomes) < 2:
            outcomes = ["YES", "NO"]

        raw_probs = data.get("probs", {})
        if not isinstance(raw_probs, dict):
            raw_probs = {}
        even = round(100 / len(outcomes))
        probs = {}
        for o in outcomes:
            v = raw_probs.get(o, even)
            try:
                probs[o] = max(1, int(v))
            except Exception:
                probs[o] = even
        diff = 100 - sum(probs.values())
        probs[outcomes[0]] = probs[outcomes[0]] + diff

        question = ""
        try:
            question = str(data.get("question", "")).strip()
        except Exception:
            pass
        if not question:
            question = "Prediction market"
        # Guaranteed final pass, not just the one inside gen()'s closure.
        # That earlier check only ran when exec_prompt returned a clean
        # dict, real evidence showed a wrong year still slipping through
        # on the rare response that didn't parse as one, this catches
        # every path regardless of how the question got here.
        question = _fix_wrong_year(question)
        if _has_long_horizon_mismatch(question):
            question = "Will " + chosen_topic + " show significant movement this period?"

        evidence_url = ""
        try:
            evidence_url = str(data.get("evidence_url", "")).strip()
        except Exception:
            pass

        mid = market_count
        self._save_market(mid, {
            "question":        question,
            "outcomes":        outcomes,
            "evidence_url":    evidence_url,
            "deadline_note":   deadline_str,
            "deadline_ts":     int(deadline_ts),
            "schedule_type":   schedule_type,
            "category":        chosen_category,
            "status":          "OPEN",
            "outcome_winner":  "",
            "resolution_note": "",
            "ai_probs":        probs,
            "ai_reasoning":    "",
            "pools":           {o: 0 for o in outcomes},
            "bet_counts":      {o: 0 for o in outcomes},
            "bets":            {},
            "created_at":      str(self._now()),
        })
        self.market_ids.append(str(mid))
        self.market_count = u64(mid + 1)

    @gl.public.write
    def create_daily_market(self, deadline_note: str = "", current_date_note: str = ""):
        self._ai_generate_market(
            base_prompt=(
                "Generate a fresh daily prediction market question about crypto, Web3, or DeFi. "
                "It will resolve within 24 hours using public data. "
                "You may reference 'today' if it helps the question read naturally, since you "
                "will be told the real current date below, just don't restate the exact deadline "
                "time, that's shown separately in the app UI. "
                "e.g. 'Will SOL trade above $150 today?' is fine if today's real date is given. "
            ),
            topics=[("a specific altcoin's price movement (not BTC or ETH)", "crypto"), ("protocol TVL movement", "crypto"), ("breaking crypto news", "crypto"), ("a security incident or exploit", "crypto"), ("a live sports match or event result", "sports")],
            deadline_str=deadline_note.strip() if deadline_note.strip() else "24 hours from now",
            schedule_type="daily",
            current_date_note=current_date_note,
            deadline_ts=0,
        )

    @gl.public.write
    def create_weekly_market(self, deadline_note: str = "", current_date_note: str = ""):
        self._ai_generate_market(
            base_prompt=(
                "Generate a weekly prediction market question about crypto or DeFi. "
                "It will resolve within 7 days using public data. "
                "You may reference 'this week' if it helps the question read naturally, since "
                "you will be told the real current date below to phrase it accurately. "
            ),
            topics=[("a major altcoin's price range this week", "crypto"), ("DeFi protocol performance", "crypto"), ("an upcoming protocol launch", "crypto"), ("a live DAO governance vote", "crypto"), ("exchange trading volumes", "crypto"), ("an upcoming major sports fixture this week", "sports")],
            deadline_str=deadline_note.strip() if deadline_note.strip() else "7 days from now",
            schedule_type="weekly",
            current_date_note=current_date_note,
            deadline_ts=0,
        )

    @gl.public.write
    def create_monthly_market(self, deadline_note: str = "", current_date_note: str = ""):
        self._ai_generate_market(
            base_prompt=(
                "Generate a monthly prediction market question about crypto macro trends. "
                "It will resolve within 30 days using public data. "
                "You may reference 'this month' or the current month by name if it helps the "
                "question read naturally, e.g. 'by the end of August', since you will be told "
                "the real current date below, use that to phrase it accurately, never guess. "
            ),
            topics=[("ETH or BTC price milestone this month", "crypto"), ("a major altcoin's monthly performance", "crypto"), ("a protocol upgrade or major release", "crypto"), ("a regulatory decision", "crypto"), ("institutional crypto adoption news", "crypto"), ("DeFi TVL milestone", "crypto"), ("a major sports tournament or league outcome this month", "sports")],
            deadline_str=deadline_note.strip() if deadline_note.strip() else "30 days from now",
            schedule_type="monthly",
            current_date_note=current_date_note,
            deadline_ts=0,
        )

    @gl.public.write.payable
    def place_bet(self, market_id: int, outcome: str):
        m = self._get_market(market_id)
        if m["status"] != "OPEN":
            raise gl.vm.UserError("Market not open: " + m["status"])
        if outcome not in m["outcomes"]:
            raise gl.vm.UserError("Invalid outcome")
        amount = int(gl.message.value)
        if amount < MIN_BET:
            raise gl.vm.UserError("Minimum bet is " + _gen(MIN_BET) + " GEN")
        addr = self._addr()
        if addr in m.get("bets", {}):
            raise gl.vm.UserError("Already predicted: " + m["bets"][addr]["outcome"])
        m.setdefault("bets", {})[addr] = {"outcome": outcome, "amount": amount, "claimed": False}
        m["pools"][outcome]      = m["pools"].get(outcome, 0) + amount
        m["bet_counts"][outcome] = m["bet_counts"].get(outcome, 0) + 1
        m["total_pool"]          = sum(m["pools"].values())
        self._save_market(market_id, m)

    @gl.public.write
    def refresh_odds(self, market_id: int):
        m = self._get_market(market_id)
        if m["status"] != "OPEN":
            raise gl.vm.UserError("Can only refresh odds on an open market")

        question     = m["question"]
        outcomes     = m["outcomes"]
        evidence_url = m.get("evidence_url", "")
        pools        = m.get("pools", {})
        total_staked = sum(pools.values())

        current_split = ""
        if total_staked > 0:
            parts = []
            for o in outcomes:
                pct = round((pools.get(o, 0) / total_staked) * 100)
                parts.append(o + ": " + str(pct) + "% of staked GEN")
            current_split = "Current real betting split: " + ", ".join(parts) + ". "
        else:
            current_split = "No bets placed yet. "

        outcomes_str = ", ".join(outcomes)

        def get_fresh_probs() -> str:
            ev = ""
            if evidence_url and evidence_url.strip():
                try:
                    snippet = gl.nondet.web.render(evidence_url, mode="text")[:3000]
                    ev      = "LIVE EVIDENCE (fetched just now from " + evidence_url + "):\n" + snippet + "\n\n"
                except:
                    ev = ""

            prompt = (
                "You are updating the probability estimate for an already-open prediction market.\n\n"
                "QUESTION: " + question + "\n"
                "OUTCOMES: " + outcomes_str + "\n\n"
                + ev
                + current_split
                + "\nBased on the live evidence above and the current real betting activity, "
                "give an updated, realistic probability for each outcome. This should reflect "
                "what you now know, not just repeat the original opening guess.\n\n"
                "Return ONLY this exact JSON shape, nothing else: "
                "{" + ", ".join('"' + o + '": <integer>' for o in outcomes) + "}\n"
                "Do NOT include \"question\", \"outcomes\", \"evidence_url\", or any field other "
                "than the outcome names above. Only the probability numbers. "
                "Values must sum to exactly 100. Minimum 1 per outcome."
            )
            result = gl.nondet.exec_prompt(prompt, response_format="json")
            if isinstance(result, dict):
                trimmed = {o: result.get(o) for o in outcomes if o in result}
                return json.dumps(trimmed, sort_keys=True)
            return str(result).strip()

        raw = gl.eq_principle.prompt_non_comparative(
            get_fresh_probs,
            task="Update probability estimates for an open prediction market using live evidence.",
            criteria=(
                "Accept ONLY if the JSON contains exactly the outcome names as keys and "
                "nothing else, no question, outcomes, evidence_url, or any other field. "
                "Reject if any extra key is present. All values must be integers 1-99 "
                "summing to 100."
            ),
        )

        try:
            parsed = json.loads(str(raw))
            probs  = {o: max(1, int(parsed.get(o, 0))) for o in outcomes}
            if sum(probs.values()) != 100:
                raise ValueError("sum != 100")
        except Exception:
            return  # Keep existing ai_probs unchanged if the refresh output is unusable

        m["ai_probs"] = probs
        self._save_market(market_id, m)

    @gl.public.write
    def resolve_market(self, market_id: int):
        if not self._is_admin_or_owner(self._addr()):
            raise gl.vm.UserError("Only owner or an admin can resolve markets")
        m = self._get_market(market_id)
        if m["status"] != "OPEN":
            raise gl.vm.UserError("Cannot resolve: " + m["status"])

        question     = m["question"]
        outcomes     = m["outcomes"]
        evidence_url = m.get("evidence_url", "")
        deadline     = m.get("deadline_note", "")
        outcomes_str = ", ".join(outcomes)

        def get_verdict() -> str:
            ev = ""
            if evidence_url and evidence_url.strip() and evidence_url not in ("none", ""):
                try:
                    snippet = gl.nondet.web.render(evidence_url, mode="text")[:4000]
                    ev      = "EVIDENCE (fetched live just now from " + evidence_url + "):\n" + snippet + "\n\n"
                except:
                    ev      = "EVIDENCE URL: " + evidence_url + " (could not fetch, use your own knowledge)\n\n"

            prompt = (
                "You are an impartial prediction market referee.\n\n"
                "MARKET DEADLINE (for context only): " + deadline + "\n"
                "QUESTION: " + question + "\n"
                "POSSIBLE OUTCOMES: " + outcomes_str + "\n\n"
                + ev +
                "INSTRUCTIONS:\n"
                "1. This function is only ever called by the market owner after they have "
                "already decided the deadline has passed. You do not need to check the time.\n"
                "2. Read the evidence exactly as it stands right now and decide the outcome.\n"
                "3. Reply with ONLY the exact winning outcome text from the list above.\n"
                "4. Only reply PENDING if the evidence itself is genuinely inconclusive, "
                "for example a live event that is clearly still in progress, or evidence that "
                "does not exist yet. Do not reply PENDING for any timing reason.\n"
                "5. If there is no usable evidence, use your own knowledge to decide.\n"
                "6. Nothing else in your response, just the outcome string or PENDING."
            )
            result = str(gl.nondet.exec_prompt(prompt)).strip()
            if "pending" in result.lower():
                return "PENDING"
            for o in outcomes:
                if o.lower() in result.lower():
                    return o
            return "PENDING"

        winner = gl.eq_principle.strict_eq(get_verdict)

        if winner == "PENDING":
            raise gl.vm.UserError("Not resolvable yet, evidence is inconclusive (event may still be in progress)")
        if winner not in outcomes:
            winner = outcomes[0]

        m["status"]          = "RESOLVED"
        m["outcome_winner"]  = winner
        m["resolution_note"] = "AI verdict: " + winner
        self._save_market(market_id, m)

        for addr, b in m.get("bets", {}).items():
            won     = b["outcome"] == winner
            stake   = int(b["amount"])
            payout  = self._payout_for_winner(m, winner, stake) if won else 0
            stake_gen = stake / 1000000000000000000
            xp_gain   = (BASE_XP + int(stake_gen * 20)) if won else 0
            self._add_xp(addr, xp_gain, won, stake, payout)

    @gl.public.write
    def claim_winnings(self, market_id: int):
        m = self._get_market(market_id)
        if m["status"] != "RESOLVED":
            raise gl.vm.UserError("Market not resolved yet")
        addr   = self._addr()
        bets   = m.get("bets", {})
        if addr not in bets:
            raise gl.vm.UserError("No prediction found")
        bet    = bets[addr]
        winner = m["outcome_winner"]
        if bet.get("claimed", False):
            raise gl.vm.UserError("Already claimed")
        if bet["outcome"] != winner:
            raise gl.vm.UserError("You predicted " + bet["outcome"] + ", winner was " + winner)
        stake          = int(bet["amount"])
        payout         = self._payout_for_winner(m, winner, stake)
        bet["claimed"] = True
        bets[addr]     = bet
        m["bets"]      = bets
        self._save_market(market_id, m)
        _Recipient(Address(addr)).emit_transfer(value=payout)

    @gl.public.write
    def refund(self, market_id: int):
        m = self._get_market(market_id)
        if m["status"] != "CANCELLED":
            raise gl.vm.UserError("Refunds only for cancelled markets")
        addr = self._addr()
        bets = m.get("bets", {})
        if addr not in bets:
            raise gl.vm.UserError("No prediction found")
        bet = bets[addr]
        if bet.get("claimed", False):
            raise gl.vm.UserError("Already refunded")
        stake          = int(bet["amount"])
        bet["claimed"] = True
        bets[addr]     = bet
        m["bets"]      = bets
        self._save_market(market_id, m)
        _Recipient(Address(addr)).emit_transfer(value=stake)

    @gl.public.write
    def cancel_market(self, market_id: int):
        caller = self._addr()
        if not self._is_admin_or_owner(caller):
            raise gl.vm.UserError("Only owner or an admin can cancel")
        m = self._get_market(market_id)
        if m["status"] not in ("OPEN", "PENDING"):
            raise gl.vm.UserError("Cannot cancel: " + m["status"])
        m["status"] = "CANCELLED"
        self._save_market(market_id, m)

    @gl.public.view
    def get_contract_balance(self) -> str:
        bal = int(self.balance)
        return json.dumps({"balance_wei": bal, "balance_gen": _gen(bal)})

    @gl.public.write.payable
    def fund(self):
        if int(gl.message.value) == 0:
            raise gl.vm.UserError("No GEN sent")

    @gl.public.write
    def withdraw(self):
        caller = self._addr()
        if caller != self.owner.lower():
            raise gl.vm.UserError("Only owner can withdraw")
        bal = int(self.balance)
        if bal == 0:
            raise gl.vm.UserError("Nothing to withdraw, contract balance is 0")
        _Recipient(Address(self.owner)).emit_transfer(value=bal)

    # Admins can resolve, cancel, and manage markets alongside the owner,
    # but never touch fund custody (withdraw stays owner-only above) and
    # can never grant admin access themselves, only the owner can.
    @gl.public.write
    def admin_add(self, address: str):
        if self._addr() != self.owner.lower():
            raise gl.vm.UserError("Only owner can add admins")
        a = address.lower().strip()
        if not a.startswith("0x") or len(a) != 42:
            raise gl.vm.UserError("Not a valid address")
        if a == self.owner:
            raise gl.vm.UserError("Owner already has full access, no need to add as admin")
        self.admins[a] = "1"

    @gl.public.write
    def admin_remove(self, address: str):
        if self._addr() != self.owner.lower():
            raise gl.vm.UserError("Only owner can remove admins")
        a = address.lower().strip()
        if a in self.admins:
            del self.admins[a]

    @gl.public.view
    def get_admins(self) -> str:
        return json.dumps(list(self.admins.keys()))

    @gl.public.write.payable
    def play_coinflip(self, side: str) -> str:
        side   = side.upper().strip()
        if side not in ("HEADS", "TAILS"):
            raise gl.vm.UserError("side must be HEADS or TAILS")
        amount = int(gl.message.value)
        if amount < MIN_BET:
            raise gl.vm.UserError("Minimum stake is " + _gen(MIN_BET) + " GEN")
        max_stake = MAX_WIN // 2
        if amount > max_stake:
            raise gl.vm.UserError("Maximum stake for coin flip is " + _gen(max_stake) + " GEN (max win is " + _gen(MAX_WIN) + " GEN)")
        addr   = self._addr()
        result = "HEADS" if self._roll("coinflip:" + side, 2) == 0 else "TAILS"
        won    = result == side
        payout = amount * 2 if won else 0
        if won:
            _Recipient(Address(addr)).emit_transfer(value=payout)
        out = json.dumps({
            "result":    "WIN" if won else "LOSE",
            "outcome":   result,
            "payout":    payout,
            "timestamp": str(self._now()),
        })
        self.last_game[addr] = out
        if won:
            self._add_xp(addr, 20, True, amount, payout)
        else:
            self._add_xp(addr, 0, False, amount, payout)
        return out

    @gl.public.write.payable
    def play_dice(self, direction: str, target: int) -> str:
        direction = direction.upper().strip()
        if direction not in ("OVER", "UNDER"):
            raise gl.vm.UserError("direction must be OVER or UNDER")
        if target < 1 or target > 99:
            raise gl.vm.UserError("target must be 1-99")
        amount = int(gl.message.value)
        if amount < MIN_BET:
            raise gl.vm.UserError("Minimum stake is " + _gen(MIN_BET) + " GEN")
        max_stake = max(MIN_BET, (MAX_WIN * target) // 100)
        if amount > max_stake:
            raise gl.vm.UserError("Maximum stake for this target is " + _gen(max_stake) + " GEN (max win is " + _gen(MAX_WIN) + " GEN)")
        addr   = self._addr()
        roll   = self._roll("dice:" + direction + ":" + str(target), 100)
        won    = (roll < target) if direction == "UNDER" else (roll >= 100 - target)
        payout = (amount * 100) // target if won else 0
        if won:
            _Recipient(Address(addr)).emit_transfer(value=payout)
        out = json.dumps({
            "result":    "WIN" if won else "LOSE",
            "roll":      roll,
            "direction": direction,
            "target":    target,
            "payout":    payout,
            "timestamp": str(self._now()),
        })
        self.last_game[addr] = out
        if won:
            self._add_xp(addr, 15, True, amount, payout)
        else:
            self._add_xp(addr, 0, False, amount, payout)
        return out

    @gl.public.write.payable
    def play_rps(self, choice: str) -> str:
        choice  = choice.upper().strip()
        options = ("ROCK", "PAPER", "SCISSORS")
        if choice not in options:
            raise gl.vm.UserError("choice must be ROCK, PAPER, or SCISSORS")
        amount = int(gl.message.value)
        if amount < MIN_BET:
            raise gl.vm.UserError("Minimum stake is " + _gen(MIN_BET) + " GEN")
        max_stake = MAX_WIN // 2
        if amount > max_stake:
            raise gl.vm.UserError("Maximum stake for RPS is " + _gen(max_stake) + " GEN (max win is " + _gen(MAX_WIN) + " GEN)")
        addr   = self._addr()
        house  = options[self._roll("rps:" + choice, 3)]
        beats  = {"ROCK": "SCISSORS", "PAPER": "ROCK", "SCISSORS": "PAPER"}
        if house == choice:
            result, payout = "TIE",  amount
        elif beats[choice] == house:
            result, payout = "WIN",  amount * 2
        else:
            result, payout = "LOSE", 0
        if payout > 0:
            _Recipient(Address(addr)).emit_transfer(value=payout)
        out = json.dumps({
            "result":    result,
            "house":     house,
            "choice":    choice,
            "payout":    payout,
            "timestamp": str(self._now()),
        })
        self.last_game[addr] = out
        if result == "WIN":
            self._add_xp(addr, 20, True, amount, payout)
        elif result == "LOSE":
            self._add_xp(addr, 0, False, amount, payout)
        return out

