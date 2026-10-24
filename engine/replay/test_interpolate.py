"""Unit tests for engine/replay interpolation and cache loading."""

from __future__ import annotations

import pytest

from engine.replay.interpolate import (
    MINUTES_PER_DAY,
    hourly_loads,
    interpolate_to_minutes,
    load_cache,
    minute_clock,
    minute_series,
)


def test_cache_loads_with_24_points():
    cache = load_cache()
    assert len(cache["points"]) == 24
    assert cache["metadata"]["respondent"] == "ISNE"
    assert cache["metadata"]["units"] == "MW"


def test_hourly_loads_ordered_0_to_23():
    cache = load_cache()
    loads = hourly_loads(cache)
    assert len(loads) == 24
    # hour 0 of the cached day is 19715.0
    assert loads[0] == pytest.approx(19715.0)
    assert loads[19] == pytest.approx(25898.0)  # the real peak hour


def test_interpolation_length_is_1440():
    loads = interpolate_to_minutes([float(h) for h in range(24)])
    assert len(loads) == MINUTES_PER_DAY


def test_interpolation_exact_on_hour_marks():
    hourly = [float(h * 100) for h in range(24)]
    minutes = interpolate_to_minutes(hourly)
    for h in range(24):
        assert minutes[h * 60] == pytest.approx(hourly[h])


def test_interpolation_midpoint_is_average():
    # hour 0 = 0, hour 1 = 60 -> minute 30 should be 30.0
    hourly = [0.0, 60.0] + [0.0] * 22
    minutes = interpolate_to_minutes(hourly)
    assert minutes[30] == pytest.approx(30.0)
    # quarter point
    assert minutes[15] == pytest.approx(15.0)


def test_interpolation_linear_segment():
    # between hour 16 (23717) and hour 17 (24817): slope 1100/60 per minute
    cache = load_cache()
    minutes = interpolate_to_minutes(hourly_loads(cache))
    m = 16 * 60 + 30  # half way into hour 16
    expected = 23717.0 + (24817.0 - 23717.0) * 0.5
    assert minutes[m] == pytest.approx(expected)


def test_interpolation_rejects_wrong_length():
    with pytest.raises(ValueError):
        interpolate_to_minutes([1.0, 2.0, 3.0])


def test_minute_clock_format():
    assert minute_clock(0) == "2025-06-24T00:00:00"
    assert minute_clock(960) == "2025-06-24T16:00:00"  # 16:00 local
    assert minute_clock(1439) == "2025-06-24T23:59:00"


def test_minute_clock_out_of_range():
    with pytest.raises(ValueError):
        minute_clock(1440)
    with pytest.raises(ValueError):
        minute_clock(-1)


def test_minute_series_shape_and_peak():
    series = minute_series()
    assert len(series) == MINUTES_PER_DAY
    assert set(series[0].keys()) == {"minute", "replay_clock", "load_mw"}
    peak = max(series, key=lambda p: p["load_mw"])
    # interpolated peak sits at the hour-19 mark (minute 1140), value 25898
    assert peak["load_mw"] == pytest.approx(25898.0)
    assert peak["replay_clock"] == "2025-06-24T19:00:00"
