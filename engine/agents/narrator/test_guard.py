"""Tests for the number extractor and the number guard."""

from __future__ import annotations

from engine.agents.narrator import guard


def test_extract_numbers_commas_decimals_percent():
    nums = guard.extract_numbers("Grid red at 24,180 MW, cut 25% then 24.3 percent.")
    assert nums == [24180.0, 25.0, 24.3]


def test_extract_numbers_empty():
    assert guard.extract_numbers("No numbers here at all.") == []


def test_extract_large_thousands():
    assert guard.extract_numbers("1,234,567 megawatts") == [1234567.0]


def _grid_event(load_mw=24180.0):
    return {"type": "grid.state", "id": "g1", "ts": 99, "load_mw": load_mw, "level": "red"}


def test_guard_accepts_valid_mw():
    ev = _grid_event()
    assert guard.line_ok("Grid is red at 24,180 megawatts.", [ev])


def test_guard_accepts_display_roundings():
    report = {"type": "coordinator.report", "id": "r", "achieved_cut_pct": 24.3}
    # exact
    assert guard.numbers_supported("Delivered 24.3 percent.", [report])
    # whole-number rounding is allowed
    assert guard.numbers_supported("Delivered 24 percent.", [report])


def test_guard_rejects_wrong_percent():
    # Cited events say 25; a line claiming 30 percent must be rejected.
    req = {"type": "utility.request", "id": "u", "cut_pct": 25.0, "duration_min": 120}
    assert not guard.numbers_supported("Utility asked for a 30 percent cut.", [req])
    # 25 is fine.
    assert guard.numbers_supported("Utility asked for a 25 percent cut.", [req])


def test_guard_rejects_unrelated_number():
    ev = _grid_event()
    # 99999 appears nowhere in the event values.
    assert not guard.numbers_supported("Grid at 99,999 megawatts.", [ev])


def test_guard_bool_not_treated_as_number():
    # accepted=True must NOT make "1" an allowed number. Use shortfall 5.0 so
    # no rounding of a real value happens to equal 1.
    verdict = {"type": "utility.verdict", "id": "v", "accepted": True, "shortfall_pct": 5.0}
    assert not guard.numbers_supported("We hit 1 percent.", [verdict])
    assert guard.numbers_supported("Shortfall of 5 points.", [verdict])


def test_guard_ignores_ts_noise():
    ev = _grid_event()
    # ts is 99 but a line citing 99 should still be rejected as unrelated.
    assert not guard.numbers_supported("Ninety nine: 99.", [ev])


def test_word_limit():
    ev = _grid_event()
    long_line = " ".join(["word"] * 19)  # 19 words, no numbers
    assert guard.word_count(long_line) == 19
    assert not guard.line_ok(long_line, [ev])
    ok_line = " ".join(["word"] * 18)
    assert guard.line_ok(ok_line, [ev])


def test_empty_line_rejected():
    assert not guard.line_ok("", [_grid_event()])
    assert not guard.line_ok("   ", [_grid_event()])


def test_multi_event_allowed_set():
    grid = _grid_event()
    req = {"type": "utility.request", "id": "u", "cut_pct": 25.0, "duration_min": 120}
    line = "Grid red at 24,180 MW. Utility asked for 25 percent."
    assert guard.line_ok(line, [grid, req])
