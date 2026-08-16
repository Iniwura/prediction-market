from pathlib import Path


SOURCE = (Path(__file__).parents[1] / "bot" / "resolve-bot.js").read_text(encoding="utf-8")


def _function_body(name):
    marker = f"async function {name}"
    start = SOURCE.index(marker)
    end = SOURCE.find("\nasync function ", start + len(marker))
    return SOURCE[start:] if end < 0 else SOURCE[start:end]


def test_scheduled_market_visibility_wait_is_read_only_and_bounded():
    helper = _function_body("waitForOpenScheduledMarket")
    assert "getMarkets()" in helper
    assert "submitAndConfirm" not in helper
    assert "writeContract" not in helper
    assert "timeoutMs = 60000" in helper
    assert "Math.min(3000, remaining)" in helper


def test_scheduled_creation_submits_once_then_waits_for_visibility():
    runner = _function_body("keepScheduledMarketsRunning")
    assert runner.count("submitAndConfirm(") == 1
    assert "await waitForOpenScheduledMarket(type)" in runner
    assert "accepted, waiting for state visibility" in runner
