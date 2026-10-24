"""Number guard for Narrator lines.

Two jobs:
  1. extract_numbers(text): pull every number out of a line, handling thousands
     commas (24,180), decimals (24.3) and percent signs (25%). Returns floats.
  2. line_ok(text, events, max_words): a line is OK only when EVERY number in it
     matches a numeric value found in the cited events (allowing the obvious
     display roundings of an event value, e.g. 24180.0 -> "24,180", 24.3 -> "24.3"
     or "24") AND the line is at most `max_words` words. Unrelated numbers fail.

If line_ok returns False the Narrator must fall back to the template line and
never publish the bad line.
"""

from __future__ import annotations

import re
from typing import Iterable

MAX_WORDS = 18

# Matches 24,180 / 24180 / 24.3 / 24,180.5 / 25 (optionally followed by %).
_NUMBER_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")

# How close a line number must be to an allowed value to count as a match.
_EPSILON = 1e-6


def extract_numbers(text: str) -> list[float]:
    """Return every numeric literal in `text` as a float.

    Strips thousands commas and a trailing percent sign is irrelevant to the
    numeric value (we match on the number itself, not the % symbol).
    """
    out: list[float] = []
    for match in _NUMBER_RE.finditer(text):
        raw = match.group(0).replace(",", "")
        try:
            out.append(float(raw))
        except ValueError:
            continue
    return out


def _numeric_values(event: dict) -> list[float]:
    """Every numeric field value on an event (floats/ints, nested dicts too).

    The event's own `ts` is included as a number it legitimately carries; the
    guard only needs the set to be a SUPERSET of what a sane line would cite,
    so extra values never cause a false rejection. We skip it anyway to keep
    the allowed set tight and catch truly unrelated numbers.
    """
    values: list[float] = []

    def walk(obj) -> None:
        if isinstance(obj, bool):
            return  # bool is an int subclass; never treat True/False as a number
        if isinstance(obj, (int, float)):
            values.append(float(obj))
        elif isinstance(obj, dict):
            for k, v in obj.items():
                if k in ("ts",):  # noise, never narrated
                    continue
                walk(v)
        elif isinstance(obj, (list, tuple)):
            for v in obj:
                walk(v)

    walk(event)
    return values


def _allowed_renderings(value: float) -> set[float]:
    """Display roundings of one event value that a line may legitimately show.

    e.g. 24180.0 -> {24180.0, 24180.0}; 24.3 -> {24.3, 24.0}; 24.7 -> {24.7, 25.0}.
    The line's number (already a float via extract_numbers) is compared against
    this set with a small epsilon.
    """
    allowed = {float(value)}
    allowed.add(float(round(value)))        # whole-number display (24.3 -> 24)
    allowed.add(float(round(value, 1)))     # one-decimal display
    return allowed


def numbers_supported(text: str, events: Iterable[dict]) -> bool:
    """True iff every number in `text` matches some cited event value."""
    allowed: set[float] = set()
    for ev in events:
        for val in _numeric_values(ev):
            allowed |= _allowed_renderings(val)

    for n in extract_numbers(text):
        if not any(abs(n - a) <= _EPSILON for a in allowed):
            return False
    return True


def word_count(text: str) -> int:
    return len(text.split())


def line_ok(text: str, events: Iterable[dict], max_words: int = MAX_WORDS) -> bool:
    """Full guard: word limit AND every number supported by the cited events."""
    text = (text or "").strip()
    if not text:
        return False
    if word_count(text) > max_words:
        return False
    return numbers_supported(text, list(events))
