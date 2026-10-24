"""Unit tests: towns, prompts, energy table, Poisson/rate formula (PR B6)."""

from __future__ import annotations

import random

from sim.crowd import energy, rate
from sim.crowd.prompts import load_heldout
from sim.crowd.towns import MA_TOWN_POP, load_town_picker


# --- towns ------------------------------------------------------------------

def test_builtin_list_has_at_least_40_real_towns():
    assert len(MA_TOWN_POP) >= 40
    assert "Boston" in MA_TOWN_POP
    assert "Worcester" in MA_TOWN_POP
    # canonical Title Case, no empty names
    for name in MA_TOWN_POP:
        assert name == name.strip() and name[0].isupper()


def test_picker_only_emits_known_towns():
    picker = load_town_picker()
    rng = random.Random(1)
    for _ in range(500):
        town = picker.pick(rng)
        assert picker.is_valid(town)
        assert town in picker.towns


def test_town_weights_favor_bigger_cities():
    """Over many draws, Boston (largest) should beat Northampton (smallest)."""
    picker = load_town_picker()
    rng = random.Random(7)
    counts = {"Boston": 0, "Northampton": 0}
    for _ in range(20000):
        t = picker.pick(rng)
        if t in counts:
            counts[t] += 1
    assert counts["Boston"] > counts["Northampton"]


def test_picker_source_is_builtin_without_centroids(tmp_path):
    missing = tmp_path / "nope.json"
    picker = load_town_picker(centroids_path=missing)
    assert picker.source == "builtin"
    assert len(picker) >= 40


def test_picker_uses_centroid_keys_when_present(tmp_path):
    import json

    f = tmp_path / "town-centroids.json"
    f.write_text(json.dumps({"Boston": [0, 0], "Fakehampton": [1, 1]}), encoding="utf-8")
    picker = load_town_picker(centroids_path=f)
    assert picker.source == "centroids"
    assert set(picker.towns) == {"Boston", "Fakehampton"}
    # Boston has a real pop weight, the unknown gets the small default -> Boston wins
    rng = random.Random(3)
    counts = {"Boston": 0, "Fakehampton": 0}
    for _ in range(5000):
        counts[picker.pick(rng)] += 1
    assert counts["Boston"] > counts["Fakehampton"]


# --- prompts ----------------------------------------------------------------

def test_load_heldout_reads_200_rows():
    prompts = load_heldout()
    assert len(prompts) == 200
    for p in prompts:
        assert p.prompt
        assert p.chars == len(p.prompt)
        assert 1 <= p.gear <= 5


# --- energy table -----------------------------------------------------------

def test_estimate_table_monotonic_in_gear():
    vals = [energy.estimate_joules(g) for g in (1, 2, 3, 4, 5)]
    assert vals == sorted(vals)
    assert all(v > 0 for v in vals)


def test_estimate_scales_with_output_tokens():
    base = energy.estimate_joules(3, 64)
    double = energy.estimate_joules(3, 128)
    assert double > base
    assert abs(double - 2 * base) < 1e-6


def test_estimate_prefers_gears_json_when_nonnull(monkeypatch):
    # Simulate the Hardware gate filling est_wh_per_1k_out_tokens for gear 2.
    monkeypatch.setattr(energy, "_wh_per_1k_from_gears", lambda: {2: 0.5})
    # 0.5 Wh/1k tokens * (1000/1000) tokens * 3600 = 1800 J for 1000 tokens
    assert abs(energy.estimate_joules(2, 1000) - 1800.0) < 1e-6


def test_estimate_uses_table_when_gears_json_null(monkeypatch):
    # With no per-1k figure (the current frozen gears.json), the table is used.
    monkeypatch.setattr(energy, "_wh_per_1k_from_gears", lambda: {})
    assert energy.estimate_joules(1, 64) == energy.ESTIMATE_JOULES_BY_GEAR[1]
    assert energy.estimate_joules(5, 64) == energy.ESTIMATE_JOULES_BY_GEAR[5]


def test_estimate_unknown_gear_falls_back_to_standard():
    # An out-of-range gear should not raise; it defaults to the gear-3 base.
    assert energy.estimate_joules(99, 64) == energy.ESTIMATE_JOULES_BY_GEAR[3]


# --- rate / Poisson ---------------------------------------------------------

def test_expected_per_minute_linear_in_load():
    # At the reference load, exactly 200/60 per minute.
    ref = rate.expected_per_minute(rate.REFERENCE_MW)
    assert abs(ref - 200.0 / 60.0) < 1e-9
    # Double the load -> double the rate (linear).
    hi = rate.expected_per_minute(2 * rate.REFERENCE_MW)
    assert abs(hi - 2 * ref) < 1e-9
    # Zero/negative load -> zero.
    assert rate.expected_per_minute(0) == 0.0
    assert rate.expected_per_minute(-5) == 0.0


def test_poisson_mean_matches_rate_formula():
    rng = random.Random(42)
    load = rate.REFERENCE_MW
    n = 60 * 50  # 50 replay hours of minutes
    total = sum(rate.draw_count(load, rng) for _ in range(n))
    per_hour = total / 50.0
    # Should average ~200/hour; allow generous tolerance for randomness.
    assert 170 <= per_hour <= 230


def test_poisson_scales_with_load():
    rng = random.Random(11)
    n = 60 * 50
    low = sum(rate.draw_count(10000.0, rng) for _ in range(n))
    high = sum(rate.draw_count(26000.0, rng) for _ in range(n))
    assert high > low
