"""Fetch hourly ISO-NE (New England) demand for 2025-06-24 from the EIA API v2.

Endpoint: https://api.eia.gov/v2/electricity/rto/region-data/data/
  facets: respondent=ISNE (ISO New England), type=D (demand)
  frequency: hourly
  units:    megawatthours (reported as MWh per hour == average MW)

Timezone note
-------------
The replay runs on LOCAL New England time (America/New_York, EDT = UTC-4 on
2025-06-24). EIA `period` timestamps are in UTC. We therefore request a UTC
window that fully covers the local day and convert every period to local time.

Local day 2025-06-24 00:00 .. 2025-06-25 00:00 (EDT, UTC-4)
  == UTC   2025-06-24 04:00 .. 2025-06-25 04:00

We keep the 24 hourly points whose LOCAL hour falls on 2025-06-24 (local hours
00..23) and cache them, labelled with their local clock string.

The API key is read from .env (EIA_API_KEY) via python-dotenv. The key is a
secret: it is never printed, logged, or written to the cache.

Usage:
    python data/grid/fetch_eia.py            # fetch + write data/grid/june24.json
    python data/grid/fetch_eia.py --dry-run  # fetch + print summary, no write
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv

EIA_URL = "https://api.eia.gov/v2/electricity/rto/region-data/data/"
RESPONDENT = "ISNE"          # ISO New England
DEMAND_TYPE = "D"            # D = demand
LOCAL_TZ = ZoneInfo("America/New_York")
TARGET_DATE = dt.date(2025, 6, 24)
CACHE_PATH = Path(__file__).resolve().parent / "june24.json"


def _utc_window(local_date: dt.date) -> tuple[str, str]:
    """UTC [start, end) hour strings (YYYY-MM-DDTHH) covering the local day."""
    local_start = dt.datetime(
        local_date.year, local_date.month, local_date.day, 0, 0, tzinfo=LOCAL_TZ
    )
    local_end = local_start + dt.timedelta(days=1)
    utc_start = local_start.astimezone(dt.timezone.utc)
    utc_end = local_end.astimezone(dt.timezone.utc)
    return utc_start.strftime("%Y-%m-%dT%H"), utc_end.strftime("%Y-%m-%dT%H")


def fetch_hourly(api_key: str, local_date: dt.date = TARGET_DATE) -> list[dict]:
    """Return 24 hourly points for the local day, sorted by local hour.

    Each point: {"hour": 0..23, "local_clock": "YYYY-MM-DDTHH:00:00", "load_mw": float}
    Raises RuntimeError with a precise reason on any failure.
    """
    start, end = _utc_window(local_date)
    params = {
        "api_key": api_key,
        "frequency": "hourly",
        "data[0]": "value",
        "facets[respondent][]": RESPONDENT,
        "facets[type][]": DEMAND_TYPE,
        "start": start,
        "end": end,
        "sort[0][column]": "period",
        "sort[0][direction]": "asc",
        "offset": 0,
        "length": 5000,
    }
    try:
        resp = requests.get(EIA_URL, params=params, timeout=30)
    except requests.RequestException as exc:  # network failure
        raise RuntimeError(f"EIA request failed (network): {exc}") from exc

    if resp.status_code != 200:
        # Never echo the key: strip it from any error text before raising.
        safe = resp.text.replace(api_key, "<redacted>") if api_key else resp.text
        raise RuntimeError(
            f"EIA returned HTTP {resp.status_code}: {safe[:500]}"
        )

    try:
        payload = resp.json()
    except ValueError as exc:
        raise RuntimeError(f"EIA response was not JSON: {exc}") from exc

    data = payload.get("response", {}).get("data")
    if not data:
        raise RuntimeError(
            "EIA response contained no data rows "
            f"(response keys: {list(payload.get('response', {}).keys())})"
        )

    # Convert each UTC period to local time; keep only the target local day.
    by_hour: dict[int, float] = {}
    for row in data:
        period = row.get("period")  # e.g. "2025-06-24T04"
        value = row.get("value")
        if period is None or value is None:
            continue
        utc_dt = dt.datetime.strptime(period, "%Y-%m-%dT%H").replace(
            tzinfo=dt.timezone.utc
        )
        local_dt = utc_dt.astimezone(LOCAL_TZ)
        if local_dt.date() != local_date:
            continue
        by_hour[local_dt.hour] = float(value)

    missing = [h for h in range(24) if h not in by_hour]
    if missing:
        raise RuntimeError(
            f"EIA data missing local hours {missing} for {local_date.isoformat()}"
        )

    points = []
    for hour in range(24):
        clock = f"{local_date.isoformat()}T{hour:02d}:00:00"
        points.append(
            {"hour": hour, "local_clock": clock, "load_mw": by_hour[hour]}
        )
    return points


def build_cache(points: list[dict], local_date: dt.date = TARGET_DATE) -> dict:
    """Wrap hourly points with provenance metadata (no secrets)."""
    loads = [p["load_mw"] for p in points]
    peak_mw = max(loads)
    peak_hour = max(points, key=lambda p: p["load_mw"])["hour"]
    return {
        "metadata": {
            "source": "EIA API v2 electricity/rto/region-data",
            "respondent": RESPONDENT,
            "respondent_name": "ISO New England (ISNE)",
            "type": DEMAND_TYPE,
            "type_name": "Demand",
            "timezone": "America/New_York (EDT, UTC-4 on this date)",
            "period_timezone_in_api": "UTC",
            "date": local_date.isoformat(),
            "fetched": dt.datetime.now(dt.timezone.utc)
            .replace(microsecond=0)
            .isoformat(),
            "units": "MW",
            "note": "Hourly demand; EIA periods converted from UTC to local.",
            "peak_mw": peak_mw,
            "peak_hour_local": peak_hour,
        },
        "points": points,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch ISO-NE demand for 2025-06-24.")
    parser.add_argument(
        "--dry-run", action="store_true", help="Fetch and summarize; do not write."
    )
    args = parser.parse_args(argv)

    load_dotenv()
    api_key = os.getenv("EIA_API_KEY")
    if not api_key:
        print("ERROR: EIA_API_KEY not set in environment/.env", file=sys.stderr)
        return 2

    try:
        points = fetch_hourly(api_key)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    cache = build_cache(points)
    meta = cache["metadata"]
    print(
        f"Fetched {len(points)} hourly points for {meta['date']} "
        f"({meta['respondent']})."
    )
    print(
        f"Peak load: {meta['peak_mw']:.1f} MW at local hour "
        f"{meta['peak_hour_local']:02d}:00."
    )

    if args.dry_run:
        print("Dry run: not writing cache.")
        return 0

    CACHE_PATH.write_text(json.dumps(cache, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {CACHE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
