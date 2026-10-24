"""B (PR B1): June 24, 2025 replay clock. Pulls EIA hourly New England demand,
interpolates to minutes, emits grid.load, serves POST /v1/demo/replay.
Stub register() does nothing yet.
"""

from __future__ import annotations


def register(bus, app):
    # TODO(B1): add POST /v1/demo/replay; emit grid.load on a replay clock.
    return None
