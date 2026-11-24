# SPDX-License-Identifier: Apache-2.0
"""Pure helpers for what Zoosh keeps in its Store (no Home Assistant imports).

Shapes:
  version 1 (Zoosh 1.0.0):  {"state": <one theme state>}
  version 2 (Zoosh 1.1.x):  {"looks": [{"id", "state"}], "default_id": str, "automation": {...}}
"""

from __future__ import annotations

import re
import secrets
from typing import Any

try:
    from . import automation
    from . import yaml_gen as yg
except ImportError:  # standalone tests import the module without the package
    import automation  # type: ignore[no-redef]
    import yaml_gen as yg  # type: ignore[no-redef]

UPGRADED_KEY = "upgraded_from"  # transient marker written by the migration, removed at setup


def starter_id(name: str) -> str:
    """Stable id derived from a starter Look's name ("Liquid Glass" -> "liquidglass")."""
    return re.sub(r"[^a-z0-9]", "", name.lower())[:12] or "look"


def new_id(existing: set[str]) -> str:
    while True:
        candidate = "l" + secrets.token_hex(3)
        if candidate not in existing:
            return candidate


def default_data() -> dict[str, Any]:
    looks = [{"id": starter_id(s["name"]), "state": yg.validate_state(s)} for s in yg.starter_looks()]
    return {"looks": looks, "default_id": looks[0]["id"], "automation": automation.default_config(), "rev": 1}


def prune_automation(cfg: dict[str, Any], ids: set[str]) -> dict[str, Any]:
    """Drop references to Looks that no longer exist."""
    out = dict(cfg)
    out["rules"] = [r for r in cfg["rules"] if r["look"] in ids]
    out["schedule"] = {
        "enabled": cfg["schedule"]["enabled"],
        "parts": [p for p in cfg["schedule"]["parts"] if p["look"] in ids],
    }
    out["people"] = {u: l for u, l in cfg["people"].items() if l in ids}
    return out


def rev_matches(data: dict[str, Any], given: Any) -> bool:
    """Optimistic concurrency: a save must carry the revision it was loaded with."""
    return isinstance(given, int) and not isinstance(given, bool) and given == data.get("rev", 1)


def prune_people(cfg: dict[str, Any], known_user_ids: set[str] | None) -> dict[str, Any]:
    """Drop person -> Look mappings for Home Assistant users that no longer exist.
    known_user_ids None means "could not find out": change nothing."""
    if known_user_ids is None:
        return cfg
    out = dict(cfg)
    out["people"] = {u: l for u, l in cfg["people"].items() if u in known_user_ids}
    return out


def migrate_v1(old: Any) -> dict[str, Any]:
    """1.0.0 {"state": ...} -> one Look called Glass with the stable id "glass"."""
    state = yg.validate_state(old["state"])
    if state["name"] == "Zoosh":
        state["name"] = "Glass"
    look_id = starter_id(state["name"])
    return {
        "looks": [{"id": look_id, "state": state}],
        "default_id": look_id,
        "automation": automation.default_config(),
        "rev": 1,
        UPGRADED_KEY: "1.0.0",
    }


def migrate(old_major: int, old_data: Any) -> Any:
    """Store migration hook: only the 1.0.0 shape needs work. Never raises."""
    if old_major < 2 and isinstance(old_data, dict) and "state" in old_data and "looks" not in old_data:
        try:
            return migrate_v1(old_data)
        except (ValueError, KeyError, TypeError):
            return {}
    return old_data


def normalise_saved(saved: Any) -> tuple[dict[str, Any], bool, bool]:
    """Read whatever is stored (defensively, any known shape).

    Returns (data, is_fresh, upgraded_from_v1).
    """
    if not isinstance(saved, dict) or not saved:
        return default_data(), True, False
    try:
        if "looks" in saved:
            looks, default_id = yg.validate_looks(saved["looks"], saved.get("default_id"))
            ids = {x["id"] for x in looks}
            try:
                cfg = automation.validate_config(saved.get("automation"), ids)
            except ValueError:
                cfg = prune_automation(automation.default_config(), ids)
            rev = saved.get("rev")
            rev = rev if isinstance(rev, int) and not isinstance(rev, bool) and 1 <= rev < 10**9 else 1
            return {"looks": looks, "default_id": default_id, "automation": cfg, "rev": rev}, False, bool(saved.get(UPGRADED_KEY))
        if "state" in saved:  # an unmigrated 1.0.0 shape (defensive)
            return migrate_v1(saved), False, True
    except (ValueError, KeyError, TypeError):
        pass
    return default_data(), True, False


def reapply_target(
    old_looks: list[dict[str, Any]],
    new_looks: list[dict[str, Any]],
    default_id: str,
    active_id: str | None,
    system_theme: str | None,
) -> str | None:
    """After a save: which Look id should be (re)applied because the currently used theme
    was renamed or deleted? None when nothing in use was affected.

    A theme counts as in use when it is the Look Zoosh last applied or the system theme.
    """
    new_by_id = {x["id"]: x["state"]["name"] for x in new_looks}
    for old in old_looks:
        oid, oname = old["id"], old["state"]["name"]
        in_use = oid == active_id or (system_theme is not None and yg.theme_name(oname) == system_theme)
        if not in_use:
            continue
        if oid not in new_by_id:
            return default_id
        if new_by_id[oid] != oname:
            return oid
    return None
