"""B (PR B5): Narrator. LLM (Bedrock), number-guarded.
Listens: commit, report, verdict, level changes. Emits: narrator.line.
One line per 8 s, 18 words max. Every number must appear in the cited events,
otherwise use a template line. Stub register() does nothing yet.
"""

from __future__ import annotations


def register(bus, app):
    # TODO(B5): template lines first, then Bedrock lines with the number guard.
    return None
