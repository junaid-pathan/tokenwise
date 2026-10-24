"""Massachusetts towns for the crowd simulator (PR B6, owner B).

Simulated users live in MA towns. A town is chosen per prompt, weighted roughly
by population so bigger cities emit more often. Names are canonical Title Case.

Town source priority:
  1. If gridroom/src/scene/data/town-centroids.json exists, use ITS keys — that
     is the Grid Room scene's town list, so a prompt from a town the scene knows
     can be drawn as a spark. We weight those keys by our built-in population
     table where we have it, and give the rest a small uniform weight.
  2. Otherwise fall back to a built-in list of 50 real MA towns with approximate
     2020-census populations as weights.

We NEVER emit a town that is not in the list we actually load, so the scene can
always place it (when it shares our town set).
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Optional

# Repo root = two levels up from this file (sim/crowd/towns.py -> repo root).
_REPO_ROOT = Path(__file__).resolve().parents[2]
_CENTROIDS_PATH = (
    _REPO_ROOT / "gridroom" / "src" / "scene" / "data" / "town-centroids.json"
)

# Built-in fallback: 50 real MA towns with approximate 2020 populations.
# Used as weights (bigger city -> chosen more often). Title Case, canonical.
MA_TOWN_POP: dict[str, int] = {
    "Boston": 675647,
    "Worcester": 206518,
    "Springfield": 155929,
    "Cambridge": 118403,
    "Lowell": 115554,
    "Brockton": 105643,
    "Quincy": 101636,
    "Lynn": 101253,
    "New Bedford": 101079,
    "Fall River": 94000,
    "Lawrence": 89143,
    "Newton": 88923,
    "Somerville": 81045,
    "Framingham": 72362,
    "Haverhill": 67787,
    "Waltham": 65218,
    "Malden": 66263,
    "Medford": 59659,
    "Taunton": 59408,
    "Chicopee": 55560,
    "Weymouth": 57437,
    "Revere": 62186,
    "Peabody": 54481,
    "Methuen": 53059,
    "Barnstable": 48916,
    "Pittsfield": 43927,
    "Attleboro": 46461,
    "Arlington": 46308,
    "Everett": 49075,
    "Salem": 44480,
    "Westfield": 41552,
    "Leominster": 43782,
    "Fitchburg": 41946,
    "Holyoke": 38238,
    "Beverly": 42670,
    "Marlborough": 41793,
    "Woburn": 40876,
    "Amherst": 39263,
    "Braintree": 39143,
    "Shrewsbury": 38325,
    "Chelsea": 40787,
    "Dartmouth": 34032,
    "Chelmsford": 36027,
    "Andover": 36569,
    "Natick": 37006,
    "Randolph": 34984,
    "Watertown": 35329,
    "Franklin": 33261,
    "Northampton": 28726,
    "Gloucester": 29729,
}

# A small default weight for a scene town we have no population figure for.
_DEFAULT_WEIGHT = 10000


class TownPicker:
    """Holds the loaded town set + cumulative weights for O(log n) sampling."""

    def __init__(self, towns: list[str], weights: list[float], source: str) -> None:
        if not towns:
            raise ValueError("TownPicker needs at least one town")
        if len(towns) != len(weights):
            raise ValueError("towns and weights must be the same length")
        self.towns = towns
        self.weights = weights
        self.source = source  # "centroids" or "builtin"
        self._town_set = frozenset(towns)

    def pick(self, rng: random.Random) -> str:
        """Pick one town, population-weighted."""
        return rng.choices(self.towns, weights=self.weights, k=1)[0]

    def is_valid(self, town: str) -> bool:
        return town in self._town_set

    def __len__(self) -> int:
        return len(self.towns)


def _load_centroid_keys(path: Path) -> Optional[list[str]]:
    """Return the town keys from the Grid Room centroids file, or None."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if isinstance(data, dict) and data:
        return [str(k) for k in data.keys()]
    return None


def load_town_picker(centroids_path: Path = _CENTROIDS_PATH) -> TownPicker:
    """Build a TownPicker. Prefer the scene's centroids file, else built-in."""
    keys = _load_centroid_keys(centroids_path)
    if keys:
        weights = [float(MA_TOWN_POP.get(k, _DEFAULT_WEIGHT)) for k in keys]
        return TownPicker(keys, weights, source="centroids")
    towns = list(MA_TOWN_POP.keys())
    weights = [float(p) for p in MA_TOWN_POP.values()]
    return TownPicker(towns, weights, source="builtin")
