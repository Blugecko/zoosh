# SPDX-License-Identifier: Apache-2.0
"""Standalone tests (no Home Assistant needed). Run: python3 tests/test_yaml_gen.py"""

from __future__ import annotations

import base64
import copy
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "custom_components" / "zoosh"))
sys.path.insert(0, str(ROOT / "tests"))

import images as im  # noqa: E402
import synth  # noqa: E402
import yaml_gen as yg  # noqa: E402

FAILS: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        FAILS.append(label)


def parse(text: str) -> dict:
    """Parse the generated YAML. PyYAML if present, else a tiny parser for this fixed shape."""
    try:
        import yaml  # type: ignore

        return yaml.safe_load(text)
    except ImportError:
        pass
    root: dict = {}
    stack = [(-1, root)]
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        m = re.match(r"^\s*([^:]+?):(?: (.*))?$", raw)
        key, val = m.group(1).strip().strip('"'), m.group(2)
        while stack[-1][0] >= indent:
            stack.pop()
        if val is None or val == "":
            d: dict = {}
            stack[-1][1][key] = d
            stack.append((indent, d))
        else:
            val = val.strip()
            if val.startswith('"') and val.endswith('"'):
                val = val[1:-1]
            stack[-1][1][key] = val
    return root


def effective(theme: dict, mode: str) -> dict:
    out = {k: v for k, v in theme.items() if k != "modes"}
    out.update(theme["modes"][mode])
    return out


def rejects(state, label: str) -> None:
    try:
        yg.validate_state(state)
    except ValueError:
        check(True, "rejected: " + label)
        return
    check(False, "rejected: " + label)


# A plain, image-based Look used as a fixture for the generator tests (not a shipped Look).
def fixture_state() -> dict:
    s = copy.deepcopy(yg.default_state())
    s.update(
        name="Glass", bgType="image", frosted=True, primary="#0A84FF", accent="#FF9F0A", gdOn=False, gLive=False,
        shimmer=False, dialogSpring=False, toggleAnim=False, entrance="none", layoutOn=False, fontScale=100,
        hoverScale=100, pressScale=100, radius=20, blur=11, bw=1, shadowBlur=14, shadowAlpha=10,
        colMax=500, rowGap=8, colGap=32,
    )
    s["light"].update(bg="#F2F2F7", bg2="#DCE6F7", card="#FFFFFF", op=78, text="#000000", text2="#6C6C70",
                      img="/local/wallpapers/light.jpg", dim=0, sbBg="#F2F2F7", sbOp=100, sbText="#000000",
                      sbIcon="#6C6C70", sbSel="#0A84FF", hdBg="#FFFFFF", hdOp=85, hdText="#000000", dlBg="#FFFFFF",
                      dlOp=95, scrim=32, bdColor="#6C6C70", bdOp=22, dvColor="#6C6C70", dvOp=22,
                      icInactive="#6C6C70", icActive="#FF9F0A", icLight="#FFD60A", inBg="#787880", inOp=18)
    s["dark"].update(bg="#443b3b", bg2="#14213D", card="#453e47", op=64, text="#fffcf0", text2="#98989F",
                     img="/local/wallpapers/dark.jpg", dim=30, sbBg="#443b3b", sbOp=100, sbText="#fffcf0",
                     sbIcon="#98989F", sbSel="#0A84FF", hdBg="#453e47", hdOp=85, hdText="#fffcf0", dlBg="#453e47",
                     dlOp=92, scrim=50, bdColor="#98989F", bdOp=28, dvColor="#98989F", dvOp=28,
                     icInactive="#98989F", icActive="#FF9F0A", icLight="#FFD60A", inBg="#787880", inOp=18)
    return s


def mutated_ok(path, value) -> bool:
    try:
        yg.validate_state(mutated(path, value))
        return True
    except ValueError:
        return False


def mutated(path: list[str], value) -> dict:
    s = fixture_state()
    node = s
    for p in path[:-1]:
        node = node[p]
    node[path[-1]] = value
    return s


def main() -> None:
    state = fixture_state()
    check(yg.validate_state(state) == state, "default state validates")
    text = yg.generate_yaml(state)

    gen = parse(text)
    (gen_name, gen_theme), = gen.items()
    check(gen_name == "Zoosh - Glass", "theme is named 'Zoosh - <Look name>'")
    check(set(gen_theme["modes"]) == {"light", "dark"}, "modes light/dark present")

    # Variation: gradient, solid, no blur, frosted off, scale, opacity<100 sidebar
    s = copy.deepcopy(state)
    s.update(bgType="gradient", frosted=False, fontScale=110)
    s["dark"]["sbOp"] = 50
    out = parse(yg.generate_yaml(s))["Zoosh - Glass"]
    check(out["ha-card-backdrop-filter"] == "none", "frosted off -> backdrop none")
    check(out["ha-font-size-scale"] == "1.1", "fontScale 110 -> 1.1")
    check(out["modes"]["dark"]["sidebar-background-color"] == "rgba(68,59,59,0.5)", "sidebar opacity -> rgba")
    check(out["modes"]["light"]["lovelace-background"] == "linear-gradient(160deg, #F2F2F7 0%, #DCE6F7 100%)", "gradient background")
    s["bgType"] = "solid"
    check(parse(yg.generate_yaml(s))["Zoosh - Glass"]["modes"]["dark"]["lovelace-background"] == "#443b3b", "solid background")
    s = copy.deepcopy(state)
    s["name"] = "123"
    check(yg.generate_yaml(s).count("Zoosh - 123:") == 1, "numeric-looking Look name is safe behind the prefix")
    s["name"] = "yes"
    check("Zoosh - yes:" in yg.generate_yaml(s), "yaml-bool Look name is safe behind the prefix")

    # Card size, animation and layout variables
    base = parse(text)["Zoosh - Glass"]
    check(base["zs-card-scale"] == "1" and base["zs-anim-duration-ms"] == "200" and base["zs-entrance"] == "none"
          and base["zs-toggle-anim"] == "off" and base["zs-anim-easing"] == "ease-out", "default zs-* variables are neutral")
    check("ha-view-sections-row-gap" not in base, "layout vars absent while layoutOn is false")
    s = copy.deepcopy(state)
    s.update(cardScale=105, hoverScale=104, pressScale=96, animMs=300, easing="spring", entrance="fade-up",
             stagger=60, toggleAnim=True, layoutOn=True, colMax=420, rowGap=12, colGap=24)
    o = parse(yg.generate_yaml(s))["Zoosh - Glass"]
    check((o["zs-card-scale"], o["zs-hover-scale"], o["zs-press-scale"]) == ("1.05", "1.04", "0.96"), "scale vars")
    check(o["zs-anim-easing"] == "cubic-bezier(0.34,1.56,0.64,1)" and o["zs-entrance"] == "fade-up", "spring easing and entrance")
    check((o["zs-anim-duration-ms"], o["zs-stagger-ms"], o["zs-toggle-anim"]) == ("300", "60", "on"), "duration, stagger, toggle")
    check((o["ha-view-sections-column-max-width"], o["ha-view-sections-row-gap"], o["ha-view-sections-column-gap"]) == ("420px", "12px", "24px"), "layout vars")
    for easing in ("ease", "ease-out", "ease-in-out"):
        s["easing"] = easing
        check(parse(yg.generate_yaml(s))["Zoosh - Glass"]["zs-anim-easing"] == easing, "easing " + easing)

    # Negative tests
    rejects(mutated(["primary"], "#12345"), "short hex")
    rejects(mutated(["primary"], "#12345G"), "non-hex digit")
    rejects(mutated(["primary"], "#123456\n"), "hex with trailing newline")
    rejects(mutated(["light", "bg"], "red"), "colour name")
    rejects(mutated(["dark", "sbBg"], "#GGGGGG"), "bad sidebar colour")
    rejects(mutated(["dark", "icLight"], "#fff"), "bad icon colour")
    rejects(mutated(["shadowColor"], "rgba(0,0,0,1)"), "bad shadow colour")
    rejects(mutated(["light", "img"], "/local/wallpapers/../x.jpg"), "image traversal")
    rejects(mutated(["light", "img"], "/etc/passwd"), "image outside /local/wallpapers")
    rejects(mutated(["light", "img"], "/local/wallpapers/a b.jpg"), "image with space")
    rejects(mutated(["light", "img"], "/local/wallpapers/a')x.jpg"), "image with quote")
    rejects(mutated(["light", "img"], "/local/wallpapers/x.jpg\n"), "image with trailing newline")
    for path, bad in [
        (["radius"], 37), (["radius"], -1), (["blur"], 41), (["bw"], 4), (["shadowBlur"], 41),
        (["shadowAlpha"], 61), (["fontScale"], 89), (["fontScale"], 121),
        (["light", "op"], 19), (["light", "op"], 101), (["dark", "dim"], 81),
        (["dark", "sbOp"], 101), (["dark", "hdOp"], -1), (["light", "dlOp"], 101),
        (["light", "scrim"], 81), (["light", "bdOp"], 101), (["light", "dvOp"], 101),
        (["dark", "inOp"], 101), (["radius"], 5.5), (["radius"], True), (["radius"], "20"),
    ]:
        rejects(mutated(path, bad), f"{'.'.join(path)} = {bad!r}")
    for path, bad in [
        (["cardScale"], 79), (["cardScale"], 121), (["hoverScale"], 99), (["hoverScale"], 109),
        (["pressScale"], 89), (["pressScale"], 101), (["animMs"], 601), (["animMs"], -1),
        (["stagger"], 121), (["colMax"], 199), (["colMax"], 601), (["rowGap"], 49), (["colGap"], -1),
    ]:
        rejects(mutated(path, bad), f"{'.'.join(path)} = {bad!r}")
    rejects(mutated(["easing"], "bounce"), "easing outside whitelist")
    rejects(mutated(["easing"], "cubic-bezier(1,1,1,1)"), "raw cubic-bezier as easing")
    rejects(mutated(["entrance"], "slide"), "entrance outside whitelist")
    rejects(mutated(["toggleAnim"], "yes"), "toggleAnim not a bool")
    rejects(mutated(["layoutOn"], 1), "layoutOn not a bool")
    rejects(mutated(["font"], "comic"), "font outside whitelist")
    rejects(mutated(["bgType"], "video"), "bgType outside list")
    rejects(mutated(["frosted"], 1), "frosted not a bool")
    for bad in ["", "x" * 41, "bad/name", "bad:name", " lead", "trail ", "a\nb", "na\"me"]:
        rejects(mutated(["name"], bad), f"name {bad!r}")
    extra = copy.deepcopy(state)
    extra["evil"] = "x: y"
    rejects(extra, "unknown key")
    missing = copy.deepcopy(state)
    del missing["light"]["inBg"]
    rejects(missing, "missing key")
    rejects("not a dict", "non-object state")
    check(yg.validate_state(mutated(["light", "img"], ""))["light"]["img"] == "", "empty image path allowed")

    # Image helpers
    png, jpg, webp = synth.png(), synth.jpeg(), synth.webp()
    b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
    check(im.decode_image(b64(png), "image/png") == (png, "png"), "png accepted")
    check(im.decode_image(b64(jpg), "image/jpeg")[1] == "jpg", "jpeg accepted")
    check(im.decode_image(b64(webp), "image/webp")[1] == "webp", "webp accepted")
    for label, args in {
        "gif type": (b64(png), "image/gif"),
        "svg type": (b64(png), "image/svg+xml"),
        "png bytes labelled jpeg": (b64(png), "image/jpeg"),
        "html with png type": (b64(b"<script>alert(1)</script>"), "image/png"),
        "bad base64": ("!!!notbase64", "image/png"),
        "empty": ("", "image/png"),
        "over 10 MB": (b64(png + b"0" * (10 * 1024 * 1024)), "image/png"),
    }.items():
        try:
            im.decode_image(*args)
            check(False, "upload rejected: " + label)
        except ValueError:
            check(True, "upload rejected: " + label)
    check(im.content_name(b"one", "png") != im.content_name(b"two", "png"), "different content gets a different name (cache busting)")
    check(re.fullmatch(r"wallpaper-[0-9a-f]{12}\.png", im.content_name(b"one", "png")) is not None, "upload name is wallpaper-<12 hex>.<ext>")
    check(im.is_upload_name(im.content_name(b"x", "jpg")) and not im.is_upload_name("zoosh-dark.jpg") and not im.is_upload_name("../wallpaper-0123456789ab.jpg"), "upload name pattern")

    # ------------------------------------------------------------ 1.1.0 additions
    # Old 1.0.0 states (without the new keys) still validate and get neutral defaults.
    old = {k: v for k, v in state.items() if k not in yg.NEW_DEFAULTS}
    v_old = yg.validate_state(old)
    check(v_old["gdOn"] is False and v_old["perf"] is False and v_old["shimmer"] is False, "old state gets neutral new fields")
    bad = copy.deepcopy(state)
    bad["extra"] = 1
    rejects(bad, "unknown key still rejected")

    # Glass depth and animation variables
    g = copy.deepcopy(state)
    g.update(gdOn=True, gBlur=22, gSat=190, gBright=108, gTint=22, gEdge=70, gGlow=35, gShadow=40, gSheen=45,
             gLive=True, shimmer=True, ripple=True, dialogSpring=True, pageTransition=True,
             sidebarHover=True, drift=True, perf=False)
    go = parse(yg.generate_yaml(g))["Zoosh - Glass"]
    check(go["ha-card-backdrop-filter"] == "blur(22px) saturate(190%) brightness(108%)", "glass backdrop filter")
    check(go["modes"]["dark"]["card-background-color"] == "rgba(69,62,71,0.22)", "glass tint opacity replaces card opacity")
    check(go["modes"]["light"]["ha-card-box-shadow"] == "0 8px 16px rgba(0,0,0,0.16)", "glass soft outer shadow")
    check((go["zs-glass"], go["zs-g-edge"], go["zs-g-glow"], go["zs-g-sheen"], go["zs-g-live"]) == ("on", "0.7", "0.35", "0.45", "on"), "glass zs vars")
    check(all(go[k] == "on" for k in ("zs-shimmer", "zs-ripple", "zs-dialog-spring", "zs-page-transition", "zs-sidebar-hover", "zs-drift")) and go["zs-perf"] == "off", "animation zs vars")
    check(go["modes"]["dark"]["zs-g-solid"] == "rgba(69,62,71,0.92)", "solid fallback colour per mode")
    check(base["zs-glass"] == "off" and base["zs-shimmer"] == "off" and base["zs-perf"] == "off", "defaults leave the new effects off")
    for key, val in (("gBlur", 41), ("gSat", 99), ("gBright", 131), ("gTint", 101), ("gEdge", -1), ("gGlow", 101), ("gShadow", 101), ("gSheen", 101)):
        b2 = copy.deepcopy(state)
        b2[key] = val
        rejects(b2, f"{key}={val} rejected")
    for key in ("gdOn", "gLive", "shimmer", "ripple", "dialogSpring", "pageTransition", "sidebarHover", "drift", "perf"):
        b2 = copy.deepcopy(state)
        b2[key] = "yes"
        rejects(b2, f"{key} must be a bool")

    # Image fit and position
    fit = copy.deepcopy(state)
    fit.update(imgFit="contain", imgPos="top")
    fo = parse(yg.generate_yaml(fit))["Zoosh - Glass"]
    check(fo["modes"]["light"]["lovelace-background"] == "top / contain no-repeat fixed url('/local/wallpapers/light.jpg') #F2F2F7", "image fit and position in lovelace-background")
    check(base["modes"]["light"]["lovelace-background"].startswith("center / cover no-repeat fixed url("), "default fit/position unchanged")
    for key, val in (("imgFit", "stretch"), ("imgPos", "left"), ("imgFit", 3)):
        b3 = copy.deepcopy(state)
        b3[key] = val
        rejects(b3, f"{key}={val!r} rejected")


    # Palettes generated by the panel (tests/palette_samples.json, dumped from the jsdom run):
    # applying any of them to a state must still pass the strict server-side validator.
    samples = json.loads((ROOT / "tests" / "palette_samples.json").read_text())
    check(len(samples) >= 4, f"palette fixture has several palettes ({len(samples)})")
    for i, pal in enumerate(samples):
        st = copy.deepcopy(state)
        mode = "dark" if pal["dark"] else "light"
        c = st[mode]
        st["accent"] = pal["accent"]
        c.update(card=pal["card"], text=pal["text"], text2=pal["text2"], icActive=pal["accent"],
                 sbBg=pal["sbBg"], sbOp=pal["sbOp"], sbText=pal["sbText"], sbIcon=pal["sbIcon"], sbSel=pal["sbSel"],
                 hdBg=pal["hdBg"], hdOp=pal["hdOp"], hdText=pal["hdText"], dlBg=pal["dlBg"], dlOp=pal["dlOp"])
        try:
            out = yg.validate_state(st)
            yg.generate_yaml(out)
            check(True, f"palette {i} ({mode}) passes the server validator")
        except ValueError as err:
            check(False, f"palette {i} ({mode}) passes the server validator: {err}")
        for key, (lo, hi) in (("sbOp", yg.MODE_RANGES["sbOp"]), ("hdOp", yg.MODE_RANGES["hdOp"]), ("dlOp", yg.MODE_RANGES["dlOp"])):
            check(isinstance(pal[key], int) and lo <= pal[key] <= hi, f"palette {i} {key} in range")

    # ---- the shipped default Look ("Glass")
    d = yg.default_state()
    check(yg.validate_state(d) == d and d["name"] == "Glass", "default starter validates strictly and is called Glass")
    check(d["bgType"] == "image" and d["light"]["img"] == "/zoosh_static/wallpapers/zoosh-light.jpg" and d["dark"]["img"] == "/zoosh_static/wallpapers/zoosh-dark.jpg", "default starter uses the two bundled wallpapers (one per mode)")
    check((d["light"]["dim"], d["dark"]["dim"], d["imgFit"], d["imgPos"]) == (0, 40, "cover", "center"), "default dimming and fit")
    blob = json.dumps(yg.starter_looks()) + yg.generate_looks_yaml(yg.starter_looks())
    check(not re.search(r"/local/wallpapers|/Volumes|/Users/", blob, re.I), "no starter has a personal or /local wallpaper path")
    check(all(x["light"]["img"] == "" and x["dark"]["img"] == "" for x in yg.starter_looks() if x["name"] != "Glass"), "other starters have empty image fields")
    check(d["layoutOn"] is False, "Sections spacing is off by default")
    dg = parse(yg.generate_yaml(d))["Zoosh - Glass"]
    check(dg["ha-card-backdrop-filter"] == "blur(20px) saturate(160%) brightness(105%)", "default: glass backdrop filter")
    check(dg["accent-color"] == "#f23f0d" and dg["ha-font-size-scale"] == "1.05", "default: accent and font scale")
    check((dg["zs-hover-scale"], dg["zs-press-scale"], dg["zs-entrance"], dg["zs-anim-duration-ms"], dg["zs-stagger-ms"]) == ("1.03", "0.99", "fade-up", "200", "40"), "default: scale and entrance vars")
    check((dg["zs-shimmer"], dg["zs-ripple"], dg["zs-dialog-spring"], dg["zs-glass"], dg["zs-g-live"], dg["zs-toggle-anim"]) == ("on", "off", "on", "on", "on", "on"), "default: effect switches")
    check((dg["zs-g-edge"], dg["zs-g-glow"], dg["zs-g-sheen"]) == ("0.6", "0.3", "0.4"), "default: glass depth values")
    check("ha-view-sections-row-gap" not in dg, "default: no Sections layout variables")
    check(dg["modes"]["dark"]["card-background-color"] == "rgba(55,33,27,0.28)" and dg["modes"]["dark"]["sidebar-background-color"] == "rgba(33,21,18,0.7)" and dg["modes"]["dark"]["app-header-background-color"] == "rgba(50,32,27,0.6)", "default: translucent card, sidebar and header")
    check(dg["modes"]["dark"]["lovelace-background"] == "linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), center / cover no-repeat fixed url('/zoosh_static/wallpapers/zoosh-dark.jpg') #0f1a33", "default dark: bundled wallpaper, 40% dimming, navy fallback colour")
    check(dg["modes"]["light"]["lovelace-background"] == "center / cover no-repeat fixed url('/zoosh_static/wallpapers/zoosh-light.jpg') #fff3ec", "default light: bundled wallpaper, no dimming, warm fallback colour")

    # Image path rule: exactly two prefixes
    for ok_path in ("/local/wallpapers/a.jpg", "/zoosh_static/wallpapers/zoosh-dark.jpg", "/zoosh_static/wallpapers/A_b-1.webp", ""):
        check(mutated_ok(["light", "img"], ok_path), f"image path accepted: {ok_path!r}")
    for bad_path in ("/zoosh_static/wallpapers/../x", "/zoosh_static/other/x.jpg", "/ZOOSH_STATIC/wallpapers/x.jpg", "/zoosh_static/wallpapers/x.jpg\n",
                     "/zoosh_static/wallpapers/", "/zoosh_static/wallpapers/a/b.jpg", "/zoosh_static/wallpapers/.", "/zoosh_static/wallpapers/a b.jpg",
                     "//zoosh_static/wallpapers/x.jpg", "http://x/zoosh_static/wallpapers/x.jpg", "/zoosh_static/wallpapers/x.jpg')", "/local/Wallpapers/x.jpg", "/static/wallpapers/x.jpg"):
        rejects(mutated(["dark", "img"], bad_path), f"image path rejected: {bad_path!r}")

    # Bundled files
    wp = ROOT / "custom_components" / "zoosh" / "wallpapers"
    for name in ("zoosh-light.jpg", "zoosh-dark.jpg"):
        data = (wp / name).read_bytes()
        check(data[:3] == b"\xff\xd8\xff" and data[-2:] == b"\xff\xd9", f"{name} is a JPEG")
        check(len(data) < 400 * 1024, f"{name} is under 400 KB ({len(data) // 1024} KB)")
    check((wp / "CREDITS.md").is_file(), "wallpaper credits file present")
    skip = (".git", "node_modules")
    def folder_kb(path):
        return sum(f.stat().st_size for f in path.rglob("*") if f.is_file() and not any(s in f.parts for s in skip)) // 1024
    integ = folder_kb(ROOT / "custom_components" / "zoosh")
    check(integ < 3000, f"the installed integration stays small ({integ} KB)")
    total = folder_kb(ROOT)
    check(total < 6000, f"repository stays small ({total} KB)")

    # Starter Looks, Look lists
    starters = yg.starter_looks()
    names = [x["name"] for x in starters]
    check(names == ["Glass", "Solid", "Midnight", "Sunrise", "Alert", "Liquid Glass"], "six starter Looks")
    for st in starters:
        yg.validate_state(st)
    check(starters[5]["gdOn"] is True, "Liquid Glass starter uses the glass layer")
    multi = parse(yg.generate_looks_yaml(starters))
    check(list(multi) == ["Zoosh - " + n for n in names], "one theme per Look, prefixed")
    items = [{"id": f"l{i:02d}", "state": st} for i, st in enumerate(starters)]
    looks, default = yg.validate_looks(items, "l00")
    check(len(looks) == 6 and default == "l00", "validate_looks ok")
    for label, args in (
        ("default must exist", (items, "zz")),
        ("empty list", ([], "l00")),
        ("too many", ([{"id": f"a{i:03d}", "state": dict(starters[0], name=f"N{i}")} for i in range(13)], "a000")),
        ("duplicate ids", ([items[0], dict(items[1], id="l00")], "l00")),
        ("duplicate names", ([items[0], {"id": "l99", "state": dict(starters[1], name="glass")}], "l00")),
        ("bad id", ([dict(items[0], id="BAD ID")], "BAD ID")),
        ("extra item key", ([dict(items[0], extra=1)], "l00")),
    ):
        try:
            yg.validate_looks(*args)
            check(False, "validate_looks rejects: " + label)
        except ValueError:
            check(True, "validate_looks rejects: " + label)
    twelve = [{"id": f"a{i:03d}", "state": dict(starters[0], name=f"N{i}")} for i in range(12)]
    check(len(yg.validate_looks(twelve, "a000")[0]) == 12, "12 Looks accepted")
    try:
        yg.generate_looks_yaml([starters[0], starters[0]])
        check(False, "duplicate Look names rejected in yaml")
    except ValueError:
        check(True, "duplicate Look names rejected in yaml")

    # Share codes
    code = yg.encode_share(starters[5])
    check(code.startswith("zoosh1:") and re.fullmatch(r"[A-Za-z0-9_:-]+", code) is not None, "share code is base64url")
    check(yg.decode_share(code) == yg.validate_state(starters[5]), "share code round trip")
    check(yg.decode_share("  " + code + "\n") == yg.validate_state(starters[5]), "share code tolerates whitespace")
    tampered = base64.urlsafe_b64encode(json.dumps({**starters[0], "radius": 99}).encode()).decode().rstrip("=")
    for label, c in (
        ("wrong prefix", "zoosh2:" + code[7:]),
        ("not base64", "zoosh1:!!!"),
        ("not json", "zoosh1:" + base64.urlsafe_b64encode(b"hello").decode()),
        ("out of range value", "zoosh1:" + tampered),
        ("too long", "zoosh1:" + "A" * 13000),
        ("array payload", "zoosh1:" + base64.urlsafe_b64encode(b"[1]").decode()),
        ("not text", 5),
        ("deeply nested json", "zoosh1:" + base64.urlsafe_b64encode(b"[" * 5000 + b"]" * 5000).decode().rstrip("=")),
        ("nested beyond the depth limit", "zoosh1:" + base64.urlsafe_b64encode(b'{"a":' * 9 + b"1" + b"}" * 9).decode().rstrip("=")),
    ):
        try:
            yg.decode_share(c)
            check(False, "share code rejected: " + label)
        except ValueError:
            check(True, "share code rejected: " + label)


    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
