"""Prompt rate model for the crowd simulator (PR B6, owner B).

The replay emits one grid.load per replay minute (field load_mw). The crowd's
prompt rate follows that load:

    FORMULA
    -------
    Target average = 200 prompts per replay HOUR when load == REFERENCE_MW.
    Per replay minute that is  200 / 60  =  3.3333 prompts.
    The rate scales LINEARLY with load:

        expected_per_minute(load_mw) = (200 / 60) * (load_mw / REFERENCE_MW)

    REFERENCE_MW = 21,000 MW (the day's approximate average New England demand;
    the June-24 replay peaks near 26,586 MW, so peak minutes emit ~27% more than
    the average minute, and quiet overnight minutes emit fewer).

    On each grid.load we draw a Poisson count with that mean and emit exactly
    that many prompts, spread with jitter over the REAL wall-clock interval until
    the next grid.load (measured live), so the sim self-paces at ANY replay
    speed.

Over a full 1440-minute day the per-minute means sum to 200 * (daily_mean /
REFERENCE_MW); with REFERENCE_MW set to the true daily mean that is ~200 per
replay hour on average.
"""

from __future__ import annotations

import random

# Day's approximate average New England demand (MW). June-24 peaks ~26,586 MW.
REFERENCE_MW = 21000.0

# Target average prompts per replay hour at REFERENCE_MW.
TARGET_PER_REPLAY_HOUR = 200.0

# Per replay minute at the reference load.
_BASE_PER_MINUTE = TARGET_PER_REPLAY_HOUR / 60.0  # 3.3333...


def expected_per_minute(load_mw: float) -> float:
    """Expected prompt count for one replay minute at the given load (linear)."""
    if load_mw <= 0:
        return 0.0
    return _BASE_PER_MINUTE * (float(load_mw) / REFERENCE_MW)


def draw_count(load_mw: float, rng: random.Random) -> int:
    """Draw a Poisson count of prompts for this replay minute at `load_mw`."""
    mean = expected_per_minute(load_mw)
    if mean <= 0:
        return 0
    return _poisson(mean, rng)


def _poisson(lam: float, rng: random.Random) -> int:
    """Knuth's Poisson sampler using an injectable RNG (deterministic in tests).

    Fine for the small means (~3-5) this sim uses. For larger lambda it still
    terminates but is slower; we never exceed single-digit means here.
    """
    if lam <= 0:
        return 0
    import math

    l = math.exp(-lam)
    k = 0
    p = 1.0
    while True:
        k += 1
        p *= rng.random()
        if p <= l:
            return k - 1
