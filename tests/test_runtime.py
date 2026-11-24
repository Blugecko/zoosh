# SPDX-License-Identifier: Apache-2.0
"""Tests the ZooshAutomation runtime (debounce, dwell, pause) against a tiny fake of the
Home Assistant APIs it uses. This checks OUR logic only; it cannot prove the real
Home Assistant behaves the same. Run: python3 tests/test_runtime.py
"""

from __future__ import annotations

import asyncio
import sys
import time
import types
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "custom_components" / "zoosh"))

FAILS: list[str] = []
CLOCK = {"t": 1000.0}
TIMERS: list[list] = []  # [due, callback, cancelled]
LISTENERS: list = []


def check(cond: bool, label: str) -> None:
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILS.append(label)


# ---- fake homeassistant modules
def _mod(name: str, **attrs):
    m = types.ModuleType(name)
    m.__dict__.update(attrs)
    sys.modules[name] = m
    return m


class FakeErr(Exception):
    pass


def async_call_later(hass, delay, cb):
    _require_loop_safe(cb, "async_call_later")
    entry = [CLOCK["t"] + delay, cb, False]
    TIMERS.append(entry)

    def cancel():
        entry[2] = True

    return cancel


def _require_loop_safe(cb, who):
    """Like Home Assistant: a plain sync function is run in the executor, which would make
    our calls to async_call_later / async_create_task unsafe. Only @callback or coroutine
    functions are acceptable here."""
    if asyncio.iscoroutinefunction(cb) or getattr(cb, "_hass_callback", False):
        return
    raise AssertionError(f"{who}: {getattr(cb, '__qualname__', cb)} must be @callback or async")


def async_track_state_change_event(hass, entities, cb):
    _require_loop_safe(cb, "async_track_state_change_event")
    LISTENERS.append((set(entities), cb))
    return lambda: None


def async_track_time_interval(hass, cb, interval):
    _require_loop_safe(cb, "async_track_time_interval")
    return lambda: None


def _callback(func):
    func._hass_callback = True
    return func


_mod("homeassistant")
_mod("homeassistant.core", callback=_callback)
_mod("homeassistant.helpers")
_mod("homeassistant.helpers.event", async_call_later=async_call_later,
     async_track_state_change_event=async_track_state_change_event,
     async_track_time_interval=async_track_time_interval)
_mod("homeassistant.exceptions", HomeAssistantError=FakeErr)
_mod("homeassistant.util")
_mod("homeassistant.util.dt", now=lambda: datetime(2026, 11, 24, 12, 0))
time.monotonic = lambda: CLOCK["t"]

import automation as au  # noqa: E402


class FakeState:
    def __init__(self, state, attrs=None):
        self.state = state
        self.attributes = attrs or {}


class FakeServices:
    def __init__(self):
        self.calls = []

    fail_with = None

    async def async_call(self, domain, service, data, blocking=False):
        if self.fail_with is not None:
            raise self.fail_with
        self.calls.append((domain, service, data["name"]))


class FakeHass:
    def __init__(self):
        self.states = types.SimpleNamespace(get=lambda eid: STATE.get(eid))
        self.services = FakeServices()
        self.tasks = []

    def async_create_task(self, coro):
        self.tasks.append(asyncio.ensure_future(coro))


STATE: dict = {}


async def advance(hass, seconds):
    CLOCK["t"] += seconds
    for entry in list(TIMERS):
        if not entry[2] and entry[0] <= CLOCK["t"]:
            entry[2] = True
            await entry[1](None)
    await asyncio.sleep(0)
    for t in hass.tasks:
        await t
    hass.tasks.clear()


def theme_for(look_id):
    return {"day01": "Zoosh - Day", "alert1": "Zoosh - Alert"}.get(look_id)


async def main() -> None:
    hass = FakeHass()
    data = {
        "looks": [{"id": i, "state": {"name": n}} for i, n in (("day01", "Day"), ("alert1", "Alert"))],
        "default_id": "day01",
        "automation": au.default_config(),
    }
    data["automation"].update(enabled=True, rules=[{
        "entity_id": "alarm_control_panel.home", "op": "is", "attribute": "", "value": "armed_away",
        "only_night": False, "look": "alert1"}])
    rt = au.ZooshAutomation(hass, data, theme_for)
    await rt.async_start()
    calls = hass.services.calls

    await advance(hass, 1)
    check(not calls, "nothing applied before the 5 s debounce")
    await advance(hass, 5)
    check(calls == [("frontend", "set_theme", "Zoosh - Day")], "default Look applied after the debounce")

    # trigger a rule: must wait for debounce AND the 30 s minimum dwell
    STATE["alarm_control_panel.home"] = FakeState("armed_away")
    rt.request_eval("alarm changed")
    await advance(hass, 6)
    check(len(calls) == 1, "rule waits for the minimum dwell (30 s since last change)")
    await advance(hass, 30)
    check(calls[-1][2] == "Zoosh - Alert" and len(calls) == 2, "Alert applied once the dwell has passed")
    check("rule: alarm_control_panel.home" in rt.reason, "reason names the rule")

    # flapping inside the debounce window produces one decision only
    for _ in range(4):
        STATE["alarm_control_panel.home"] = FakeState("disarmed")
        rt.request_eval("flap")
        await advance(hass, 1)
        STATE["alarm_control_panel.home"] = FakeState("armed_away")
        rt.request_eval("flap")
        await advance(hass, 1)
    await advance(hass, 10)
    check(len(calls) == 2, "flapping does not flicker the theme")

    # condition ends -> reverts after dwell
    await advance(hass, 40)
    STATE["alarm_control_panel.home"] = FakeState("disarmed")
    rt.request_eval("alarm cleared")
    await advance(hass, 6)
    check(calls[-1][2] == "Zoosh - Day" and len(calls) == 3, "auto-revert to the default when the rule ends")

    # pause stops changes
    data["automation"]["paused"] = True
    STATE["alarm_control_panel.home"] = FakeState("armed_away")
    rt.request_eval("while paused")
    await advance(hass, 60)
    check(len(calls) == 3 and rt.status()["paused"] is True, "paused: no changes")
    check("paused" in rt.reason, "paused reason shown")

    # an event delivered through the registered listener works (decorated callback)
    check(any(getattr(cb, "_hass_callback", False) for _, cb in LISTENERS), "state listener is a @callback")
    # a save re-applying a Look keeps the runtime in step
    rt.mark_applied("day01", "saved from the panel")
    check(rt.active_id == "day01" and "saved from the panel" in rt.log[0]["msg"], "mark_applied updates active Look and log")
    # a non-@callback function is rejected by the strict fake (proves the check works)
    try:
        async_track_state_change_event(hass, ["a.b"], lambda e: None)
        check(False, "strict fake rejects a plain function")
    except AssertionError:
        check(True, "strict fake rejects a plain function")

    # manual test ignores pause and dwell
    ok = await rt.async_test("alert1")
    check(ok and calls[-1][2] == "Zoosh - Alert", "test button applies a Look")
    check(not await rt.async_test("missing"), "test with an unknown Look is refused")
    check(len(rt.log) <= 20 and rt.status()["log"][0]["msg"].startswith("Alert"), "log kept newest first, capped at 20")
    for i in range(30):
        rt.record(f"m{i}")
    check(len(rt.log) == 20, "log capped at 20 entries")
    # a failing service call (any exception, e.g. vol.Invalid) is survived and logged once
    class Invalid(Exception):
        pass

    logged = []
    au._LOGGER.warning = lambda *a, **k: logged.append(a)
    hass.services.fail_with = Invalid("bad theme")
    n_calls = len(calls)
    for _ in range(3):
        ok2 = await rt.async_test("day01")
    check(ok2 is False and len(calls) == n_calls, "failing set_theme does not raise and nothing is applied")
    check(len(logged) == 1, "the same failure is logged once, not every time")
    hass.services.fail_with = None
    check(await rt.async_test("day01") is True, "runtime keeps working after a failure")
    rt.async_stop()

    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)


asyncio.run(main())
