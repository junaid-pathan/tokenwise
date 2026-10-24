"""Tests for the power meter (A2). Synthetic samples; no network."""

from __future__ import annotations

import pytest

from engine import power


@pytest.fixture(autouse=True)
def fresh_store(monkeypatch):
    s = power._PowerStore()
    s.reachable = True
    monkeypatch.setattr(power, "store", s)
    return s


def feed(store, start, n, dt=0.5, watts=100.0, util=50.0):
    for i in range(n):
        store.add(start + i * dt, watts, util)


def test_long_interval_constant_power():
    s = power.store
    feed(s, 1000.0, 21)                       # 10 s of 100 W
    j, src = power.energy_between(1002.0, 1008.0)
    assert src == "measured" and j == pytest.approx(600.0)


def test_short_interval_between_two_samples_is_measured():
    """A ~0.4 s answer fits between two 0.5 s samples; old code returned estimated."""
    s = power.store
    feed(s, 1000.0, 21)
    j, src = power.energy_between(1003.05, 1003.45)
    assert src == "measured" and j == pytest.approx(40.0)


def test_linear_ramp_is_interpolated():
    s = power.store
    for i in range(11):                       # watts = 100 + 20*t over 5 s
        s.add(1000.0 + i * 0.5, 100.0 + 20.0 * (i * 0.5), 50.0)
    j, src = power.energy_between(1001.0, 1001.2)
    # mean watts = 100 + 20*1.1 = 122 -> 0.2 s -> 24.4 J
    assert src == "measured" and j == pytest.approx(24.4)


def test_no_coverage_or_dropout_falls_back_to_estimate():
    s = power.store
    feed(s, 1000.0, 5)                        # samples only cover 1000-1002
    assert power.energy_between(1100.0, 1101.0)[1] == "estimated"   # nothing near
    s.add(1010.0, 100.0, 50.0)                # 8 s dropout between 1002 and 1010
    assert power.energy_between(1001.0, 1009.0)[1] == "estimated"   # dropout inside


def test_unreachable_meter_uses_estimate_even_with_old_samples():
    s = power.store
    feed(s, 1000.0, 21)
    s.reachable = False
    j, src = power.energy_between(1002.0, 1004.0)
    assert src == "estimated" and j > 0


def test_idle_subtraction():
    s = power.store
    for i in range(30):
        s.add(1000.0 + i * 0.5, 30.0, 0.0)    # idle 30 W for 15 s -> baseline
    feed(s, 1020.0, 11, watts=130.0)
    s.add(1030.0, 30.0, 0.0)                  # idle baseline gets frozen after 10 s
    net, src = power.joules_above_idle(1021.0, 1024.0)
    assert src == "measured" and net == pytest.approx((130.0 - 30.0) * 3.0, rel=0.02)


def test_zero_or_reversed_interval():
    assert power.energy_between(10.0, 10.0)[0] == 0.0
    assert power.energy_between(10.0, 5.0)[0] == 0.0
