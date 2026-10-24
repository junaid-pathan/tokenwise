"""Local pytest config for the Utility agent tests.

Lives inside engine/agents/utility/ (the only folder B4 may edit). Puts the repo
root on sys.path so `engine.*` and `contracts.*` import when pytest is run from
anywhere, and enables pytest-asyncio auto mode for the async tests here.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# repo root = .../ds-b4 (parents: utility -> agents -> engine -> ds-b4)
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


def pytest_configure(config: pytest.Config) -> None:
    # Make every `async def test_*` run without an explicit marker.
    config.option.asyncio_mode = "auto"
