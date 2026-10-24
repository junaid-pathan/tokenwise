"""Pytest config for the crowd-sim tests (owner B, PR B6).

Forces pytest-asyncio into "auto" mode for this test session so `async def
test_*` coroutines run without a per-test marker, independent of any repo-wide
config. Setting it in pytest_configure runs before pytest-asyncio collects, so
it takes effect for these tests.
"""

import pytest


def pytest_configure(config):
    # pytest-asyncio reads this ini value at collection; set it to auto so every
    # async test in this package is collected as an asyncio test.
    try:
        config.inicfg["asyncio_mode"] = "auto"
    except Exception:
        pass
    try:
        config.option.asyncio_mode = "auto"
    except Exception:
        pass
