import ast
import json
import sys
from pathlib import Path

import pytest


GEN = 10**18


def _module(contract):
    return sys.modules[type(contract).__module__]


def _addr(contract, value):
    module = _module(contract)
    if isinstance(value, module.Address):
        return value
    return module.Address(value)


def _seed_market(contract, deadline_ts, *, status="OPEN", bets=None, winner="", market_id=0):
    module = _module(contract)
    bets = bets or {}
    market = {
        "question": "Will the test outcome be YES?",
        "outcomes": ["YES", "NO"],
        "evidence_url": "https://example.com/evidence",
        "deadline_note": "display only",
        "deadline_ts": int(deadline_ts),
        "schedule_type": "manual",
        "category": "other",
        "status": status,
        "outcome_winner": winner,
        "resolution_note": "",
        "winner_liability": 0,
        "ai_probs": {"YES": 50, "NO": 50},
        "pools": {"YES": 0, "NO": 0},
        "bet_counts": {"YES": 0, "NO": 0},
        "bets": bets,
        "created_at": "0",
    }
    for bet in bets.values():
        market["pools"][bet["outcome"]] += int(bet["amount"])
        market["bet_counts"][bet["outcome"]] += 1
    contract.markets[str(market_id)] = json.dumps(market)
    contract.market_ids.append(str(market_id))
    contract.market_count = module.u64(market_id + 1)
    contract.reserved_liabilities = module.u256(
        sum(int(b["amount"]) for b in bets.values() if not b.get("claimed", False))
    )


def _fund(contract, direct_vm, sender, amount):
    direct_vm.sender = _addr(contract, sender)
    direct_vm.value = amount
    contract.fund()
    direct_vm.value = 0


def test_place_bet_adds_exact_reserved_liability(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("prediction_market.py")
    direct_vm.warp("2026-08-10T12:00:00Z")
    _seed_market(contract, 1786366800)
    direct_vm.sender = _addr(contract, direct_alice)
    direct_vm.value = 2 * GEN

    contract.place_bet(0, "YES")

    assert int(contract.reserved_liabilities) == 2 * GEN
    market = json.loads(contract.get_market(0))
    assert market["pools"][0] == 2 * GEN


def test_multiple_markets_aggregate_reserved_liabilities(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("prediction_market.py")
    direct_vm.warp("2026-08-10T12:00:00Z")
    _seed_market(contract, 1786366800, market_id=0)
    _seed_market(contract, 1786366800, market_id=1)
    direct_vm.sender = _addr(contract, direct_alice)
    direct_vm.value = GEN
    contract.place_bet(0, "YES")
    direct_vm.sender = _addr(contract, direct_bob)
    direct_vm.value = 2 * GEN
    contract.place_bet(1, "NO")
    assert int(contract.reserved_liabilities) == 3 * GEN


@pytest.mark.parametrize("when", ["2026-08-10T12:00:00Z", "2026-08-10T12:00:01Z"])
def test_bet_at_or_after_deadline_reverts(direct_vm, direct_deploy, direct_alice, when):
    contract = direct_deploy("prediction_market.py")
    deadline = 1786363200  # 2026-08-10T12:00:00Z
    _seed_market(contract, deadline)
    direct_vm.warp(when)
    direct_vm.sender = _addr(contract, direct_alice)
    direct_vm.value = GEN

    with direct_vm.expect_revert("Betting deadline has passed"):
        contract.place_bet(0, "YES")


def test_manual_creation_rejects_deadline_at_contract_time(direct_vm, direct_deploy):
    contract = direct_deploy("prediction_market.py")
    direct_vm.warp("2026-08-10T12:00:00Z")
    direct_vm.value = 500000000000000000
    with direct_vm.expect_revert("Deadline must be in the future"):
        contract.create_market("Will it pass?", "YES,NO", "https://example.com", "now", 1786363200)


def test_resolution_requires_deadline_before_any_evidence_call(direct_vm, direct_deploy):
    contract = direct_deploy("prediction_market.py")
    direct_vm.warp("2026-08-10T11:59:59Z")
    _seed_market(contract, 1786363200)
    with direct_vm.expect_revert("Market deadline has not passed"):
        contract.resolve_market(0)


def test_cancellation_keeps_full_refund_reserve(direct_vm, direct_deploy, direct_alice, direct_owner):
    contract = direct_deploy("prediction_market.py")
    direct_vm.warp("2026-08-10T12:00:00Z")
    alice = _addr(contract, direct_alice)
    _seed_market(contract, 1786366800, bets={
        alice.as_hex.lower(): {"outcome": "YES", "amount": GEN, "claimed": False}
    })
    direct_vm.sender = _addr(contract, direct_owner)
    contract.cancel_market(0)

    assert json.loads(contract.get_market(0))["status"] == "CANCELLED"
    assert int(contract.reserved_liabilities) == GEN


def test_expired_market_cannot_be_cancelled(direct_vm, direct_deploy, direct_owner):
    contract = direct_deploy("prediction_market.py")
    direct_vm.warp("2026-08-10T12:00:00Z")
    _seed_market(contract, 1786363200)
    direct_vm.sender = _addr(contract, direct_owner)
    with direct_vm.expect_revert("Expired markets must be settled, not cancelled"):
        contract.cancel_market(0)


def test_unauthorized_scheduled_generation_fails_before_ai_call(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("prediction_market.py")
    direct_vm.sender = _addr(contract, direct_alice)
    with direct_vm.expect_revert("Only the owner or an admin can generate scheduled markets"):
        contract.create_daily_market("", "")


def test_refund_decreases_reserve_once(direct_vm, direct_deploy, direct_alice, direct_owner):
    contract = direct_deploy("prediction_market.py")
    direct_vm.warp("2026-08-10T12:00:00Z")
    alice = _addr(contract, direct_alice)
    _seed_market(contract, 1786366800, status="CANCELLED", bets={
        alice.as_hex.lower(): {"outcome": "YES", "amount": GEN, "claimed": False}
    })
    _fund(contract, direct_vm, direct_alice, GEN)
    direct_vm.sender = alice
    # Direct Mode verifies the deterministic parent commit and liability
    # transition; it does not execute the external EOA child at finalization.
    contract.refund(0)
    assert int(contract.reserved_liabilities) == 0
    view = json.loads(contract.get_my_bet(0, alice.as_hex))
    assert view["status"] == "CLAIMED"
    assert view["payout_status"] == "EXTERNAL_MESSAGE_COMMITTED"
    assert int(contract.committed_outbound) == GEN
    assert int(contract.book_balance) == 0
    book_before = int(contract.book_balance)
    direct_vm.sender = _addr(contract, direct_owner)
    with direct_vm.expect_revert("Withdrawal exceeds withdrawable surplus"):
        contract.withdraw(str(GEN))
    direct_vm.sender = alice
    with direct_vm.expect_revert("Already refunded"):
        contract.refund(0)
    assert int(contract.book_balance) == book_before


def test_winner_claim_decreases_exact_payout_reserve(direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner):
    contract = direct_deploy("prediction_market.py")
    alice = _addr(contract, direct_alice)
    bob = _addr(contract, direct_bob)
    _seed_market(contract, 1786363200, status="RESOLVED", winner="YES", bets={
        alice.as_hex.lower(): {"outcome": "YES", "amount": GEN, "claimed": False},
        bob.as_hex.lower(): {"outcome": "NO", "amount": GEN, "claimed": False},
    })
    market = json.loads(contract.markets["0"])
    payout = contract._payout_for_winner(market, "YES", GEN)
    market["winner_liability"] = payout
    contract.markets["0"] = json.dumps(market)
    contract.reserved_liabilities = _module(contract).u256(payout)
    _fund(contract, direct_vm, direct_alice, payout)
    direct_vm.sender = alice

    # The external message is terminal once emitted; a failed child would not
    # roll the liability back or make this same payout claimable again.
    contract.claim_winnings(0)

    assert int(contract.reserved_liabilities) == 0
    view = json.loads(contract.get_my_bet(0, alice.as_hex))
    assert view["status"] == "CLAIMED"
    assert view["payout_status"] == "EXTERNAL_MESSAGE_COMMITTED"
    assert int(contract.committed_outbound) == payout
    assert int(contract.book_balance) == 0
    book_before = int(contract.book_balance)
    direct_vm.sender = _addr(contract, direct_owner)
    with direct_vm.expect_revert("Withdrawal exceeds withdrawable surplus"):
        contract.withdraw(str(payout))
    direct_vm.sender = alice
    with direct_vm.expect_revert("Already claimed"):
        contract.claim_winnings(0)
    assert int(contract.book_balance) == book_before


def test_withdraw_is_surplus_only(direct_vm, direct_deploy, direct_owner):
    contract = direct_deploy("prediction_market.py")
    _seed_market(contract, 1786366800, bets={
        "0x" + "11" * 20: {"outcome": "YES", "amount": 3 * GEN, "claimed": False}
    })
    _fund(contract, direct_vm, direct_owner, 4 * GEN)
    direct_vm.sender = _addr(contract, direct_owner)

    with direct_vm.expect_revert("Withdrawal exceeds withdrawable surplus"):
        contract.withdraw(str(2 * GEN))

    contract.withdraw(str(GEN))
    view = json.loads(contract.get_solvency())
    assert view["reserved_liabilities_wei"] == 3 * GEN
    # Direct Mode verifies only the parent-side surplus gate. External EOA
    # delivery/failure belongs to a Bradbury finalization integration suite.
    assert view["withdrawable_surplus_wei"] == 0
    assert view["book_balance_wei"] == 4 * GEN - GEN
    assert view["committed_outbound_wei"] == GEN


def test_non_owner_cannot_withdraw(direct_vm, direct_deploy, direct_alice, direct_owner):
    contract = direct_deploy("prediction_market.py")
    _fund(contract, direct_vm, direct_owner, GEN)
    direct_vm.sender = _addr(contract, direct_alice)
    with direct_vm.expect_revert("Only owner can withdraw"):
        contract.withdraw(str(GEN))


def test_pending_withdrawal_debits_book_before_external_finalization(direct_vm, direct_deploy, direct_owner):
    contract = direct_deploy("prediction_market.py")
    _seed_market(contract, 1786366800, bets={
        "0x" + "11" * 20: {"outcome": "YES", "amount": GEN // 10, "claimed": False}
    })
    _fund(contract, direct_vm, direct_owner, 18 * GEN // 10)
    direct_vm.sender = _addr(contract, direct_owner)

    contract.withdraw(str(GEN // 10))
    view = json.loads(contract.get_solvency())
    assert isinstance(view["observed_balance_wei"], int)
    assert view["book_balance_wei"] == 17 * GEN // 10
    assert view["economically_available_surplus_wei"] == 16 * GEN // 10
    assert json.loads(contract.get_surplus())["surplus_wei"] == 16 * GEN // 10
    with direct_vm.expect_revert("Withdrawal exceeds withdrawable surplus"):
        contract.withdraw(str(17 * GEN // 10))


def test_multiple_pending_outbound_commitments_cannot_exceed_book_surplus(direct_vm, direct_deploy, direct_owner):
    contract = direct_deploy("prediction_market.py")
    _seed_market(contract, 1786366800, bets={
        "0x" + "11" * 20: {"outcome": "YES", "amount": GEN // 10, "claimed": False}
    })
    _fund(contract, direct_vm, direct_owner, 18 * GEN // 10)
    direct_vm.sender = _addr(contract, direct_owner)

    contract.withdraw(str(GEN))
    contract.withdraw(str(6 * GEN // 10))
    assert int(contract.book_balance) == 2 * GEN // 10
    assert int(contract.committed_outbound) == 16 * GEN // 10
    contract.withdraw(str(GEN // 10))
    with direct_vm.expect_revert("Withdrawal exceeds withdrawable surplus"):
        contract.withdraw(str(GEN // 10))


def test_pending_withdrawals_cannot_consume_market_reserve_through_game_guard(direct_vm, direct_deploy, direct_owner):
    contract = direct_deploy("prediction_market.py")
    _seed_market(contract, 1786366800, bets={
        "0x" + "11" * 20: {"outcome": "YES", "amount": GEN // 10, "claimed": False}
    })
    _fund(contract, direct_vm, direct_owner, 18 * GEN // 10)
    direct_vm.sender = _addr(contract, direct_owner)
    contract.withdraw(str(17 * GEN // 10))

    with direct_vm.expect_revert("House bankroll cannot cover this payout"):
        contract._require_game_payout(2 * GEN // 10)
    assert int(contract.book_balance) == GEN // 10


def test_pending_game_payout_cannot_be_withdrawn_from_reserved_funds(direct_vm, direct_deploy, direct_owner, direct_alice):
    contract = direct_deploy("prediction_market.py")
    _seed_market(contract, 1786366800, bets={
        "0x" + "11" * 20: {"outcome": "YES", "amount": GEN // 10, "claimed": False}
    })
    _fund(contract, direct_vm, direct_owner, 13 * GEN // 10)
    # Game wins use the same _send path; model the committed payout without
    # depending on nondeterministic game output in this ledger regression.
    contract._send(_addr(contract, direct_alice).as_hex, 2 * GEN // 10)
    direct_vm.sender = _addr(contract, direct_owner)
    contract.withdraw(str(GEN))
    with direct_vm.expect_revert("Withdrawal exceeds withdrawable surplus"):
        contract.withdraw(str(2 * GEN // 10))


def test_send_gen_forwarding_does_not_create_reusable_surplus(direct_vm, direct_deploy, direct_owner):
    contract = direct_deploy("prediction_market.py")
    _fund(contract, direct_vm, direct_owner, GEN)
    direct_vm.sender = _addr(contract, direct_owner)
    direct_vm.value = GEN // 2
    contract.send_gen("0x" + "22" * 20)
    direct_vm.value = 0
    assert int(contract.book_balance) == GEN
    assert json.loads(contract.get_surplus())["economically_available_surplus_wei"] == GEN
    assert int(contract.committed_outbound) == GEN // 2


def test_payable_ingress_book_and_bet_reserve_accounting(direct_vm, direct_deploy, direct_owner, direct_alice):
    contract = direct_deploy("prediction_market.py")
    _fund(contract, direct_vm, direct_owner, GEN)
    direct_vm.warp("2026-08-10T12:00:00Z")
    _seed_market(contract, 1786366800)
    direct_vm.sender = _addr(contract, direct_alice)
    direct_vm.value = 2 * GEN // 10
    contract.place_bet(0, "YES")
    direct_vm.value = 0
    assert int(contract.book_balance) == 12 * GEN // 10
    assert int(contract.reserved_liabilities) == 2 * GEN // 10


def test_book_ledger_schema_and_source_guards():
    source = Path("prediction_market.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    create = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "create_market")
    assert "self._accept_value()" in ast.get_source_segment(source, create)
    assert "book_balance:     u256" in source
    assert source.count("self._accept_value()") == 7
    assert '"observed_balance_wei"' in source
    assert '"economically_available_surplus_wei"' in source
    assert "int(self.balance) < self._reserved()" not in source
    assert "int(self.balance) < updated_reserved" not in source


def test_contract_source_has_permissionless_deadline_settlement_and_safe_ordering():
    source = Path("prediction_market.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    resolve = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "resolve_market")
    resolve_text = ast.get_source_segment(source, resolve)
    assert "_require_deadline" in resolve_text
    assert "_is_admin_or_owner" not in resolve_text
    claim = ast.get_source_segment(source, next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "claim_winnings"))
    assert "_commit_bet_payout" in claim
    refund = ast.get_source_segment(source, next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "refund"))
    assert "_commit_bet_payout" in refund
    payout = ast.get_source_segment(source, next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "_commit_bet_payout"))
    assert payout.index("self._send") < payout.index("self._save_market")
    assert "EXTERNAL_MESSAGE_COMMITTED" in payout
    assert "committed_outbound" in source
    assert "__on_errored_message__" not in source


def test_source_rejects_memory_only_evidence_fallback_and_full_balance_withdraw():
    source = Path("prediction_market.py").read_text(encoding="utf-8")
    assert "use your own knowledge" not in source
    assert "def withdraw(self, amount_wei: str)" in source
    assert "emit_transfer(value=bal)" not in source
    assert "failed transfer can be retried" not in source.lower()


def test_source_covers_scheduled_deadlines_fees_and_game_bankroll_guards():
    source = Path("prediction_market.py").read_text(encoding="utf-8")
    assert "int(gl.message.value) != CREATION_FEE" in source
    assert "def _create_scheduled_market" in source
    assert '"daily": (' in source
    assert '"weekly": (' in source
    assert '"monthly": (' in source
    assert '"ai_probs": probs' in source
    assert 'probs = {"YES": 50, "NO": 50}' in source
    assert source.count("self._require_game_payout(") >= 3
    assert "EVIDENCE_UNAVAILABLE" in source
    assert "BEGIN UNTRUSTED EVIDENCE DATA" in source

def test_weekly_scheduled_creation_is_deterministic(direct_vm, direct_deploy, direct_owner):
    contract = direct_deploy("prediction_market.py")
    direct_vm.warp("2026-08-15T12:00:00Z")
    direct_vm.sender = _addr(contract, direct_owner)

    contract.create_weekly_market("", "")

    assert contract.get_market_count() == "1"
    market = json.loads(contract.get_market(0))
    assert market["status"] == "OPEN"
    assert market["schedule_type"] == "weekly"
    assert market["outcomes"] == ["YES", "NO"]
    assert market["ai_probs"] == [50, 50]
    assert market["deadline_ts"] == 1787400000
    assert market["evidence_url"].startswith("https://")
