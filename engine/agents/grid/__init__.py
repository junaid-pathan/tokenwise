"""A (PR A5): Grid agent. Plain rules on load.
Listens: grid.load (from B's replay) or the live EIA feed.
Emits: grid.state every replay minute. Serves /v1/grid, /v1/demo/alert.
Green < 20,000 MW, yellow <= 23,500, red above. Stub register() does nothing.
"""

from __future__ import annotations


def register(bus, app):
    # TODO(A5): subscribe grid.load -> level -> emit grid.state; serve /v1/grid, /v1/demo/alert.
    return None
