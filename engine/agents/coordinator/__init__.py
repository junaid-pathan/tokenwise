"""A (PR A6/A7): Coordinator. Deterministic policy + negotiation.
Listens: triage.decided, grid.state, utility.request, answer.completed.
Emits: route.decided, coordinator.commit, coordinator.report.
Never touches protected prompts. Stub register() does nothing yet.
"""

from __future__ import annotations


def register(bus, app):
    # TODO(A6): policy table -> route.decided.
    # TODO(A7): handle utility.request -> commit + report.
    return None
