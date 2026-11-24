# SPDX-License-Identifier: Apache-2.0
"""Tests for storage.py: migration, stable ids, defensive reads, re-apply decisions.
Run: python3 tests/test_storage.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "custom_components" / "zoosh"))

import storage as st  # noqa: E402
import yaml_gen as yg  # noqa: E402

FAILS: list[str] = []


def check(c: bool, label: str) -> None:
    print(("PASS " if c else "FAIL ") + label)
    if not c:
        FAILS.append(label)


def look(i, name):
    return {"id": i, "state": dict(yg.default_state(), name=name)}


def main() -> None:
    fresh, is_fresh, up = st.normalise_saved(None)
    check(is_fresh and not up and len(fresh["looks"]) == 6, "nothing stored -> six starters, fresh")
    ids = [x["id"] for x in fresh["looks"]]
    check(ids == ["glass", "solid", "midnight", "sunrise", "alert", "liquidglass"], "starter ids are stable slugs")
    check(st.default_data()["looks"][0]["id"] == "glass" and fresh["default_id"] == "glass", "default id is glass")
    again, _, _ = st.normalise_saved(None)
    check([x["id"] for x in again["looks"]] == ids, "ids identical on every run")

    v1 = {"state": dict(yg.default_state(), name="Zoosh", radius=7)}
    m = st.migrate(1, v1)
    check(m["looks"][0]["id"] == "glass" and m["looks"][0]["state"]["name"] == "Glass" and m["looks"][0]["state"]["radius"] == 7, "1.0.0 state kept as Look 'Glass'")
    check(m["default_id"] == "glass" and m[st.UPGRADED_KEY] == "1.0.0", "migration marks the upgrade")
    data, is_fresh, up = st.normalise_saved(m)
    check(up and not is_fresh and st.UPGRADED_KEY not in data, "normalise reports an upgrade")
    data, is_fresh, up = st.normalise_saved(v1)
    check(up and data["looks"][0]["id"] == "glass", "unmigrated 1.0.0 shape still read defensively")
    check(st.migrate(2, {"looks": []}) == {"looks": []}, "version 2 data untouched by migration")
    check(st.migrate(1, {"state": {"bad": 1}}) == {}, "broken 1.0.0 data migrates to empty (never raises)")
    check(st.normalise_saved({})[1] is True, "empty dict is fresh")
    check(st.normalise_saved({"looks": "x"})[1] is True, "garbage falls back to defaults")
    two = {"looks": [look("aa", "A"), look("bb", "B")], "default_id": "bb",
           "automation": {"enabled": True, "paused": False, "schedule": {"enabled": False, "parts": []},
                          "rules": [], "people": {}}}
    d2, f2, u2 = st.normalise_saved(two)
    check(not f2 and not u2 and d2["default_id"] == "bb" and d2["automation"]["enabled"], "version 2 shape round trips")
    bad_auto = dict(two, automation={"nope": 1})
    check(st.normalise_saved(bad_auto)[0]["automation"]["enabled"] is False, "bad automation block reset, Looks kept")

    old = [look("aa", "Day"), look("bb", "Night")]
    new_same = [look("aa", "Day"), look("bb", "Night")]
    check(st.reapply_target(old, new_same, "aa", "bb", None) is None, "nothing renamed -> nothing re-applied")
    renamed = [look("aa", "Day"), look("bb", "Late")]
    check(st.reapply_target(old, renamed, "aa", "bb", None) == "bb", "active Look renamed -> re-apply it")
    check(st.reapply_target(old, renamed, "aa", None, "Zoosh - Night") == "bb", "system theme Look renamed -> re-apply it")
    check(st.reapply_target(old, renamed, "aa", "aa", "Zoosh - Day") is None, "unused renamed Look ignored")
    deleted = [look("aa", "Day")]
    check(st.reapply_target(old, deleted, "aa", "bb", None) == "aa", "active Look deleted -> default Look")
    check(st.reapply_target(old, deleted, "aa", None, "Zoosh - Night") == "aa", "system Look deleted -> default Look")

    # An existing store is never touched by the starters (owner-style store with two Looks).
    glass2 = dict(yg.default_state(), name="Glass 2", radius=7)
    mine = {"looks": [{"id": "glass", "state": dict(yg.default_state(), name="Glass", radius=3)}, {"id": "l0d143f", "state": glass2}],
            "default_id": "l0d143f", "automation": st.default_data()["automation"]}
    dm, fm, um = st.normalise_saved(mine)
    check(not fm and not um and [x["id"] for x in dm["looks"]] == ["glass", "l0d143f"], "existing Looks are kept, no starters added")
    check(dm["looks"][0]["state"]["radius"] == 3 and dm["looks"][1]["state"]["name"] == "Glass 2" and dm["default_id"] == "l0d143f", "existing Look values and default are untouched")
    check(st.migrate(2, mine) is mine, "migration never rewrites version 2 data")
    check(st.default_data()["looks"][0]["state"]["name"] == "Glass" and "Glass 2" not in [x["state"]["name"] for x in st.default_data()["looks"]], "fresh install seeds 'Glass', never 'Glass 2'")

    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)


main()
