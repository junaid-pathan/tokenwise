"""B (PR B4): Utility agent. Deterministic negotiator.
Listens: grid.state, coordinator.commit, coordinator.report.
Emits: utility.request, utility.verdict. Serves POST /v1/utility/request.
Red for 2 samples: request 25% cut for 120 min. Shortfall > 3 pts: re-request once.
Stub register() does nothing yet.
"""

from __future__ import annotations


def register(bus, app):
    # TODO(B4): red-twice -> utility.request; report -> utility.verdict; one escalation.
    return None
