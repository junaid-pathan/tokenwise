"""A (PR A4): Triage. Trained classifier with a rules fallback.
Listens: prompt.received. Emits: triage.decided. Under 150 ms on CPU.
Stub register() does nothing yet.
"""

from __future__ import annotations


def register(bus, app):
    # TODO(A4): subscribe prompt.received -> emit triage.decided; serve /v1/triage.
    return None
