# SPDX-License-Identifier: Apache-2.0
"""Zoosh automations: time-of-day schedule, reactive rules, per-person Looks.

The top half is pure Python (no Home Assistant imports) so it can be tested standalone.
The runtime class at the bottom imports Home Assistant lazily.

Applying a Look uses the frontend.set_theme service, which sets the SYSTEM-WIDE default
theme (Home Assistant exposes nothing finer). Per-person Looks are applied in each
browser by zoosh-fx.js.
"""

from __future__ import annotations

import logging
import re
from collections import deque
from datetime import datetime
from typing import Any, Callable

try:  # Home Assistant: marks a function as safe to run in the event loop
    from homeassistant.core import callback
except ImportError:  # standalone tests without Home Assistant
    def callback(func):  # type: ignore[no-redef]
        func._hass_callback = True
        return func

_LOGGER = logging.getLogger(__name__)

MAX_RULES = 8
MAX_PARTS = 6
MAX_PEOPLE = 64
DEBOUNCE_SECONDS = 5
MIN_DWELL_SECONDS = 30
LOG_SIZE = 20
FALLBACK_DAY = (7 * 60, 19 * 60)  # minutes from midnight, used when sun.sun is missing

ENTITY_RE = re.compile(r"[a-z0-9_]+\.[a-z0-9_]+")
ATTR_RE = re.compile(r"[A-Za-z0-9_]{0,48}")
TIME_RE = re.compile(r"([01][0-9]|2[0-3]):[0-5][0-9]")
LOOK_ID_RE = re.compile(r"[a-z0-9]{2,12}")
USER_ID_RE = re.compile(r"[0-9a-f]{32}")
OPS = ("is", "is_not", "gt", "lt", "gte", "lte")
KINDS = ("day", "night", "range")


# ------------------------------------------------------------------ validation
def default_config() -> dict[str, Any]:
    return {
        "enabled": False,
        "paused": False,
        "schedule": {"enabled": False, "parts": []},
        "rules": [],
        "people": {},
    }


def _bool(value: Any, what: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{what} must be true or false")
    return value


def _look(value: Any, look_ids: set[str] | None) -> str:
    if not isinstance(value, str) or not LOOK_ID_RE.fullmatch(value):
        raise ValueError("invalid Look reference")
    if look_ids is not None and value not in look_ids:
        raise ValueError("unknown Look")
    return value


def validate_config(raw: Any, look_ids: set[str] | None = None) -> dict[str, Any]:
    """Strictly validate an automation config. Raises ValueError."""
    if not isinstance(raw, dict) or set(raw) != set(default_config()):
        raise ValueError("automation config has missing or unknown keys")
    out: dict[str, Any] = {
        "enabled": _bool(raw["enabled"], "enabled"),
        "paused": _bool(raw["paused"], "paused"),
    }
    sched = raw["schedule"]
    if not isinstance(sched, dict) or set(sched) != {"enabled", "parts"}:
        raise ValueError("schedule has missing or unknown keys")
    if not isinstance(sched["parts"], list) or len(sched["parts"]) > MAX_PARTS:
        raise ValueError(f"at most {MAX_PARTS} schedule parts")
    parts = []
    for p in sched["parts"]:
        if not isinstance(p, dict) or set(p) != {"kind", "start", "end", "look"}:
            raise ValueError("schedule part has missing or unknown keys")
        if p["kind"] not in KINDS:
            raise ValueError("schedule part kind must be day, night or range")
        start, end = p["start"], p["end"]
        if p["kind"] == "range":
            for t in (start, end):
                if not isinstance(t, str) or not TIME_RE.fullmatch(t):
                    raise ValueError("times must look like HH:MM")
            if start == end:
                raise ValueError("a time range needs different start and end")
        else:
            start = end = ""
        parts.append({"kind": p["kind"], "start": start, "end": end, "look": _look(p["look"], look_ids)})
    out["schedule"] = {"enabled": _bool(sched["enabled"], "schedule enabled"), "parts": parts}

    if not isinstance(raw["rules"], list) or len(raw["rules"]) > MAX_RULES:
        raise ValueError(f"at most {MAX_RULES} rules")
    rules = []
    for r in raw["rules"]:
        if not isinstance(r, dict) or set(r) != {"entity_id", "op", "attribute", "value", "only_night", "look"}:
            raise ValueError("rule has missing or unknown keys")
        if not isinstance(r["entity_id"], str) or not ENTITY_RE.fullmatch(r["entity_id"]):
            raise ValueError("rule entity must look like domain.name")
        if r["op"] not in OPS:
            raise ValueError("unsupported rule comparison")
        if not isinstance(r["attribute"], str) or not ATTR_RE.fullmatch(r["attribute"]):
            raise ValueError("attribute may only contain letters, digits and _")
        if not isinstance(r["value"], str) or not 1 <= len(r["value"]) <= 64 or r["value"] != r["value"].strip():
            raise ValueError("rule value must be 1-64 characters")
        if r["op"] not in ("is", "is_not") and _num(r["value"]) is None:
            raise ValueError("numeric comparisons need a number")
        rules.append({
            "entity_id": r["entity_id"], "op": r["op"], "attribute": r["attribute"],
            "value": r["value"], "only_night": _bool(r["only_night"], "only_night"),
            "look": _look(r["look"], look_ids),
        })
    out["rules"] = rules

    if not isinstance(raw["people"], dict) or len(raw["people"]) > MAX_PEOPLE:
        raise ValueError("people mapping is invalid")
    people = {}
    for uid, lid in raw["people"].items():
        if not isinstance(uid, str) or not USER_ID_RE.fullmatch(uid):
            raise ValueError("invalid user id")
        people[uid] = _look(lid, look_ids)
    out["people"] = people
    return out


# --------------------------------------------------------------------- decision
def _num(value: Any) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n and abs(n) != float("inf") else None


def rule_matches(rule: dict[str, Any], state: tuple[str, dict[str, Any]] | None) -> bool:
    if state is None:
        return False
    current = state[1].get(rule["attribute"]) if rule["attribute"] else state[0]
    if current is None:
        return False
    op, want = rule["op"], rule["value"]
    if op in ("is", "is_not"):
        same = str(current).strip().lower() == want.strip().lower()
        return same if op == "is" else not same
    a, b = _num(current), _num(want)
    if a is None or b is None:
        return False
    return {"gt": a > b, "lt": a < b, "gte": a >= b, "lte": a <= b}[op]


def is_night(now: datetime, sun_state: str | None) -> bool:
    if sun_state in ("above_horizon", "below_horizon"):
        return sun_state == "below_horizon"
    minutes = now.hour * 60 + now.minute
    return not FALLBACK_DAY[0] <= minutes < FALLBACK_DAY[1]


def _in_range(now: datetime, start: str, end: str) -> bool:
    cur = now.hour * 60 + now.minute
    a = int(start[:2]) * 60 + int(start[3:])
    b = int(end[:2]) * 60 + int(end[3:])
    return a <= cur < b if a < b else (cur >= a or cur < b)


def decide(
    config: dict[str, Any],
    look_ids: set[str],
    default_id: str,
    get_state: Callable[[str], tuple[str, dict[str, Any]] | None],
    now: datetime,
    sun_state: str | None,
) -> tuple[str, str]:
    """Return (look_id, reason). Priority: reactive rules, then schedule, then default."""
    night = is_night(now, sun_state)
    for rule in config["rules"]:
        if rule["look"] not in look_ids:
            continue
        if rule["only_night"] and not night:
            continue
        if rule_matches(rule, get_state(rule["entity_id"])):
            what = f"{rule['attribute'] or 'state'} {rule['op'].replace('_', ' ')} {rule['value']}"
            return rule["look"], f"rule: {rule['entity_id']} {what}"
    if config["schedule"]["enabled"]:
        for part in config["schedule"]["parts"]:
            if part["look"] not in look_ids:
                continue
            if part["kind"] == "day" and not night:
                return part["look"], "schedule: daytime"
            if part["kind"] == "night" and night:
                return part["look"], "schedule: night"
            if part["kind"] == "range" and _in_range(now, part["start"], part["end"]):
                return part["look"], f"schedule: {part['start']}-{part['end']}"
    return default_id, "default"


# ---------------------------------------------------------------------- runtime
class ZooshAutomation:
    """Evaluates the config and applies a Look with frontend.set_theme."""

    def __init__(self, hass: Any, data: dict[str, Any], theme_for: Callable[[str], str | None]) -> None:
        self.hass = hass
        self.data = data  # shared dict: looks, default_id, automation
        self.theme_for = theme_for
        self.log: deque[dict[str, str]] = deque(maxlen=LOG_SIZE)
        self.active_id: str | None = None
        self.reason = "not evaluated yet"
        self.last_change = 0.0
        self._unsubs: list[Callable[[], None]] = []
        self._debounce: Callable[[], None] | None = None
        self._dwell: Callable[[], None] | None = None
        self._running = False
        self._warned: set[str] = set()

    # -- helpers
    def _now(self) -> datetime:
        from homeassistant.util import dt as dt_util

        return dt_util.now()

    def record(self, message: str) -> None:
        """Add a line to the in-memory decision log."""
        self.log.appendleft({"t": self._now().strftime("%H:%M:%S"), "msg": message})

    def _look_ids(self) -> set[str]:
        return {x["id"] for x in self.data["looks"]}

    def _look_name(self, look_id: str | None) -> str:
        for x in self.data["looks"]:
            if x["id"] == look_id:
                return x["state"]["name"]
        return "?"

    def _get_state(self, entity_id: str) -> tuple[str, dict[str, Any]] | None:
        st = self.hass.states.get(entity_id)
        return None if st is None else (st.state, dict(st.attributes))

    def _sun(self) -> str | None:
        st = self.hass.states.get("sun.sun")
        return None if st is None else st.state

    def _active(self) -> bool:
        cfg = self.data["automation"]
        return cfg["enabled"] and not cfg["paused"]

    # -- lifecycle
    async def async_start(self) -> None:
        from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval
        from datetime import timedelta

        self.async_stop(keep_log=True)
        self._running = True
        entities = {r["entity_id"] for r in self.data["automation"]["rules"]} | {"sun.sun"}
        self._unsubs.append(
            async_track_state_change_event(self.hass, sorted(entities), self._on_change)
        )
        self._unsubs.append(
            async_track_time_interval(self.hass, self._on_tick, timedelta(seconds=60))
        )
        self.request_eval("started")

    def async_stop(self, keep_log: bool = False) -> None:
        self._running = False
        for unsub in self._unsubs:
            unsub()
        self._unsubs = []
        for attr in ("_debounce", "_dwell"):
            cancel = getattr(self, attr)
            if cancel:
                cancel()
                setattr(self, attr, None)
        if not keep_log:
            self.log.clear()

    @callback
    def _on_change(self, event: Any) -> None:
        self.request_eval(f"{event.data.get('entity_id')} changed")

    @callback
    def _on_tick(self, _now: Any) -> None:
        self.request_eval("clock")

    # -- evaluation
    def request_eval(self, why: str, immediate: bool = False) -> None:
        """Debounce: wait 5 s after the last trigger so flapping entities do not flicker."""
        from homeassistant.helpers.event import async_call_later

        if not self._running:
            return
        if self._debounce:
            self._debounce()
            self._debounce = None
        if immediate:
            self.hass.async_create_task(self.async_evaluate(why))
            return

        async def _fire(_now: Any) -> None:
            self._debounce = None
            await self.async_evaluate(why)

        self._debounce = async_call_later(self.hass, DEBOUNCE_SECONDS, _fire)

    async def async_evaluate(self, why: str = "") -> None:
        if not self._active():
            self.reason = "paused" if self.data["automation"]["paused"] else "automation is off"
            return
        import time

        ids = self._look_ids()
        target, reason = decide(
            self.data["automation"], ids, self.data["default_id"],
            self._get_state, self._now(), self._sun(),
        )
        self.reason = reason
        if target == self.active_id:
            return
        wait = MIN_DWELL_SECONDS - (time.monotonic() - self.last_change)
        if self.active_id is not None and wait > 0:
            # Minimum dwell: do not change again too soon; re-check when it has passed.
            from homeassistant.helpers.event import async_call_later

            if self._dwell:
                self._dwell()

            async def _later(_now: Any) -> None:
                self._dwell = None
                await self.async_evaluate("dwell over")

            self._dwell = async_call_later(self.hass, wait + 0.2, _later)
            return
        await self._apply(target, reason, why)

    async def _apply(self, look_id: str, reason: str, why: str) -> bool:
        import time

        theme = self.theme_for(look_id)
        if theme is None:
            return False
        try:
            await self.hass.services.async_call("frontend", "set_theme", {"name": theme}, blocking=True)
        except Exception as err:  # noqa: BLE001 - HomeAssistantError, vol.Invalid, anything: keep running
            self.record(f"Could not apply {self._look_name(look_id)} ({type(err).__name__})")
            key = type(err).__name__
            if key not in self._warned:  # log each kind of failure once, not every minute
                self._warned.add(key)
                _LOGGER.warning("set_theme failed (%s): %s", key, err)
            return False
        self.active_id = look_id
        self.last_change = time.monotonic()
        self.record(f"{self._look_name(look_id)} ({reason}; {why})" if why else f"{self._look_name(look_id)} ({reason})")
        return True

    def mark_applied(self, look_id: str, reason: str) -> None:
        """Tell the runtime a Look was applied from outside (a save), so it neither skips
        nor repeats the next evaluation."""
        import time

        self.active_id = look_id
        self.last_change = time.monotonic()
        self.record(f"{self._look_name(look_id)} ({reason})")

    async def async_test(self, look_id: str) -> bool:
        """Apply a Look now, ignoring dwell and pause (manual test button)."""
        if look_id not in self._look_ids():
            return False
        ok = await self._apply(look_id, "manual test", "test button")
        if ok:
            self.reason = "manual test (the next evaluation may switch it back)"
        return ok

    def status(self) -> dict[str, Any]:
        cfg = self.data["automation"]
        return {
            "active_look": self.active_id,
            "active_name": self._look_name(self.active_id) if self.active_id else "",
            "reason": self.reason,
            "enabled": cfg["enabled"],
            "paused": cfg["paused"],
            "sun_present": self.hass.states.get("sun.sun") is not None,
            "log": list(self.log),
        }
