# SPDX-License-Identifier: Apache-2.0
"""Standalone tests for the pure parts of automation.py (no Home Assistant needed).
Run: python3 tests/test_automation.py
"""

from __future__ import annotations

import copy
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "custom_components" / "zoosh"))

import automation as au  # noqa: E402

FAILS: list[str] = []
IDS = {"day01", "night1", "alert1", "tv0001"}


def check(cond: bool, label: str) -> None:
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILS.append(label)


def rejects(raw, label: str, ids=IDS) -> None:
    try:
        au.validate_config(raw, ids)
    except ValueError:
        check(True, "rejected: " + label)
        return
    check(False, "rejected: " + label)


def at(h: int, m: int = 0) -> datetime:
    return datetime(2026, 11, 24, h, m)


def rule(**kw):
    base = {"entity_id": "alarm_control_panel.home", "op": "is", "attribute": "", "value": "armed_away",
            "only_night": False, "look": "alert1"}
    base.update(kw)
    return base


def cfg(**kw):
    c = au.default_config()
    c.update(kw)
    return c


def states(table):
    return lambda eid: table.get(eid)


def main() -> None:
    check(au.validate_config(au.default_config(), IDS) == au.default_config(), "default config valid")

    # --- validation
    good = cfg(enabled=True, rules=[rule()], schedule={"enabled": True, "parts": [
        {"kind": "day", "start": "", "end": "", "look": "day01"},
        {"kind": "range", "start": "22:00", "end": "06:30", "look": "night1"}]},
        people={"a" * 32: "day01"})
    check(au.validate_config(good, IDS)["rules"][0]["entity_id"] == "alarm_control_panel.home", "good config accepted")
    rejects({**au.default_config(), "extra": 1}, "unknown top-level key")
    rejects(cfg(enabled="yes"), "enabled must be bool")
    rejects(cfg(rules=[rule()] * 9), "more than 8 rules")
    rejects(cfg(rules=[rule(entity_id="Bad Entity")]), "bad entity id")
    rejects(cfg(rules=[rule(entity_id="a.b; drop")]), "entity injection")
    rejects(cfg(rules=[rule(op="matches")]), "unknown op")
    rejects(cfg(rules=[rule(attribute="a b")]), "bad attribute")
    rejects(cfg(rules=[rule(value="")]), "empty value")
    rejects(cfg(rules=[rule(value="x" * 65)]), "value too long")
    rejects(cfg(rules=[rule(op="gt", value="abc")]), "numeric op needs number")
    rejects(cfg(rules=[rule(look="nope99")]), "unknown look in rule")
    rejects(cfg(rules=[rule(only_night="no")]), "only_night bool")
    rejects(cfg(rules=[dict(rule(), extra=1)]), "extra rule key")
    rejects(cfg(schedule={"enabled": True, "parts": [{"kind": "range", "start": "25:00", "end": "06:00", "look": "day01"}]}), "bad time")
    rejects(cfg(schedule={"enabled": True, "parts": [{"kind": "range", "start": "08:00", "end": "08:00", "look": "day01"}]}), "empty range")
    rejects(cfg(schedule={"enabled": True, "parts": [{"kind": "weekly", "start": "", "end": "", "look": "day01"}]}), "bad part kind")
    rejects(cfg(schedule={"enabled": True, "parts": [{"kind": "day", "start": "", "end": "", "look": "day01"}] * 7}), "too many parts")
    rejects(cfg(people={"not-an-id": "day01"}), "bad user id")
    rejects(cfg(people={"b" * 32: "zzzzzz"}), "unknown look for person")
    rejects(cfg(people={("%032x" % i): "day01" for i in range(65)}), "too many people")

    # --- rule matching
    r = rule()
    check(au.rule_matches(r, ("armed_away", {})), "is: match")
    check(au.rule_matches(rule(value="ARMED_AWAY"), ("armed_away", {})), "is: case-insensitive")
    check(not au.rule_matches(r, ("disarmed", {})), "is: no match")
    check(not au.rule_matches(r, None), "missing entity never matches")
    check(au.rule_matches(rule(op="is_not"), ("disarmed", {})), "is_not")
    check(au.rule_matches(rule(op="gt", value="20", attribute="temperature"), ("heat", {"temperature": 21.5})), "attribute gt")
    check(not au.rule_matches(rule(op="lt", value="20", attribute="temperature"), ("heat", {"temperature": 21.5})), "attribute lt")
    check(not au.rule_matches(rule(op="gt", value="20", attribute="missing"), ("heat", {})), "missing attribute")
    check(not au.rule_matches(rule(op="gt", value="20"), ("unavailable", {})), "non-numeric state fails numeric op")
    check(au.rule_matches(rule(op="gte", value="21.5", attribute="t"), ("x", {"t": "21.5"})), "gte on string number")

    # --- night / sun
    check(au.is_night(at(12), "below_horizon") and not au.is_night(at(3), "above_horizon"), "sun.sun wins over the clock")
    check(not au.is_night(at(12), None) and au.is_night(at(23), None) and au.is_night(at(6, 59), None), "fixed-time fallback")
    check(not au.is_night(at(7, 0), None) and au.is_night(at(19, 0), None), "fallback boundaries")

    # --- decisions: priority reactive > schedule > default
    ids = {"day01", "night1", "alert1", "tv0001", "base01"}
    schedule = {"enabled": True, "parts": [
        {"kind": "day", "start": "", "end": "", "look": "day01"},
        {"kind": "night", "start": "", "end": "", "look": "night1"}]}
    c = cfg(enabled=True, rules=[rule()], schedule=schedule)
    quiet = states({})
    check(au.decide(c, ids, "base01", quiet, at(12), "above_horizon") == ("day01", "schedule: daytime"), "schedule day")
    check(au.decide(c, ids, "base01", quiet, at(23), "below_horizon") == ("night1", "schedule: night"), "schedule night")
    armed = states({"alarm_control_panel.home": ("armed_away", {})})
    look, why = au.decide(c, ids, "base01", armed, at(12), "above_horizon")
    check(look == "alert1" and why.startswith("rule:"), "rule beats schedule")
    check(au.decide(c, ids, "base01", states({"alarm_control_panel.home": ("disarmed", {})}), at(12), "above_horizon")[0] == "day01",
          "reverts to schedule when the rule ends")
    nosched = cfg(enabled=True, rules=[rule()])
    check(au.decide(nosched, ids, "base01", quiet, at(12), None) == ("base01", "default"), "falls back to the default Look")
    first = cfg(rules=[rule(look="tv0001", entity_id="media_player.tv", value="on"), rule()])
    both = states({"media_player.tv": ("on", {}), "alarm_control_panel.home": ("armed_away", {})})
    check(au.decide(first, ids, "base01", both, at(12), None)[0] == "tv0001", "rule order is priority order")
    door = cfg(rules=[rule(entity_id="binary_sensor.door", value="on", only_night=True)])
    open_door = states({"binary_sensor.door": ("on", {})})
    check(au.decide(door, ids, "base01", open_door, at(12), "above_horizon")[0] == "base01", "only_night rule ignored by day")
    check(au.decide(door, ids, "base01", open_door, at(23), "below_horizon")[0] == "alert1", "only_night rule fires at night")
    check(au.decide(c, {"base01"}, "base01", armed, at(12), None)[0] == "base01", "dangling Look references are ignored")
    rng = cfg(schedule={"enabled": True, "parts": [{"kind": "range", "start": "22:00", "end": "06:30", "look": "night1"},
                                                    {"kind": "range", "start": "12:00", "end": "13:00", "look": "tv0001"}]})
    check(au.decide(rng, ids, "base01", quiet, at(23), None)[0] == "night1", "range wraps midnight (evening)")
    check(au.decide(rng, ids, "base01", quiet, at(5), None)[0] == "night1", "range wraps midnight (morning)")
    check(au.decide(rng, ids, "base01", quiet, at(6, 30), None)[0] == "base01", "range end is exclusive")
    check(au.decide(rng, ids, "base01", quiet, at(12, 30), None)[0] == "tv0001", "second range")
    off = copy.deepcopy(rng)
    off["schedule"]["enabled"] = False
    check(au.decide(off, ids, "base01", quiet, at(23), None)[0] == "base01", "disabled schedule ignored")

    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
