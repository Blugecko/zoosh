# SPDX-License-Identifier: Apache-2.0
"""Pure validation and YAML generation for Zoosh.

This module imports nothing from Home Assistant (or voluptuous) so it can be
tested standalone. The check_* callables raise ValueError, which voluptuous
turns into a validation error when used inside a schema.
"""

from __future__ import annotations

import base64
import copy
import json
import math
import re
from typing import Any, Callable

THEME_PREFIX = "Zoosh - "
SHARE_PREFIX = "zoosh1:"
MAX_SHARE_LEN = 12000
MAX_LOOKS = 12
ID_RE = re.compile(r"[a-z0-9]{2,12}")

FONTS: dict[str, str] = {
    "ios": "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
    "rounded": "ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, sans-serif",
    "roboto": "Roboto, 'Noto Sans', sans-serif",
}
BG_TYPES = ("solid", "gradient", "image")
EASINGS: dict[str, str] = {
    "ease": "ease",
    "ease-out": "ease-out",
    "ease-in-out": "ease-in-out",
    "spring": "cubic-bezier(0.34,1.56,0.64,1)",
}
ENTRANCES = ("none", "fade", "fade-up", "scale-in")
IMG_FITS = ("cover", "contain")
IMG_POSITIONS = ("center", "top", "bottom")
CHOICES: dict[str, tuple[str, ...]] = {
    "imgFit": IMG_FITS,
    "imgPos": IMG_POSITIONS,
    "font": tuple(FONTS),
    "bgType": BG_TYPES,
    "easing": tuple(EASINGS),
    "entrance": ENTRANCES,
}
BOOLS = (
    "frosted", "toggleAnim", "layoutOn",
    # Extra animations (opt-in, read by zoosh-fx.js)
    "shimmer", "ripple", "dialogSpring", "pageTransition", "sidebarHover", "drift", "perf",
    # Glass depth ("Liquid Glass" approximation)
    "gdOn", "gLive",
)

HEX_RE = re.compile(r"#[0-9a-fA-F]{6}")
NAME_RE = re.compile(r"[A-Za-z0-9 _-]{1,40}")
# Only two prefixes are ever allowed: the user's uploads and the wallpapers shipped inside
# the integration.
IMAGE_RE = re.compile(r"/(?:local/wallpapers|zoosh_static/wallpapers)/[A-Za-z0-9._-]+")

RANGES: dict[str, tuple[int, int]] = {
    "radius": (0, 36),
    "blur": (0, 40),
    "bw": (0, 3),
    "shadowBlur": (0, 40),
    "shadowAlpha": (0, 60),
    "fontScale": (90, 120),
    # Card size and animation (--zs-* variables read by zoosh-fx.js)
    "cardScale": (80, 120),
    "hoverScale": (100, 108),
    "pressScale": (90, 100),
    "animMs": (0, 600),
    "stagger": (0, 120),
    # Sections view layout
    "colMax": (200, 600),
    "rowGap": (0, 48),
    "colGap": (0, 48),
    # Glass depth
    "gBlur": (0, 40),
    "gSat": (100, 250),
    "gBright": (80, 130),
    "gTint": (0, 100),
    "gEdge": (0, 100),
    "gGlow": (0, 100),
    "gShadow": (0, 100),
    "gSheen": (0, 100),
}
# Keys added after 1.0.0: missing ones are filled from here so old saves and old
# share codes still validate. Anything else missing or unknown is still rejected.
NEW_DEFAULTS: dict[str, Any] = {
    "imgFit": "cover", "imgPos": "center",
    "shimmer": False, "ripple": False, "dialogSpring": False, "pageTransition": False,
    "sidebarHover": False, "drift": False, "perf": False,
    "gdOn": False, "gLive": False,
    "gBlur": 20, "gSat": 160, "gBright": 105, "gTint": 28,
    "gEdge": 60, "gGlow": 30, "gShadow": 35, "gSheen": 40,
}
MODE_RANGES: dict[str, tuple[int, int]] = {
    "op": (20, 100),
    "dim": (0, 80),
    "sbOp": (0, 100),
    "hdOp": (0, 100),
    "dlOp": (0, 100),
    "scrim": (0, 80),
    "bdOp": (0, 100),
    "dvOp": (0, 100),
    "inOp": (0, 100),
}

GLOBAL_COLORS = ("primary", "accent", "success", "error", "shadowColor")
MODE_COLORS = (
    "bg", "bg2", "card", "text", "text2",
    "sbBg", "sbText", "sbIcon", "sbSel",
    "hdBg", "hdText",
    "dlBg",
    "bdColor", "dvColor",
    "icInactive", "icActive", "icLight",
    "inBg",
)
MODES = ("light", "dark")

_YAML_RESERVED = {"true", "false", "yes", "no", "on", "off", "null", "y", "n", "~"}


# ---------------------------------------------------------------- validators
def check_hex(value: Any) -> str:
    if not isinstance(value, str) or not HEX_RE.fullmatch(value):
        raise ValueError("expected a colour like #AABBCC")
    return value


def check_int_range(lo: int, hi: int) -> Callable[[Any], int]:
    def _check(value: Any) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("expected a whole number")
        if not lo <= value <= hi:
            raise ValueError(f"expected a number between {lo} and {hi}")
        return value

    return _check


def check_name(value: Any) -> str:
    if not isinstance(value, str) or not NAME_RE.fullmatch(value) or value != value.strip():
        raise ValueError(
            "theme name must be 1-40 characters: letters, digits, space, _ or -"
            " (no leading or trailing space)"
        )
    return value


def check_image(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("image path must be text")
    if value == "":
        return value
    if not IMAGE_RE.fullmatch(value) or ".." in value or value.endswith("/."):
        raise ValueError("image path must look like /local/wallpapers/<file> or /zoosh_static/wallpapers/<file>")
    return value


def check_bool(value: Any) -> bool:
    if not isinstance(value, bool):
        raise ValueError("expected true or false")
    return value


def check_choice(options: Any) -> Callable[[Any], str]:
    def _check(value: Any) -> str:
        if not isinstance(value, str) or value not in options:
            raise ValueError(f"expected one of {', '.join(options)}")
        return value

    return _check


def validate_state(raw: Any) -> dict[str, Any]:
    """Strictly validate a full editor state. Returns a clean copy or raises ValueError."""
    if not isinstance(raw, dict):
        raise ValueError("state must be an object")
    raw = {**NEW_DEFAULTS, **raw}
    expected = {"name", "light", "dark", *CHOICES, *BOOLS, *GLOBAL_COLORS, *RANGES}
    if set(raw) != expected:
        raise ValueError("state has missing or unknown keys")
    out: dict[str, Any] = {
        "name": check_name(raw["name"]),
    }
    for key, options in CHOICES.items():
        out[key] = check_choice(options)(raw[key])
    for key in BOOLS:
        out[key] = check_bool(raw[key])
    for key in GLOBAL_COLORS:
        out[key] = check_hex(raw[key])
    for key, (lo, hi) in RANGES.items():
        out[key] = check_int_range(lo, hi)(raw[key])
    mode_keys = {*MODE_COLORS, *MODE_RANGES, "img"}
    for mode in MODES:
        sub = raw[mode]
        if not isinstance(sub, dict) or set(sub) != mode_keys:
            raise ValueError(f"{mode} has missing or unknown keys")
        clean: dict[str, Any] = {}
        for key in MODE_COLORS:
            clean[key] = check_hex(sub[key])
        for key, (lo, hi) in MODE_RANGES.items():
            clean[key] = check_int_range(lo, hi)(sub[key])
        clean["img"] = check_image(sub["img"])
        out[mode] = clean
    return out


# ------------------------------------------------------------------ helpers
def _alpha(a: float) -> str:
    # floor(x + 0.5) matches JavaScript's Math.round so client and server agree
    return f"{math.floor(a * 100 + 0.5) / 100:g}"


def _rgba(hex_colour: str, a: str) -> str:
    n = int(hex_colour[1:], 16)
    return f"rgba({n >> 16 & 255},{n >> 8 & 255},{n & 255},{a})"


def _q(value: str) -> str:
    """Double-quote a value. All inputs are validated and never contain quotes."""
    if '"' in value or "\\" in value or "\n" in value:
        raise ValueError("unsafe character in value")
    return f'"{value}"'


def _theme_key(name: str) -> str:
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9 _-]*", name) and name.lower() not in _YAML_RESERVED:
        return name
    return _q(name)


def _mode_vars(s: dict[str, Any], mode: str) -> dict[str, str]:
    c = s[mode]
    dark = mode == "dark"
    card_pct = s["gTint"] if s["gdOn"] else c["op"]
    card = _rgba(c["card"], _alpha(card_pct / 100))
    bg = c["bg"]
    if s["bgType"] == "gradient":
        bg = f"linear-gradient(160deg, {c['bg']} 0%, {c['bg2']} 100%)"
    elif s["bgType"] == "image" and c["img"]:
        layer = ""
        if c["dim"]:
            d = _alpha(c["dim"] / 100)
            layer = f"linear-gradient(rgba(0,0,0,{d}), rgba(0,0,0,{d})), "
        bg = f"{layer}{s['imgPos']} / {s['imgFit']} no-repeat fixed url('{c['img']}') {c['bg']}"
    if s["gdOn"]:
        if s["gShadow"]:
            a = _alpha(s["gShadow"] / 250 * (1.6 if dark else 1))
            shadow = f"0 8px {math.floor(s['gShadow'] * 0.4 + 0.5)}px {_rgba(s['shadowColor'], a)}"
        else:
            shadow = "none"
    elif s["shadowBlur"]:
        a = _alpha(s["shadowAlpha"] / 100 * (1.6 if dark else 1))
        shadow = f"0 2px {s['shadowBlur']}px {_rgba(s['shadowColor'], a)}"
    else:
        shadow = "none"
    return {"bg": bg, "card": card, "shadow": shadow}


def _op(hex_colour: str, percent: int) -> str:
    return _rgba(hex_colour, _alpha(percent / 100))


def theme_name(look_name: str) -> str:
    """The Home Assistant theme name for a Look."""
    return THEME_PREFIX + look_name


HEADER = [
    "# Generated by Zoosh (one theme per Look). Edits made here are overwritten on the next save.",
    "# Saved as /config/themes/zoosh.yaml",
    "# configuration.yaml: frontend: themes: !include_dir_merge_named themes",
    "",
]


def generate_yaml(state: dict[str, Any]) -> str:
    """Theme YAML for a single Look (used by the tests)."""
    return generate_looks_yaml([state])


def generate_looks_yaml(states: list[dict[str, Any]]) -> str:
    """Theme YAML with one theme per Look (names must be unique)."""
    cleaned = [validate_state(x) for x in states]
    names = [x["name"].lower() for x in cleaned]
    if len(set(names)) != len(names):
        raise ValueError("Look names must be unique")
    lines = list(HEADER)
    for s in cleaned:
        lines += _theme_lines(s)
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def _theme_lines(s: dict[str, Any]) -> list[str]:
    f = FONTS[s["font"]]
    q = _q
    if s["gdOn"]:
        blur = f"blur({s['gBlur']}px) saturate({s['gSat']}%) brightness({s['gBright']}%)"
    else:
        blur = f"blur({s['blur']}px) saturate(180%)" if s["frosted"] and s["blur"] else "none"
    lines = [
        f"# Look: {s['name']}",
        f"{_theme_key(theme_name(s['name']))}:",
        "  # Shared",
        f"  primary-color: {q(s['primary'])}",
        f"  accent-color: {q(s['accent'])}",
        f"  ha-card-border-radius: {s['radius']}px",
        f"  ha-card-border-width: {s['bw']}px",
        f"  ha-card-backdrop-filter: {blur}",
        f"  ha-font-family-body: {q(f)}",
        f"  ha-font-family-heading: {q(f)}",
        f"  paper-font-common-base_-_font-family: {q(f)}",
        f"  mdc-typography-font-family: {q(f)}",
        f"  dialog-border-radius: {s['radius'] + 4}px",
        f"  mdc-shape-medium: {max(6, math.floor(s['radius'] * 0.7 + 0.5))}px",
        f"  mdc-shape-small: {max(4, math.floor(s['radius'] * 0.55 + 0.5))}px",
        "  slider-color: var(--primary-color)",
        '  slider-bar-color: "rgba(120,120,128,0.32)"',
        f"  switch-checked-color: {q(s['success'])}",
        f"  switch-checked-track-color: {q(s['success'])}",
        '  switch-checked-button-color: "#FFFFFF"',
        '  switch-unchecked-button-color: "#FFFFFF"',
        "  mdc-checkbox-checked-color: var(--primary-color)",
        "  mdc-radio-checked-color: var(--primary-color)",
        f"  success-color: {q(s['success'])}",
        f"  warning-color: {q(s['accent'])}",
        f"  error-color: {q(s['error'])}",
        f"  info-color: {q(s['primary'])}",
    ]
    def num(value: int) -> str:
        return f"{value / 100:g}"

    lines += [
        f"  zs-card-scale: {q(num(s['cardScale']))}",
        f"  zs-hover-scale: {q(num(s['hoverScale']))}",
        f"  zs-press-scale: {q(num(s['pressScale']))}",
        f"  zs-anim-duration-ms: {q(str(s['animMs']))}",
        f"  zs-anim-easing: {q(EASINGS[s['easing']])}",
        f"  zs-entrance: {q(s['entrance'])}",
        f"  zs-stagger-ms: {q(str(s['stagger']))}",
        f"  zs-toggle-anim: {q('on' if s['toggleAnim'] else 'off')}",
    ]

    def onoff(key: str) -> str:
        return q("on" if s[key] else "off")

    lines += [
        f"  zs-shimmer: {onoff('shimmer')}",
        f"  zs-ripple: {onoff('ripple')}",
        f"  zs-dialog-spring: {onoff('dialogSpring')}",
        f"  zs-page-transition: {onoff('pageTransition')}",
        f"  zs-sidebar-hover: {onoff('sidebarHover')}",
        f"  zs-drift: {onoff('drift')}",
        f"  zs-perf: {onoff('perf')}",
        f"  zs-glass: {onoff('gdOn')}",
        f"  zs-g-edge: {q(num(s['gEdge']))}",
        f"  zs-g-glow: {q(num(s['gGlow']))}",
        f"  zs-g-sheen: {q(num(s['gSheen']))}",
        f"  zs-g-live: {onoff('gLive')}",
    ]
    if s["layoutOn"]:
        lines += [
            f"  ha-view-sections-column-max-width: {s['colMax']}px",
            f"  ha-view-sections-row-gap: {s['rowGap']}px",
            f"  ha-view-sections-column-gap: {s['colGap']}px",
        ]
    if s["fontScale"] != 100:
        # Not an official Home Assistant variable as far as we know; ignored if unsupported.
        lines.append(f"  ha-font-size-scale: {s['fontScale'] / 100:g}")
    lines += ["", "  modes:"]
    for mode in MODES:
        c = s[mode]
        v = _mode_vars(s, mode)
        border = _op(c["bdColor"], c["bdOp"])
        divider = _op(c["dvColor"], c["dvOp"])
        dialog = _op(c["dlBg"], c["dlOp"])
        sidebar_bg = c["sbBg"] if c["sbOp"] == 100 else _op(c["sbBg"], c["sbOp"])
        field = _op(c["inBg"], c["inOp"])
        lines += [
            f"    {mode}:",
            f"      primary-background-color: {q(c['bg'])}",
            f"      secondary-background-color: {q(c['card'])}",
            f"      lovelace-background: {q(v['bg'])}",
            f"      card-background-color: {q(v['card'])}",
            f"      ha-card-background: {q(v['card'])}",
            f"      ha-card-box-shadow: {q(v['shadow'])}",
            f"      primary-text-color: {q(c['text'])}",
            f"      secondary-text-color: {q(c['text2'])}",
            f"      disabled-text-color: {q(_rgba(c['text2'], '0.6'))}",
            f"      divider-color: {q(divider)}",
            f"      outline-color: {q(border)}",
            f"      ha-card-border-color: {q(border)}",
            f"      app-header-background-color: {q(_op(c['hdBg'], c['hdOp']))}",
            f"      app-header-text-color: {q(c['hdText'])}",
            f"      sidebar-background-color: {q(sidebar_bg)}",
            f"      sidebar-text-color: {q(c['sbText'])}",
            f"      sidebar-icon-color: {q(c['sbIcon'])}",
            f"      sidebar-selected-background-color: {q(_rgba(c['sbSel'], '0.18'))}",
            f"      sidebar-selected-text-color: {q(c['sbSel'])}",
            f"      sidebar-selected-icon-color: {q(c['sbSel'])}",
            f"      mdc-text-field-fill-color: {q(field)}",
            f"      input-fill-color: {q(field)}",
            f"      mdc-text-field-ink-color: {q(c['text'])}",
            f"      mdc-text-field-label-ink-color: {q(c['text2'])}",
            f"      ha-dialog-surface-background: {q(dialog)}",
            f"      mdc-theme-surface: {q(dialog)}",
            f"      mdc-dialog-scrim-color: {q(_op('#000000', c['scrim']))}",
            f"      state-icon-color: {q(c['icInactive'])}",
            f"      state-icon-active-color: {q(c['icActive'])}",
            f"      state-light-active-color: {q(c['icLight'])}",
            f"      zs-g-solid: {q(_rgba(c['card'], '0.92'))}",
        ]
    return lines


def default_state() -> dict[str, Any]:
    """The default Look: the "Glass" starter (Liquid Glass depth over the two wallpapers
    shipped with Zoosh; the gradient colours behind them are the fallback)."""
    return copy.deepcopy(_GLASS)


_GLASS: dict[str, Any] = {
        "name": "Glass",
        "imgFit": "cover",
        "imgPos": "center",
        "font": "ios",
        "bgType": "image",
        "easing": "ease-out",
        "entrance": "fade-up",
        "frosted": True,
        "toggleAnim": True,
        "layoutOn": False,
        "shimmer": True,
        "ripple": False,
        "dialogSpring": True,
        "pageTransition": False,
        "sidebarHover": False,
        "drift": False,
        "perf": False,
        "gdOn": True,
        "gLive": True,
        "primary": "#0A84FF",
        "accent": "#f23f0d",
        "success": "#34C759",
        "error": "#FF3B30",
        "shadowColor": "#000000",
        "radius": 20,
        "blur": 11,
        "bw": 1,
        "shadowBlur": 14,
        "shadowAlpha": 10,
        "fontScale": 105,
        "cardScale": 100,
        "hoverScale": 103,
        "pressScale": 99,
        "animMs": 200,
        "stagger": 40,
        "colMax": 525,
        "rowGap": 12,
        "colGap": 38,
        "gBlur": 20,
        "gSat": 160,
        "gBright": 105,
        "gTint": 28,
        "gEdge": 60,
        "gGlow": 30,
        "gShadow": 35,
        "gSheen": 40,
        "light": {
            "bg": "#fff3ec",
            "bg2": "#ffd9c7",
            "card": "#fbf5f4",
            "text": "#211512",
            "text2": "#4f352d",
            "sbBg": "#f4edeb",
            "sbText": "#211512",
            "sbIcon": "#6b4f47",
            "sbSel": "#741e06",
            "hdBg": "#faf6f5",
            "hdText": "#211512",
            "dlBg": "#fcf9f8",
            "bdColor": "#6C6C70",
            "dvColor": "#6C6C70",
            "icInactive": "#6C6C70",
            "icActive": "#f23f0d",
            "icLight": "#FFD60A",
            "inBg": "#787880",
            "op": 36,
            "dim": 0,
            "sbOp": 70,
            "hdOp": 60,
            "dlOp": 92,
            "scrim": 32,
            "bdOp": 22,
            "dvOp": 22,
            "inOp": 18,
            "img": "/zoosh_static/wallpapers/zoosh-light.jpg"
        },
        "dark": {
            "bg": "#0f1a33",
            "bg2": "#7a2a14",
            "card": "#37211b",
            "text": "#f5f1f0",
            "text2": "#c2b2ad",
            "sbBg": "#211512",
            "sbText": "#f5f1f0",
            "sbIcon": "#c2b2ad",
            "sbSel": "#f23f0d",
            "hdBg": "#32201b",
            "hdText": "#f5f1f0",
            "dlBg": "#2d1b16",
            "bdColor": "#98989F",
            "dvColor": "#98989F",
            "icInactive": "#98989F",
            "icActive": "#f23f0d",
            "icLight": "#FFD60A",
            "inBg": "#787880",
            "op": 60,
            "dim": 40,
            "sbOp": 70,
            "hdOp": 60,
            "dlOp": 92,
            "scrim": 50,
            "bdOp": 28,
            "dvOp": 28,
            "inOp": 18,
            "img": "/zoosh_static/wallpapers/zoosh-dark.jpg"
        }
    }


# ---------------------------------------------------------------- starter Looks
def _derive(name: str, o: dict[str, Any]) -> dict[str, Any]:
    """Build a full state from a short description (mirrors the old panel presets)."""
    s = default_state()
    s.update(
        name=name, font=o["font"], bgType=o["bgType"], frosted=o["blur"] > 0,
        primary=o["primary"], accent=o["accent"], success=o["success"], error=o["error"],
        radius=o["radius"], blur=o["blur"], bw=o["bw"],
        shadowBlur=o["shadowBlur"], shadowAlpha=o["shadowAlpha"],
    )
    for mode in MODES:
        c = o[mode]
        dark = mode == "dark"
        s[mode] = {
            "bg": c["bg"], "bg2": c["bg2"], "card": c["card"], "op": c["op"],
            "text": c["text"], "text2": c["text2"],
            "img": "", "dim": 30 if dark else 0,
            "sbBg": c["bg"], "sbOp": 100, "sbText": c["text"], "sbIcon": c["text2"],
            "sbSel": o["primary"],
            "hdBg": c["card"], "hdOp": 85, "hdText": c["text"],
            "dlBg": c["card"], "dlOp": 92 if dark else 95, "scrim": 50 if dark else 32,
            "bdColor": c["text2"], "bdOp": 28 if dark else 22,
            "dvColor": c["text2"], "dvOp": 28 if dark else 22,
            "icInactive": c["text2"], "icActive": o["accent"], "icLight": o["active"],
            "inBg": "#787880", "inOp": 18,
        }
    return s


def starter_looks() -> list[dict[str, Any]]:
    """Six ready-made Looks the user can duplicate. Names are unique."""
    glass = default_state()
    solid = _derive("Solid", {
        "font": "ios", "primary": "#007AFF", "accent": "#FF9500", "active": "#FFCC00",
        "success": "#34C759", "error": "#FF3B30", "radius": 14, "blur": 0, "bw": 0,
        "shadowBlur": 0, "shadowAlpha": 0, "bgType": "solid",
        "light": {"bg": "#F2F2F7", "bg2": "#F2F2F7", "card": "#FFFFFF", "op": 100, "text": "#000000", "text2": "#8A8A8E"},
        "dark": {"bg": "#000000", "bg2": "#000000", "card": "#1C1C1E", "op": 100, "text": "#FFFFFF", "text2": "#8E8E93"},
    })
    midnight = _derive("Midnight", {
        "font": "rounded", "primary": "#2DD4BF", "accent": "#F59E0B", "active": "#FBBF24",
        "success": "#2DD4BF", "error": "#F87171", "radius": 24, "blur": 18, "bw": 1,
        "shadowBlur": 20, "shadowAlpha": 30, "bgType": "gradient",
        "light": {"bg": "#EEF6F5", "bg2": "#CDE8E4", "card": "#FFFFFF", "op": 70, "text": "#0B1F1D", "text2": "#4F6B68"},
        "dark": {"bg": "#07110F", "bg2": "#0F2A28", "card": "#16302D", "op": 60, "text": "#E6FFFB", "text2": "#8DB3AE"},
    })
    sunrise = _derive("Sunrise", {
        "font": "rounded", "primary": "#E8590C", "accent": "#FF7A3D", "active": "#FFB703",
        "success": "#2F9E44", "error": "#E03131", "radius": 22, "blur": 14, "bw": 1,
        "shadowBlur": 16, "shadowAlpha": 14, "bgType": "gradient",
        "light": {"bg": "#FFF4E6", "bg2": "#FFD9B0", "card": "#FFFFFF", "op": 72, "text": "#3B2412", "text2": "#8A6A4F"},
        "dark": {"bg": "#2A1710", "bg2": "#4A2412", "card": "#3A2218", "op": 62, "text": "#FFEFE0", "text2": "#D2A98C"},
    })
    alert = _derive("Alert", {
        "font": "ios", "primary": "#FF3B30", "accent": "#FFB020", "active": "#FFB020",
        "success": "#34C759", "error": "#FF3B30", "radius": 18, "blur": 10, "bw": 1,
        "shadowBlur": 18, "shadowAlpha": 24, "bgType": "gradient",
        "light": {"bg": "#FFF1F0", "bg2": "#FFD9D6", "card": "#FFFFFF", "op": 78, "text": "#2B0A08", "text2": "#8C4B47"},
        "dark": {"bg": "#1F0707", "bg2": "#3A0D0A", "card": "#3A1210", "op": 66, "text": "#FFECEA", "text2": "#D9A3A0"},
    })
    liquid = default_state()
    liquid.update(
        name="Liquid Glass", bgType="gradient", gdOn=True, gLive=True, shimmer=True, ripple=True,
        sidebarHover=True, frosted=True, radius=26, bw=0,
        gBlur=22, gSat=190, gBright=108, gTint=22, gEdge=70, gGlow=35, gShadow=40, gSheen=45,
    )
    liquid["light"]["img"] = liquid["dark"]["img"] = ""  # gradient-only starter
    liquid["light"].update(card="#FFFFFF", text="#0A0A0C", hdOp=60, sbOp=70, dlOp=70)
    liquid["dark"].update(card="#FFFFFF", text="#FFFFFF", hdOp=40, sbOp=60, dlOp=45)
    liquid["dark"]["card"] = "#8E8E9A"
    return [glass, solid, midnight, sunrise, alert, liquid]


# ------------------------------------------------------------------ Look lists
def validate_looks(raw: Any, default_id: Any) -> tuple[list[dict[str, Any]], str]:
    """Validate [{id, state}] (1..MAX_LOOKS, unique ids and names) and the default id."""
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_LOOKS:
        raise ValueError(f"expected between 1 and {MAX_LOOKS} Looks")
    out: list[dict[str, Any]] = []
    ids: set[str] = set()
    names: set[str] = set()
    for item in raw:
        if not isinstance(item, dict) or set(item) != {"id", "state"}:
            raise ValueError("each Look needs an id and a state")
        look_id = item["id"]
        if not isinstance(look_id, str) or not ID_RE.fullmatch(look_id):
            raise ValueError("invalid Look id")
        state = validate_state(item["state"])
        if look_id in ids or state["name"].lower() in names:
            raise ValueError("Look ids and names must be unique")
        ids.add(look_id)
        names.add(state["name"].lower())
        out.append({"id": look_id, "state": state})
    if not isinstance(default_id, str) or default_id not in ids:
        raise ValueError("default Look must be one of the Looks")
    return out, default_id


# ------------------------------------------------------------------ share codes
def encode_share(state: dict[str, Any]) -> str:
    clean = validate_state(state)
    blob = json.dumps(clean, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return SHARE_PREFIX + base64.urlsafe_b64encode(blob).decode("ascii").rstrip("=")


MAX_JSON_DEPTH = 6


def _json_depth(text: str) -> int:
    """Deepest [ / { nesting outside strings (cheap scan, no parsing)."""
    depth = best = 0
    in_str = esc = False
    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch in "[{":
            depth += 1
            best = max(best, depth)
        elif ch in "]}":
            depth -= 1
    return best


def decode_share(code: Any) -> dict[str, Any]:
    """Decode and strictly validate a share code. Raises ValueError."""
    if not isinstance(code, str):
        raise ValueError("share code must be text")
    code = code.strip()
    if len(code) > MAX_SHARE_LEN or not code.startswith(SHARE_PREFIX):
        raise ValueError("not a Zoosh share code")
    body = code[len(SHARE_PREFIX):]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", body):
        raise ValueError("share code has invalid characters")
    try:
        blob = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        text = blob.decode("utf-8")
        if _json_depth(text) > MAX_JSON_DEPTH:
            raise ValueError("share code is nested too deeply")
        data = json.loads(text)
    except (ValueError, UnicodeDecodeError, RecursionError) as err:
        raise ValueError("share code is damaged") from err
    return validate_state(data)
