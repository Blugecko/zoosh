// SPDX-License-Identifier: Apache-2.0
/* Zoosh panel for Home Assistant.
 * Single-file vanilla web component. No build step, no external requests.
 * The server (zoosh/save) validates the state and writes the real theme file;
 * the YAML shown here is a preview copy for display only.
 */
(function () {
  "use strict";
  if (customElements.get("zoosh-panel")) return;

  var FONTS = {
    ios: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
    rounded: "ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, sans-serif",
    roboto: "Roboto, 'Noto Sans', sans-serif"
  };
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;
  var NAME_RE = /^[A-Za-z0-9 _-]{1,40}$/;
  var IMG_RE = /^\/(?:local\/wallpapers|zoosh_static\/wallpapers)\/[A-Za-z0-9._-]+$/;
  var UPLOAD_WARNING = "Uploaded wallpapers are served at /local/ without sign-in; do not upload photos of people or your home if your Home Assistant is reachable from the internet.";
  var UPLOAD_NAME_RE = /^wallpaper-[0-9a-f]{12}\.(?:jpg|png|webp)$/;
  var BUNDLED_URL = "/zoosh_static/wallpapers/";
  var BUNDLED_DEFAULT = ["zoosh-light.jpg", "zoosh-dark.jpg"];
  var BUNDLED_LABEL = { "zoosh-light.jpg": "Zoosh light", "zoosh-dark.jpg": "Zoosh dark" };
  var ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  // Home Assistant's websocket accepts messages up to 4 MB; stay well below it after base64 (x1.34).
  var MAX_RAW_BYTES = 2.7 * 1024 * 1024;

  // ------------------------------------------------------------------ data
  // Mirrors yaml_gen.default_state() on the server (the "Glass" starter Look).
  // The server also sends the full list of starter Looks with zoosh/get.
  var DEFAULT = {
    "name": "Glass",
    "imgFit": "cover",
    "imgPos": "center",
    "font": "ios",
    "bgType": "image",
    "easing": "ease-out",
    "entrance": "fade-up",
    "frosted": true,
    "toggleAnim": true,
    "layoutOn": false,
    "shimmer": true,
    "ripple": false,
    "dialogSpring": true,
    "pageTransition": false,
    "sidebarHover": false,
    "drift": false,
    "perf": false,
    "gdOn": true,
    "gLive": true,
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
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  var THEME_PREFIX = "Zoosh - ";
  var TOUR_KEY = "zoosh_tour_done";

  // Field definitions. type: text | select | color | range | check | image
  // adv: true hides the field (or whole section) in Simple mode.
  var FONT_OPTS = [["ios", "iOS system (San Francisco)"], ["rounded", "iOS rounded"], ["roboto", "Roboto (Home Assistant default)"]];
  var EASINGS = { "ease": "ease", "ease-out": "ease-out", "ease-in-out": "ease-in-out", "spring": "cubic-bezier(0.34,1.56,0.64,1)" };
  var CHOICES = {
    font: ["ios", "rounded", "roboto"], bgType: ["solid", "gradient", "image"],
    easing: Object.keys(EASINGS), entrance: ["none", "fade", "fade-up", "scale-in"],
    imgFit: ["cover", "contain"], imgPos: ["center", "top", "bottom"]
  };

  // Settings that apply to the whole Look (the "Shared" tab).
  var SHARED_SECTIONS = [
    { id: "s-name", title: "Name and font", help: "What this Look is called and the typeface used everywhere.", open: true, fields: [
      { k: "name", label: "Look name", type: "text", maxlength: 40, help: "Saved as the theme \"Zoosh - <name>\". Letters, numbers, spaces, _ and - only." },
      { k: "font", label: "Font", type: "select", opts: FONT_OPTS },
      { k: "fontScale", label: "Text size", type: "range", min: 90, max: 120, unit: "%", adv: true, help: "Home Assistant may ignore this on some versions." }
    ] },
    { id: "s-colors", title: "Brand colours", help: "Used on buttons, switches, sliders and warnings.", fields: [
      { k: "accent", label: "Accent colour", type: "color" },
      { k: "primary", label: "Main colour", type: "color", adv: true },
      { k: "success", label: "Switch on colour", type: "color", adv: true },
      { k: "error", label: "Error colour", type: "color", adv: true }
    ] },
    { id: "s-shape", title: "Shape and glass", help: "Rounded corners, frosted blur, borders and shadows on cards.", fields: [
      { k: "radius", label: "Corner roundness", type: "range", min: 0, max: 36, unit: "px" },
      { k: "frosted", label: "Frosted glass on cards", type: "check", adv: true },
      { k: "blur", label: "Glass blur", type: "range", min: 0, max: 40, unit: "px" },
      { k: "bw", label: "Card border thickness", type: "range", min: 0, max: 3, unit: "px", adv: true },
      { k: "shadowColor", label: "Shadow colour", type: "color", adv: true },
      { k: "shadowBlur", label: "Shadow softness", type: "range", min: 0, max: 40, unit: "px", adv: true },
      { k: "shadowAlpha", label: "Shadow strength", type: "range", min: 0, max: 60, unit: "%", adv: true }
    ] },
    { id: "s-layout", title: "Layout spacing", adv: true, help: "Spacing in the Sections dashboard view.", fields: [
      { k: "layoutOn", label: "Set Sections view spacing", type: "check", help: "Unknown variables are harmless; I could not verify every one exists in your Home Assistant version." },
      { k: "colMax", label: "Column max width", type: "range", min: 200, max: 600, unit: "px" },
      { k: "rowGap", label: "Row gap", type: "range", min: 0, max: 48, unit: "px" },
      { k: "colGap", label: "Column gap", type: "range", min: 0, max: 48, unit: "px" }
    ] }
  ];

  // Settings that exist once for light and once for dark (the "Light" and "Dark" tabs).
  var MODE_SECTIONS = [
    { id: "m-bg", title: "Background", special: "background", help: "The wallpaper or colour behind your dashboard.", open: true, fields: [
      { k: "bg", label: "Background colour", type: "color" },
      { k: "bg2", label: "Gradient end colour", type: "color", adv: true },
      { k: "dim", label: "Darken the wallpaper", type: "range", min: 0, max: 80, unit: "%", adv: true, help: "Helps text stay readable on bright photos." }
    ] },
    { id: "m-cards", title: "Cards", help: "The tiles and panels on your dashboard.", open: true, fields: [
      { k: "card", label: "Card colour", type: "color" },
      { k: "op", label: "Card solidity", type: "range", min: 20, max: 100, unit: "%", help: "100% is solid, lower lets the wallpaper show through." },
      { k: "bdColor", label: "Card border colour", type: "color", adv: true },
      { k: "bdOp", label: "Card border strength", type: "range", min: 0, max: 100, unit: "%", adv: true },
      { k: "dvColor", label: "Divider line colour", type: "color", adv: true },
      { k: "dvOp", label: "Divider line strength", type: "range", min: 0, max: 100, unit: "%", adv: true }
    ] },
    { id: "m-text", title: "Text", help: "Readable text on cards.", open: true, fields: [
      { k: "text", label: "Text colour", type: "color" },
      { k: "text2", label: "Quieter text colour", type: "color", adv: true }
    ] },
    { id: "m-header", title: "Header", adv: true, help: "The bar at the top of each page.", fields: [
      { k: "hdBg", label: "Header colour", type: "color" },
      { k: "hdOp", label: "Header solidity", type: "range", min: 0, max: 100, unit: "%" },
      { k: "hdText", label: "Header text colour", type: "color" }
    ] },
    { id: "m-sidebar", title: "Sidebar", adv: true, help: "The menu on the left. Blur on the sidebar is not themable in Home Assistant.", fields: [
      { k: "sbBg", label: "Sidebar colour", type: "color" },
      { k: "sbOp", label: "Sidebar solidity", type: "range", min: 0, max: 100, unit: "%" },
      { k: "sbText", label: "Sidebar text colour", type: "color" },
      { k: "sbIcon", label: "Sidebar icon colour", type: "color" },
      { k: "sbSel", label: "Selected item colour", type: "color" }
    ] },
    { id: "m-dialogs", title: "Dialogs and popups", adv: true, help: "Windows that open on top of the dashboard.", fields: [
      { k: "dlBg", label: "Dialog colour", type: "color" },
      { k: "dlOp", label: "Dialog solidity", type: "range", min: 0, max: 100, unit: "%" },
      { k: "scrim", label: "Dim the page behind", type: "range", min: 0, max: 80, unit: "%" }
    ] },
    { id: "m-icons", title: "Icons and states", adv: true, help: "Icons for things that are off, on or lit.", fields: [
      { k: "icInactive", label: "Icon when off", type: "color" },
      { k: "icActive", label: "Icon when on", type: "color" },
      { k: "icLight", label: "Light that is on", type: "color" }
    ] },
    { id: "m-inputs", title: "Inputs", adv: true, help: "Text boxes and drop-downs.", fields: [
      { k: "inBg", label: "Field colour", type: "color" },
      { k: "inOp", label: "Field solidity", type: "range", min: 0, max: 100, unit: "%" }
    ] }
  ];
  var BG_FIELDS = [
    { k: "imgFit", label: "Image fit", type: "select", opts: [["cover", "Fill the screen (crop edges)"], ["contain", "Fit inside (may show bars)"]], adv: true },
    { k: "imgPos", label: "Image position", type: "select", opts: [["center", "Centre"], ["top", "Top"], ["bottom", "Bottom"]], adv: true }
  ];

  // Look-wide effects ("Animations and Glass" tab).
  var ANIM = [
    { k: "cardScale", label: "Card size", type: "range", min: 80, max: 120, unit: "%", help: "Scales cards visually. They keep their grid cell, so small cards leave a gap and large ones overlap." },
    { k: "hoverScale", label: "Grow on hover (mouse only)", type: "range", min: 100, max: 108, unit: "%" },
    { k: "pressScale", label: "Shrink when pressed", type: "range", min: 90, max: 100, unit: "%" },
    { k: "animMs", label: "Animation speed (0 = off)", type: "range", min: 0, max: 600, unit: "ms" },
    { k: "easing", label: "Animation feel", type: "select", opts: [["ease", "Ease"], ["ease-out", "Ease out"], ["ease-in-out", "Ease in-out"], ["spring", "Springy"]] },
    { k: "entrance", label: "How cards appear", type: "select", opts: [["none", "No effect"], ["fade", "Fade in"], ["fade-up", "Fade and rise"], ["scale-in", "Grow in"]] },
    { k: "stagger", label: "Delay between cards", type: "range", min: 0, max: 120, unit: "ms" },
    { k: "toggleAnim", label: "Press effect on switches", type: "check" }
  ];
  var FX = [
    { k: "shimmer", label: "Glass shimmer on press", type: "check" },
    { k: "ripple", label: "Press ripple in the accent colour", type: "check" },
    { k: "dialogSpring", label: "Springy pop-up windows", type: "check" },
    { k: "pageTransition", label: "Fade between dashboard pages", type: "check", help: "Best effort: only plays when Home Assistant creates a new page element." },
    { k: "sidebarHover", label: "Sidebar items slide on hover (mouse only)", type: "check" },
    { k: "drift", label: "Slowly drifting wallpaper", type: "check", help: "Moves one wallpaper layer smoothly; pauses when the tab is hidden." },
    { k: "perf", label: "Performance mode (turns every animation off)", type: "check" }
  ];
  var GLASS = [
    { k: "gdOn", label: "Use the Liquid Glass layer", type: "check", help: "Replaces the normal blur and card solidity with the controls below." },
    { k: "gBlur", label: "Blur behind cards", type: "range", min: 0, max: 40, unit: "px" },
    { k: "gSat", label: "Colour richness", type: "range", min: 100, max: 250, unit: "%" },
    { k: "gBright", label: "Brightness", type: "range", min: 80, max: 130, unit: "%" },
    { k: "gTint", label: "Card tint strength", type: "range", min: 0, max: 100, unit: "%" },
    { k: "gEdge", label: "Shiny edge", type: "range", min: 0, max: 100, unit: "%" },
    { k: "gGlow", label: "Inner glow", type: "range", min: 0, max: 100, unit: "%" },
    { k: "gShadow", label: "Soft shadow", type: "range", min: 0, max: 100, unit: "%" },
    { k: "gSheen", label: "Top sheen", type: "range", min: 0, max: 100, unit: "%" },
    { k: "gLive", label: "Living light (highlight follows scroll and mouse)", type: "check", help: "Pointer devices follow the mouse; scrolling works everywhere. No motion sensors are used." }
  ];

  // Number-range tables used by the pre-save check (the server enforces the same limits).
  var RANGES = {};
  var MODE_RANGES = {};
  [SHARED_SECTIONS, [{ fields: ANIM }, { fields: FX }, { fields: GLASS }]].forEach(function (list) {
    list.forEach(function (g) { g.fields.forEach(function (d) { if (d.type === "range") RANGES[d.k] = [d.min, d.max]; }); });
  });
  MODE_SECTIONS.forEach(function (g) { g.fields.forEach(function (d) { if (d.type === "range") MODE_RANGES[d.k] = [d.min, d.max]; }); });
  var MODE_COLOR_KEYS = [];
  MODE_SECTIONS.forEach(function (g) { g.fields.forEach(function (d) { if (d.type === "color") MODE_COLOR_KEYS.push(d.k); }); });
  var DEVICES = {
    phone: { name: "iPhone", w: 390, h: 844, bezel: 8, label: "Phone" },
    tablet: { name: "iPad", w: 820, h: 1180, bezel: 12, label: "Tablet" },
    desktop: { name: "Desktop browser", w: 1280, h: 800, bezel: 1, label: "Desktop" }
  };

  // ------------------------------------------------------------- helpers
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === false || v == null) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null || kid === false) continue;
      if (Array.isArray(kid)) kid.forEach(function (x) { if (x) el.append(x); });
      else el.append(kid);
    }
    return el;
  }

  function hex(v, fallback) { return typeof v === "string" && HEX_RE.test(v) ? v : (fallback || "#000000"); }
  function rgba(hexv, a) {
    var n = parseInt(hex(hexv).slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
  }
  function alpha(a) { return String(Math.round(a * 100) / 100); }
  function op(hexv, pct) { return rgba(hexv, alpha(pct / 100)); }
  // Only a validated wallpaper path or a blob: preview may ever reach a CSS url().
  function safeUrl(u) {
    if (typeof u !== "string" || u === "") return "";
    if (validImg(u)) return u;
    if (/^blob:[A-Za-z0-9:\/._-]+$/.test(u)) return u;
    return "";
  }
  function validImg(p) { return typeof p === "string" && IMG_RE.test(p) && p.indexOf("..") === -1 && !/\/\.$/.test(p); }

  function own(o, k) { return o !== null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k); }

  // One value, checked exactly like problems() and the server validator do. Anything that
  // does not pass is dropped by the caller and the default is used instead.
  function okValue(def, key, v, rangeTable, isMode) {
    if (typeof v !== typeof def) return false;
    if (typeof def === "boolean") return true;
    if (typeof def === "number") {
      var r = rangeTable[key];
      return Number.isInteger(v) && (!r || (v >= r[0] && v <= r[1]));
    }
    if (typeof def !== "string") return false;
    if (key === "name") return NAME_RE.test(v) && v === v.trim();
    if (key === "img") return v === "" || validImg(v);
    if (!isMode && own(CHOICES, key)) return CHOICES[key].indexOf(v) !== -1;
    return HEX_RE.test(v); // every other text field in a Look is a colour
  }

  // Merge unknown input onto defaults. A value is kept ONLY if it passes the same checks as
  // problems() and the server; otherwise the default for that field is used. Nothing that
  // fails validation can reach a CSS custom property, a style string or a url().
  function normalize(src) {
    var out = clone(DEFAULT);
    if (!src || typeof src !== "object" || Array.isArray(src)) return out;
    Object.keys(DEFAULT).forEach(function (k) {
      if (!own(src, k)) return;
      if (k === "light" || k === "dark") {
        var sub = src[k];
        if (sub && typeof sub === "object" && !Array.isArray(sub)) {
          Object.keys(DEFAULT[k]).forEach(function (kk) {
            if (own(sub, kk) && okValue(DEFAULT[k][kk], kk, sub[kk], MODE_RANGES, true)) out[k][kk] = sub[kk];
          });
        }
      } else if (okValue(DEFAULT[k], k, src[k], RANGES, false)) {
        out[k] = src[k];
      }
    });
    return out;
  }

  // Local checks to give friendly messages before the server's strict validation.
  function problems(s) {
    if (!NAME_RE.test(s.name) || s.name !== s.name.trim()) return "Theme name must be 1-40 characters: letters, digits, space, _ or - (no leading or trailing space).";
    var k, m;
    for (var ck in CHOICES) { if (CHOICES[ck].indexOf(s[ck]) === -1) return "'" + ck + "' has an unsupported value."; }
    ["primary", "accent", "success", "error", "shadowColor"].forEach(function (key) { if (!k && !HEX_RE.test(s[key])) k = key; });
    if (k) return "Colour '" + k + "' must look like #AABBCC.";
    for (var rk in RANGES) { k = rk; if (!(s[k] >= RANGES[k][0] && s[k] <= RANGES[k][1])) return "'" + k + "' must be between " + RANGES[k][0] + " and " + RANGES[k][1] + "."; }
    var modes = ["light", "dark"];
    for (var i = 0; i < modes.length; i++) {
      m = modes[i];
      var c = s[m];
      for (k in c) {
        if (k === "img") {
          if (c.img !== "" && !validImg(c.img)) return m + " image path must look like /local/wallpapers/<file> or /zoosh_static/wallpapers/<file>.";
        } else if (MODE_RANGES[k]) {
          if (!(c[k] >= MODE_RANGES[k][0] && c[k] <= MODE_RANGES[k][1])) return m + " '" + k + "' must be between " + MODE_RANGES[k][0] + " and " + MODE_RANGES[k][1] + ".";
        } else if (!HEX_RE.test(c[k])) {
          return m + " colour '" + k + "' must look like #AABBCC.";
        }
      }
    }
    return "";
  }

  // Client copy of the server's YAML generator, for display only.
  function modeVars(s, m, previewSrc) {
    var c = s[m], dark = m === "dark";
    var bg = c.bg;
    if (s.bgType === "gradient") {
      bg = "linear-gradient(160deg, " + c.bg + " 0%, " + c.bg2 + " 100%)";
    } else if (s.bgType === "image") {
      var src = previewSrc === undefined ? c.img : previewSrc;
      if (src) {
        var layer = "";
        if (c.dim) { var d = alpha(c.dim / 100); layer = "linear-gradient(rgba(0,0,0," + d + "), rgba(0,0,0," + d + ")), "; }
        bg = layer + s.imgPos + " / " + s.imgFit + " no-repeat" + (previewSrc === undefined ? " fixed" : "") + " url('" + src + "') " + c.bg;
      }
    }
    var shadow = s.shadowBlur ? "0 2px " + s.shadowBlur + "px " + rgba(s.shadowColor, alpha(s.shadowAlpha / 100 * (dark ? 1.6 : 1))) : "none";
    if (s.gdOn) shadow = s.gShadow ? "0 8px " + Math.round(s.gShadow * 0.4) + "px " + rgba(s.shadowColor, alpha(s.gShadow / 250 * (dark ? 1.6 : 1))) : "none";
    return { bg: bg, card: op(c.card, s.gdOn ? s.gTint : c.op), shadow: shadow };
  }

  function yamlText(s) {
    var f = FONTS[s.font] || FONTS.ios;
    var q = function (v) { return '"' + v + '"'; };
    var blur = s.gdOn ? "blur(" + s.gBlur + "px) saturate(" + s.gSat + "%) brightness(" + s.gBright + "%)" : (s.frosted && s.blur ? "blur(" + s.blur + "px) saturate(180%)" : "none");
    var lines = [
      "# Look: " + s.name,
      THEME_PREFIX + s.name + ":",
      "  # Shared",
      "  primary-color: " + q(s.primary),
      "  accent-color: " + q(s.accent),
      "  ha-card-border-radius: " + s.radius + "px",
      "  ha-card-border-width: " + s.bw + "px",
      "  ha-card-backdrop-filter: " + blur,
      "  ha-font-family-body: " + q(f),
      "  ha-font-family-heading: " + q(f),
      "  paper-font-common-base_-_font-family: " + q(f),
      "  mdc-typography-font-family: " + q(f),
      "  dialog-border-radius: " + (s.radius + 4) + "px",
      "  mdc-shape-medium: " + Math.max(6, Math.round(s.radius * 0.7)) + "px",
      "  mdc-shape-small: " + Math.max(4, Math.round(s.radius * 0.55)) + "px",
      "  slider-color: var(--primary-color)",
      '  slider-bar-color: "rgba(120,120,128,0.32)"',
      "  switch-checked-color: " + q(s.success),
      "  switch-checked-track-color: " + q(s.success),
      '  switch-checked-button-color: "#FFFFFF"',
      '  switch-unchecked-button-color: "#FFFFFF"',
      "  mdc-checkbox-checked-color: var(--primary-color)",
      "  mdc-radio-checked-color: var(--primary-color)",
      "  success-color: " + q(s.success),
      "  warning-color: " + q(s.accent),
      "  error-color: " + q(s.error),
      "  info-color: " + q(s.primary)
    ];
    lines.push(
      "  zs-card-scale: " + q(String(s.cardScale / 100)),
      "  zs-hover-scale: " + q(String(s.hoverScale / 100)),
      "  zs-press-scale: " + q(String(s.pressScale / 100)),
      "  zs-anim-duration-ms: " + q(String(s.animMs)),
      "  zs-anim-easing: " + q(EASINGS[s.easing] || EASINGS["ease-out"]),
      "  zs-entrance: " + q(s.entrance),
      "  zs-stagger-ms: " + q(String(s.stagger)),
      "  zs-toggle-anim: " + q(s.toggleAnim ? "on" : "off")
    );
    var oo = function (k) { return q(s[k] ? "on" : "off"); };
    lines.push(
      "  zs-shimmer: " + oo("shimmer"), "  zs-ripple: " + oo("ripple"), "  zs-dialog-spring: " + oo("dialogSpring"),
      "  zs-page-transition: " + oo("pageTransition"), "  zs-sidebar-hover: " + oo("sidebarHover"),
      "  zs-drift: " + oo("drift"), "  zs-perf: " + oo("perf"), "  zs-glass: " + oo("gdOn"),
      "  zs-g-edge: " + q(String(s.gEdge / 100)), "  zs-g-glow: " + q(String(s.gGlow / 100)),
      "  zs-g-sheen: " + q(String(s.gSheen / 100)), "  zs-g-live: " + oo("gLive")
    );
    if (s.layoutOn) {
      lines.push(
        "  ha-view-sections-column-max-width: " + s.colMax + "px",
        "  ha-view-sections-row-gap: " + s.rowGap + "px",
        "  ha-view-sections-column-gap: " + s.colGap + "px"
      );
    }
    if (s.fontScale !== 100) lines.push("  ha-font-size-scale: " + String(s.fontScale / 100));
    lines.push("", "  modes:");
    ["light", "dark"].forEach(function (m) {
      var c = s[m], v = modeVars(s, m), border = op(c.bdColor, c.bdOp), dialog = op(c.dlBg, c.dlOp), field = op(c.inBg, c.inOp);
      lines.push(
        "    " + m + ":",
        "      primary-background-color: " + q(c.bg),
        "      secondary-background-color: " + q(c.card),
        "      lovelace-background: " + q(v.bg),
        "      card-background-color: " + q(v.card),
        "      ha-card-background: " + q(v.card),
        "      ha-card-box-shadow: " + q(v.shadow),
        "      primary-text-color: " + q(c.text),
        "      secondary-text-color: " + q(c.text2),
        "      disabled-text-color: " + q(rgba(c.text2, "0.6")),
        "      divider-color: " + q(op(c.dvColor, c.dvOp)),
        "      outline-color: " + q(border),
        "      ha-card-border-color: " + q(border),
        "      app-header-background-color: " + q(op(c.hdBg, c.hdOp)),
        "      app-header-text-color: " + q(c.hdText),
        "      sidebar-background-color: " + q(c.sbOp === 100 ? c.sbBg : op(c.sbBg, c.sbOp)),
        "      sidebar-text-color: " + q(c.sbText),
        "      sidebar-icon-color: " + q(c.sbIcon),
        "      sidebar-selected-background-color: " + q(rgba(c.sbSel, "0.18")),
        "      sidebar-selected-text-color: " + q(c.sbSel),
        "      sidebar-selected-icon-color: " + q(c.sbSel),
        "      mdc-text-field-fill-color: " + q(field),
        "      input-fill-color: " + q(field),
        "      mdc-text-field-ink-color: " + q(c.text),
        "      mdc-text-field-label-ink-color: " + q(c.text2),
        "      ha-dialog-surface-background: " + q(dialog),
        "      mdc-theme-surface: " + q(dialog),
        "      mdc-dialog-scrim-color: " + q(op("#000000", c.scrim)),
        "      state-icon-color: " + q(c.icInactive),
        "      state-icon-active-color: " + q(c.icActive),
        "      state-light-active-color: " + q(c.icLight),
        "      zs-g-solid: " + q(rgba(c.card, "0.92"))
      );
    });
    return lines.join("\n").replace(/\n+$/, "\n");
  }

  // ----------------------------------------------------------------- styles
  var STYLE_CSS = [
    ":host { display: block; box-sizing: border-box; min-height: 100%; background: var(--primary-background-color); color: var(--primary-text-color); font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); font-size: 14px; line-height: 1.45; }",
    "* { box-sizing: border-box; }",
    "[hidden] { display: none !important; }",
    ":focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }",
    ".bar { position: sticky; top: 0; z-index: 6; display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 0 12px; padding-top: env(safe-area-inset-top, 0px); background: var(--app-header-background-color, var(--card-background-color)); color: var(--app-header-text-color, var(--primary-text-color)); border-bottom: 1px solid var(--divider-color); }",
    ".bar h1 { margin: 0; font-size: 20px; font-weight: 500; flex: none; }",
    ".bar .looksel { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }",
    ".bar .looksel select { min-height: 40px; max-width: 100%; }",
    ".icon-btn { width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; padding: 0; flex: none; }",
    ".icon-btn svg { width: 24px; height: 24px; fill: currentColor; }",
    ".wrap { max-width: 1280px; margin: 0 auto; padding: 12px 16px 24px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }",
    /* Tabs */
    ".tablist { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--divider-color); margin: 0 0 14px; }",
    ".tablist::-webkit-scrollbar { display: none; }",
    ".tablist [role=tab] { font: inherit; flex: none; min-height: 44px; padding: 8px 14px; border: 0; border-bottom: 3px solid transparent; background: transparent; color: var(--secondary-text-color); cursor: pointer; white-space: nowrap; }",
    ".tablist [role=tab][aria-selected=true] { color: var(--primary-text-color); border-bottom-color: var(--primary-color); font-weight: 600; }",
    ".tablist.modes { border: 1px solid var(--divider-color); border-radius: 12px; overflow: hidden; gap: 0; margin: 0 0 12px; display: inline-flex; }",
    ".tablist.modes [role=tab] { border-bottom: 0; padding: 6px 18px; }",
    ".tablist.modes [role=tab][aria-selected=true] { background: var(--primary-color); color: var(--text-primary-color, #fff); }",
    /* Layout */
    ".layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 520px); gap: 16px; align-items: start; }",
    ".layout[data-nopreview] { grid-template-columns: minmax(0, 1fr); }",
    ".layout[data-nopreview] .previewcol, .layout[data-nopreview] .fab { display: none !important; }",
    "@media (max-width: 900px) { .layout { grid-template-columns: minmax(0, 1fr); } .previewcol { display: none; } .previewcol[data-open] { display: block; position: fixed; left: 0; right: 0; bottom: calc(68px + env(safe-area-inset-bottom, 0px)); max-height: 72vh; overflow: auto; z-index: 20; background: var(--card-background-color); border-top: 1px solid var(--divider-color); border-radius: 16px 16px 0 0; padding: 10px 12px 14px; box-shadow: 0 -8px 30px rgba(0,0,0,.3); } .previewcol .sticky { position: static !important; } }",
    ".fab { display: none; position: fixed; right: 16px; bottom: calc(84px + env(safe-area-inset-bottom, 0px)); z-index: 21; min-height: 48px; padding: 0 18px; border-radius: 99px; border: 0; background: var(--primary-color); color: var(--text-primary-color, #fff); font: inherit; font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,.35); cursor: pointer; }",
    "@media (max-width: 900px) { .fab { display: inline-flex; align-items: center; } }",
    ".col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }",
    ".sticky { position: sticky; top: 72px; }",
    ".panel { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 12px; padding: 14px 16px; min-width: 0; }",
    ".panel h2 { margin: 0 0 10px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--secondary-text-color); }",
    ".fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 12px 16px; }",
    ".f { display: flex; flex-direction: column; gap: 4px; min-width: 0; }",
    ".f > label, .f > .lab { font-size: 13px; color: var(--secondary-text-color); display: flex; justify-content: space-between; gap: 8px; }",
    ".f .hint { font-size: 12px; color: var(--secondary-text-color); }",
    ".f .err { font-size: 12px; color: var(--error-color, #c62828); }",
    /* Custom dropdown, range, toggle and file styling (glass-friendly, low risk) */
    ".dd { position: relative; min-width: 0; width: 100%; }",
    ".ddbtn { font: inherit; width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; text-align: left; border: 1px solid var(--divider-color); border-radius: 10px; background: var(--secondary-background-color); color: var(--primary-text-color); cursor: pointer; }",
    ".ddbtn:hover { border-color: var(--primary-color); } .ddbtn:active { transform: scale(.99); }",
    ".ddtext { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".ddchev { flex: none; display: grid; place-items: center; width: 22px; height: 22px; color: var(--secondary-text-color); transition: transform .18s ease; }",
    ".dd[data-open] .ddchev { transform: rotate(180deg); color: var(--primary-color); }",
    ".dd[data-open] .ddbtn { border-color: var(--primary-color); }",
    ".ddpop { position: fixed; z-index: 50; overflow-y: auto; overscroll-behavior: contain; padding: 4px; border-radius: 12px; border: 1px solid var(--divider-color); background: var(--zs-pop-bg, var(--card-background-color)); color: var(--primary-text-color); -webkit-backdrop-filter: blur(18px) saturate(150%); backdrop-filter: blur(18px) saturate(150%); box-shadow: 0 10px 34px rgba(0,0,0,.35); transform-origin: top center; animation: ddin .14s ease-out; }",
    ".ddpop[data-up] { transform-origin: bottom center; }",
    "@keyframes ddin { from { opacity: 0; transform: scale(.97) translateY(-4px); } }",
    "@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .ddpop { background: var(--zs-glass-solid, var(--card-background-color)); } }",
    ".ddopt { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; padding: 8px 12px; border-radius: 8px; cursor: pointer; color: var(--primary-text-color); }",
    ".ddopt[data-active] { background: var(--secondary-background-color); outline: 2px solid var(--primary-color); outline-offset: -2px; }",
    ".ddopt:active { background: var(--divider-color); }",
    ".ddopt[aria-selected=true] { font-weight: 600; } .ddck { flex: none; width: 18px; color: var(--primary-color); visibility: hidden; } .ddopt[aria-selected=true] .ddck { visibility: visible; }",
    ".ddlbl { min-width: 0; overflow-wrap: anywhere; }",
    "@media (prefers-reduced-motion: reduce) { .ddpop { animation: none; } .ddchev { transition: none; } }",
    ".root[data-perf] .ddpop { animation: none; } .root[data-perf] .ddchev { transition: none; }",
    /* Range: accent track and thumb */
    "input[type=range] { -webkit-appearance: none; appearance: none; background: transparent; }",
    "input[type=range]::-webkit-slider-runnable-track { height: 6px; border-radius: 99px; background: var(--divider-color); }",
    "input[type=range]::-moz-range-track { height: 6px; border-radius: 99px; background: var(--divider-color); }",
    "input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 24px; height: 24px; margin-top: -9px; border-radius: 50%; background: var(--primary-color); border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }",
    "input[type=range]::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: var(--primary-color); border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }",
    "input[type=range]:focus-visible { outline: none; } input[type=range]:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--primary-color); outline-offset: 3px; } input[type=range]:focus-visible::-moz-range-thumb { outline: 2px solid var(--primary-color); outline-offset: 3px; }",
    /* Checkboxes become toggle switches */
    ".chk input[type=checkbox], .sw-row input[type=checkbox] { -webkit-appearance: none; appearance: none; width: 46px; height: 28px; border-radius: 99px; background: var(--divider-color); position: relative; cursor: pointer; flex: none; transition: background .15s ease; margin: 0; border: 0; }",
    ".chk input[type=checkbox]::after, .sw-row input[type=checkbox]::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.35); transition: transform .15s ease; }",
    ".chk input[type=checkbox]:checked, .sw-row input[type=checkbox]:checked { background: var(--primary-color); }",
    ".chk input[type=checkbox]:checked::after, .sw-row input[type=checkbox]:checked::after { transform: translateX(18px); }",
    ".chk input[type=checkbox]:focus-visible, .sw-row input[type=checkbox]:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }",
    "@media (prefers-reduced-motion: reduce) { .chk input[type=checkbox], .chk input[type=checkbox]::after, .sw-row input[type=checkbox], .sw-row input[type=checkbox]::after { transition: none; } }",
    ".chk input[type=checkbox]:disabled { opacity: .5; }",
    "input[type=color] { -webkit-appearance: none; appearance: none; } input[type=color]::-webkit-color-swatch-wrapper { padding: 0; } input[type=color]::-webkit-color-swatch { border: 0; border-radius: 6px; } input[type=color]::-moz-color-swatch { border: 0; border-radius: 6px; }",
    "input[type=number] { -moz-appearance: textfield; } input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }",
    "input[type=text], input[type=number], input[type=time], textarea { -webkit-appearance: none; appearance: none; }",
    "input[type=text]:focus-visible, input[type=number]:focus-visible, input[type=time]:focus-visible, textarea:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; border-color: var(--primary-color); }",
    "input[type=text], input[type=number], input[type=time], textarea { font: inherit; min-height: 44px; width: 100%; padding: 8px 10px; border: 1px solid var(--divider-color); border-radius: 8px; background: var(--secondary-background-color); color: var(--primary-text-color); }",
    "input[aria-invalid=true] { border-color: var(--error-color, #c62828); }",
    "textarea { min-height: 120px; font-family: var(--code-font-family, monospace); font-size: 12px; resize: vertical; }",
    "input[type=range] { width: 100%; height: 44px; margin: 0; accent-color: var(--primary-color); flex: 1; min-width: 0; }",
    ".rng { display: flex; align-items: center; gap: 8px; } .rng input[type=number] { width: 76px; flex: none; text-align: right; }",
    ".colr { display: flex; align-items: center; gap: 6px; }",
    ".colr input[type=color] { width: 48px; height: 44px; padding: 3px; flex: none; border: 1px solid var(--divider-color); border-radius: 8px; background: var(--secondary-background-color); cursor: pointer; }",
    ".colr input[type=text] { flex: 1; min-width: 0; font-family: var(--code-font-family, monospace); }",
    ".colr .rst { width: 44px; height: 44px; flex: none; border: 1px solid var(--divider-color); border-radius: 8px; background: transparent; color: var(--secondary-text-color); cursor: pointer; font-size: 18px; }",
    ".recent { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--secondary-text-color); margin: 0 0 10px; }",
    ".recent button { width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--divider-color); cursor: pointer; padding: 0; }",
    ".chk { flex-direction: row; align-items: center; gap: 10px; min-height: 44px; }",
    ".chk input { width: 24px; height: 24px; accent-color: var(--primary-color); flex: none; }",
    ".chk label { font-size: 14px; color: var(--primary-text-color); }",
    ".row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }",
    ".btn { font: inherit; min-height: 44px; padding: 8px 16px; border-radius: 10px; border: 1px solid var(--divider-color); background: var(--secondary-background-color); color: var(--primary-text-color); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }",
    ".btn.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); font-weight: 600; }",
    ".btn.danger { border-color: var(--error-color, #c62828); color: var(--error-color, #c62828); }",
    ".btn[disabled] { opacity: .45; cursor: default; }",
    ".seg { display: inline-flex; border: 1px solid var(--divider-color); border-radius: 10px; overflow: hidden; }",
    ".seg button { font: inherit; min-height: 40px; padding: 4px 12px; border: 0; background: transparent; color: var(--secondary-text-color); cursor: pointer; }",
    ".seg button[aria-pressed=true] { background: var(--primary-color); color: var(--text-primary-color, #fff); }",
    "details.grp { background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 12px; padding: 0 16px; }",
    "details.grp > summary { cursor: pointer; min-height: 52px; display: flex; flex-direction: column; justify-content: center; list-style: none; }",
    "details.grp > summary::-webkit-details-marker { display: none; }",
    "details.grp > summary b { font-weight: 600; font-size: 15px; } details.grp > summary span { font-size: 12.5px; color: var(--secondary-text-color); }",
    "details.grp[open] > summary { border-bottom: 1px solid var(--divider-color); margin-bottom: 12px; }",
    "details.grp .fields { padding: 0 0 16px; }",
    ".panelbody { padding-bottom: 14px; display: flex; flex-direction: column; gap: 12px; }",
    ".root[data-level=simple] .adv { display: none !important; }",
    ".level { display: inline-flex; }",
    ".note { margin: 0; font-size: 12.5px; color: var(--secondary-text-color); }",
    ".dirty-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--warning-color, #f59e0b); flex: none; }",
    ".dirty-dot[data-clean] { background: var(--success-color, #2e7d32); }",
    "pre.yaml { margin: 8px 0 0; padding: 12px; border-radius: 10px; background: var(--secondary-background-color); color: var(--primary-text-color); font-family: var(--code-font-family, monospace); font-size: 11.5px; line-height: 1.5; overflow: auto; max-height: 360px; tab-size: 2; }",
    "details.yamlbox > summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; font-weight: 500; }",
    /* Action bar and toasts */
    ".actionbar { position: sticky; bottom: 0; z-index: 8; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 16px; padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); background: var(--card-background-color); border-top: 1px solid var(--divider-color); }",
    ".actionbar .state { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 120px; font-size: 13px; color: var(--secondary-text-color); }",
    ".toasts { position: fixed; left: 12px; right: 12px; bottom: calc(76px + env(safe-area-inset-bottom, 0px)); z-index: 30; display: flex; justify-content: center; pointer-events: none; }",
    ".toast { pointer-events: auto; max-width: 560px; width: 100%; padding: 12px 14px; border-radius: 12px; background: var(--primary-text-color); color: var(--primary-background-color); box-shadow: 0 6px 24px rgba(0,0,0,.35); font-size: 14px; overflow-wrap: anywhere; display: flex; gap: 10px; align-items: flex-start; }",
    ".toast.ok { border-left: 6px solid var(--success-color, #2e7d32); } .toast.err { border-left: 6px solid var(--error-color, #c62828); } .toast.warn { border-left: 6px solid var(--warning-color, #f59e0b); }",
    ".toast button { margin-left: auto; background: transparent; border: 0; color: inherit; font-size: 18px; cursor: pointer; min-width: 32px; min-height: 32px; }",
    ".banner { padding: 12px 14px; border-radius: 10px; margin: 0 0 12px; background: var(--secondary-background-color); border: 1px solid var(--divider-color); }",
    ".banner.err { border-color: var(--error-color, #c62828); }",
    /* Tour, Looks, automations */
    ".tour { margin: 0 0 12px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--primary-color); background: var(--card-background-color); }",
    ".tour h3 { margin: 0 0 6px; font-size: 15px; } .tour p { margin: 0 0 10px; font-size: 13px; color: var(--secondary-text-color); }",
    ".looklist { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }",
    ".lookcard { text-align: left; font: inherit; color: inherit; cursor: pointer; border: 2px solid var(--divider-color); border-radius: 12px; padding: 10px; background: var(--secondary-background-color); min-height: 44px; display: flex; flex-direction: column; gap: 6px; }",
    ".lookcard[aria-current=true] { border-color: var(--primary-color); }",
    ".lookcard .sw3 { display: flex; height: 22px; border-radius: 6px; overflow: hidden; border: 1px solid var(--divider-color); } .lookcard .sw3 i { flex: 1; }",
    ".sw-row { display: flex; align-items: center; gap: 10px; min-height: 44px; } .sw-row input { width: 24px; height: 24px; accent-color: var(--primary-color); }",
    ".card2 { border: 1px solid var(--divider-color); border-radius: 10px; padding: 10px; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); align-items: end; }",
    ".card2 .full { grid-column: 1 / -1; }",
    ".stack { display: flex; flex-direction: column; gap: 10px; }",
    ".big-status { font-size: 16px; font-weight: 600; } .why { color: var(--secondary-text-color); font-size: 13px; }",
    "ul.log { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow: auto; font-size: 12.5px; font-family: var(--code-font-family, monospace); }",
    "ul.log li { padding: 4px 0; border-bottom: 1px solid var(--divider-color); overflow-wrap: anywhere; }",
    ".swatches { display: flex; flex-wrap: wrap; gap: 10px; }",
    ".pal { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--divider-color); border-radius: 10px; background: var(--secondary-background-color); cursor: pointer; font: inherit; color: inherit; min-height: 44px; }",
    ".pal .strip { display: flex; gap: 3px; height: 54px; width: 150px; } .pal .strip i { display: block; border-radius: 5px; border: 1px solid var(--divider-color); font-style: normal; font-size: 10px; text-align: center; line-height: 22px; } .pal .strip .sb { width: 30px; padding: 4px 0; } .pal .strip .sb b { display: block; height: 6px; margin: 0 4px; border-radius: 3px; } .pal .strip .col { flex: 1; display: flex; flex-direction: column; gap: 3px; } .pal .strip .col i { flex: 1; } .pal .strip .ac { width: 14px; }",
    ".pal { cursor: default; } .palchecks { margin-bottom: 8px; } .swatches .pal .btn { min-height: 36px; padding: 4px 10px; }",
    ".pal .chips2 { display: flex; gap: 4px; } .pal .chips2 i { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--divider-color); display: block; }",
    "table.ct { width: 100%; border-collapse: collapse; font-size: 13px; } table.ct td, table.ct th { text-align: left; padding: 8px 4px; border-bottom: 1px solid var(--divider-color); }",
    ".badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11.5px; font-weight: 600; background: var(--secondary-background-color); }",
    ".badge.ok { background: var(--success-color, #2e7d32); color: #fff; } .badge.bad { background: var(--error-color, #c62828); color: #fff; } .badge.mid { background: var(--warning-color, #b26a00); color: #fff; }",
    /* Image picker */
    ".picker { border: 2px dashed var(--divider-color); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 10px; }",
    ".picker[data-drag] { border-color: var(--primary-color); background: var(--secondary-background-color); }",
    ".picker .top { display: flex; gap: 12px; align-items: center; }",
    ".picker .thumb { width: 96px; height: 64px; border-radius: 8px; background: var(--secondary-background-color) center / cover no-repeat; border: 1px solid var(--divider-color); flex: none; display: grid; place-items: center; font-size: 11px; color: var(--secondary-text-color); }",
    ".picker .meta { min-width: 0; font-size: 13px; overflow-wrap: anywhere; } .picker .meta small { color: var(--secondary-text-color); display: block; }",
    ".gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; max-height: 260px; overflow: auto; }",
    ".gallery button { padding: 0; border: 2px solid var(--divider-color); border-radius: 8px; overflow: hidden; background: var(--secondary-background-color); cursor: pointer; min-height: 56px; }",
    ".gallery button[aria-pressed=true] { border-color: var(--primary-color); }",
    ".gitem { display: flex; flex-direction: column; gap: 4px; } .gdel { font: inherit; font-size: 12px; min-height: 32px; border: 1px solid var(--error-color, #c62828); color: var(--error-color, #c62828); background: transparent; border-radius: 8px; cursor: pointer; } .gdel[data-armed] { background: var(--error-color, #c62828); color: #fff; }",
    ".upwarn { color: var(--warning-color, #b26a00); }",
    ".gallery img { width: 100%; height: 64px; object-fit: cover; display: block; }",
    ".gallery span { display: block; font-size: 10.5px; padding: 2px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    /* Preview device */
    ".devbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }",
    ".stage { display: flex; justify-content: center; padding: 12px; border: 1px solid var(--divider-color); border-radius: 12px; background: var(--secondary-background-color); overflow: hidden; }",
    ".scaler { position: relative; overflow: hidden; flex: none; }",
    ".devcap { text-align: center; font-size: 12px; color: var(--secondary-text-color); margin: 0; }",
    ".dev { position: absolute; left: 0; top: 0; transform-origin: top left; background: #0b0b0d; display: flex; flex-direction: column; overflow: hidden; }",
    ".dev .chrome { display: none; height: 36px; flex: none; align-items: center; gap: 8px; padding: 0 12px; background: #2b2c30; color: #c9cbd1; font-size: 12px; }",
    ".dev[data-device=desktop] .chrome { display: flex; }",
    ".chrome i { width: 11px; height: 11px; border-radius: 50%; background: #ff5f57; display: block; } .chrome i:nth-child(2) { background: #febc2e; } .chrome i:nth-child(3) { background: #28c840; }",
    ".chrome .url { margin-left: 14px; flex: 0 1 380px; padding: 4px 12px; border-radius: 8px; background: #1b1c1f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".screen { position: relative; flex: 1; min-height: 0; display: flex; overflow: hidden; background: var(--p-bg); color: var(--p-text); font-family: var(--p-font); }",
    ".dev .side { display: none; flex: none; flex-direction: column; gap: 4px; padding: 14px 10px; background: var(--p-sbbg); color: var(--p-sbtext); font-size: 14px; z-index: 3; }",
    ".dev[data-device=desktop] .side, .dev[data-device=tablet][data-orient=landscape] .side { display: flex; width: 256px; }",
    ".dev[data-device=tablet][data-orient=portrait] .side { display: flex; width: 68px; }",
    ".dev[data-device=tablet][data-orient=portrait] .side .tx, .dev[data-device=tablet][data-orient=portrait] .side .brand { display: none; }",
    ".dev[data-view=side][data-device=phone] .side, .dev[data-view=side][data-device=tablet][data-orient=portrait] .side { display: flex; position: absolute; left: 0; top: 0; bottom: 0; width: 260px; box-shadow: 0 0 40px rgba(0,0,0,.45); }",
    ".dev[data-view=side][data-device=tablet][data-orient=portrait] .side .tx, .dev[data-view=side][data-device=tablet][data-orient=portrait] .side .brand { display: inline; }",
    ".side .brand { font-weight: 700; font-size: 15px; padding: 6px 10px 12px; }",
    ".si { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 10px; color: var(--p-sbtext); }",
    ".si .ic { width: 22px; text-align: center; color: var(--p-sbicon); font-style: normal; }",
    ".si.sel { background: var(--p-sbselbg); color: var(--p-sbsel); } .si.sel .ic { color: var(--p-sbsel); }",
    ".content { flex: 1; min-width: 0; display: flex; flex-direction: column; }",
    ".hdr { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: var(--p-hd); color: var(--p-hdtext); font-weight: 600; font-size: 16px; border-bottom: 1px solid var(--p-dv); flex: none; }",
    ".hdr .sp { flex: 1; } .hdr .hi { opacity: .75; font-weight: 400; }",
    ".dev[data-device=desktop] .hdr .menu, .dev[data-device=tablet][data-orient=landscape] .hdr .menu { display: none; }",
    ".main { flex: 1; min-height: 0; padding: 16px; display: flex; flex-direction: column; gap: 12px; overflow: hidden; }",
    ".main h3 { margin: 0 4px; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }",
    ".meta { margin: -6px 4px 0; color: var(--p-text2); font-size: 13px; }",
    ".cards { display: grid; grid-template-columns: repeat(var(--cols, 1), minmax(0, 1fr)); gap: 12px; }",
    ".dev[data-device=phone] { --cols: 1; } .dev[data-device=phone][data-orient=landscape] { --cols: 2; }",
    ".dev[data-device=tablet] { --cols: 2; } .dev[data-device=tablet][data-orient=landscape] { --cols: 3; }",
    ".dev[data-device=desktop] { --cols: 4; }",
    ".pc { background: var(--p-card); border-radius: var(--p-radius); border: var(--p-bw) solid var(--p-bd); box-shadow: var(--p-shadow); -webkit-backdrop-filter: var(--p-filter); backdrop-filter: var(--p-filter); padding: 14px; min-width: 0; }",
    ".chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 2px; }",
    ".chip { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; font-size: 12.5px; background: var(--p-card); border: var(--p-bw) solid var(--p-bd); box-shadow: var(--p-shadow); -webkit-backdrop-filter: var(--p-filter); backdrop-filter: var(--p-filter); }",
    ".dot { width: 14px; height: 14px; border-radius: 50%; flex: none; }",
    ".tile { display: flex; flex-direction: column; gap: 12px; min-height: 96px; }",
    ".tile .top { display: flex; justify-content: space-between; align-items: center; }",
    ".lbl { font-size: 14px; font-weight: 600; } .st { font-size: 12.5px; color: var(--p-text2); }",
    ".ico { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--p-dv); color: var(--p-icoff); }",
    ".ico.light { background: var(--p-iclight); color: #fff; } .ico.act { background: var(--p-icact); color: #fff; }",
    ".sw { width: 46px; height: 28px; border-radius: 99px; background: var(--p-track); position: relative; flex: none; }",
    ".sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 24px; height: 24px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); }",
    ".sw.on { background: var(--p-switch); } .sw.on::after { left: 20px; }",
    ".therm { display: flex; flex-direction: column; gap: 10px; }",
    ".therm .big { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; }",
    ".rule { height: 1px; background: var(--p-dv); border: 0; margin: 2px 0; }",
    ".slider { height: 6px; border-radius: 9px; background: var(--p-track); position: relative; margin: 10px 0 6px; }",
    ".slider i { position: absolute; inset: 0 40% 0 0; background: var(--p-primary); border-radius: 9px; }",
    ".slider b { position: absolute; left: 60%; top: -8px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35); transform: translateX(-50%); }",
    ".bars { display: flex; align-items: flex-end; gap: 6px; height: 56px; }",
    ".bars span { flex: 1; background: var(--p-primary); border-radius: 4px 4px 2px 2px; opacity: .85; }",
    ".btnrow { display: flex; gap: 8px; }",
    ".pbtn { flex: 1; text-align: center; padding: 10px 4px; border-radius: calc(var(--p-radius) * .6); font-size: 13px; font-weight: 600; color: #fff; }",
    ".pbtn.p { background: var(--p-primary); } .pbtn.a { background: var(--p-accent); } .pbtn.e { background: var(--p-error); }",
    ".dev[data-device=phone][data-orient=portrait] .only-wide { display: none; }",
    ".dev[data-device=phone] .only-desk, .dev[data-device=tablet][data-orient=portrait] .only-desk { display: none; }",
    ".pc, .chip { scale: var(--p-cardscale, 1); transition: scale calc(var(--p-dur, 0) * 1ms) var(--p-ease, ease-out); }",
    "@media (hover: hover) { .dev .pc:hover { scale: calc(var(--p-cardscale, 1) * var(--p-hover, 1)); } }",
    ".dev .pc:active { scale: calc(var(--p-cardscale, 1) * var(--p-press, 1)); }",
    ".dev[data-entrance] .pc, .dev[data-entrance] .chip { animation: p-in calc(var(--p-dur, 0) * 2ms) var(--p-ease, ease-out) calc(var(--i, 0) * var(--p-stagger, 0) * 1ms) backwards; }",
    "@keyframes p-fade { from { opacity: 0; } } @keyframes p-fade-up { from { opacity: 0; transform: translateY(14px); } } @keyframes p-scale-in { from { opacity: 0; transform: scale(.94); } }",
    ".dev[data-entrance=fade] .pc, .dev[data-entrance=fade] .chip { animation-name: p-fade; }",
    ".dev[data-entrance=fade-up] .pc, .dev[data-entrance=fade-up] .chip { animation-name: p-fade-up; }",
    ".dev[data-entrance=scale-in] .pc, .dev[data-entrance=scale-in] .chip { animation-name: p-scale-in; }",
    "@media (prefers-reduced-motion: reduce) { .pc, .chip { transition: none !important; animation: none !important; } }",
    ".scrim { display: none; position: absolute; inset: 0; align-items: center; justify-content: center; padding: 20px; background: var(--p-scrim); z-index: 5; }",
    ".dev[data-view=dlg] .scrim { display: flex; }",
    ".dlg { width: 100%; max-width: 360px; background: var(--p-dl); color: var(--p-text); border-radius: calc(var(--p-radius) + 4px); padding: 18px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.35); }",
    ".dlg h4 { margin: 0; font-size: 18px; } .dlg p { margin: 0; font-size: 14px; color: var(--p-text2); }",
    ".fld { padding: 12px; border-radius: 10px; background: var(--p-field); font-size: 14px; color: var(--p-text); }",
    ".dlg .acts { display: flex; justify-content: flex-end; gap: 16px; font-size: 15px; font-weight: 600; color: var(--p-primary); }",
    /* Glass depth in the preview */
    ".dev[data-glass] .pc, .dev[data-glass] .chip { position: relative; isolation: isolate; }",
    ".dev[data-glass] .pc::after, .dev[data-glass] .chip::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: -1; background: linear-gradient(var(--p-angle, 135deg), rgba(255,255,255,calc(var(--p-sheen, .4) * .38)), rgba(255,255,255,0) 46%); box-shadow: inset 0 0 calc(var(--p-glow, .3) * 26px) rgba(255,255,255,calc(var(--p-glow, .3) * .3)); }",
    ".dev[data-glass] .pc::before, .dev[data-glass] .chip::before { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; z-index: 1; background: linear-gradient(var(--p-angle, 135deg), rgba(255,255,255,calc(var(--p-edge, .6) * .95)) 0%, rgba(255,255,255,calc(var(--p-edge, .6) * .28)) 45%, rgba(255,255,255,calc(var(--p-edge, .6) * .06)) 100%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); }",
    /* Wallpaper behind the page and glass chrome (only while data-wall is set) */
    ".root { position: relative; isolation: isolate; min-height: 100%; }",
    ".pagebg { position: fixed; inset: 0; z-index: -1; pointer-events: none; display: none; }",
    ".root[data-wall] .pagebg { display: block; }",
    ".pagectl { display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center; margin: 0 0 8px; font-size: 13px; }",
    ".pagectl .rng { max-width: 360px; flex: 1; min-width: 220px; } .pagectl input[type=range] { height: 32px; }",
    ".root[data-wall] { color: var(--primary-text-color); }",
    ".root[data-wall] .bar, .root[data-wall] .panel, .root[data-wall] details.grp, .root[data-wall] .actionbar, .root[data-wall] .stage, .root[data-wall] .tour, .root[data-wall] .banner, .root[data-wall] .tablist { -webkit-backdrop-filter: blur(16px) saturate(140%); backdrop-filter: blur(16px) saturate(140%); }",
    ".root[data-wall] .bar { background: var(--card-background-color); color: var(--primary-text-color); }",
    ".root[data-wall] .tablist { background: var(--card-background-color); border-radius: 12px; padding: 0 6px; border-bottom: 0; }",
    ".root[data-wall] .stage { background: var(--card-background-color); }",
    ".root[data-wall] .toast { background: var(--card-background-color); color: var(--primary-text-color); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }",
    ".root[data-wall] input[type=text], .root[data-wall] input[type=number], .root[data-wall] textarea { color: var(--primary-text-color); }",
    "@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .root[data-wall] { --card-background-color: var(--zs-glass-solid); } }",
    "@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }"
  ].join("\n");

  var MENU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z"/></svg>';

  // Static device mock (no user data, no external images). Layout is driven by data-* attributes.
  var DEVICE_HTML = [
    '<div class="chrome"><i></i><i></i><i></i><span class="url">homeassistant.local:8123/lovelace/overview</span></div>',
    '<div class="screen">',
    '<aside class="side"><div class="brand">Home Assistant</div>',
    '<div class="si sel"><i class="ic">&#8962;</i><span class="tx">Overview</span></div>',
    '<div class="si"><i class="ic">&#9678;</i><span class="tx">Map</span></div>',
    '<div class="si"><i class="ic">&#8801;</i><span class="tx">Logbook</span></div>',
    '<div class="si"><i class="ic">&#9202;</i><span class="tx">History</span></div>',
    '<div class="si"><i class="ic">&#9889;</i><span class="tx">Energy</span></div>',
    '<div class="si"><i class="ic">&#9881;</i><span class="tx">Settings</span></div></aside>',
    '<div class="content"><div class="hdr"><span class="menu" aria-hidden="true">&#9776;</span><span>Overview</span><span class="sp"></span><span class="hi">&#8981;</span><span class="hi">&#8942;</span></div>',
    '<div class="main"><h3>Living room</h3><p class="meta">4 devices on &middot; 21.5&deg;C</p>',
    '<div class="chips"><span class="chip"><span class="dot" style="background:var(--p-iclight)"></span>Lights</span>',
    '<span class="chip"><span class="dot" style="background:var(--p-primary)"></span>Climate</span>',
    '<span class="chip"><span class="dot" style="background:var(--p-switch)"></span>Secure</span>',
    '<span class="chip"><span class="dot" style="background:var(--p-icact)"></span>Fan</span></div>',
    '<div class="cards">',
    '<div class="pc tile"><div class="top"><span class="ico light">&#9680;</span><span class="sw on"></span></div><div><div class="lbl">Ceiling light</div><div class="st">On &middot; 80%</div></div></div>',
    '<div class="pc tile"><div class="top"><span class="ico">&#9635;</span><span class="sw"></span></div><div><div class="lbl">Television</div><div class="st">Off</div></div></div>',
    '<div class="pc tile only-wide"><div class="top"><span class="ico act">&#10050;</span><span class="sw on"></span></div><div><div class="lbl">Fan</div><div class="st">On &middot; Medium</div></div></div>',
    '<div class="pc tile only-wide"><div class="top"><span class="ico">&#9919;</span><span class="sw"></span></div><div><div class="lbl">Front door</div><div class="st">Locked</div></div></div>',
    '<div class="pc therm"><div style="display:flex;justify-content:space-between"><span class="lbl">Thermostat</span><span class="st">Heating</span></div>',
    '<div class="big">21.5&deg;</div><hr class="rule"><div class="slider"><i></i><b></b></div></div>',
    '<div class="pc"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:10px"><b>Energy today</b><span class="st">7.4 kWh</span></div>',
    '<div class="bars"><span style="height:35%"></span><span style="height:55%"></span><span style="height:42%"></span><span style="height:80%"></span><span style="height:64%"></span><span style="height:92%"></span><span style="height:50%"></span></div></div>',
    '<div class="pc"><div class="lbl" style="margin-bottom:10px">Alarm</div><div class="btnrow"><span class="pbtn p">Arm</span><span class="pbtn a">Away</span><span class="pbtn e">Alarm</span></div></div>',
    '<div class="pc only-desk tabok"><div class="lbl">Now playing</div><div class="st">Evening playlist &middot; Kitchen speaker</div><div class="slider"><i></i><b></b></div></div>',
    '</div></div></div>',
    '<div class="scrim"><div class="dlg"><h4>Turn off all lights?</h4><p>This switches off 4 lights in the Living room.</p>',
    '<div class="fld">Reason (optional)</div><div class="acts"><span>Cancel</span><span>Turn off</span></div></div></div>',
    '</div>'
  ].join("");

  // ----------------------------------------------------- colour and palette helpers
  function rgbOf(hx) { var n = parseInt(hex(hx).slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function toHex(c) {
    return "#" + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? "0" : "") + v.toString(16); }).join("");
  }
  function rgb2hsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, hh = 0, ss = 0;
    if (mx !== mn) {
      var d = mx - mn;
      ss = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) hh = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
      hh /= 6;
    }
    return [hh, ss, l];
  }
  function hsl2rgb(c) {
    var h = c[0], s = c[1], l = c[2];
    if (s === 0) return [l * 255, l * 255, l * 255];
    function f(p, q, t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
  }
  function lumOf(c) {
    var a = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function ratioOf(a, b) {
    var l1 = lumOf(a), l2 = lumOf(b);
    if (l1 < l2) { var t = l1; l1 = l2; l2 = t; }
    return (l1 + 0.05) / (l2 + 0.05);
  }
  function over(fg, a, bg) { return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]; }

  // Median cut: split the box with the most pixels along its widest channel until n boxes.
  function medianCut(px, n) {
    if (!px.length) return [];
    var boxes = [px];
    while (boxes.length < n) {
      var bi = -1, bs = 1;
      boxes.forEach(function (b, i) { if (b.length > bs) { bs = b.length; bi = i; } });
      if (bi < 0) break;
      var box = boxes[bi], ch = 0, best = -1;
      for (var c = 0; c < 3; c++) {
        var lo = 255, hi = 0;
        box.forEach(function (p) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; });
        if (hi - lo > best) { best = hi - lo; ch = c; }
      }
      box.sort(function (a, b) { return a[ch] - b[ch]; });
      var mid = box.length >> 1;
      boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
    }
    return boxes.filter(function (b) { return b.length; }).map(function (b) {
      var s = [0, 0, 0];
      b.forEach(function (p) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; });
      return { rgb: [s[0] / b.length, s[1] / b.length, s[2] / b.length], count: b.length };
    });
  }

  // Up to 5 distinct, reasonably colourful swatches, most prominent first.
  function pickSwatches(boxes) {
    var scored = boxes.map(function (b) {
      var hsl = rgb2hsl(b.rgb);
      return { rgb: b.rgb, score: b.count * (0.35 + hsl[1]) };
    }).sort(function (a, b) { return b.score - a.score; });
    var out = [];
    scored.forEach(function (c) {
      if (out.length >= 5) return;
      var far = out.every(function (o) {
        return Math.abs(o[0] - c.rgb[0]) + Math.abs(o[1] - c.rgb[1]) + Math.abs(o[2] - c.rgb[2]) > 60;
      });
      if (far) out.push(c.rgb);
    });
    // Pad with lightness variants of the first swatch if the wallpaper is nearly flat.
    var i = 0;
    while (out.length && out.length < 5) {
      var hsl = rgb2hsl(out[0]);
      out.push(hsl2rgb([hsl[0], hsl[1], Math.max(0.15, Math.min(0.85, hsl[2] + (++i % 2 ? 0.18 : -0.18) * Math.ceil(i / 2)))]));
    }
    return out;
  }

  // Suggested accent / card / text for one swatch, for the given mode.
  function paletteFor(rgb, dark) {
    var hsl = rgb2hsl(rgb), hue = hsl[0];
    var accent = hsl2rgb([hue, Math.max(0.55, Math.min(0.9, hsl[1] || 0.6)), Math.max(0.5, Math.min(0.62, hsl[2]))]);
    var card, text, text2;
    if (dark) {
      card = hsl2rgb([hue, Math.min(hsl[1], 0.35), 0.16]);
      text = hsl2rgb([hue, 0.2, 0.95]);
      text2 = hsl2rgb([hue, 0.15, 0.72]);
    } else {
      card = hsl2rgb([hue, Math.min(hsl[1], 0.5), 0.97]);
      text = hsl2rgb([hue, 0.3, 0.1]);
      text2 = hsl2rgb([hue, 0.2, 0.35]);
    }
    return { accent: toHex(accent), card: toHex(card), text: toHex(text), text2: toHex(text2) };
  }

  // Average colour of a region of an RGBA pixel buffer: "left" = left 12% strip (sidebar),
  // "top" = top 12% strip (header), "all" = everything. Transparent pixels are skipped.
  function regionAvg(data, w, hgt, region) {
    var x1 = region === "left" ? Math.max(1, Math.round(w * 0.12)) : w;
    var y1 = region === "top" ? Math.max(1, Math.round(hgt * 0.12)) : hgt;
    var sum = [0, 0, 0], n = 0;
    for (var y = 0; y < y1; y++) {
      for (var x = 0; x < x1; x++) {
        var i = (y * w + x) * 4;
        if (data[i + 3] < 128) continue;
        sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n++;
      }
    }
    return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : null;
  }

  function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

  // Whole-Look suggestion from one swatch. ctx = { avg, left, top, cardOp } are the colours
  // behind the cards, sidebar and header. Every text/background pair is nudged to AA
  // (icons to 3:1) against the composited surface, so the result passes the contrast table.
  function fullPalette(rgb, dark, ctx) {
    var p = paletteFor(rgb, dark), hsl = rgb2hsl(rgb), hue = hsl[0], sat = Math.min(hsl[1], 0.35);
    var avg = ctx.avg, left = ctx.left || avg, top = ctx.top || avg;
    var sbBg = hsl2rgb([hue, Math.min(sat, 0.3), dark ? 0.1 : 0.94]);
    var hdBg = hsl2rgb([hue, Math.min(sat, 0.3), dark ? 0.15 : 0.97]);
    var dlBg = hsl2rgb([hue, Math.min(sat, 0.35), dark ? 0.13 : 0.98]);
    var out = {
      accent: p.accent, card: p.card, text: p.text, text2: p.text2,
      sbBg: toHex(sbBg), sbOp: 70, sbText: p.text, sbIcon: p.text2, sbSel: p.accent,
      hdBg: toHex(hdBg), hdOp: 60, hdText: p.text,
      dlBg: toHex(dlBg), dlOp: 92
    };
    var cardEff = over(rgbOf(out.card), (ctx.cardOp || 70) / 100, avg);
    var sbEff = over(sbBg, out.sbOp / 100, left);
    var hdEff = over(hdBg, out.hdOp / 100, top);
    var dlEff = over(dlBg, out.dlOp / 100, avg);
    out.text = fixedText(out.text, cardEff, 4.5);
    out.text = fixedText(out.text, dlEff, 4.5);
    out.text2 = fixedText(out.text2, cardEff, 4.5);
    out.sbText = fixedText(out.sbText, sbEff, 4.5);
    out.sbIcon = fixedText(out.sbIcon, sbEff, 3);
    out.sbSel = fixedText(out.sbSel, sbEff, 4.5);
    out.hdText = fixedText(out.hdText, hdEff, 4.5);
    return out;
  }

  // Nudge lightness of fg until it reaches the target ratio on bg. Returns a hex colour.
  function fixedText(fg, bg, target) {
    var hsl = rgb2hsl(rgbOf(fg)), dir = ratioOf([0, 0, 0], bg) >= ratioOf([255, 255, 255], bg) ? -1 : 1;
    var cur = rgbOf(fg);
    for (var i = 0; i < 60 && ratioOf(cur, bg) < target; i++) {
      hsl[2] = Math.max(0, Math.min(1, hsl[2] + dir * 0.02));
      cur = hsl2rgb(hsl);
      if (hsl[2] <= 0 || hsl[2] >= 1) break;
    }
    if (ratioOf(cur, bg) < target) cur = dir < 0 ? [0, 0, 0] : [255, 255, 255];
    return toHex(cur);
  }

  function badge(r) {
    if (r >= 7) return ["AAA", "ok"];
    if (r >= 4.5) return ["AA", "ok"];
    if (r >= 3) return ["AA large only", "mid"];
    return ["Fail", "bad"];
  }

  var TOUR = [
    ["Looks", "A Look is a complete theme. The Look tab edits one (Light, Dark or Shared settings) and the Looks tab lets you add, duplicate and choose them. Six starters are included."],
    ["Glass and animations", "Open Animations and Glass for the Liquid Glass style, shimmer, ripple and more. Everything is optional and switches off with reduced motion or Performance mode."],
    ["Automations", "The Automations tab changes the Look by time of day, by a device's state, or per person. Test it there and use Pause any time. Save and apply (bottom right) writes your changes."]
  ];
  var MAIN_TABS = [["look", "Look"], ["looks", "Looks"], ["auto", "Automations"], ["anim", "Animations and Glass"], ["share", "Share"]];
  var PREVIEW_TABS = { look: true, looks: true, anim: true };

  // ---------------------------------------------------------------- element
  class ZooshPanel extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._narrow = false;
      this._route = null;
      this._panel = null;
      this._looks = [{ id: "l0local", state: clone(DEFAULT) }];
      this._curId = "l0local";
      this._defaultId = "l0local";
      this._starters = [];
      this._saved = null;
      this._same = {};
      this._undo = [];
      this._redo = [];
      this._lastTag = null;
      this._lastTagAt = 0;
      this._pm = "dark";
      this._view = "dash";
      this._tab = "look";
      this._modeTab = "dark";
      this._level = lsGet("zoosh_level") === "advanced" ? "advanced" : "simple";
      var pv = {};
      try { pv = JSON.parse(lsGet("zoosh_preview") || "{}") || {}; } catch (e) { pv = {}; }
      if (typeof pv !== "object" || Array.isArray(pv)) pv = {};
      this._device = own(DEVICES, pv.device) ? pv.device : "phone";
      this._orient = pv.orient === "landscape" ? "landscape" : "portrait";
      try { this._secState = JSON.parse(lsGet("zoosh_sections") || "{}"); } catch (e) { this._secState = {}; }
      if (!this._secState || typeof this._secState !== "object" || Array.isArray(this._secState)) this._secState = {};
      try { this._recent = (JSON.parse(lsGet("zoosh_recent") || "[]") || []).filter(function (c) { return HEX_RE.test(c); }).slice(0, 8); } catch (e) { this._recent = []; }
      this._lastColour = null;
      this._wallOn = lsGet("zoosh_wall") !== "0";
      var ga = parseInt(lsGet("zoosh_glass"), 10);
      this._glassA = isFinite(ga) && ga >= 30 && ga <= 95 ? ga : 70;
      this._wallBad = {};
      this._pageSig = "";
      this._blobs = { light: null, dark: null };
      this._syncs = [];
      this._pickers = [];
      this._images = [];
      this._bundled = BUNDLED_DEFAULT.slice();
      this._wp = { light: null, dark: null };
      this._swatches = [];
      this._auto = null;
      this._autoLooks = [];
      this._autoTimer = null;
      this._delArmed = false;
      this._toastTimer = null;
      this._busy = false;
      this._rev = 1;
      this._loaded = false;
      this._loadState = "loading";
      this._built = false;
      this._scale = 1;
      this.attachShadow({ mode: "open" });
    }

    // The Look being edited. Assigning replaces its state, so older code paths keep working.
    get _cur() {
      for (var i = 0; i < this._looks.length; i++) if (this._looks[i].id === this._curId) return this._looks[i];
      return this._looks[0];
    }
    get _s() { return this._cur.state; }
    set _s(v) { this._cur.state = v; }

    set hass(v) {
      this._hass = v;
      if (this._built && this._pageBg) this._renderPage();
      if (this._built && !this._loaded) { this._loaded = true; this._load(); }
    }
    get hass() { return this._hass; }
    set narrow(v) { this._narrow = !!v; if (this._menuBtn) this._menuBtn.hidden = !this._narrow; }
    get narrow() { return this._narrow; }
    set route(v) { this._route = v; }
    get route() { return this._route; }
    set panel(v) { this._panel = v; }
    get panel() { return this._panel; }

    connectedCallback() {
      if (!this._built) {
        this._build();
        this._built = true;
        this._refreshLooksSelect();
        this._render();
      }
      var self = this;
      this._onResize = function () { self._fit(); };
      window.addEventListener("resize", this._onResize);
      if (typeof ResizeObserver !== "undefined" && this._stage) {
        this._ro = new ResizeObserver(this._onResize);
        this._ro.observe(this._stage);
      }
      this._fit();
      if (this._hass && !this._loaded) { this._loaded = true; this._load(); }
      if (this._tab === "auto") this._startPoll();
    }

    disconnectedCallback() {
      this._stopPoll();
      if (this._diagTimer) { clearInterval(this._diagTimer); this._diagTimer = null; }
      this._ddClose(false);
      if (this._onResize) window.removeEventListener("resize", this._onResize);
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      ["light", "dark"].forEach(function (m) {
        var b = this._blobs[m];
        if (b && b.url) URL.revokeObjectURL(b.url);
        this._blobs[m] = null;
      }, this);
    }

    // ------------------------------------------------------------- build
    // ---- custom dropdown (replaces every native <select>) -------------------------
    // Returns an element that behaves like a select for this panel's code: .value,
    // .options, .selectedIndex, .add(value, text), .clear(), and a "change" event that
    // fires only when the person picks something.
    _dd(label, id) {
      var self = this, uid = "dd" + (this._ddN = (this._ddN || 0) + 1);
      var txt = h("span", { class: "ddtext" });
      var chev = h("span", { class: "ddchev", "aria-hidden": "true" });
      chev.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'; // static
      var btn = h("button", { type: "button", class: "ddbtn", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": label }, txt, chev);
      var el = h("div", { class: "dd", id: id }, btn);
      var value = "", opts = [];
      var paint = function () {
        var o = opts.filter(function (x) { return x.value === value; })[0];
        txt.textContent = o ? o.text : (opts[0] ? opts[0].text : "");
        btn.setAttribute("aria-label", label + (o ? ": " + o.text : ""));
      };
      Object.defineProperty(el, "value", { get: function () { return value; }, set: function (v) { value = String(v); paint(); } });
      Object.defineProperty(el, "options", { get: function () { return opts; } });
      Object.defineProperty(el, "selectedIndex", { get: function () { for (var i = 0; i < opts.length; i++) if (opts[i].value === value) return i; return -1; } });
      el.add = function (v, t) { opts.push({ value: String(v), text: String(t) }); if (opts.length === 1 && !value) value = String(v); paint(); };
      el.clear = function () { opts = []; value = ""; paint(); if (self._ddCur === el) self._ddClose(false); };
      el._ddOptions = function () { return opts; };
      el._ddPick = function (v) {
        var changed = v !== value;
        value = v; paint();
        if (changed) { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
      };
      el._ddBtn = btn; el._ddUid = uid;
      btn.addEventListener("click", function () { if (self._ddCur === el) self._ddClose(true); else self._ddOpenFor(el); });
      btn.addEventListener("keydown", function (ev) {
        var k = ev.key;
        if (self._ddCur === el) return; // the open list handles keys itself
        if (k === "Enter" || k === " " || k === "ArrowDown" || k === "ArrowUp") { ev.preventDefault(); self._ddOpenFor(el); }
      });
      return el;
    }

    _ddOpenFor(el) {
      var self = this;
      if (this._ddCur) this._ddClose(false);
      var opts = el._ddOptions();
      if (!opts.length) return;
      var pop = h("div", { class: "ddpop", role: "listbox", id: el._ddUid + "-list", tabindex: "-1", "aria-label": el._ddBtn.getAttribute("aria-label") });
      var items = opts.map(function (o, i) {
        var it = h("div", { class: "ddopt", role: "option", id: el._ddUid + "-o" + i, "aria-selected": String(o.value === el.value), "data-v": o.value });
        var ck = h("span", { class: "ddck", "aria-hidden": "true" });
        ck.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'; // static
        it.append(h("span", { class: "ddlbl", text: o.text }), ck);
        it.addEventListener("pointermove", function () { self._ddActive(i); });
        it.addEventListener("click", function (ev) { ev.stopPropagation(); self._ddChoose(i); });
        pop.append(it);
        return it;
      });
      var cur = Math.max(0, el.selectedIndex);
      this._ddCur = el; this._ddItems = items; this._ddPop = pop; this._ddIdx = cur; this._ddTyped = ""; this._ddTypedAt = 0;
      el._ddBtn.setAttribute("aria-expanded", "true");
      el._ddBtn.setAttribute("aria-controls", pop.id);
      el.setAttribute("data-open", "");
      this._rootEl.append(pop);
      this._ddPlace();
      this._ddActive(cur, true);
      this._ddOnKey = function (ev) { self._ddKey(ev); };
      this._ddOnDown = function (ev) {
        var path = ev.composedPath ? ev.composedPath() : [];
        if (path.indexOf(pop) !== -1 || path.indexOf(el) !== -1) return;
        self._ddClose(false);
      };
      this._ddOnAway = function (ev) {
        var path = ev && ev.composedPath ? ev.composedPath() : [];
        if (path.indexOf(pop) !== -1) return; // scrolling inside the list is fine
        self._ddClose(false);
      };
      document.addEventListener("keydown", this._ddOnKey, true);
      document.addEventListener("pointerdown", this._ddOnDown, true);
      window.addEventListener("scroll", this._ddOnAway, true);
      window.addEventListener("resize", this._ddOnAway);
      el._ddBtn.focus();
    }

    // Position with fixed coordinates; flip above when there is not enough room below.
    _ddPlace() {
      var el = this._ddCur, pop = this._ddPop;
      if (!el || !pop) return;
      var r = el._ddBtn.getBoundingClientRect();
      var vh = window.innerHeight || 800, vw = window.innerWidth || 400, gap = 6, margin = 8;
      var want = Math.min(pop.scrollHeight || 44 * this._ddItems.length, 320);
      var below = vh - r.bottom - gap - margin, above = r.top - gap - margin;
      var up = below < Math.min(want, 160) && above > below;
      var maxH = Math.max(88, Math.min(320, up ? above : below));
      var width = Math.max(r.width, 180);
      var left = Math.max(margin, Math.min(r.left, vw - width - margin));
      var st = pop.style;
      st.left = Math.round(left) + "px";
      st.width = Math.round(Math.min(width, vw - margin * 2)) + "px";
      st.maxHeight = Math.round(maxH) + "px";
      if (up) { st.top = ""; st.bottom = Math.round(vh - r.top + gap) + "px"; pop.setAttribute("data-up", ""); }
      else { st.bottom = ""; st.top = Math.round(r.bottom + gap) + "px"; pop.removeAttribute("data-up"); }
    }

    _ddActive(i, scroll) {
      var items = this._ddItems;
      if (!items || !items.length) return;
      i = Math.max(0, Math.min(items.length - 1, i));
      this._ddIdx = i;
      items.forEach(function (it, j) { if (j === i) it.setAttribute("data-active", ""); else it.removeAttribute("data-active"); });
      this._ddCur._ddBtn.setAttribute("aria-activedescendant", items[i].id);
      if (scroll !== false && items[i].scrollIntoView) { try { items[i].scrollIntoView({ block: "nearest" }); } catch (e) { /* ignore */ } }
    }

    _ddChoose(i) {
      var el = this._ddCur, o = el && el._ddOptions()[i];
      if (!o) return;
      this._ddClose(true);
      el._ddPick(o.value);
    }

    _ddKey(ev) {
      var k = ev.key, n = this._ddItems.length;
      if (k === "Tab") { this._ddClose(false); return; }
      var handled = true;
      if (k === "Escape") { this._ddClose(true); }
      else if (k === "ArrowDown") this._ddActive(Math.min(n - 1, this._ddIdx + 1));
      else if (k === "ArrowUp") this._ddActive(Math.max(0, this._ddIdx - 1));
      else if (k === "Home") this._ddActive(0);
      else if (k === "End") this._ddActive(n - 1);
      else if (k === "Enter" || k === " ") this._ddChoose(this._ddIdx);
      else if (k.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        var now = Date.now();
        this._ddTyped = (now - this._ddTypedAt > 700 ? "" : this._ddTyped) + k.toLowerCase();
        this._ddTypedAt = now;
        var opts = this._ddCur._ddOptions(), start = this._ddTyped.length === 1 ? this._ddIdx + 1 : this._ddIdx;
        for (var j = 0; j < n; j++) {
          var idx = (start + j) % n;
          if (opts[idx].text.replace(/^\u2605 /, "").toLowerCase().indexOf(this._ddTyped) === 0) { this._ddActive(idx); break; }
        }
      } else handled = false;
      if (handled) { ev.preventDefault(); ev.stopPropagation(); }
    }

    _ddClose(refocus) {
      var el = this._ddCur;
      if (!el) return;
      document.removeEventListener("keydown", this._ddOnKey, true);
      document.removeEventListener("pointerdown", this._ddOnDown, true);
      window.removeEventListener("scroll", this._ddOnAway, true);
      window.removeEventListener("resize", this._ddOnAway);
      this._ddOnKey = this._ddOnDown = this._ddOnAway = null;
      if (this._ddPop && this._ddPop.parentNode) this._ddPop.parentNode.removeChild(this._ddPop);
      el._ddBtn.setAttribute("aria-expanded", "false");
      el._ddBtn.removeAttribute("aria-activedescendant");
      el._ddBtn.removeAttribute("aria-controls");
      el.removeAttribute("data-open");
      this._ddCur = null; this._ddItems = null; this._ddPop = null;
      if (refocus) el._ddBtn.focus();
    }

    // A tab strip with proper roles and arrow-key support.
    _tablist(label, tabs, current, onPick, cls) {
      var list = h("div", { class: "tablist" + (cls ? " " + cls : ""), role: "tablist", "aria-label": label });
      var btns = [];
      tabs.forEach(function (t) {
        var b = h("button", { type: "button", role: "tab", "data-v": t[0], "aria-selected": String(t[0] === current), tabindex: t[0] === current ? "0" : "-1", text: t[1] });
        b.addEventListener("click", function () { pick(t[0]); });
        b.addEventListener("keydown", function (ev) {
          var i = btns.indexOf(b), n = -1;
          if (ev.key === "ArrowRight") n = (i + 1) % btns.length;
          else if (ev.key === "ArrowLeft") n = (i - 1 + btns.length) % btns.length;
          else if (ev.key === "Home") n = 0;
          else if (ev.key === "End") n = btns.length - 1;
          if (n >= 0) { ev.preventDefault(); btns[n].focus(); pick(tabs[n][0]); }
        });
        btns.push(b);
        list.append(b);
      });
      function pick(v) {
        btns.forEach(function (x) {
          var on = x.getAttribute("data-v") === v;
          x.setAttribute("aria-selected", String(on));
          x.tabIndex = on ? 0 : -1;
        });
        onPick(v);
      }
      list.select = function (v) {
        btns.forEach(function (x) { var on = x.getAttribute("data-v") === v; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; });
      };
      return list;
    }

    _build() {
      var self = this, root = this.shadowRoot;
      var style = document.createElement("style");
      style.textContent = STYLE_CSS;

      var menuBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Toggle sidebar", onclick: function () {
        self.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
      } });
      menuBtn.innerHTML = MENU_SVG; // static markup
      menuBtn.hidden = !this._narrow;
      this._menuBtn = menuBtn;
      this._looksSel = this._dd("Look being edited");
      this._looksSel.addEventListener("change", function () { self._selectLook(self._looksSel.value); });
      var bar = h("div", { class: "bar" }, menuBtn, h("h1", { text: "Zoosh" }),
        h("div", { class: "looksel" }, h("span", { class: "note", text: "Look:" }), this._looksSel));

      this._tabsEl = this._tablist("Sections", MAIN_TABS, this._tab, function (v) { self._setTab(v); });
      this._banner = h("div", { class: "banner", hidden: true, role: "status" });

      this._tour = h("div", { class: "tour", hidden: true, role: "dialog", "aria-label": "Welcome to Zoosh" });
      this._tourStep = 0;
      this._renderTour();

      this._status = h("div", { class: "toast", role: "status", "aria-live": "polite", hidden: true });
      this._toasts = h("div", { class: "toasts" }, this._status);

      this._panes = {
        look: this._buildLookTab(), looks: this._buildLooksTab(), auto: this._buildAuto(),
        anim: this._buildAnimTab(), share: this._buildShareTab()
      };
      var controls = h("div", { class: "col" });
      Object.keys(this._panes).forEach(function (k) {
        var p = self._panes[k];
        p.setAttribute("role", "tabpanel");
        p.hidden = k !== self._tab;
        controls.append(p);
      });
      this._previewCol = this._buildPreview();
      this._layout = h("div", { class: "layout" }, controls, this._previewCol);
      this._fab = h("button", { class: "fab", type: "button", "aria-expanded": "false", onclick: function () { self._togglePreview(); } }, "Preview");

      this._undoBtn = h("button", { class: "btn", type: "button", "aria-label": "Undo", onclick: function () { self._undoStep(); } }, "Undo");
      this._redoBtn = h("button", { class: "btn", type: "button", "aria-label": "Redo", onclick: function () { self._redoStep(); } }, "Redo");
      this._resetBtn = h("button", { class: "btn", type: "button", onclick: function () { self._resetSaved(); } }, "Reset");
      this._saveBtn = h("button", { class: "btn primary", type: "button", onclick: function () { self._save(); } }, "Save and apply");
      this._dot = h("span", { class: "dirty-dot", "data-clean": "" });
      this._dirty = h("span", { text: "Loading..." });
      var actionbar = h("div", { class: "actionbar" },
        h("div", { class: "state" }, this._dot, this._dirty), this._undoBtn, this._redoBtn, this._resetBtn, this._saveBtn);

      this._pageBg = h("div", { class: "pagebg", "aria-hidden": "true" });
      this._rootEl = h("div", { class: "root", "data-level": this._level });
      this._rootEl.append(this._pageBg);
      this._rootEl.append(bar,
        h("div", { class: "wrap" }, this._tour, this._banner, this._pageCtl(), this._tabsEl, this._layout),
        actionbar, this._toasts, this._fab);
      root.append(style, this._rootEl);
      if (!lsGet(TOUR_KEY)) this._tour.hidden = false;
      this._setTab(this._tab);
    }

    _renderTour() {
      var self = this, i = this._tourStep, t = TOUR[i];
      this._tour.textContent = "";
      this._tour.append(
        h("h3", { text: "Welcome to Zoosh (" + (i + 1) + " of " + TOUR.length + "): " + t[0] }),
        h("p", { text: t[1] }),
        h("div", { class: "row" },
          i < TOUR.length - 1
            ? h("button", { class: "btn primary", type: "button", onclick: function () { self._tourStep++; self._renderTour(); } }, "Next")
            : h("button", { class: "btn primary", type: "button", onclick: function () { self._endTour(); } }, "Done"),
          h("button", { class: "btn", type: "button", onclick: function () { self._endTour(); } }, "Skip tour"))
      );
    }

    _endTour() { lsSet(TOUR_KEY, "1"); this._tour.hidden = true; }

    // ---- page wallpaper and glass chrome
    _pageCtl() {
      var self = this;
      var chk = h("input", { type: "checkbox", id: "wallchk", checked: this._wallOn });
      chk.addEventListener("change", function () { self._wallOn = chk.checked; lsSet("zoosh_wall", chk.checked ? "1" : "0"); self._renderPage(); });
      var rng = h("input", { type: "range", min: 30, max: 95, step: 1, value: this._glassA, "aria-label": "Panel glass opacity" });
      var out = h("span", { class: "note", text: this._glassA + "%" });
      rng.addEventListener("input", function () {
        var v = Math.max(30, Math.min(95, Math.round(Number(rng.value)) || 70));
        self._glassA = v; out.textContent = v + "%"; lsSet("zoosh_glass", String(v)); self._renderPage();
      });
      this._wallChk = chk; this._glassRng = rng;
      return h("div", { class: "pagectl" },
        h("div", { class: "f chk" }, chk, h("label", { for: "wallchk", text: "Show wallpaper behind this page" })),
        h("div", { class: "rng" }, h("label", { class: "note", text: "Panel glass opacity" }), rng, out));
    }

    // Which mode paints the page: the Light or Dark tab while editing, else Home Assistant's own.
    _pageMode() {
      if (this._tab === "look" && (this._modeTab === "light" || this._modeTab === "dark")) return this._modeTab;
      var dm = this._hass && this._hass.themes ? this._hass.themes.darkMode : undefined;
      if (typeof dm === "boolean") return dm ? "dark" : "light";
      try { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (e) { return "dark"; }
    }

    _renderPage() {
      if (!this._pageBg) return;
      var s = this._s, m = this._pageMode(), c = s[m];
      var src = s.bgType === "image" ? safeUrl(this._previewSrc(m)) : "";
      if (src && this._wallBad[src] === undefined) this._probeWall(src);
      var on = this._wallOn && !(src && this._wallBad[src] === true);
      var root = this._rootEl;
      if (!on) {
        this._pageSig = "";
        root.removeAttribute("data-wall");
        ["--zs-ink", "--zs-ink2", "--primary-text-color", "--secondary-text-color", "--card-background-color", "--secondary-background-color", "--divider-color", "--zs-glass-solid"].forEach(function (k) { root.style.removeProperty(k); });
        this._pageBg.style.cssText = "";
        return;
      }
      if (src) this._ensureWallpaper(m);
      var dark = m === "dark", back = this._backdrop(m);
      // Glass surface: tinted translucent base. Raise its opacity (a scrim) until text reaches AA.
      var base = dark ? [18, 18, 22] : [255, 255, 255], ink = dark ? [255, 255, 255] : [17, 17, 20];
      var a = this._glassA / 100;
      while (a < 0.96 && ratioOf(ink, over(base, a, back)) < 4.5) a += 0.05;
      a = Math.min(a, 0.96);
      var sig = [m, s.bgType, src, c.bg, c.bg2, c.dim, s.imgFit, s.imgPos, a.toFixed(2)].join("|");
      if (sig === this._pageSig) return;
      this._pageSig = sig;
      var st = this._pageBg.style;
      st.cssText = "";
      var color = hex(c.bg);
      if (s.bgType === "gradient") {
        st.setProperty("background-image", "linear-gradient(160deg, " + hex(c.bg) + " 0%, " + hex(c.bg2) + " 100%)");
      } else if (src) {
        var layers = "";
        if (c.dim > 0) { var d = alpha(Math.max(0, Math.min(80, Number(c.dim) || 0)) / 100); layers = "linear-gradient(rgba(0,0,0," + d + "), rgba(0,0,0," + d + ")), "; }
        st.setProperty("background-image", layers + 'url("' + src + '")');
        st.setProperty("background-size", s.imgFit === "contain" ? "contain" : "cover");
        st.setProperty("background-position", ["top", "bottom"].indexOf(s.imgPos) !== -1 ? s.imgPos : "center");
        st.setProperty("background-repeat", "no-repeat");
      }
      st.setProperty("background-color", color);
      var rgbA = function (c3, al) { return "rgba(" + Math.round(c3[0]) + "," + Math.round(c3[1]) + "," + Math.round(c3[2]) + "," + al + ")"; };
      var rs = root.style;
      rs.setProperty("--zs-ink", toHex(ink));
      rs.setProperty("--primary-text-color", toHex(ink));
      rs.setProperty("--secondary-text-color", rgbA(ink, "0.78"));
      rs.setProperty("--card-background-color", rgbA(base, a.toFixed(2)));
      rs.setProperty("--zs-glass-solid", rgbA(base, "0.94"));
      rs.setProperty("--secondary-background-color", rgbA(dark ? [255, 255, 255] : [0, 0, 0], dark ? "0.10" : "0.06"));
      rs.setProperty("--divider-color", rgbA(ink, "0.22"));
      root.setAttribute("data-wall", m);
    }

    // Probe the wallpaper once; if it cannot load, fall back to the Home Assistant background.
    _probeWall(src) {
      var self = this;
      this._wallBad[src] = false;
      try {
        var img = new Image();
        img.onerror = function () { self._wallBad[src] = true; self._pageSig = ""; self._renderPage(); };
        img.src = src;
      } catch (e) { /* ignore */ }
    }

    _setTab(v) {
      this._tab = v;
      var self = this;
      Object.keys(this._panes).forEach(function (k) { self._panes[k].hidden = k !== v; });
      this._tabsEl.select(v);
      if (this._layout) {
        if (PREVIEW_TABS[v]) this._layout.removeAttribute("data-nopreview"); else this._layout.setAttribute("data-nopreview", "");
      }
      if (v === "auto") { this._openAuto(); this._startPoll(); } else this._stopPoll();
      if (v === "share") { this._refreshDiag(); if (!this._diagTimer) { var me = this; this._diagTimer = setInterval(function () { if (!document.hidden) me._refreshDiag(); }, 2000); } }
      else if (this._diagTimer) { clearInterval(this._diagTimer); this._diagTimer = null; }
      if (PREVIEW_TABS[v]) this._fit();
      this._renderPage();
    }

    // Selecting a mode tab edits that mode and shows it in the preview.
    _setMode(v) {
      this._modeTab = v;
      this._modeTabs.select(v);
      var self = this;
      ["light", "dark", "shared"].forEach(function (k) { self._modePanes[k].hidden = k !== v; });
      if (v === "light" || v === "dark") {
        this._pm = v;
        this._previewMode.select(v);
        this._modePanes[v].append(this._palSection);
        this._renderSwatches();
        this._render();
      }
      this._renderPage();
    }

    _setLevel(v) {
      this._level = v;
      lsSet("zoosh_level", v);
      this._rootEl.setAttribute("data-level", v);
      this._levelSeg.select(v);
    }

    _togglePreview() {
      var open = !this._previewCol.hasAttribute("data-open");
      if (open) this._previewCol.setAttribute("data-open", ""); else this._previewCol.removeAttribute("data-open");
      this._fab.setAttribute("aria-expanded", String(open));
      this._fab.textContent = open ? "Close preview" : "Preview";
      if (open) this._fit();
    }

    // ---- Look tab (Light | Dark | Shared)
    _buildLookTab() {
      var self = this;
      this._levelSeg = this._seg("Detail level", [["simple", "Simple"], ["advanced", "Advanced"]], this._level, function (v) { self._setLevel(v); });
      this._recentRow = h("div", { class: "recent" });
      this._renderRecent();
      this._modeTabs = this._tablist("Mode", [["light", "Light"], ["dark", "Dark"], ["shared", "Shared"]], this._modeTab, function (v) { self._setMode(v); }, "modes");

      // Palette and contrast (moved into whichever of Light/Dark is open)
      this._palBox = h("div", { class: "swatches" });
      this._ctBox = h("div");
      this._palNote = h("p", { class: "note" });
      this._palSection = h("details", { class: "grp", "data-sec": "m-palette" },
        h("summary", null, h("b", { text: "Wallpaper colours and contrast" }), h("span", { text: "Suggests colours from your wallpaper and checks that text is readable." })),
        h("div", { class: "panelbody" },
          h("p", { class: "note", text: "Everything runs in your browser; the wallpaper is never uploaded anywhere. Suggestions apply to the mode you are editing." }),
          h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: function () { self._extractPalette(); } }, "Suggest palettes from the wallpaper")),
          this._palNote, this._palBox,
          h("div", { class: "lab", style: "font-weight:600" }, "Contrast check (WCAG)"), this._ctBox));
      this._palSection.open = this._secState["m-palette"] === true;
      this._palSection.addEventListener("toggle", function () { self._secState["m-palette"] = self._palSection.open; lsSet("zoosh_sections", JSON.stringify(self._secState)); });

      this._modePanes = {
        light: this._buildModePane("light"), dark: this._buildModePane("dark"), shared: this._buildSharedPane()
      };
      Object.keys(this._modePanes).forEach(function (k) { self._modePanes[k].hidden = k !== self._modeTab; });
      this._modePanes[this._modeTab === "shared" ? "dark" : this._modeTab].append(this._palSection);
      return h("div", { class: "col" },
        h("div", { class: "row", style: "justify-content:space-between" }, this._modeTabs, this._levelSeg),
        this._recentRow, this._modePanes.light, this._modePanes.dark, this._modePanes.shared);
    }

    _buildSharedPane() {
      var self = this, pane = h("div", { class: "col" });
      pane.append(h("p", { class: "note", text: "These settings apply in both light and dark mode." }));
      SHARED_SECTIONS.forEach(function (g) { pane.append(self._sectionEl(g, undefined, "g")); });
      return pane;
    }

    _buildModePane(mode) {
      var self = this, other = mode === "dark" ? "light" : "dark";
      var tools = h("div", { class: "row" },
        h("button", { class: "btn", type: "button", onclick: function () { self._copyMode(other, mode); } }, "Copy " + (other === "light" ? "Light" : "Dark") + " to " + (mode === "light" ? "Light" : "Dark")));
      if (mode === "dark") {
        tools.append(h("button", { class: "btn", type: "button", onclick: function () { self._matchDark(); } }, "Match dark from light"));
      }
      var pane = h("div", { class: "col" }, tools);
      MODE_SECTIONS.forEach(function (g) { pane.append(self._sectionEl(g, mode, mode)); });
      return pane;
    }

    _sectionEl(def, mode, ctx) {
      var self = this;
      var open = this._secState[def.id] !== undefined ? this._secState[def.id] === true : !!def.open;
      var det = h("details", { class: "grp" + (def.adv ? " adv" : ""), "data-sec": def.id, open: open },
        h("summary", null, h("b", { text: def.title }), h("span", { text: def.help || "" })));
      var body = h("div", { class: "panelbody" });
      if (def.special === "background") body.append(this._bgControls(mode, ctx));
      body.append(this._fieldGrid(def.fields, mode, ctx));
      if (def.special === "background") body.append(this._fieldGrid(BG_FIELDS, undefined, ctx));
      det.append(body);
      det.addEventListener("toggle", function () {
        self._secState[def.id] = det.open;
        lsSet("zoosh_sections", JSON.stringify(self._secState));
        // keep the same section in the other mode pane in step
        Array.prototype.forEach.call(self.shadowRoot.querySelectorAll('details[data-sec="' + def.id + '"]'), function (o) { if (o !== det && o.open !== det.open) o.open = det.open; });
      });
      return det;
    }

    _fieldGrid(defs, mode, ctx) {
      var grid = h("div", { class: "fields" });
      defs.forEach(function (d) { grid.append(this._field(d, mode, ctx)); }, this);
      return grid;
    }

    _bgControls(mode, ctx) {
      var self = this;
      var wrap = h("div", { class: "stack" });
      wrap.append(this._fieldGrid([{ k: "bgType", label: "Background type", type: "select", opts: [["solid", "Solid colour"], ["gradient", "Gradient"], ["image", "Wallpaper image"]] }], undefined, ctx));
      var sameId = "same-" + ctx;
      var sameChk = h("input", { type: "checkbox", id: sameId });
      sameChk.addEventListener("change", function () { self._setSame(sameChk.checked); });
      var sameRow = h("div", { class: "f chk", "data-k": "same" }, sameChk, h("label", { for: sameId, text: "Use the same image for light and dark" }));
      var picker = this._picker(mode);
      var box = h("div", { class: "stack imgbox" }, sameRow, picker.el);
      this._syncs.push(function () { sameChk.checked = self._isSame(); });
      wrap.append(box);
      return wrap;
    }

    // ---- image picker (thumbnail, upload, existing gallery, remove, drag and drop)
    _picker(mode) {
      var self = this;
      var thumb = h("div", { class: "thumb", text: "No image" });
      var nameEl = h("div", { class: "meta" });
      var err = h("div", { class: "err", role: "alert" });
      var gallery = h("div", { class: "gallery", hidden: true });
      var file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", style: "position:absolute;opacity:0;width:1px;height:1px;pointer-events:none", tabindex: "-1", "aria-hidden": "true" });
      var el = h("div", { class: "picker", "data-mode": mode });
      var target = function () { return self._isSame() ? "both" : mode; };
      var up = h("button", { class: "btn", type: "button", onclick: function () { file.click(); } }, "Upload");
      var choose = h("button", { class: "btn", type: "button", "aria-expanded": "false", onclick: function () {
        gallery.hidden = !gallery.hidden;
        choose.setAttribute("aria-expanded", String(!gallery.hidden));
        api.fillGallery();
      } }, "Choose existing");
      var remove = h("button", { class: "btn", type: "button", onclick: function () { self._setImage(target(), "", true); } }, "Remove");
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        file.value = "";
        if (f) self._upload(target(), f, api);
      });
      ["dragenter", "dragover"].forEach(function (n) { el.addEventListener(n, function (ev) { ev.preventDefault(); el.setAttribute("data-drag", ""); }); });
      el.addEventListener("dragleave", function () { el.removeAttribute("data-drag"); });
      el.addEventListener("drop", function (ev) {
        ev.preventDefault();
        el.removeAttribute("data-drag");
        var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (f) self._upload(target(), f, api);
        else api.error("Drop an image file (JPEG, PNG or WebP).");
      });
      el.append(h("div", { class: "top" }, thumb, nameEl),
        h("div", { class: "row" }, up, choose, remove, file),
        h("p", { class: "note", text: "Or drop an image here." }),
        h("p", { class: "note upwarn", text: UPLOAD_WARNING }), err, gallery);
      var api = {
        el: el, mode: mode,
        error: function (m) { err.textContent = m || ""; },
        refresh: function () {
          var src = self._previewSrc(mode), p = self._s[mode].img;
          thumb.style.backgroundImage = src ? "url('" + src + "')" : "";
          thumb.textContent = src ? "" : "No image";
          nameEl.textContent = "";
          if (p) {
            var blob = self._blobs[mode];
            nameEl.append(h("b", { text: p.split("/").pop() }),
              h("small", { text: p.indexOf(BUNDLED_URL) === 0 ? "Included with Zoosh" : blob && blob.path === p && blob.size ? (blob.size / 1024 < 1024 ? Math.round(blob.size / 1024) + " KB" : (blob.size / 1048576).toFixed(1) + " MB") + " (just uploaded)" : "Stored on your Home Assistant" }));
          } else {
            nameEl.append(h("b", { text: "No wallpaper chosen" }), h("small", { text: "Upload one or choose an existing file" }));
          }
          api.fillGallery();
        },
        fillGallery: function () {
          if (gallery.hidden) return;
          gallery.textContent = "";
          var add = function (title, list, prefix, label) {
            gallery.append(h("p", { class: "note gtitle", style: "grid-column:1/-1;margin:4px 0 0;font-weight:600", text: title }));
            list.forEach(function (n) {
              var path = prefix + n;
              var img = h("img", { src: path, alt: "", loading: "lazy" });
              gallery.append(h("button", { type: "button", "data-included": prefix === BUNDLED_URL ? "1" : null, "aria-label": "Use " + (label ? label[n] || n : n), "aria-pressed": String(self._s[mode].img === path), onclick: function () { self._setImage(target(), path, true); } }, img, h("span", { text: label ? label[n] || n : n })));
            });
          };
          add("Included with Zoosh", self._bundled, BUNDLED_URL, BUNDLED_LABEL);
          if (!self._images.length) gallery.append(h("p", { class: "note", style: "grid-column:1/-1", text: "Your uploads: none yet. Upload one." }));
          else {
            gallery.append(h("p", { class: "note gtitle", style: "grid-column:1/-1;margin:4px 0 0;font-weight:600", text: "Your uploads" }));
            self._images.forEach(function (n) {
              var path = "/local/wallpapers/" + n;
              var img = h("img", { src: path, alt: "", loading: "lazy" });
              var pick = h("button", { type: "button", "aria-label": "Use " + n, "aria-pressed": String(self._s[mode].img === path), onclick: function () { self._setImage(target(), path, true); } }, img, h("span", { text: n }));
              if (!UPLOAD_NAME_RE.test(n)) { gallery.append(pick); return; }
              var del = h("button", { type: "button", class: "gdel", "aria-label": "Delete " + n, "data-name": n }, "Delete");
              del.addEventListener("click", function () { self._confirmDelete(del, n); });
              gallery.append(h("div", { class: "gitem" }, pick, del));
            });
          }
        }
      };
      this._pickers.push(api);
      return api;
    }

    _isSame() {
      var f = this._same[this._curId];
      if (f !== undefined) return f;
      return this._s.light.img === this._s.dark.img;
    }

    _setSame(on) {
      this._checkpoint();
      this._same[this._curId] = !!on;
      if (on) {
        var from = this._modeTab === "light" ? "light" : "dark";
        var to = from === "light" ? "dark" : "light";
        this._s[to].img = this._s[from].img;
      }
      this._syncAll();
      this._render();
    }

    // Set the wallpaper path for a mode, or both when target is "both".
    _setImage(target, path, announce) {
      this._checkpoint();
      var modes = target === "both" ? ["light", "dark"] : [target];
      modes.forEach(function (m) { this._s[m].img = path; }, this);
      if (path) this._s.bgType = "image";
      this._syncAll();
      this._render();
      if (announce) this._say(path ? "Wallpaper set for " + (modes.length === 2 ? "light and dark" : modes[0]) + " mode." : "Wallpaper removed.", "ok");
    }

    _renderRecent() {
      var self = this;
      this._recentRow.textContent = "";
      if (!this._recent.length) { this._recentRow.hidden = true; return; }
      this._recentRow.hidden = false;
      this._recentRow.append(h("span", { text: "Recent colours:" }));
      this._recent.forEach(function (c) {
        self._recentRow.append(h("button", { type: "button", style: "background:" + c, "aria-label": "Use colour " + c, title: c, onclick: function () {
          if (self._lastColour) self._lastColour.set(c); else self._say("Tap a colour field first, then pick a recent colour.", "warn");
        } }));
      });
    }

    _noteColour(c) {
      c = c.toLowerCase();
      this._recent = [c].concat(this._recent.filter(function (x) { return x !== c; })).slice(0, 8);
      lsSet("zoosh_recent", JSON.stringify(this._recent));
      this._renderRecent();
    }

    _val(path) { return path.mode ? this._s[path.mode][path.k] : this._s[path.k]; }
    _setVal(path, v) { if (path.mode) this._s[path.mode][path.k] = v; else this._s[path.k] = v; }

    _field(d, mode, ctx) {
      var self = this, path = { k: d.k, mode: mode };
      var id = "i-" + (ctx || mode || "g") + "-" + d.k;
      var wrap = h("div", { class: "f" + (d.adv ? " adv" : ""), "data-k": d.k });
      var lab = h("label", { for: id, text: d.label });
      var inp, num, hexIn, rst, errEl = h("span", { class: "err", role: "alert" });
      var tag = (mode || "g") + ":" + d.k;
      var def = mode ? DEFAULT[mode][d.k] : DEFAULT[d.k];
      if (d.type === "select") {
        inp = this._dd(d.label, id);
        d.opts.forEach(function (o) { inp.add(o[0], o[1]); });
        wrap.append(lab, inp);
      } else if (d.type === "check") {
        wrap.className += " chk";
        inp = h("input", { id: id, type: "checkbox" });
        wrap.append(inp, lab);
      } else if (d.type === "range") {
        inp = h("input", { id: id, type: "range", min: d.min, max: d.max, step: 1, "aria-label": d.label });
        num = h("input", { type: "number", min: d.min, max: d.max, step: 1, inputmode: "numeric", "aria-label": d.label + " (number)" });
        wrap.append(lab, h("div", { class: "rng" }, inp, num, h("span", { class: "note", text: d.unit })));
      } else if (d.type === "color") {
        inp = h("input", { id: id, type: "color", "aria-label": d.label + " swatch" });
        hexIn = h("input", { type: "text", maxlength: 7, autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": d.label + " (hex)" });
        rst = h("button", { class: "rst", type: "button", title: "Reset to the default colour", "aria-label": "Reset " + d.label + " to default" }, "↺");
        wrap.append(lab, h("div", { class: "colr" }, inp, hexIn, rst));
      } else {
        inp = h("input", { id: id, type: "text", maxlength: d.maxlength, autocomplete: "off" });
        wrap.append(lab, inp);
      }
      if (d.help) wrap.append(h("span", { class: "hint", text: d.help }));
      wrap.append(errEl);

      var sync = function () {
        var v = self._val(path);
        if (d.type === "check") inp.checked = !!v;
        else if (d.type === "color") { inp.value = hex(v).toLowerCase(); hexIn.value = hex(v).toLowerCase(); hexIn.removeAttribute("aria-invalid"); errEl.textContent = ""; }
        else if (d.type === "range") { inp.value = v; num.value = v; }
        else inp.value = v;
      };
      var commit = function (v) {
        self._checkpoint(tag);
        self._setVal(path, v);
        if (d.k === "name") self._refreshLooksSelect();
        self._render();
      };
      if (d.type === "color") {
        var remember = function () { self._lastColour = { set: function (c) { commit(c); sync(); self._noteColour(c); } }; };
        inp.addEventListener("focus", remember); hexIn.addEventListener("focus", remember);
        inp.addEventListener("input", function () { commit(inp.value); hexIn.value = inp.value; hexIn.removeAttribute("aria-invalid"); errEl.textContent = ""; });
        inp.addEventListener("change", function () { self._noteColour(inp.value); });
        hexIn.addEventListener("input", function () {
          var t = hexIn.value.trim();
          if (/^[0-9a-fA-F]{3,6}$/.test(t)) t = "#" + t;
          if (/^#[0-9a-fA-F]{3}$/.test(t)) t = "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
          if (HEX_RE.test(t)) { hexIn.removeAttribute("aria-invalid"); errEl.textContent = ""; commit(t.toLowerCase()); inp.value = t.toLowerCase(); }
          else { hexIn.setAttribute("aria-invalid", "true"); errEl.textContent = "Use a colour like #AABBCC."; }
        });
        hexIn.addEventListener("change", function () { if (HEX_RE.test(hexIn.value)) self._noteColour(hexIn.value); });
        rst.addEventListener("click", function () { commit(def); sync(); });
      } else if (d.type === "range") {
        var apply = function (raw, from) {
          var v = Math.round(Number(raw));
          if (isNaN(v)) return;
          if (v < d.min || v > d.max) { errEl.textContent = "Choose a value from " + d.min + " to " + d.max + "."; num.setAttribute("aria-invalid", "true"); if (from === "num") return; v = Math.max(d.min, Math.min(d.max, v)); }
          else { errEl.textContent = ""; num.removeAttribute("aria-invalid"); }
          commit(v);
          if (from === "num") inp.value = v; else num.value = v;
        };
        inp.addEventListener("input", function () { apply(inp.value, "range"); });
        num.addEventListener("input", function () { apply(num.value, "num"); });
        num.addEventListener("change", function () { num.value = self._val(path); errEl.textContent = ""; num.removeAttribute("aria-invalid"); });
      } else if (d.type === "check") {
        inp.addEventListener("input", function () { commit(inp.checked); });
      } else {
        inp.addEventListener("input", function () {
          if (d.k === "name") {
            var bad = !NAME_RE.test(inp.value) || inp.value !== inp.value.trim();
            inp.setAttribute("aria-invalid", String(bad));
            errEl.textContent = bad ? "Use 1-40 letters, numbers, spaces, _ or - (no space at the start or end)." : "";
          }
          commit(inp.value);
        });
      }
      this._syncs.push(sync);
      sync();
      return wrap;
    }

    _syncAll() { this._syncs.forEach(function (fn) { fn(); }); }

    // ---- Looks tab
    _buildLooksTab() {
      var self = this;
      this._looksList = h("div", { class: "looklist", role: "list" });
      this._starterSel = this._dd("Add a starter Look");
      this._starterSel.addEventListener("change", function () {
        var i = Number(self._starterSel.value);
        self._starterSel.value = "";
        if (!isNaN(i) && self._starters[i]) self._addLook(self._starters[i]);
      });
      this._delBtn = h("button", { class: "btn danger", type: "button", onclick: function () { self._deleteLook(); } }, "Delete");
      this._applyChk = h("input", { type: "checkbox", id: "applychk", checked: true });
      return h("div", { class: "col" },
        h("section", { class: "panel" }, h("h2", { text: "Your Looks" }),
          h("p", { class: "note", style: "margin-bottom:10px", text: "Tap a Look to edit it. The star marks the default Look, used when no schedule or rule matches. Up to 12 Looks." }),
          this._looksList),
        h("section", { class: "panel" }, h("h2", { text: "Manage" }),
          h("div", { class: "row" },
            h("button", { class: "btn", type: "button", onclick: function () { self._addLook(clone(DEFAULT)); } }, "New Look"),
            h("button", { class: "btn", type: "button", onclick: function () { self._addLook(clone(self._s)); } }, "Duplicate"),
            h("button", { class: "btn", type: "button", onclick: function () { self._setDefault(); } }, "Set as default"),
            this._delBtn, this._starterSel),
          h("div", { class: "f chk", style: "margin-top:8px" }, this._applyChk, h("label", { for: "applychk", text: "When I save, switch the whole house to the Look I am editing" })),
          h("div", { class: "row", style: "margin-top:4px" },
            h("button", { class: "btn", type: "button", onclick: function () { self._applyNow(); } }, "Apply this Look now")),
          h("p", { class: "note", style: "margin-top:8px", text: "Home Assistant can only change the theme for everyone at once, so applying a Look changes it system-wide. Rename a Look in the Look tab, Shared, Name and font." })));
    }

    _renderLooksList() {
      var self = this;
      this._looksList.textContent = "";
      this._looks.forEach(function (l) {
        var s = l.state, m = s[self._pm];
        var card = h("button", { class: "lookcard", type: "button", role: "listitem", "aria-current": String(l.id === self._curId), onclick: function () { self._selectLook(l.id); } },
          h("b", { text: (l.id === self._defaultId ? "★ " : "") + s.name }),
          h("span", { class: "sw3" }, h("i", { style: "background:" + m.bg }), h("i", { style: "background:" + m.card }), h("i", { style: "background:" + s.accent })));
        self._looksList.append(card);
      });
    }

    // ---- Animations and Glass tab
    _buildAnimTab() {
      var self = this;
      return h("div", { class: "col" },
        h("section", { class: "panel" }, h("h2", { text: "Liquid Glass" }), this._fieldGrid(GLASS, undefined, "anim"),
          h("p", { class: "note", style: "margin-top:10px", text: "Approximation of iOS 26 Liquid Glass. Real lens refraction is not available in the Home Assistant app's web view. This layer adds blur, colour richness, a shiny gradient edge, an inner glow and a top sheen using cheap CSS. It needs a wallpaper or gradient behind the cards, and falls back to a solid translucent card where backdrop blur is unsupported." })),
        h("section", { class: "panel" }, h("h2", { text: "Card size and animation" }), this._fieldGrid(ANIM, undefined, "anim"),
          h("div", { class: "row", style: "margin-top:12px" },
            h("button", { class: "btn", type: "button", onclick: function () { self._replay(); } }, "Replay entrance in preview"),
            h("button", { class: "btn", type: "button", onclick: function () { self._applyPreset("__perf"); } }, "Switch to Performance mode")),
          h("p", { class: "note", style: "margin-top:10px", text: "These effects need the Zoosh script, which the integration loads automatically for every user. After the first install do a full page refresh, or relaunch the app. Heavy blur plus animation can be slow on older iPhones: Performance mode turns blur and every animation off. Hover effects only apply with a mouse. Everything animated switches off when the device asks for reduced motion." })),
        h("section", { class: "panel" }, h("h2", { text: "Extra animations" }), this._fieldGrid(FX, undefined, "anim"),
          h("p", { class: "note", style: "margin-top:10px", text: "Not included: a number-tick animation on sensor values, because it would mean rewriting Home Assistant's own state text." })));
    }

    // ---- Share tab
    _buildShareTab() {
      var self = this;
      this._shareBox = h("textarea", { "aria-label": "Share code", spellcheck: "false", placeholder: "zoosh1:..." });
      this._shareBox.style.minHeight = "80px";
      this._json = h("textarea", { "aria-label": "Look settings as JSON", spellcheck: "false" });
      this._yaml = h("pre", { class: "yaml", tabindex: "0" });
      this._yamlLabel = h("span", { text: "Generated YAML (preview of this Look)" });
      this._diagBox = h("pre", { class: "yaml", tabindex: "0", "aria-label": "Diagnostics" });
      return h("div", { class: "col" },
        h("section", { class: "panel" }, h("h2", { text: "Share this Look" }),
          h("p", { class: "note", style: "margin-bottom:8px", text: "Export makes a short code for the Look you are editing. To use a friend's code, paste it and press Import: the server checks it and adds it as a new Look." }),
          this._shareBox,
          h("div", { class: "row", style: "margin-top:8px" },
            h("button", { class: "btn", type: "button", onclick: function () { self._exportCode(); } }, "Export code"),
            h("button", { class: "btn", type: "button", onclick: function () { self._copyText(self._shareBox.value, "Code copied."); } }, "Copy"),
            h("button", { class: "btn", type: "button", onclick: function () { self._importCode(); } }, "Import"))),
        h("section", { class: "panel" }, h("h2", { text: "Raw settings (advanced)" }),
          h("p", { class: "note", style: "margin-bottom:8px", text: "Copy the JSON of this Look, or paste JSON and press Import. The server checks it again when you save." }),
          this._json,
          h("div", { class: "row", style: "margin-top:8px" },
            h("button", { class: "btn", type: "button", onclick: function () { self._exportJson(); } }, "Export current"),
            h("button", { class: "btn", type: "button", onclick: function () { self._copyText(self._json.value, "JSON copied."); } }, "Copy JSON"),
            h("button", { class: "btn", type: "button", onclick: function () { self._importJson(); } }, "Import"))),
        h("section", { class: "panel" }, h("h2", { text: "Diagnostics" }),
          h("p", { class: "note", style: "margin-bottom:8px", text: "What the effects script sees in THIS browser or app. Open this page in each device you compare, then copy and paste the text. Nothing is sent anywhere." }),
          this._diagBox,
          h("div", { class: "row", style: "margin-top:8px" },
            h("button", { class: "btn", type: "button", onclick: function () { self._refreshDiag(); } }, "Refresh"),
            h("button", { class: "btn", type: "button", onclick: function () { self._copyDiag(); } }, "Copy diagnostics"))),
        h("section", { class: "panel" }, h("h2", { text: "Theme file" }),
          h("button", { class: "btn", type: "button", onclick: function () { self._copyText(self._yaml.textContent, "YAML copied."); } }, "Copy YAML"),
          h("details", { class: "yamlbox" }, h("summary", null, this._yamlLabel), this._yaml,
            h("p", { class: "note", style: "margin-top:8px", text: "Needs frontend: themes: !include_dir_merge_named themes in configuration.yaml. All Looks are written by Home Assistant to /config/themes/zoosh.yaml." })),
          h("p", { class: "note", style: "margin-top:10px", text: "Privacy: nothing leaves your Home Assistant. There is no tracking and no outside request." })));
    }

    // ---- diagnostics (plain text only; rendered with textContent)
    _diagText() {
      var fx = window.__zooshFx, L = [];
      L.push("Zoosh diagnostics");
      L.push("panel: 1.2.2");
      var d = null;
      try { d = fx && typeof fx.getDiagnostics === "function" ? fx.getDiagnostics() : null; } catch (e) { d = null; }
      if (!d) { L.push("effects script: NOT LOADED in this page (refresh the page fully)"); }
      else {
        L.push("effects script: " + d.version + (d.version !== "1.2.2" ? "  (differs from the panel: reload the page)" : ""));
        L.push("active theme: " + (d.theme || "(unknown)") + ", " + (d.darkMode === null ? "mode unknown" : (d.darkMode ? "dark" : "light")));
        L.push("Zoosh theme active: " + (d.zoosh ? "yes" : "no (no --zs-* variables seen)"));
        L.push("variables resolved: " + (d.resolved ? "yes, " + d.resolveMs + " ms after page start, " + d.retries + " retries" : "no (retries so far: " + d.retries + ", timers left: " + d.timersLeft + ")"));
        L.push("adopted: " + d.adopted.shadowRoots + " shadow roots, " + d.adopted.cards + " cards, " + d.adopted.plainCardsSkipped + " plain cards skipped");
        L.push("");
        L.push("theme variables:");
        Object.keys(d.vars || {}).forEach(function (k) { L.push("  " + k + ": " + (d.vars[k] === "" ? "(empty)" : d.vars[k])); });
        L.push("");
        L.push("feature support:");
        Object.keys(d.support || {}).forEach(function (k) { L.push("  " + k + ": " + (d.support[k] ? "yes" : "no")); });
        L.push("");
        L.push("viewport: " + d.viewport + " @ " + d.pixelRatio + "x");
        L.push("user agent: " + d.userAgent);
      }
      return L.join("\n");
    }

    _refreshDiag() { if (this._diagBox) this._diagBox.textContent = this._diagText(); }

    async _copyDiag() {
      this._refreshDiag();
      var text = this._diagBox.textContent;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); this._say("Diagnostics copied.", "ok"); return; }
      } catch (e) { /* fall through */ }
      try {
        var r = document.createRange();
        r.selectNodeContents(this._diagBox);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(r); }
      } catch (e) { /* ignore */ }
      this._say("Selected. Press Ctrl/Cmd+C to copy.", "warn");
    }

    // ---- preview column
    _buildPreview() {
      var self = this;
      this._dev = h("div", { class: "dev", "data-device": this._device, "data-orient": this._orient, "data-view": this._view });
      this._dev.innerHTML = DEVICE_HTML; // static template, no user data
      Array.prototype.forEach.call(this._dev.querySelectorAll(".pc, .chip"), function (el, i) { el.style.setProperty("--i", String(Math.min(i, 12))); });
      this._dev.addEventListener("pointermove", function (ev) {
        if (!self._s.gdOn || !self._s.gLive) return;
        var r = self._dev.getBoundingClientRect();
        self._dev.style.setProperty("--p-angle", Math.round(135 + ((ev.clientX - r.left) / Math.max(1, r.width) - 0.5) * 50 + ((ev.clientY - r.top) / Math.max(1, r.height) - 0.5) * 30) + "deg");
      });
      this._scaler = h("div", { class: "scaler" }, this._dev);
      this._stage = h("div", { class: "stage" }, this._scaler);
      this._devSeg = this._seg("Preview device", Object.keys(DEVICES).map(function (k) { return [k, DEVICES[k].label]; }), this._device, function (v) { self._setDevice(v); });
      this._rotBtn = h("button", { class: "btn", type: "button", "aria-label": "Rotate the preview", onclick: function () { self._rotate(); } }, "Rotate");
      this._previewMode = this._seg("Preview mode", [["light", "Light"], ["dark", "Dark"]], this._pm, function (v) { self._pm = v; if (self._modeTab !== "shared") { self._modeTabs.select(v); self._setMode(v); } else self._render(); });
      this._previewView = this._seg("Preview view", [["dash", "Dashboard"], ["side", "Sidebar"], ["dlg", "Dialog"]], this._view, function (v) { self._view = v; self._render(); });
      this._devCap = h("p", { class: "devcap" });
      return h("div", { class: "col previewcol" },
        h("div", { class: "col sticky" },
          h("div", { class: "devbar" }, this._devSeg, this._rotBtn),
          h("div", { class: "devbar" }, this._previewMode, this._previewView),
          this._stage, this._devCap,
          h("p", { class: "note", text: "Preview only. Blur and glass highlights need a wallpaper or gradient behind the cards." })));
    }

    _setDevice(v) {
      this._device = v;
      this._savePreviewPrefs();
      this._render();
    }
    _rotate() {
      if (this._device === "desktop") return;
      this._orient = this._orient === "portrait" ? "landscape" : "portrait";
      this._savePreviewPrefs();
      this._render();
    }
    _savePreviewPrefs() { lsSet("zoosh_preview", JSON.stringify({ device: this._device, orient: this._orient })); }

    // Frame and screen size in logical pixels for the current device and orientation.
    _frame() {
      var d = DEVICES[this._device], land = this._orient === "landscape" && this._device !== "desktop";
      var w = land ? d.h : d.w, hgt = land ? d.w : d.h;
      var fw = w + d.bezel * 2, fh = hgt + d.bezel * 2 + (this._device === "desktop" ? 36 : 0);
      return { w: w, h: hgt, fw: fw, fh: fh, name: d.name, bezel: d.bezel };
    }

    // Scale the frame to the available width (and a sensible height) with a transform, so
    // text stays sharp and there is never horizontal scrolling.
    _fit() {
      if (!this._stage) return;
      var f = this._frame();
      var avail = (this._stage.clientWidth || 360) - 24;
      var maxH = Math.max(360, (window.innerHeight || 800) * 0.78);
      var k = Math.min(1, avail / f.fw, maxH / f.fh);
      if (!isFinite(k) || k <= 0) k = 0.3;
      this._scale = k;
      this._scaler.style.width = Math.round(f.fw * k) + "px";
      this._scaler.style.height = Math.round(f.fh * k) + "px";
      this._dev.style.width = f.fw + "px";
      this._dev.style.height = f.fh + "px";
      this._dev.style.transform = "scale(" + k + ")";
    }

    // ------------------------------------------------------------ automations UI
    _buildAuto() {
      var self = this;
      this._aActive = h("div", { class: "big-status", text: "Loading..." });
      this._aWhy = h("div", { class: "why" });
      this._aEnabled = h("input", { type: "checkbox", id: "a-en" });
      this._aPaused = h("input", { type: "checkbox", id: "a-pause" });
      this._aEnabled.addEventListener("change", function () { if (self._auto) self._auto.enabled = self._aEnabled.checked; });
      this._aPaused.addEventListener("change", function () { self._autoPause(self._aPaused.checked); });
      this._aTests = h("div", { class: "row" });
      this._aLog = h("ul", { class: "log" });
      this._aStatus = h("p", { class: "status", role: "status", "aria-live": "polite" });
      var statusPanel = h("section", { class: "panel" }, h("h2", { text: "Now" }),
        this._aActive, this._aWhy,
        h("div", { class: "sw-row", style: "margin-top:8px" }, this._aEnabled, h("label", { for: "a-en", text: "Automations on" })),
        h("div", { class: "sw-row" }, this._aPaused, h("label", { for: "a-pause", text: "Pause (stops all automatic changes, including per-person Looks)" })),
        h("p", { class: "note" }, "Automations apply a Look with Home Assistant's frontend.set_theme, which changes the system-wide default theme for everyone who has not chosen their own. Priority: rules, then schedule, then the default Look. A change waits 5 seconds to settle and a Look stays at least 30 seconds."),
        h("h2", { text: "Test", style: "margin-top:12px" }), this._aTests,
        h("div", { class: "row", style: "margin-top:8px" },
          h("button", { class: "btn", type: "button", onclick: function () { self._autoReeval(); } }, "Re-evaluate now")));

      this._aSchedule = h("div", { class: "stack" });
      this._aSchedEn = h("input", { type: "checkbox", id: "a-sch" });
      this._aSchedEn.addEventListener("change", function () { if (self._auto) self._auto.schedule.enabled = self._aSchedEn.checked; });
      var schedP = h("section", { class: "panel" }, h("h2", { text: "Schedule (time of day)" }),
        h("div", { class: "sw-row" }, this._aSchedEn, h("label", { for: "a-sch", text: "Use the schedule" })),
        h("p", { class: "note" }, "The first matching part wins. Day and night follow sun.sun when it exists; otherwise fixed times (07:00 to 19:00) are used."),
        this._aSchedule,
        h("div", { class: "row", style: "margin-top:8px" },
          h("button", { class: "btn", type: "button", onclick: function () { self._addPart(); } }, "Add part")));

      this._aRules = h("div", { class: "stack" });
      this._aTpl = this._dd("Add an example rule");
      [["", "Add an example rule..."], ["alarm", "Alarm armed: Alert"], ["tv", "TV on: low glare"], ["door", "Door open at night: Alert"]].forEach(function (o) { self._aTpl.add(o[0], o[1]); });
      this._aTpl.addEventListener("change", function () { var v = self._aTpl.value; self._aTpl.value = ""; if (v) self._addTemplate(v); });
      this._entityList = h("datalist", { id: "zs-entities" });
      var rulesP = h("section", { class: "panel" }, h("h2", { text: "Reactive rules" }),
        h("p", { class: "note" }, "Up to 8 rules, checked from the top. The first rule whose condition is true wins; when it stops being true the Look reverts to the schedule or default."),
        this._aRules, this._entityList,
        h("div", { class: "row", style: "margin-top:8px" },
          h("button", { class: "btn", type: "button", onclick: function () { self._addRule(); } }, "Add rule"), this._aTpl));

      this._aPeople = h("div", { class: "stack" });
      var peopleP = h("section", { class: "panel" }, h("h2", { text: "Per-person Looks" }),
        h("p", { class: "note" }, "Each person's browser applies their Look once when it changes (the Zoosh script asks the server for the caller's own Look only). If someone picked a different theme themselves in that browser, their choice is kept."),
        this._aPeople);

      var logP = h("section", { class: "panel" }, h("h2", { text: "Recent decisions (last 20, kept in memory)" }), this._aLog);
      var saveRow = h("section", { class: "panel" },
        h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: function () { self._autoSave(); } }, "Save automations")), this._aStatus,
        h("p", { class: "note" }, "Save your Looks first (Save and apply): automations can only use Looks that exist on the server."));
      return h("div", { class: "col" }, statusPanel, schedP, rulesP, peopleP, logP, saveRow);
    }

    _lookSelect(value, onPick) {
      var sel = this._dd("Look");
      this._autoLooks.forEach(function (l) { sel.add(l.id, l.name); });
      sel.value = value;
      if (sel.value !== value && this._autoLooks.length) { sel.value = this._autoLooks[0].id; onPick(sel.value); }
      sel.addEventListener("change", function () { onPick(sel.value); });
      return sel;
    }

    _fieldWrap(label, input) {
      return h("div", { class: "f" }, h("label", { text: label }), input);
    }

    _renderAuto() {
      var self = this, a = this._auto;
      if (!a) return;
      this._aEnabled.checked = !!a.enabled;
      this._aPaused.checked = !!a.paused;
      this._aSchedEn.checked = !!a.schedule.enabled;
      // test buttons
      this._aTests.textContent = "";
      this._autoLooks.forEach(function (l) {
        self._aTests.append(h("button", { class: "btn", type: "button", onclick: function () { self._autoTest(l.id); } }, "Test: " + l.name));
      });
      // schedule parts
      this._aSchedule.textContent = "";
      a.schedule.parts.forEach(function (p, i) {
        var kind = self._dd("Part type");
        [["day", "Daytime (sunrise to sunset)"], ["night", "Night (sunset to sunrise)"], ["range", "Custom time range"]].forEach(function (o) { kind.add(o[0], o[1]); });
        kind.value = p.kind;
        var start = h("input", { type: "time", value: p.start || "08:00", "aria-label": "From" });
        var end = h("input", { type: "time", value: p.end || "20:00", "aria-label": "To" });
        var range = p.kind === "range";
        var tf = h("div", { class: "full row", hidden: !range }, self._fieldWrap("From", start), self._fieldWrap("To", end));
        kind.addEventListener("change", function () { p.kind = kind.value; tf.hidden = p.kind !== "range"; if (p.kind === "range") { p.start = start.value; p.end = end.value; } });
        start.addEventListener("change", function () { p.start = start.value; });
        end.addEventListener("change", function () { p.end = end.value; });
        if (range) { p.start = p.start || "08:00"; p.end = p.end || "20:00"; }
        var look = self._lookSelect(p.look, function (v) { p.look = v; });
        self._aSchedule.append(h("div", { class: "card2" },
          self._fieldWrap("When", kind), self._fieldWrap("Use Look", look), tf,
          h("button", { class: "btn danger", type: "button", onclick: function () { a.schedule.parts.splice(i, 1); self._renderAuto(); } }, "Remove")));
      });
      // rules
      this._aRules.textContent = "";
      a.rules.forEach(function (r, i) {
        var ent = h("input", { type: "text", list: "zs-entities", value: r.entity_id, placeholder: "domain.entity", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Entity" });
        ent.addEventListener("input", function () { r.entity_id = ent.value.trim(); });
        var attr = h("input", { type: "text", value: r.attribute, placeholder: "(state)", autocomplete: "off", autocapitalize: "off", "aria-label": "Attribute" });
        attr.addEventListener("input", function () { r.attribute = attr.value.trim(); });
        var op = self._dd("Comparison");
        [["is", "is"], ["is_not", "is not"], ["gt", "above"], ["lt", "below"], ["gte", "at least"], ["lte", "at most"]].forEach(function (o) { op.add(o[0], o[1]); });
        op.value = r.op;
        op.addEventListener("change", function () { r.op = op.value; });
        var val = h("input", { type: "text", value: r.value, maxlength: 64, autocomplete: "off", "aria-label": "Value" });
        val.addEventListener("input", function () { r.value = val.value.trim(); });
        var night = h("input", { type: "checkbox", id: "rn-" + i, checked: !!r.only_night });
        night.addEventListener("change", function () { r.only_night = night.checked; });
        var look = self._lookSelect(r.look, function (v) { r.look = v; });
        self._aRules.append(h("div", { class: "card2" },
          h("div", { class: "full" }, self._fieldWrap("When this entity", ent)),
          self._fieldWrap("Attribute (optional)", attr), self._fieldWrap("is", op), self._fieldWrap("Value", val),
          h("div", { class: "f chk" }, night, h("label", { for: "rn-" + i, text: "Only at night" })),
          self._fieldWrap("Then use Look", look),
          h("div", { class: "full row" },
            h("button", { class: "btn", type: "button", "aria-label": "Move up", disabled: i === 0, onclick: function () { a.rules.splice(i - 1, 0, a.rules.splice(i, 1)[0]); self._renderAuto(); } }, "Up"),
            h("button", { class: "btn", type: "button", "aria-label": "Move down", disabled: i === a.rules.length - 1, onclick: function () { a.rules.splice(i + 1, 0, a.rules.splice(i, 1)[0]); self._renderAuto(); } }, "Down"),
            h("button", { class: "btn danger", type: "button", onclick: function () { a.rules.splice(i, 1); self._renderAuto(); } }, "Remove"))));
      });
      // entity datalist
      this._entityList.textContent = "";
      var states = this._hass && this._hass.states ? Object.keys(this._hass.states).sort() : [];
      states.slice(0, 4000).forEach(function (id) { self._entityList.append(h("option", { value: id })); });
      this._renderPeople();
    }

    async _renderPeople() {
      var self = this, a = this._auto;
      this._aPeople.textContent = "";
      var users = [];
      try {
        var res = await this._hass.callWS({ type: "config/auth/list" });
        users = (Array.isArray(res) ? res : []).filter(function (u) { return u && u.is_active && !u.system_generated && /^[0-9a-f]{32}$/.test(u.id); });
      } catch (e) {
        this._aPeople.append(h("p", { class: "note", text: "Could not list the Home Assistant users." }));
        return;
      }
      users.forEach(function (u) {
        var sel = self._dd("Look for " + u.name);
        sel.add("", "(none: their own choice)");
        self._autoLooks.forEach(function (l) { sel.add(l.id, l.name); });
        sel.value = a.people[u.id] || "";
        sel.addEventListener("change", function () { if (sel.value) a.people[u.id] = sel.value; else delete a.people[u.id]; });
        self._aPeople.append(h("div", { class: "card2" }, h("div", { class: "f" }, h("label", { text: u.name })), self._fieldWrap("Look", sel)));
      });
      if (!users.length) this._aPeople.append(h("p", { class: "note", text: "No users found." }));
    }

    _addPart() {
      if (!this._auto || this._auto.schedule.parts.length >= 6) return;
      this._auto.schedule.parts.push({ kind: "night", start: "", end: "", look: this._defaultLookFor() });
      this._renderAuto();
    }

    _defaultLookFor(name) {
      var list = this._autoLooks;
      if (name) { for (var i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === name.toLowerCase()) return list[i].id; }
      return list.length ? list[0].id : "";
    }

    _addRule(r) {
      if (!this._auto) return;
      if (this._auto.rules.length >= 8) { this._autoSay("At most 8 rules.", "err"); return; }
      this._auto.rules.push(r || { entity_id: "", op: "is", attribute: "", value: "on", only_night: false, look: this._defaultLookFor("Alert") });
      this._renderAuto();
    }

    _firstEntity(domain, devClass) {
      var st = this._hass && this._hass.states ? this._hass.states : {};
      var ids = Object.keys(st).sort();
      for (var i = 0; i < ids.length; i++) {
        if (ids[i].indexOf(domain + ".") !== 0) continue;
        if (devClass && !(st[ids[i]].attributes && st[ids[i]].attributes.device_class === devClass)) continue;
        return ids[i];
      }
      return domain + ".example";
    }

    _addTemplate(kind) {
      if (kind === "alarm") this._addRule({ entity_id: this._firstEntity("alarm_control_panel"), op: "is", attribute: "", value: "armed_away", only_night: false, look: this._defaultLookFor("Alert") });
      else if (kind === "tv") this._addRule({ entity_id: this._firstEntity("media_player"), op: "is", attribute: "", value: "playing", only_night: false, look: this._defaultLookFor("Midnight") });
      else if (kind === "door") this._addRule({ entity_id: this._firstEntity("binary_sensor", "door"), op: "is", attribute: "", value: "on", only_night: true, look: this._defaultLookFor("Alert") });
      this._autoSay("Example added. Check the entity and value, then save.", "");
    }

    _autoSay(msg, kind) { this._aStatus.textContent = msg || ""; this._aStatus.className = "status" + (kind ? " " + kind : ""); }

    _applyAutoPayload(res, keepEdits) {
      if (!res) return;
      this._autoLooks = Array.isArray(res.looks) ? res.looks : [];
      if (!keepEdits || !this._auto) { this._auto = clone(res.config); this._renderAuto(); }
      var st = res.status || {};
      this._aActive.textContent = st.active_name ? "Active Look: " + st.active_name : "No Look applied by Zoosh yet";
      var why = st.reason || "";
      if (!st.sun_present) why += (why ? ". " : "") + "sun.sun not found, using fixed day times";
      this._aWhy.textContent = "Why: " + why;
      this._aLog.textContent = "";
      (st.log || []).forEach(function (e) { this._aLog.append(h("li", { text: e.t + "  " + e.msg })); }, this);
      if (!(st.log || []).length) this._aLog.append(h("li", { text: "No decisions yet." }));
    }

    async _openAuto() {
      try {
        var res = await this._hass.callWS({ type: "zoosh/automation_get" });
        this._applyAutoPayload(res, false);
      } catch (e) { this._autoSay("Could not load automations: " + (e && e.message ? e.message : "unknown error"), "err"); }
    }

    _startPoll() {
      var self = this;
      this._stopPoll();
      this._autoTimer = setInterval(async function () {
        if (document.hidden || !self._hass || self._tab !== "auto") return;
        try { self._applyAutoPayload(await self._hass.callWS({ type: "zoosh/automation_get" }), true); } catch (e) { /* ignore */ }
      }, 4000);
    }
    _stopPoll() { if (this._autoTimer) { clearInterval(this._autoTimer); this._autoTimer = null; } }

    // Ids of the real Home Assistant users, or null when they cannot be listed.
    async _knownUsers() {
      try {
        var res = await this._hass.callWS({ type: "config/auth/list" });
        if (!Array.isArray(res)) return null;
        return new Set(res.filter(function (u) { return u && u.is_active && !u.system_generated && /^[0-9a-f]{32}$/.test(u.id); }).map(function (u) { return u.id; }));
      } catch (e) { return null; }
    }

    async _autoSave() {
      var a = this._auto;
      if (!a) return;
      for (var i = 0; i < a.rules.length; i++) {
        var r = a.rules[i];
        if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(r.entity_id)) { this._autoSay("Rule " + (i + 1) + ": the entity must look like domain.name.", "err"); return; }
        if (!r.value) { this._autoSay("Rule " + (i + 1) + ": enter a value.", "err"); return; }
        if (["gt", "lt", "gte", "lte"].indexOf(r.op) !== -1 && isNaN(parseFloat(r.value))) { this._autoSay("Rule " + (i + 1) + ": a numeric comparison needs a number.", "err"); return; }
      }
      var known = await this._knownUsers();
      if (known) Object.keys(a.people).forEach(function (u) { if (!known.has(u)) delete a.people[u]; });
      try {
        var res = await this._hass.callWS({ type: "zoosh/automation_save", config: a });
        this._applyAutoPayload(res, false);
        this._autoSay("Automations saved.", "ok");
      } catch (e) { this._autoSay("Save failed: " + (e && e.message ? e.message : "unknown error"), "err"); }
    }

    async _autoPause(paused) {
      try { this._applyAutoPayload(await this._hass.callWS({ type: "zoosh/automation_pause", paused: paused }), true); if (this._auto) this._auto.paused = paused; }
      catch (e) { this._autoSay("Could not change pause: " + (e && e.message ? e.message : "unknown error"), "err"); this._aPaused.checked = !paused; }
    }

    async _autoTest(id) {
      try { this._applyAutoPayload(await this._hass.callWS({ type: "zoosh/automation_test", look_id: id }), true); this._autoSay("Test applied. The next evaluation may switch it back.", "ok"); }
      catch (e) { this._autoSay("Test failed: " + (e && e.message ? e.message : "unknown error"), "err"); }
    }

    async _autoReeval() {
      try { this._applyAutoPayload(await this._hass.callWS({ type: "zoosh/automation_test" }), true); this._autoSay("Re-evaluated.", "ok"); }
      catch (e) { this._autoSay("Failed: " + (e && e.message ? e.message : "unknown error"), "err"); }
    }


    _seg(label, opts, current, onPick) {
      var seg = h("div", { class: "seg", role: "group", "aria-label": label });
      var set = function (v) {
        Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-v") === v)); });
      };
      opts.forEach(function (o) {
        var b = h("button", { type: "button", "data-v": o[0], "aria-pressed": String(o[0] === current), text: o[1] });
        b.addEventListener("click", function () { set(o[0]); onPick(o[0]); });
        seg.append(b);
      });
      seg.select = set;
      return seg;
    }

    // ----------------------------------------------------------- behaviour
    // Toasts do not block anything. Errors stay longer.
    _say(msg, kind) {
      var self = this;
      if (this._toastTimer) { clearTimeout(this._toastTimer); this._toastTimer = null; }
      this._status.textContent = "";
      if (!msg) { this._status.hidden = true; return; }
      this._status.className = "toast" + (kind ? " " + kind : "");
      this._status.append(h("span", { text: msg }),
        h("button", { type: "button", "aria-label": "Dismiss", onclick: function () { self._status.hidden = true; } }, "×"));
      this._status.hidden = false;
      this._toastTimer = setTimeout(function () { self._status.hidden = true; }, kind === "err" ? 9000 : 4500);
    }

    // ---- undo / redo (20 steps). Snapshots are taken before a change; typing or
    // dragging on the same field is merged into one step.
    _snap() { return JSON.stringify({ l: this._looks, d: this._defaultId, c: this._curId, s: this._same }); }

    _checkpoint(tag) {
      var now = Date.now();
      if (tag && tag === this._lastTag && now - this._lastTagAt < 900) { this._lastTagAt = now; return; }
      this._lastTag = tag || null;
      this._lastTagAt = now;
      this._undo.push(this._snap());
      if (this._undo.length > 20) this._undo.shift();
      this._redo = [];
      this._syncBar();
    }

    _restore(str) {
      var o = JSON.parse(str);
      this._looks = o.l; this._defaultId = o.d; this._curId = o.c; this._same = o.s || {};
      this._lastTag = null;
      this._refreshLooksSelect();
      this._syncAll();
      this._render();
    }

    _undoStep() {
      if (!this._undo.length) return;
      this._redo.push(this._snap());
      this._restore(this._undo.pop());
    }

    _redoStep() {
      if (!this._redo.length) return;
      this._undo.push(this._snap());
      this._restore(this._redo.pop());
    }

    // Saved-state comparison ignores which Look is selected.
    _snapshot() { return JSON.stringify({ l: this._looks, d: this._defaultId }); }
    _isDirty() { return this._saved === null ? false : this._saved !== this._snapshot(); }

    _syncBar() {
      var dirty = this._isDirty();
      this._dot.toggleAttribute("data-clean", !dirty);
      this._dirty.textContent = this._loadState !== "ready" ? (this._loadState === "error" ? "Could not load" : "Loading...") : (dirty ? "Unsaved changes" : "All changes saved");
      this._saveBtn.disabled = !dirty || this._busy || this._loadState !== "ready";
      this._resetBtn.disabled = !dirty;
      this._undoBtn.disabled = !this._undo.length;
      this._redoBtn.disabled = !this._redo.length;
    }
    _updateDirty() { this._syncBar(); }

    _previewSrc(m) {
      var b = this._blobs[m], p = this._s[m].img;
      if (b && b.path === p) return b.url;
      return validImg(p) ? p : "";
    }

    _render() {
      if (this._s.perf) this._rootEl.setAttribute("data-perf", ""); else this._rootEl.removeAttribute("data-perf");
      this._renderDevice();
      this._yaml.textContent = yamlText(this._s);
      this._yamlLabel.textContent = "Generated YAML (preview of this Look)";
      this._syncBar();
      this._syncBg();
      this._pickers.forEach(function (p) { p.refresh(); });
      this._renderLooksList();
      this._renderContrast();
      this._ensureWallpaper(this._pm);
      this._renderPage();
    }

    // Show only the background controls that apply to the chosen type.
    _syncBg() {
      var t = this._s.bgType;
      Array.prototype.forEach.call(this.shadowRoot.querySelectorAll(".imgbox, [data-k=dim], [data-k=imgFit], [data-k=imgPos]"), function (el) { el.hidden = t !== "image"; });
      Array.prototype.forEach.call(this.shadowRoot.querySelectorAll("[data-k=bg2]"), function (el) { el.hidden = t !== "gradient"; });
    }

    _renderDevice() {
      var s = this._s, m = this._pm, c = s[m];
      var v = modeVars(s, m, this._previewSrc(m));
      var filter = s.gdOn ? "blur(" + s.gBlur + "px) saturate(" + s.gSat + "%) brightness(" + s.gBright + "%)" : (s.frosted && s.blur ? "blur(" + s.blur + "px) saturate(180%)" : "none");
      var map = {
        "--p-bg": v.bg, "--p-card": v.card, "--p-shadow": v.shadow,
        "--p-bd": op(c.bdColor, c.bdOp), "--p-dv": op(c.dvColor, c.dvOp),
        "--p-text": c.text, "--p-text2": c.text2,
        "--p-primary": s.primary, "--p-accent": s.accent, "--p-switch": s.success, "--p-error": s.error,
        "--p-iclight": c.icLight, "--p-icact": c.icActive, "--p-icoff": c.icInactive,
        "--p-hd": op(c.hdBg, c.hdOp), "--p-hdtext": c.hdText,
        "--p-sbbg": c.sbOp === 100 ? c.sbBg : op(c.sbBg, c.sbOp), "--p-sbtext": c.sbText, "--p-sbicon": c.sbIcon,
        "--p-sbsel": c.sbSel, "--p-sbselbg": rgba(c.sbSel, "0.18"),
        "--p-dl": op(c.dlBg, c.dlOp), "--p-scrim": op("#000000", c.scrim), "--p-field": op(c.inBg, c.inOp),
        "--p-radius": s.radius + "px", "--p-bw": s.bw + "px",
        "--p-filter": filter,
        "--p-font": FONTS[s.font] || FONTS.ios, "--p-track": "rgba(120,120,128,0.32)"
      };
      var st = this._dev.style;
      Object.keys(map).forEach(function (k) { st.setProperty(k, map[k]); });
      var d = this._dev;
      d.setAttribute("data-device", this._device);
      d.setAttribute("data-orient", this._device === "desktop" ? "landscape" : this._orient);
      d.setAttribute("data-view", this._view);
      d.setAttribute("data-mode", m);
      if (s.gdOn) {
        d.setAttribute("data-glass", "");
        st.setProperty("--p-edge", String(s.gEdge / 100));
        st.setProperty("--p-glow", String(s.gGlow / 100));
        st.setProperty("--p-sheen", String(s.gSheen / 100));
      } else {
        d.removeAttribute("data-glass");
      }
      st.setProperty("--p-cardscale", String(s.cardScale / 100));
      st.setProperty("--p-hover", String(s.hoverScale / 100));
      st.setProperty("--p-press", String(s.pressScale / 100));
      st.setProperty("--p-dur", String(s.perf ? 0 : s.animMs));
      st.setProperty("--p-ease", EASINGS[s.easing] || "ease-out");
      st.setProperty("--p-stagger", String(s.stagger));
      if (s.entrance !== "none" && s.animMs > 0 && !s.perf) d.setAttribute("data-entrance", s.entrance);
      else d.removeAttribute("data-entrance");
      d.style.fontSize = (s.fontScale / 100 * 14) + "px";
      this._rotBtn.disabled = this._device === "desktop";
      this._devSeg.select(this._device);
      this._previewView.select(this._view);
      this._previewMode.select(m);
      var f = this._frame();
      this._devCap.textContent = f.name + ", " + f.w + " × " + f.h + " pt" + (this._device === "desktop" ? "" : " (" + this._orient + ")");
      this._fit();
    }

    _replay() {
      var ph = this._dev;
      if (this._s.entrance === "none" || this._s.animMs <= 0) {
        this._say("Pick a way for cards to appear and a speed above zero to see it.", "warn");
        return;
      }
      ph.removeAttribute("data-entrance");
      void ph.offsetWidth; // restart the CSS animation
      ph.setAttribute("data-entrance", this._s.entrance);
    }

    _applyPreset(name) {
      if (name === "__perf") {
        this._checkpoint();
        var s = this._s;
        s.blur = 0; s.frosted = false; s.entrance = "none"; s.animMs = Math.min(s.animMs, 120);
        s.gdOn = false; s.gLive = false; s.shimmer = false; s.ripple = false; s.dialogSpring = false;
        s.pageTransition = false; s.sidebarHover = false; s.drift = false; s.perf = true;
        this._afterReplace("Performance mode is on: blur, glass and every animation are off. Press Save and apply to keep it.");
      }
    }

    _resetSaved() {
      if (this._saved === null) { this._say("Nothing saved yet.", "warn"); return; }
      this._checkpoint();
      var snap = JSON.parse(this._saved);
      this._looks = snap.l;
      this._defaultId = snap.d;
      if (!this._looks.some(function (l) { return l.id === this._curId; }, this)) this._curId = this._looks[0].id;
      this._refreshLooksSelect();
      this._afterReplace("Reset to the saved Looks. Undo brings your edits back.");
    }

    _afterReplace(msg) {
      this._syncAll();
      this._render();
      if (msg) this._say(msg, "");
    }

    // ---- mode tools
    _copyMode(from, to) {
      this._checkpoint();
      var src = clone(this._s[from]);
      src.img = this._s[to].img;
      this._s[to] = src;
      this._afterReplace("Copied " + from + " settings to " + to + " (the wallpaper choice was kept).");
    }

    // A starting point for dark mode: flip the lightness of every light colour.
    _matchDark() {
      this._checkpoint();
      var l = this._s.light, d = clone(l);
      MODE_COLOR_KEYS.forEach(function (k) {
        var hsl = rgb2hsl(rgbOf(l[k]));
        hsl[2] = Math.max(0.06, Math.min(0.94, 1 - hsl[2]));
        d[k] = toHex(hsl2rgb(hsl));
      });
      d.img = this._s.dark.img;
      d.dim = Math.max(l.dim, 30);
      d.scrim = Math.max(l.scrim, 45);
      this._s.dark = d;
      this._afterReplace("Dark mode now mirrors light mode with the lightness flipped. Fine-tune it from here.");
    }

    // ---------------------------------------------------------------- Looks
    _newId() {
      var id;
      do { id = "l" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0"); }
      while (this._looks.some(function (l) { return l.id === id; }));
      return id;
    }

    _uniqueName(base) {
      var names = this._looks.map(function (l) { return l.state.name.toLowerCase(); });
      var name = base.slice(0, 40), n = 1;
      while (names.indexOf(name.toLowerCase()) !== -1) {
        n++;
        var suffix = " " + n;
        name = base.slice(0, 40 - suffix.length) + suffix;
      }
      return name;
    }

    _refreshLooksSelect() {
      var self = this;
      this._looksSel.clear();
      this._looks.forEach(function (l) {
        self._looksSel.add(l.id, (l.id === self._defaultId ? "\u2605 " : "") + l.state.name);
      });
      this._looksSel.value = this._curId;
      this._starterSel.clear();
      this._starterSel.add("", "Add a starter Look...");
      this._starters.forEach(function (st, i) { self._starterSel.add(String(i), st.name); });
      this._starterSel.value = "";
      this._delBtn.textContent = "Delete";
      this._delArmed = false;
      this._delBtn.disabled = this._looks.length <= 1;
      if (this._renderLooksList && this._looksList) this._renderLooksList();
    }

    _selectLook(id) {
      this._curId = id;
      this._delArmed = false;
      this._delBtn.textContent = "Delete";
      this._looksSel.value = id;
      this._syncAll();
      this._render();
      this._say("", "");
    }

    _addLook(state) {
      if (this._looks.length >= 12) { this._say("You can have at most 12 Looks.", "err"); return; }
      this._checkpoint();
      var st = normalize(state);
      st.name = this._uniqueName(state.name || "New Look");
      var look = { id: this._newId(), state: st };
      this._looks.push(look);
      this._curId = look.id;
      this._refreshLooksSelect();
      this._afterReplace("Added \"" + st.name + "\". Press Save and apply to write it.");
    }

    _setDefault() {
      this._checkpoint();
      this._defaultId = this._curId;
      this._refreshLooksSelect();
      this._render();
      this._say("\"" + this._s.name + "\" is now the default Look. Press Save and apply.", "");
    }

    _deleteLook() {
      if (this._looks.length <= 1) return;
      if (!this._delArmed) {
        this._delArmed = true;
        this._delBtn.textContent = "Tap again to delete";
        return;
      }
      this._checkpoint();
      var id = this._curId;
      this._looks = this._looks.filter(function (l) { return l.id !== id; });
      this._curId = this._looks[0].id;
      if (this._defaultId === id) this._defaultId = this._curId;
      this._refreshLooksSelect();
      this._afterReplace("Look deleted. Undo brings it back until you save.");
    }

    async _applyNow() {
      var p = problems(this._s);
      if (p) { this._say(p, "err"); return; }
      this._say("Applying...", "");
      try {
        await this._hass.callWS({ type: "zoosh/apply_look", look_id: this._curId });
        this._say("Applied \"" + THEME_PREFIX + this._s.name + "\" system-wide.", "ok");
      } catch (e) {
        this._say("Could not apply: " + (e && e.message ? e.message : "unknown error") + " (save first if this Look is new)", "err");
      }
    }

    async _exportCode() {
      var p = problems(this._s);
      if (p) { this._say(p, "err"); return; }
      try {
        var res = await this._hass.callWS({ type: "zoosh/export_look", state: clone(this._s) });
        this._shareBox.value = res.code;
        this._shareBox.focus();
        this._shareBox.select();
        this._say("Share code written to the box.", "ok");
      } catch (e) { this._say("Export failed: " + (e && e.message ? e.message : "unknown error"), "err"); }
    }

    async _importCode() {
      var code = this._shareBox.value.trim();
      if (!code) { this._say("Paste a share code first.", "err"); return; }
      try {
        var res = await this._hass.callWS({ type: "zoosh/import_look", code: code });
        this._addLook(res.state);
      } catch (e) { this._say("Import failed: " + (e && e.message ? e.message : "unknown error"), "err"); }
    }

    _fillImages(list) {
      this._images = Array.isArray(list) ? list.filter(function (n) { return typeof n === "string"; }) : [];
      this._pickers.forEach(function (p) { p.fillGallery(); });
    }

    _setLoad(state, msg) {
      var self = this;
      this._loadState = state;
      this._banner.textContent = "";
      this._banner.className = "banner" + (state === "error" ? " err" : "");
      if (state === "ready") { this._banner.hidden = true; }
      else {
        this._banner.hidden = false;
        this._banner.append(h("span", { text: state === "loading" ? "Loading your Looks..." : msg }));
        if (state === "error") this._banner.append(h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn", type: "button", onclick: function () { self._load(); } }, "Try again")));
      }
      this._syncBar();
    }

    async _load() {
      this._setLoad("loading");
      try {
        var res = await this._hass.callWS({ type: "zoosh/get" });
        this._starters = (res && Array.isArray(res.starters) ? res.starters : []).map(normalize);
        if (res && Array.isArray(res.looks) && res.looks.length) {
          this._looks = res.looks.map(function (l) { return { id: l.id, state: normalize(l.state) }; });
          this._defaultId = res.default_id;
          this._curId = this._looks.some(function (l) { return l.id === res.default_id; }) ? res.default_id : this._looks[0].id;
        }
        this._rev = res && Number.isInteger(res.rev) && res.rev >= 1 ? res.rev : 1;
        this._same = {};
        this._undo = []; this._redo = [];
        this._saved = this._snapshot();
        if (res && Array.isArray(res.bundled)) this._bundled = res.bundled.filter(function (n) { return typeof n === "string" && /^[A-Za-z0-9._-]+$/.test(n) && n.indexOf("..") === -1; });
        this._fillImages(res && res.images);
        this._setLoad("ready");
        this._refreshLooksSelect();
        this._syncAll();
        this._render();
      } catch (e) {
        this._setLoad("error", "Could not load your Looks: " + (e && e.message ? e.message : "unknown error"));
      }
    }

    async _save() {
      var names = {};
      for (var i = 0; i < this._looks.length; i++) {
        var l = this._looks[i], p = problems(l.state);
        if (p) { this._say("Look \"" + l.state.name + "\": " + p, "err"); return; }
        var key = l.state.name.toLowerCase();
        if (names[key]) { this._say("Two Looks are called \"" + l.state.name + "\". Names must be unique.", "err"); return; }
        names[key] = true;
      }
      this._busy = true;
      this._syncBar();
      this._say("Saving...", "");
      try {
        var snapshot = this._snapshot();
        var msgOut = { type: "zoosh/save_looks", looks: clone(this._looks), default_id: this._defaultId, rev: this._rev, apply_default: false };
        if (this._applyChk.checked) msgOut.apply_id = this._curId;
        var res = await this._hass.callWS(msgOut);
        if (Number.isInteger(res.rev)) this._rev = res.rev;
        this._saved = snapshot;
        this._yaml.textContent = res.yaml;
        this._yamlLabel.textContent = "Generated YAML for all Looks (written by Home Assistant)";
        var msg = "Saved " + this._looks.length + " Look" + (this._looks.length === 1 ? "" : "s") + " and reloaded themes.";
        if (this._applyChk.checked && !res.warning) msg += " Now using \"" + this._s.name + "\" for the whole house.";
        if (res.warning) msg += " " + res.warning;
        this._say(msg, res.warning ? "warn" : "ok");
      } catch (e) {
        if (e && e.code === "stale") this._showStale(e.message);
        else this._say("Save failed: " + (e && e.message ? e.message : "unknown error"), "err");
      } finally {
        this._busy = false;
        this._syncBar();
      }
    }

    // Another tab or admin saved first: show a banner with a Reload button, never overwrite.
    _showStale(msg) {
      var self = this;
      this._banner.textContent = "";
      this._banner.className = "banner err";
      this._banner.hidden = false;
      this._banner.append(h("span", { text: (msg || "Your Looks were changed somewhere else.") + " Your unsaved edits here would overwrite them, so nothing was saved." }),
        h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn primary", type: "button", onclick: function () { self._load(); } }, "Reload")));
      this._say("Not saved: the Looks changed elsewhere. Press Reload.", "err");
    }

    // Two-tap delete of one of your own uploads. Looks that use it lose that image.
    _confirmDelete(btn, name) {
      var self = this, path = "/local/wallpapers/" + name;
      var users = this._looks.filter(function (l) { return l.state.light.img === path || l.state.dark.img === path; });
      if (btn.getAttribute("data-armed") !== "1") {
        btn.setAttribute("data-armed", "1");
        btn.textContent = users.length ? "Used by " + users.length + " Look" + (users.length === 1 ? "" : "s") + ": tap again" : "Tap again";
        setTimeout(function () { if (btn.isConnected) { btn.removeAttribute("data-armed"); btn.textContent = "Delete"; } }, 5000);
        return;
      }
      this._deleteUpload(name, path, users);
    }

    async _deleteUpload(name, path, users) {
      try {
        await this._hass.callWS({ type: "zoosh/delete_upload", name: name });
      } catch (e) { this._say("Delete failed: " + (e && e.message ? e.message : "unknown error"), "err"); return; }
      this._checkpoint();
      this._looks.forEach(function (l) { ["light", "dark"].forEach(function (m) { if (l.state[m].img === path) l.state[m].img = ""; }); });
      ["light", "dark"].forEach(function (m) { var b = this._blobs[m]; if (b && b.path === path) { if (b.url) URL.revokeObjectURL(b.url); this._blobs[m] = null; } }, this);
      this._fillImages(this._images.filter(function (n) { return n !== name; }));
      this._syncAll();
      this._render();
      this._say("Deleted " + name + (users.length ? ". It was used by " + users.map(function (l) { return l.state.name; }).join(", ") + "; the image was cleared there (press Save and apply)." : "."), "ok");
    }

    async _copyText(text, doneMsg) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          this._say(doneMsg, "ok");
          return;
        }
      } catch (e) { /* fall through to manual copy */ }
      // Fallback: select the visible text so the user can copy by hand.
      var target = text === this._json.value ? this._json : (text === this._shareBox.value ? this._shareBox : null);
      if (target) { target.focus(); target.select(); }
      else {
        var det = this._yaml.closest("details");
        if (det) det.open = true;
        var r = document.createRange();
        r.selectNodeContents(this._yaml);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(r); }
      }
      this._say("Selected. Press Ctrl/Cmd+C to copy.", "warn");
    }

    _exportJson() {
      this._json.value = JSON.stringify(this._s, null, 2);
      this._json.focus();
      this._json.select();
      this._say("Settings written to the box above. Copy them to keep a backup.", "");
    }

    _importJson() {
      var raw = this._json.value.trim();
      if (!raw) { this._say("Paste JSON into the box first.", "err"); return; }
      var obj;
      try { obj = JSON.parse(raw); } catch (e) { this._say("That is not valid JSON.", "err"); return; }
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) { this._say("Expected a JSON object.", "err"); return; }
      this._checkpoint();
      var name = this._s.name;
      this._s = normalize(obj);
      this._s.name = name;
      this._afterReplace("Imported into this Look (its name was kept). Unknown or mistyped fields were left at their defaults. Press Save and apply to validate on the server.");
    }

    // ------------------------------------------------------ palette and contrast
    // Load the wallpaper for a mode into a 64px canvas (same-origin only) and cache the
    // colour data. Nothing leaves the browser.
    async _ensureWallpaper(m) {
      var s = this._s, src = s.bgType === "image" ? this._previewSrc(m) : "";
      var cur = this._wp[m];
      if (!src) { if (cur) { this._wp[m] = null; this._renderContrast(); } return; }
      if (cur && cur.src === src) return;
      if (this._wpBusy === src) return;
      this._wpFail = this._wpFail || {};
      if (this._wpFail[src]) return; // could not be analysed once: do not retry in a loop
      this._wpBusy = src;
      try {
        var img = new Image();
        await new Promise(function (resolve, reject) { img.onload = resolve; img.onerror = reject; img.src = src; });
        var w = 64, hgt = Math.max(1, Math.round(64 * img.naturalHeight / Math.max(1, img.naturalWidth)));
        var cv = document.createElement("canvas");
        cv.width = w; cv.height = Math.min(hgt, 128);
        var ctx = cv.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        var data = ctx.getImageData(0, 0, cv.width, cv.height).data, px = [], sum = [0, 0, 0];
        for (var i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          px.push([data[i], data[i + 1], data[i + 2]]);
          sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2];
        }
        var n = Math.max(1, px.length);
        var avg3 = [sum[0] / n, sum[1] / n, sum[2] / n];
        this._wp[m] = { src: src, avg: avg3, left: regionAvg(data, cv.width, cv.height, "left") || avg3, top: regionAvg(data, cv.width, cv.height, "top") || avg3, px: px };
      } catch (e) {
        this._wp[m] = null;
        this._wpFail[src] = true;
      } finally {
        this._wpBusy = null;
      }
      this._renderContrast();
      this._renderPage();
    }

    // The colour that sits behind the cards: wallpaper average (dimmed) or the background colour(s).
    _backdrop(m) {
      var s = this._s, c = s[m];
      if (s.bgType === "image" && this._wp[m]) {
        var d = 1 - c.dim / 100, a = this._wp[m].avg;
        return [a[0] * d, a[1] * d, a[2] * d];
      }
      if (s.bgType === "gradient") {
        var x = rgbOf(c.bg), y = rgbOf(c.bg2);
        return [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2, (x[2] + y[2]) / 2];
      }
      return rgbOf(c.bg);
    }

    // Colour behind a region of the page for a mode: wallpaper strip (dimmed), gradient mean or solid bg.
    _regionBack(m, region) {
      var s = this._s, c = s[m], wp = this._wp[m];
      if (s.bgType === "image" && wp) {
        var d = 1 - c.dim / 100, a = wp[region] || wp.avg;
        return [a[0] * d, a[1] * d, a[2] * d];
      }
      return this._backdrop(m);
    }

    _ctx(m) {
      var s = this._s, c = s[m];
      return { avg: this._regionBack(m, "avg"), left: this._regionBack(m, "left"), top: this._regionBack(m, "top"), cardOp: s.gdOn ? s.gTint : c.op };
    }

    _contrastRows() {
      var s = this._s, m = this._pm, c = s[m], ctx = this._ctx(m);
      var card = over(rgbOf(c.card), ctx.cardOp / 100, ctx.avg);
      var head = over(rgbOf(c.hdBg), c.hdOp / 100, ctx.top);
      var side = over(rgbOf(c.sbBg), c.sbOp / 100, ctx.left);
      var dlg = over(rgbOf(c.dlBg), c.dlOp / 100, ctx.avg);
      return [
        { key: "text", label: "Text on cards", fg: c.text, bg: card },
        { key: "text2", label: "Secondary text on cards", fg: c.text2, bg: card },
        { key: "hdText", label: "Header text on header", fg: c.hdText, bg: head },
        { key: "sbText", label: "Sidebar text on sidebar", fg: c.sbText, bg: side },
        { key: "sbSel", label: "Selected item on sidebar", fg: c.sbSel, bg: side },
        { key: "text", label: "Dialog text on dialog", fg: c.text, bg: dlg }
      ];
    }

    _renderContrast() {
      if (!this._ctBox) return;
      var self = this, rows = this._contrastRows();
      var table = h("table", { class: "ct" }, h("tr", null, h("th", { text: "Pair" }), h("th", { text: "Ratio" }), h("th", { text: "Level" }), h("th", { text: "" })));
      rows.forEach(function (r) {
        var ratio = ratioOf(rgbOf(r.fg), r.bg), b = badge(ratio);
        table.append(h("tr", null,
          h("td", { text: r.label }), h("td", { text: ratio.toFixed(2) + ":1" }),
          h("td", null, h("span", { class: "badge " + b[1], text: b[0] })),
          h("td", null, ratio >= 4.5 ? "" : h("button", { class: "btn", type: "button", onclick: function () { self._fixText(r); } }, "Fix text colour"))));
      });
      this._ctBox.textContent = "";
      this._ctBox.append(table, h("p", { class: "note", text: "Measured with the card or header opacity blended over " + (this._wp[this._pm] && this._s.bgType === "image" ? "the wallpaper's average colour (after dimming)." : "the background colour (no wallpaper analysed).") }));
    }

    _fixText(r) {
      this._checkpoint();
      var v = r.fg;
      // Card text and dialog text share one colour: satisfy every surface that uses it.
      this._contrastRows().filter(function (x) { return x.key === r.key; }).forEach(function (x) { v = fixedText(v, x.bg, 4.5); });
      this._s[this._pm][r.key] = v;
      this._syncAll();
      this._render();
      this._say("Nudged the colour until it reaches AA (4.5:1). Press Save and apply to keep it.", "");
    }

    async _extractPalette() {
      var m = this._pm;
      this._palNote.textContent = "Reading the wallpaper...";
      this._wp[m] = null;
      await this._ensureWallpaper(m);
      var wp = this._wp[m];
      if (!wp) {
        // No image: build the palette from the Look's own background colours instead.
        this._swatches = [rgbOf(this._s[m].bg), rgbOf(this._s[m].bg2), rgbOf(this._s.primary), rgbOf(this._s.accent), rgbOf(this._s[m].card)];
        this._palNote.textContent = "No readable wallpaper for " + m + " mode; suggestions come from the Look's colours.";
      } else {
        this._swatches = pickSwatches(medianCut(wp.px.slice(), 8));
        this._palNote.textContent = "Five suggestions for " + m + " mode, including sidebar, header and dialogs. Tick what to change, then apply to Light, Dark or both.";
      }
      this._renderSwatches();
    }

    _palTargets() {
      var t = { cards: true, accent: true, sidebar: true, header: true, dialogs: true };
      try { var o = JSON.parse(lsGet("zoosh_pal_targets") || "{}"); Object.keys(t).forEach(function (k) { if (typeof o[k] === "boolean") t[k] = o[k]; }); } catch (e) { /* defaults */ }
      return t;
    }

    _renderSwatches() {
      var self = this, dark = this._pm === "dark", targets = this._palTargets();
      this._palBox.textContent = "";
      var checks = h("div", { class: "row palchecks", role: "group", "aria-label": "Apply to" }, h("span", { class: "note", text: "Apply to:" }));
      [["cards", "Cards and text"], ["accent", "Accent colours"], ["sidebar", "Sidebar"], ["header", "Header"], ["dialogs", "Dialogs"]].forEach(function (o) {
        var id = "pt-" + o[0], cb = h("input", { type: "checkbox", id: id, checked: targets[o[0]], "data-t": o[0] });
        cb.addEventListener("change", function () { var t = self._palTargets(); t[o[0]] = cb.checked; lsSet("zoosh_pal_targets", JSON.stringify(t)); });
        checks.append(h("span", { class: "f chk" }, cb, h("label", { for: id, text: o[1] })));
      });
      this._palBox.append(checks);
      var list = h("div", { class: "swatches" });
      this._swatches.forEach(function (rgb) {
        var p = fullPalette(rgb, dark, self._ctx(self._pm));
        var strip = h("span", { class: "strip", "aria-hidden": "true" },
          h("i", { class: "sb", style: "background:" + p.sbBg }, h("b", { style: "background:" + p.sbSel })),
          h("span", { class: "col" },
            h("i", { class: "hd", style: "background:" + p.hdBg + ";color:" + p.hdText, text: "Aa" }),
            h("i", { class: "cd", style: "background:" + p.card + ";color:" + p.text, text: "Aa" })),
          h("i", { class: "ac", style: "background:" + p.accent }));
        var mk = function (label, which) { return h("button", { class: "btn", type: "button", "aria-label": label + " with accent " + p.accent, onclick: function () { self._applyPalette(rgb, which); } }, label); };
        list.append(h("div", { class: "pal", "data-accent": p.accent }, strip, h("span", { class: "note", text: p.accent }),
          h("span", { class: "row" }, mk("Light", "light"), mk("Dark", "dark"), mk("Both", "both"))));
      });
      this._palBox.append(list);
    }

    // Apply the ticked parts of a suggestion to light, dark or both modes. One undo step.
    async _applyPalette(rgb, which) {
      var modes = which === "both" ? ["light", "dark"] : [which];
      for (var k = 0; k < modes.length; k++) await this._ensureWallpaper(modes[k]);
      var t = this._palTargets();
      if (!t.cards && !t.accent && !t.sidebar && !t.header && !t.dialogs) { this._say("Tick at least one part to apply.", "warn"); return; }
      this._checkpoint();
      var s = this._s, accentFrom = null;
      modes.forEach(function (m) {
        var p = fullPalette(rgb, m === "dark", this._ctx(m)), c = s[m];
        if (accentFrom === null) accentFrom = p;
        if (t.cards) { c.card = p.card; c.text = p.text; c.text2 = p.text2; }
        if (t.accent) c.icActive = p.accent;
        if (t.sidebar) { c.sbBg = p.sbBg; c.sbOp = p.sbOp; c.sbText = p.sbText; c.sbIcon = p.sbIcon; c.sbSel = p.sbSel; }
        if (t.header) { c.hdBg = p.hdBg; c.hdOp = p.hdOp; c.hdText = p.hdText; }
        if (t.dialogs) { c.dlBg = p.dlBg; c.dlOp = p.dlOp; }
      }, this);
      if (t.accent && accentFrom) s.accent = accentFrom.accent;
      this._syncAll();
      this._render();
      this._say("Palette applied to " + (modes.length === 2 ? "light and dark" : modes[0]) + " mode. Undo restores the previous colours.", "");
    }

    // -------------------------------------------------------------- upload
    _readAsBase64(blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () {
          var r = String(fr.result || "");
          var i = r.indexOf(",");
          resolve(i >= 0 ? r.slice(i + 1) : "");
        };
        fr.onerror = function () { reject(new Error("Could not read the file.")); };
        fr.readAsDataURL(blob);
      });
    }

    // Every upload is re-encoded through a canvas, whatever its size. That drops EXIF, GPS and
    // XMP metadata. Images with transparency stay PNG; everything else becomes JPEG. Large
    // images are scaled down (2560 px) and compressed until they fit the upload limit.
    async _reencode(file) {
      var url = URL.createObjectURL(file);
      try {
        var img = new Image();
        await new Promise(function (resolve, reject) { img.onload = resolve; img.onerror = function () { reject(new Error("Could not decode the image.")); }; img.src = url; });
        var scale = Math.min(1, 2560 / Math.max(1, img.naturalWidth, img.naturalHeight));
        var quality = 0.88, png = null;
        for (var attempt = 0; attempt < 12; attempt++) {
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          var ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("This browser cannot process images.");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          if (png === null) {
            // Decide once: does the picture really use transparency?
            var px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            png = false;
            for (var i = 3; i < px.length; i += 4) { if (px[i] < 255) { png = true; break; } }
          }
          var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, png ? "image/png" : "image/jpeg", quality); });
          if (blob && blob.size <= MAX_RAW_BYTES) return { blob: blob, type: png ? "image/png" : "image/jpeg" };
          if (png || quality <= 0.55) scale *= 0.8; else quality -= 0.1;
        }
        throw new Error("The image is too large even after shrinking.");
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    // target: "light", "dark" or "both". The wallpaper path is set automatically.
    async _upload(target, file, picker) {
      var fail = function (m) { if (picker) picker.error(m); this._say(m, "err"); }.bind(this);
      if (picker) picker.error("");
      if (ALLOWED_TYPES.indexOf(file.type) === -1) { fail("That file is not a JPEG, PNG or WebP image."); return; }
      this._say("Uploading " + file.name + "...", "");
      try {
        this._say("Preparing " + file.name + " (removing metadata)...", "");
        var enc = await this._reencode(file);
        var blob = enc.blob, type = enc.type;
        var data = await this._readAsBase64(blob);
        var res = await this._hass.callWS({ type: "zoosh/upload_image", data: data, content_type: type });
        this._checkpoint();
        var modes = target === "both" ? ["light", "dark"] : [target];
        var url = URL.createObjectURL(blob);
        modes.forEach(function (m) {
          var old = this._blobs[m];
          this._blobs[m] = { path: res.path, url: url, size: blob.size };
          this._s[m].img = res.path;
          if (old && old.url && old.url !== url && !modes.some(function (x) { return x !== m && this._blobs[x] && this._blobs[x].url === old.url; }, this)) URL.revokeObjectURL(old.url);
        }, this);
        this._s.bgType = "image";
        var base = res.path.split("/").pop();
        if (this._images.indexOf(base) === -1) this._fillImages(this._images.concat([base]));
        this._syncAll();
        this._render();
        this._say("Uploaded " + base + " and set it for " + (modes.length === 2 ? "light and dark" : modes[0]) + " mode. Press Save and apply to keep it." + (res.warning ? " " + res.warning : ""), res.warning ? "warn" : "ok");
      } catch (e) {
        fail(e && e.code === "quota_exceeded" ? e.message : "Upload failed: " + (e && e.message ? e.message : "unknown error"));
      }
    }
  }

  ZooshPanel._util = { normalize: normalize, regionAvg: regionAvg, fullPalette: fullPalette, medianCut: medianCut, pickSwatches: pickSwatches, paletteFor: paletteFor, fixedText: fixedText, ratioOf: ratioOf, rgbOf: rgbOf, lumOf: lumOf, badge: badge };
  customElements.define("zoosh-panel", ZooshPanel);
})();
