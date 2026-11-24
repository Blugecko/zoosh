// SPDX-License-Identifier: Apache-2.0
/* Zoosh effects (loaded for every user as an extra module).
 *
 * Applies card scale, hover/press scale, entrance animation and a press effect on
 * switches, driven only by the --zs-* variables that a Zoosh theme defines.
 * If the active theme does not define them, this script adds no styles at all.
 *
 * Why `scale` and not `zoom` or `transform: scale()`:
 *  - `zoom` changes layout size, so cards in Sections/masonry grids would reflow and
 *    jump on every hover, and it is not animatable on every WebKit build.
 *  - the `transform` property is needed by the entrance keyframes (translate/scale-in),
 *    so using it for the static size would make the two effects fight.
 *  - the standalone `scale` property (Safari 14.1+, all current Chromium/WebKit) is
 *    composited, does not touch layout, animates smoothly and composes with `transform`.
 *  Trade-off: a scaled card keeps its grid cell, so cards below 100% leave a gap and
 *  above 100% overlap their neighbours slightly.
 *
 * Version 1.1 adds opt-in extras, each driven by a --zs-* variable of the active theme:
 * glass depth layer ("Liquid Glass" approximation, no real refraction), press shimmer and
 * ripple (Web Animations API, composited), spring dialogs, view fade, sidebar hover slide,
 * a slowly drifting wallpaper layer, "living light" and per-person Looks. All of them are
 * off under prefers-reduced-motion (the animated ones) and in Performance mode, and the
 * continuous ones pause while the tab is hidden.
 *
 * This depends on Home Assistant's internal structure (ha-card, ha-switch, dialogs, sidebar
 * and the dashboard view as custom elements with open shadow roots). It may need updating
 * after a Home Assistant release; every part fails safe (no styles, no errors).
 */
(function () {
  "use strict";
  if (window.__zooshFx) return;
  var VERSION = "1.2.2";
  var T0 = (window.performance && performance.now) ? performance.now() : 0;
  window.__zooshFx = { version: VERSION, getDiagnostics: function () { try { return diagnostics(); } catch (e) { return { version: VERSION, error: "diagnostics failed" }; } } };

  var MAX_STAGGER_INDEX = 12;
  var root = document.documentElement;
  var reduceMq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  var cardSheet = null;
  var switchSheet = null;
  var SHEETS = {};
  try {
    cardSheet = new CSSStyleSheet();
    switchSheet = new CSSStyleSheet();
    ["glassCard", "glassHeader", "glassDialog", "glassSide", "dialog", "sidebar", "view", "drift"].forEach(function (k) {
      SHEETS[k] = new CSSStyleSheet();
    });
  } catch (e) {
    return; // Constructable stylesheets unsupported: do nothing rather than break the UI.
  }

  // Which sheets each custom element receives (when it has an open shadow root).
  var TAGS = {
    "ha-card": [cardSheet, SHEETS.glassCard],
    "ha-switch": [switchSheet],
    "hui-root": [SHEETS.glassHeader],
    "ha-top-app-bar-fixed": [SHEETS.glassHeader],
    "ha-sidebar": [SHEETS.sidebar, SHEETS.glassSide],
    "mwc-dialog": [SHEETS.dialog, SHEETS.glassDialog],
    "ha-wa-dialog": [SHEETS.dialog, SHEETS.glassDialog],
    "wa-dialog": [SHEETS.dialog, SHEETS.glassDialog],
    "hui-view": [SHEETS.view],
    "hui-view-container": [SHEETS.drift]
  };
  var BACKDROP_OK = true;
  try {
    BACKDROP_OK = !!(window.CSS && CSS.supports && (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)")));
  } catch (e) { BACKDROP_OK = false; }
  function sup(a, b) { try { return !!(window.CSS && CSS.supports && (b === undefined ? CSS.supports(a) : CSS.supports(a, b))); } catch (e) { return false; } }
  var MASK_STD = sup("mask-composite", "exclude");
  var MASK_WK = sup("-webkit-mask-composite", "xor");
  var MASK_OK = MASK_STD || MASK_WK;
  // Older WebKit (the iOS app web view) may lack the standalone `scale` property: use transform.
  var SCALE_OK = sup("scale", "1");
  var SP = SCALE_OK ? "scale" : "transform";
  function scaleVal(expr) { return SCALE_OK ? expr : "scale(" + expr + ")"; }

  // Each shadow root gets the sheet once. WeakSets let closed-over roots be garbage collected.
  var adopted = new WeakSet();
  var plainSeen = new WeakSet();
  var counts = { roots: 0, cards: 0, plain: 0 };
  var RETRY_DELAYS = [16, 50, 100, 300, 700, 1500];
  var observedRoots = new WeakSet();
  var retries = new WeakMap();

  // ------------------------------------------------------------ theme values
  function readVar(cs, name) { return cs.getPropertyValue(name).trim(); }
  function num(value, fallback) {
    var n = parseFloat(value);
    return isFinite(n) ? n : fallback;
  }

  // Theme variables normally sit on <html>, but be tolerant: also look at <home-assistant>
  // and <body>. The first source that has the Zoosh marker variable wins.
  function varSources() {
    var list = [root];
    var ha = document.querySelector ? document.querySelector("home-assistant") : null;
    if (ha) list.push(ha);
    if (document.body) list.push(document.body);
    return list;
  }
  function pickStyle() {
    var list = varSources();
    for (var i = 0; i < list.length; i++) {
      var cs = getComputedStyle(list[i]);
      if (readVar(cs, "--zs-card-scale") !== "") return cs;
    }
    return null;
  }

  function readTheme() {
    var cs = pickStyle();
    if (!cs) return null; // active theme is not a Zoosh theme (or it has not arrived yet)
    var scaleRaw = readVar(cs, "--zs-card-scale");
    var v = {
      scale: num(scaleRaw, 1),
      hover: num(readVar(cs, "--zs-hover-scale"), 1),
      press: num(readVar(cs, "--zs-press-scale"), 1),
      dur: num(readVar(cs, "--zs-anim-duration-ms"), 0),
      entrance: readVar(cs, "--zs-entrance") || "none",
      toggle: readVar(cs, "--zs-toggle-anim") === "on",
      shimmer: readVar(cs, "--zs-shimmer") === "on",
      ripple: readVar(cs, "--zs-ripple") === "on",
      dialog: readVar(cs, "--zs-dialog-spring") === "on",
      page: readVar(cs, "--zs-page-transition") === "on",
      sidebar: readVar(cs, "--zs-sidebar-hover") === "on",
      drift: readVar(cs, "--zs-drift") === "on",
      perf: readVar(cs, "--zs-perf") === "on",
      glass: readVar(cs, "--zs-glass") === "on",
      live: readVar(cs, "--zs-g-live") === "on"
    };
    if (v.perf) {
      // Performance mode: no animation at all; the static card size and glass edge stay.
      v.dur = 0; v.shimmer = v.ripple = v.dialog = v.page = v.sidebar = v.drift = v.live = false;
    }
    // Clamp so a hand-edited theme cannot produce absurd values.
    v.scale = Math.min(1.2, Math.max(0.8, v.scale));
    v.hover = Math.min(1.08, Math.max(1, v.hover));
    v.press = Math.min(1, Math.max(0.9, v.press));
    if (!v.perf) v.dur = Math.min(600, Math.max(0, v.dur));
    if (["fade", "fade-up", "scale-in"].indexOf(v.entrance) === -1) v.entrance = "none";
    return v;
  }

  // -------------------------------------------------------------- stylesheets
  var KEYFRAMES = {
    "fade": "@keyframes zs-in { from { opacity: 0; } }",
    "fade-up": "@keyframes zs-in { from { opacity: 0; transform: translateY(14px); } }",
    "scale-in": "@keyframes zs-in { from { opacity: 0; transform: scale(0.94); } }"
  };
  var NO_MOTION = "@media (prefers-reduced-motion: no-preference)";

  function buildCardCss(v) {
    if (!v) return "";
    var css = [];
    var moving = v.dur > 0;
    var interactive = moving && (v.hover !== 1 || v.press !== 1);
    var scaled = v.scale !== 1 || interactive;
    if (scaled) {
      // --zs-m is the interaction multiplier; the base size is --zs-card-scale.
      css.push(":host { --zs-m: 1; " + SP + ": " + scaleVal("calc(var(--zs-card-scale, 1) * var(--zs-m))") + "; }");
    }
    if (interactive) {
      css.push(NO_MOTION + " { :host { transition: " + SP + " calc(var(--zs-anim-duration-ms, 200) * 1ms) var(--zs-anim-easing, ease-out); } }");
      if (v.hover !== 1) {
        // Hover only on devices that really hover, so touch screens do not get a stuck state.
        css.push("@media (hover: hover) and (prefers-reduced-motion: no-preference) { :host(:hover) { --zs-m: var(--zs-hover-scale, 1); } }");
      }
      if (v.press !== 1) {
        css.push(NO_MOTION + " { :host(:active) { --zs-m: var(--zs-press-scale, 1); } }");
      }
    }
    if (moving && v.entrance !== "none") {
      css.push(KEYFRAMES[v.entrance]);
      css.push(NO_MOTION + " { :host { animation: zs-in calc(var(--zs-anim-duration-ms, 200) * 2ms) var(--zs-anim-easing, ease-out) calc(var(--zs-i, 0) * var(--zs-stagger-ms, 0) * 1ms) backwards; } }");
    }
    return css.join("\n");
  }

  function buildSwitchCss(v) {
    if (!v || !v.toggle || v.dur <= 0) return "";
    return NO_MOTION + " { :host { transition: " + SP + " calc(var(--zs-anim-duration-ms, 200) * 1ms) var(--zs-anim-easing, ease-out); } :host(:active) { " + SP + ": " + scaleVal("0.92") + "; } }";
  }

  var EDGE = "var(--zs-g-edge, 0.6)", SHEEN = "var(--zs-g-sheen, 0.4)", GLOW = "var(--zs-g-glow, 0.3)";
  var ANGLE = "var(--zs-g-angle, 135deg)";

  // The glass layer: gradient edge (mask-composite, with a plain border fallback), a top
  // sheen and an inner glow, all painted by two pseudo-elements. No extra blur layers.
  function glassCardCss(v) {
    if (!v || !v.glass) return "";
    var css = [":host { position: relative; isolation: isolate; }"];
    if (!BACKDROP_OK) css.push(":host { background: var(--zs-g-solid, rgba(40,40,44,0.92)) !important; }");
    else css.push(":host { -webkit-backdrop-filter: var(--ha-card-backdrop-filter, none); backdrop-filter: var(--ha-card-backdrop-filter, none); }");
    css.push(":host::after { content: \"\"; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: -1; " +
      "background: linear-gradient(" + ANGLE + ", rgba(255,255,255,calc(" + SHEEN + " * 0.38)) 0%, rgba(255,255,255,0) 46%); " +
      "box-shadow: inset 0 0 calc(" + GLOW + " * 26px) rgba(255,255,255,calc(" + GLOW + " * 0.3)); }");
    if (MASK_OK) {
      // Emit only the forms this browser understands: prefixed first, standard last.
      var edgeBg = "linear-gradient(" + ANGLE + ", rgba(255,255,255,calc(" + EDGE + " * 0.95)) 0%, rgba(255,255,255,calc(" + EDGE + " * 0.28)) 45%, rgba(255,255,255,calc(" + EDGE + " * 0.06)) 100%)";
      var maskDecl = "";
      if (MASK_WK) maskDecl += "-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; ";
      if (MASK_STD) maskDecl += "mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; ";
      css.push(":host::before { content: \"\"; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; z-index: 1; background: " + edgeBg + "; " + maskDecl + "}");
    } else {
      css.push(":host { box-shadow: inset 0 0 0 1px rgba(255,255,255,calc(" + EDGE + " * 0.4)), var(--ha-card-box-shadow, none); }");
    }
    return css.join("\n");
  }
  function glassSurfaceCss(v, selector) {
    if (!v || !v.glass) return "";
    var rule = selector + " { box-shadow: inset 0 1px 0 rgba(255,255,255,calc(" + EDGE + " * 0.7)), inset 0 0 calc(" + GLOW + " * 20px) rgba(255,255,255,calc(" + GLOW + " * 0.22)); " +
      "background-image: linear-gradient(" + ANGLE + ", rgba(255,255,255,calc(" + SHEEN + " * 0.3)), rgba(255,255,255,0) 50%); }";
    if (!BACKDROP_OK) rule += "\n" + selector + " { background-color: var(--zs-g-solid, rgba(40,40,44,0.92)); }";
    return rule;
  }
  function dialogCss(v) {
    if (!v || !v.dialog || v.dur <= 0) return "";
    return "@keyframes zs-dlg { from { opacity: 0; transform: scale(0.92); } }\n" +
      NO_MOTION + " { .mdc-dialog__surface, [part~=\"dialog\"], .dialog { animation: zs-dlg 340ms cubic-bezier(0.34,1.56,0.64,1) backwards; } }";
  }
  function viewCss(v) {
    if (!v || !v.page || v.dur <= 0) return "";
    return "@keyframes zs-view { from { opacity: 0; transform: translateY(8px); } }\n" +
      NO_MOTION + " { :host { animation: zs-view calc(var(--zs-anim-duration-ms, 200) * 1.4ms) var(--zs-anim-easing, ease-out) backwards; } }";
  }
  function sidebarCss(v) {
    if (!v || !v.sidebar || v.dur <= 0) return "";
    var items = "a, ha-md-list-item, paper-icon-item";
    return "@media (hover: hover) and (prefers-reduced-motion: no-preference) { " + items + " { transition: translate 180ms var(--zs-anim-easing, ease-out); } " +
      "a:hover, ha-md-list-item:hover, paper-icon-item:hover { translate: 4px 0; } }";
  }
  function driftSheetCss(v) {
    if (!v || !v.drift) return "";
    return ""; // no host styles: the drift layer is self-contained (fixed, clipped on its own box)
  }

  var lastSignature = null;
  function setSheet(sheet, css) {
    try { sheet.replaceSync(css); } catch (e) { try { sheet.replaceSync(""); } catch (e2) { /* ignore */ } }
  }
  function refreshSheets() {
    var v = readTheme();
    current = v;
    var parts = {
      card: buildCardCss(v), sw: buildSwitchCss(v),
      glassCard: glassCardCss(v), glassHeader: glassSurfaceCss(v, ".header, .toolbar, header"),
      glassDialog: glassSurfaceCss(v, ".mdc-dialog__surface, [part~=\"dialog\"], .dialog"),
      glassSide: glassSurfaceCss(v, ".menu"),
      dialog: dialogCss(v), sidebar: sidebarCss(v), view: viewCss(v), drift: driftSheetCss(v)
    };
    var signature = JSON.stringify(parts);
    syncExtras(v); // cheap; handles on/off of the JS-driven effects
    if (v && !resolved) onResolved();
    if (signature === lastSignature) return; // unchanged: do not touch the sheets
    lastSignature = signature;
    rescanSoon(); // cards seen before the theme arrived (or skipped as plain) get re-judged
    // replaceSync updates every adopting root and does not mutate the DOM, so it cannot
    // trigger the observers below.
    setSheet(cardSheet, parts.card);
    setSheet(switchSheet, parts.sw);
    ["glassCard", "glassHeader", "glassDialog", "glassSide", "dialog", "sidebar", "view", "drift"].forEach(function (k) {
      setSheet(SHEETS[k], parts[k]);
    });
  }

  // ----------------------------------------------------------------- adoption
  function adoptSheet(shadow, sheet) {
    shadow.adoptedStyleSheets = shadow.adoptedStyleSheets.concat([sheet]);
  }

  var mo = new MutationObserver(function (records) {
    try {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) pending.push(added[j]);
        }
      }
      schedule();
    } catch (e) { /* never break Home Assistant */ }
  });

  function observeRoot(node) {
    if (observedRoots.has(node)) return;
    observedRoots.add(node);
    mo.observe(node, { childList: true, subtree: true });
    // Scroll events do not cross shadow roots, so listen in each root (passive, throttled).
    try { node.addEventListener("scroll", onScroll, { capture: true, passive: true }); } catch (e) { /* ignore */ }
  }

  var batchIndex = 0;

  // One throwing element must never abandon the batch or break Home Assistant.
  function safeHandle(el) { try { handleElement(el); } catch (e) { /* ignore */ } }

  // A card that Home Assistant draws without a surface (heading cards such as "Areas",
  // or any card styled with no background and no border) must not get the glass layer.
  function isPlainCard(el) {
    try {
      var root = el.getRootNode && el.getRootNode();
      var host = root && root.host;
      if (host && /heading|badge/.test(host.localName || "")) return true;
      if (el.classList && (el.classList.contains("heading") || el.classList.contains("zs-plain"))) return true;
      var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (!cs) return false;
      var bg = cs.backgroundColor, bgi = cs.backgroundImage;
      var noBg = (!bg || bg === "transparent" || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) && (!bgi || bgi === "none");
      var noBorder = parseFloat(cs.borderTopWidth || "0") === 0;
      var noShadow = !cs.boxShadow || cs.boxShadow === "none";
      return noBg && noBorder && noShadow;
    } catch (e) { return false; }
  }

  function handleElement(el) {
    var tag = el.localName;
    if (TAGS[tag]) {
      var sr = el.shadowRoot;
      if (!sr) {
        // Lit creates the shadow root on connect; retry once on the next frame.
        var tries = retries.get(el) || 0;
        // Bounded backoff (about 2.7 s in total): cold loads can be slow to create the root.
        if (tries < RETRY_DELAYS.length) {
          retries.set(el, tries + 1);
          setTimeout(function () { if (el.isConnected) { pending.push(el); schedule(); } }, RETRY_DELAYS[tries]);
        }
        return;
      }
      if (tag === "ha-card" && !adopted.has(sr)) {
        // Do not judge a card before the Zoosh theme has arrived or before Lit rendered it:
        // an unstyled card looks "plain". A full rescan runs once the theme resolves.
        if (!current || el.hasUpdated === false) return;
        if (isPlainCard(el)) { // headings and other chrome-less cards stay untouched
          if (!plainSeen.has(el)) { plainSeen.add(el); counts.plain++; }
          return;
        }
        if (plainSeen.has(el)) { plainSeen.delete(el); counts.plain--; }
      }
      if (tag === "ha-card" && !adopted.has(sr)) {
        el.style.setProperty("--zs-i", String(Math.min(batchIndex++, MAX_STAGGER_INDEX)));
      }
      if (!adopted.has(sr)) {
        TAGS[tag].forEach(function (sheet) { adoptSheet(sr, sheet); });
        adopted.add(sr);
        counts.roots++;
        if (tag === "ha-card") counts.cards++;
      }
      if (tag === "hui-view-container" || tag === "hui-view") { driftHost = el; syncDrift(); }
    }
    if (el.shadowRoot) scanRoot(el.shadowRoot);
  }

  function scanRoot(shadow) {
    observeRoot(shadow);
    var all = shadow.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) safeHandle(all[i]);
  }

  function scanSubtree(el) {
    safeHandle(el);
    var all = el.querySelectorAll ? el.querySelectorAll("*") : [];
    for (var i = 0; i < all.length; i++) safeHandle(all[i]);
  }

  var pending = [];
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      var work = pending;
      pending = [];
      batchIndex = 0;
      for (var i = 0; i < work.length; i++) {
        try { if (work[i].isConnected) scanSubtree(work[i]); } catch (e) { /* keep going */ }
      }
    });
  }

  // ------------------------------------------------- JS-driven effects (opt-in)
  var current = null;
  var driftHost = null;
  var driftLayer = null;
  var driftAnim = null;
  var layers = new WeakMap();
  var colorMixOk = false;
  try { colorMixOk = !!(window.CSS && CSS.supports && CSS.supports("color", "color-mix(in srgb, red 50%, transparent)")); } catch (e) { colorMixOk = false; }

  function motionOk() {
    return !!current && !current.perf && !(reduceMq && reduceMq.matches);
  }

  function pressLayer(card) {
    var sr = card.shadowRoot;
    if (!sr) return null;
    var rec = layers.get(card);
    if (rec) return rec;
    var box = document.createElement("div");
    box.setAttribute("data-zoosh-fx", "");
    box.style.cssText = "position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:2;";
    var shimmer = document.createElement("div");
    shimmer.style.cssText = "position:absolute;inset:0;opacity:0;background:linear-gradient(110deg,transparent 32%,rgba(255,255,255,0.38) 50%,transparent 68%);";
    var ripple = document.createElement("div");
    ripple.style.cssText = "position:absolute;inset:0;opacity:0;";
    box.appendChild(shimmer);
    box.appendChild(ripple);
    sr.appendChild(box);
    rec = { shimmer: shimmer, ripple: ripple };
    layers.set(card, rec);
    return rec;
  }

  function onPointerDown(ev) {
    if (!current || !(current.shimmer || current.ripple) || !motionOk()) return;
    try {
      var path = ev.composedPath ? ev.composedPath() : [];
      var card = null;
      for (var i = 0; i < path.length; i++) {
        if (path[i] && path[i].localName === "ha-card") { card = path[i]; break; }
      }
      if (!card || !card.animate) return;
      var rec = pressLayer(card);
      if (!rec) return;
      var rect = card.getBoundingClientRect();
      var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      if (current.shimmer) {
        rec.shimmer.animate([
          { opacity: 1, transform: "translateX(-100%)" },
          { opacity: 1, transform: "translateX(100%)" }
        ], { duration: 650, easing: "ease-out" });
      }
      if (current.ripple) {
        var colour = colorMixOk ? "color-mix(in srgb, var(--accent-color, #ff9f0a) 55%, transparent)" : "rgba(255,255,255,0.35)";
        rec.ripple.style.background = "radial-gradient(circle at " + Math.round(x) + "px " + Math.round(y) + "px, " + colour + " 0%, transparent 62%)";
        rec.ripple.animate([
          { opacity: 0.9, transform: "scale(0.7)" },
          { opacity: 0, transform: "scale(1.12)" }
        ], { duration: 560, easing: "ease-out" });
      }
    } catch (e) { /* effects must never break the UI */ }
  }
  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });

  // Slow wallpaper drift: one fixed layer inside the view container's shadow root, moved
  // with transform only (compositor). Created once, removed when the effect is off.
  function syncDrift() {
    var want = !!(current && current.drift) && motionOk() && !document.hidden;
    var wantLayer = !!(current && current.drift) && motionOk();
    if (!wantLayer || !driftHost || !driftHost.isConnected || !driftHost.shadowRoot) {
      removeDrift();
      return;
    }
    try {
      if (!driftLayer || driftLayer.parentNode !== driftHost.shadowRoot) {
        removeDrift();
        var bg = getComputedStyle(driftHost).backgroundImage;
        if (!bg || bg.indexOf("url(") === -1) return; // no wallpaper image to move
        driftLayer = document.createElement("div");
        driftLayer.setAttribute("data-zoosh-fx", "");
        driftLayer.style.cssText = "position:fixed;inset:0;overflow:hidden;z-index:-1;pointer-events:none;contain:strict;";
        var inner = document.createElement("div");
        inner.style.cssText = "position:absolute;inset:-6%;will-change:transform;background-size:cover;background-position:center;background-image:" + bg + ";";
        driftLayer.appendChild(inner);
        driftHost.shadowRoot.insertBefore(driftLayer, driftHost.shadowRoot.firstChild);
        if (inner.animate) {
          driftAnim = inner.animate([
            { transform: "translate3d(-1.5%,-1%,0) scale(1.03)" },
            { transform: "translate3d(1.5%,1%,0) scale(1.07)" }
          ], { duration: 70000, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
        }
      }
      if (driftAnim) { if (want) driftAnim.play(); else driftAnim.pause(); }
    } catch (e) { removeDrift(); }
  }
  function removeDrift() {
    try { if (driftAnim) driftAnim.cancel(); } catch (e) { /* ignore */ }
    driftAnim = null;
    if (driftLayer && driftLayer.parentNode) driftLayer.parentNode.removeChild(driftLayer);
    driftLayer = null;
  }

  // Living light: the highlight angle follows scroll and, on pointer devices, the cursor.
  // The angle is a custom property on <body> (inherits into shadow roots); body is not the
  // element the theme watcher observes, so this never re-triggers theme refreshes.
  var angleRaf = false, lastAngle = 135, pendingAngle = 135;
  var finePointer = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  var scrollBase = 0, pointerOff = 0;
  function pushAngle() {
    if (angleRaf) return;
    angleRaf = true;
    requestAnimationFrame(function () {
      angleRaf = false;
      var a = Math.round(135 + scrollBase + pointerOff);
      if (a === lastAngle || !document.body) return;
      lastAngle = a;
      document.body.style.setProperty("--zs-g-angle", a + "deg");
    });
  }
  function liveOn() { return !!(current && current.glass && current.live && motionOk() && !document.hidden); }
  function onScroll(ev) {
    if (!liveOn()) return;
    var t = ev.target, top = 0;
    try { top = (t && t.scrollTop) || window.scrollY || 0; } catch (e) { top = 0; }
    scrollBase = Math.sin(top / 260) * 16;
    pushAngle();
  }
  document.addEventListener("pointermove", function (ev) {
    if (!finePointer || !liveOn()) return;
    pointerOff = (ev.clientX / Math.max(1, window.innerWidth) - 0.5) * 24 + (ev.clientY / Math.max(1, window.innerHeight) - 0.5) * 14;
    pushAngle();
  }, { passive: true });

  function syncExtras(v) {
    syncDrift();
    if (!liveOn() && document.body && lastAngle !== 135) {
      lastAngle = 135; scrollBase = 0; pointerOff = 0;
      document.body.style.removeProperty("--zs-g-angle");
    }
  }
  document.addEventListener("visibilitychange", function () { syncDrift(); });

  // ------------------------------------------------------- per-person Looks
  // The admin maps a user to a Look in the Zoosh panel. Home Assistant's frontend listens
  // for a "settheme" event on the <home-assistant> element (its theme mixin) and stores the
  // choice in this browser, so the person can still change it later. We only apply it when
  // the mapping is new to this browser and the person has not picked their own theme.
  // Everything here is best effort: any failure is a silent no-op.
  var MY_SIG_KEY = "zoosh_my_sig", MY_THEME_KEY = "zoosh_my_theme";
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function applyMyLook(tries) {
    var ha = document.querySelector("home-assistant");
    var hass = ha && ha.hass;
    if (!hass || typeof hass.callWS !== "function" || !hass.themes) {
      if (tries < 40) setTimeout(function () { applyMyLook(tries + 1); }, 1500);
      return;
    }
    var p;
    try { p = hass.callWS({ type: "zoosh/my_look" }); } catch (e) { return; }
    if (!p || typeof p.then !== "function") return;
    p.then(function (res) {
      if (!res || typeof res !== "object") return;
      if (!res.theme || !res.sig) { lsSet(MY_SIG_KEY, null); lsSet(MY_THEME_KEY, null); return; }
      if (lsGet(MY_SIG_KEY) === res.sig) return; // already handled for this mapping
      var themes = hass.themes && hass.themes.themes;
      if (!themes || !themes[res.theme]) {
        if (tries < 40) setTimeout(function () { applyMyLook(tries + 1); }, 3000); // theme file not loaded yet
        return;
      }
      var sel = null;
      try { sel = JSON.parse(lsGet("selectedTheme") || "null"); } catch (e) { sel = null; }
      var chosen = sel && typeof sel.theme === "string" ? sel.theme : "";
      var last = lsGet(MY_THEME_KEY) || "";
      var ownChoice = chosen !== "" && chosen !== "default" && chosen !== last && chosen.indexOf("Zoosh - ") !== 0;
      if (!ownChoice) {
        ha.dispatchEvent(new CustomEvent("settheme", { detail: { theme: res.theme }, bubbles: true, composed: true }));
        lsSet(MY_THEME_KEY, res.theme);
      }
      lsSet(MY_SIG_KEY, res.sig); // remember the mapping either way, so we never fight the person
    }).catch(function () { /* not an error for the user */ });
  }
  window.addEventListener("load", function () { setTimeout(function () { applyMyLook(0); }, 800); }, { once: true });

  // --------------------------------------------------------------- theme watch
  // On a cold load Home Assistant applies the theme AFTER this script runs (the theme list
  // arrives over the websocket), possibly on <html> or on <home-assistant>. So we:
  //  - watch style/class on both elements,
  //  - react to HA's theme events when they exist,
  //  - re-check on DOMContentLoaded, load and when the tab becomes visible,
  //  - retry with a bounded backoff until the first Zoosh variables are seen.
  // "No Zoosh variables" never disables the script: the shared sheets are simply empty and
  // are filled in place (replaceSync) when the variables show up, then cleared again if the
  // theme becomes a non-Zoosh one.
  var resolved = false, resolveMs = null, retriesUsed = 0, backoff = [];
  var BACKOFF = [100, 300, 700, 1500, 3000, 6000, 10000];
  var themeScheduled = false, rescanScheduled = false, observedHa = null;
  function scheduleThemeRefresh() {
    if (themeScheduled) return;
    themeScheduled = true;
    var run = function () { themeScheduled = false; try { observeHa(); refreshSheets(); } catch (e) { /* ignore */ } };
    // rAF does not run in hidden tabs: fall back to a timer so a background cold load resolves.
    if (document.hidden) setTimeout(run, 50); else requestAnimationFrame(run);
  }
  function observeHa() {
    var ha = document.querySelector ? document.querySelector("home-assistant") : null;
    if (!ha || ha === observedHa) return;
    observedHa = ha;
    try { new MutationObserver(scheduleThemeRefresh).observe(ha, { attributes: true, attributeFilter: ["style", "class"] }); } catch (e) { /* ignore */ }
  }
  function rescanSoon() {
    if (rescanScheduled) return;
    rescanScheduled = true;
    setTimeout(function () {
      rescanScheduled = false;
      pending.push(document.documentElement);
      schedule();
    }, 0);
  }
  function stopBackoff() {
    backoff.forEach(function (t) { clearTimeout(t); });
    backoff = [];
  }
  function onResolved() {
    resolved = true;
    resolveMs = Math.round(((window.performance && performance.now) ? performance.now() : 0) - T0);
    stopBackoff();
    // Cards can finish rendering a little after the theme: two more bounded rescans.
    [1500, 4000].forEach(function (d) { setTimeout(rescanSoon, d); });
  }
  function startBackoff() {
    BACKOFF.forEach(function (d) {
      backoff.push(setTimeout(function () {
        backoff.shift();
        if (resolved) return;
        retriesUsed++;
        scheduleThemeRefresh();
      }, d));
    });
  }
  try { new MutationObserver(scheduleThemeRefresh).observe(root, { attributes: true, attributeFilter: ["style", "class", "data-theme"] }); } catch (e) { /* ignore */ }
  if (reduceMq && reduceMq.addEventListener) reduceMq.addEventListener("change", scheduleThemeRefresh);
  ["settheme", "themes-updated", "hass-themes-updated"].forEach(function (n) {
    try { document.addEventListener(n, scheduleThemeRefresh, true); } catch (e) { /* ignore */ }
  });
  document.addEventListener("DOMContentLoaded", scheduleThemeRefresh);
  window.addEventListener("load", scheduleThemeRefresh);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) scheduleThemeRefresh(); });

  function diagnostics() {
    var ha = document.querySelector ? document.querySelector("home-assistant") : null;
    var themes = ha && ha.hass && ha.hass.themes ? ha.hass.themes : null;
    var vars = {}, cs = null;
    try { cs = pickStyle(); } catch (e) { cs = null; }
    ["card-scale", "hover-scale", "press-scale", "anim-duration-ms", "anim-easing", "entrance", "stagger-ms", "toggle-anim", "shimmer", "ripple", "dialog-spring", "page-transition", "sidebar-hover", "drift", "perf", "glass", "g-edge", "g-glow", "g-sheen", "g-live"].forEach(function (k) {
      vars["--zs-" + k] = cs ? readVar(cs, "--zs-" + k) : "";
    });
    var mq = function (q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };
    return {
      version: VERSION,
      theme: themes && typeof themes.theme === "string" ? themes.theme : "",
      darkMode: themes && typeof themes.darkMode === "boolean" ? themes.darkMode : null,
      zoosh: !!current,
      vars: vars,
      support: {
        "backdrop-filter": sup("backdrop-filter", "blur(1px)"),
        "-webkit-backdrop-filter": sup("-webkit-backdrop-filter", "blur(1px)"),
        "mask-composite": MASK_STD,
        "-webkit-mask-composite": MASK_WK,
        "scale property": SCALE_OK,
        "color-mix": colorMixOk,
        "hover: hover": mq("(hover: hover)"),
        "pointer: fine": mq("(pointer: fine)"),
        "prefers-reduced-motion": mq("(prefers-reduced-motion: reduce)"),
        "constructable stylesheets": true
      },
      adopted: { shadowRoots: counts.roots, cards: counts.cards, plainCardsSkipped: counts.plain },
      resolved: resolved,
      resolveMs: resolveMs,
      retries: retriesUsed,
      timersLeft: backoff.length,
      userAgent: String(navigator.userAgent || ""),
      viewport: (window.innerWidth || 0) + " x " + (window.innerHeight || 0),
      pixelRatio: window.devicePixelRatio || 1
    };
  }

  // iOS WebKit only matches :active when a touch listener exists on the document.
  document.addEventListener("touchstart", function () {}, { passive: true });

  // ---------------------------------------------------------------------- go
  refreshSheets();
  observeHa();
  if (!resolved) startBackoff();
  observeRoot(document);
  (function () {
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) safeHandle(all[i]);
  })();
  // The first walk can run early; one more pass after load catches late renders.
  window.addEventListener("load", function () {
    if (document.body) { pending.push(document.body); schedule(); }
  }, { once: true });
})();
