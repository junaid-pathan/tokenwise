"""A owns the implementation; interface stub written jointly.

Contract:
    energy_between(t0, t1) -> (joules: float, source: str)
    source is one of: "nvidia-smi" | "cloud" | "estimate"

Also exposes register(bus, app) so the power sampler can emit power.sample
events at 2 Hz once A implements it. The stub emits nothing and always
reports the "estimate" source, so no one is blocked before the Hardware gate.
"""

from __future__ import annotations

# Rough placeholder: average draw (W) used to estimate joules before a real
# meter exists. Replaced by measured values at the Hardware gate.
_ESTIMATE_WATTS = 60.0


def energy_between(t0: float, t1: float) -> tuple[float, str]:
    """Return (joules, source) for the interval [t0, t1] in epoch seconds."""
    seconds = max(0.0, t1 - t0)
    return (_ESTIMATE_WATTS * seconds, "estimate")


def register(bus, app):
    """Stub: real sampler (A, PR A2) polls Colab at 2 Hz and emits power.sample.
    Until then this does nothing so the engine stays on the estimate source."""
    return None
