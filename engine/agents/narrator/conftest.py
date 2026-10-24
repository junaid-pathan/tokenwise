"""Pytest config for the narrator test package.

Sets a function-scoped asyncio loop and silences the pytest-asyncio default
fixture-loop-scope deprecation warning so the suite runs cleanly in the shared
venv without touching repo-level config.
"""

import pytest


def pytest_configure(config):
    # Harmless if already set elsewhere; keeps this package self-contained.
    config.addinivalue_line("markers", "asyncio: mark an async test")


# pytest-asyncio reads this to scope the event loop for async fixtures.
@pytest.fixture(scope="function")
def anyio_backend():
    return "asyncio"
