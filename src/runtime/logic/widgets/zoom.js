/**
 * @file src/runtime/logic/widgets/zoom.js
 * @description Pan & Zoom interaction engine for Nexa runtime canvas frames.
 * Supports smooth trackpad pinch, mouse wheel zoom, click-drag pan, and touch gestures.
 */

var ZOOM_STEP_LIVE = 0.2;
var ZOOM_CSS = [
    ".nexa-zoom-toolbar { position: absolute; z-index: 5; right: 16px; bottom: 16px; display: flex; align-items: center;",
    "  background: #fff; border-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); overflow: hidden; }",
    ".nexa-zoom-toolbar button { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; padding: 0;",
    "  border: none; background: transparent; color: #555; cursor: pointer; }",
    ".nexa-zoom-toolbar button:hover { background: #f2f2f2; }",
    ".nexa-zoom-toolbar button svg { width: 12px; height: 12px; }",
    ".nexa-zoom-toolbar .nexa-zoom-level { width: 44px; text-align: center; font: 11px sans-serif; color: #555; user-select: none; }"
].join("\n");

var ZOOM_ICONS = {
    minus: '<svg viewBox="0 0 12 12"><rect x="1" y="5" width="10" height="2" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 12 12"><rect x="1" y="5" width="10" height="2" fill="currentColor"/><rect x="5" y="1" width="2" height="10" fill="currentColor"/></svg>',
    reset: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    fit: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M1.2 10.8L5 7"/><path d="M2.4 7H5v2.6"/><path d="M10.8 1.2L7 5"/><path d="M9.6 5H7V2.4"/></svg>'
};

export function setupZoom(el, comp, z) {
    if (!document.getElementById("nexa-zoom-css") && document.head) {
        var css = document.createElement("style");
        css.id = "nexa-zoom-css";
        css.textContent = ZOOM_CSS;
        document.head.appendChild(css);
    }
    var M = window.NexaModel;
    if (el.style.display !== "none") el.style.display = "block";
    el.style.padding = "0";
    el.style.overflowX = "";
    el.style.overflowY = "";
    el.style.overflow = "hidden";
    if (!el.style.position || el.style.position === "static") el.style.position = "relative";

    var vp = document.createElement("div");
    vp.className = "nexa-zoom-viewport" + (M && M.styleOf && M.styleOf(comp).scrollbar === "hidden" ? " nexa-no-scrollbar" : "");
    if (M && M.styleOf && M.styleOf(comp).scrollbar === "hidden") {
        vp.style.scrollbarWidth = "none";
    }
    Object.assign(vp.style, { position: "absolute", left: "0", top: "0", right: "0", bottom: "0", overflow: "auto", touchAction: "pan-x pan-y" });
    el.appendChild(vp);

    var sizer = document.createElement("div");
    sizer.className = "nexa-zoom-sizer";
    sizer.style.position = "relative";
    vp.appendChild(sizer);

    var stage = document.createElement("div");
    stage.className = "nexa-zoom-stage";
    var fcss = M && M.frameCss ? M.frameCss(comp, { scroll: false }) : {};
    ["background", "border", "border-radius", "overflow", "overflow-x", "overflow-y", "scrollbar-width"].forEach(function (k) { delete fcss[k]; });
    Object.assign(fcss, { position: "absolute", left: "0", top: "0", width: comp.w + "px", height: comp.h + "px", "box-sizing": "border-box", "transform-origin": "0 0" });
    Object.keys(fcss).forEach(function (k) {
        if (typeof stage.style.setProperty === "function") stage.style.setProperty(k, fcss[k]);
        else stage.style[k] = fcss[k];
    });
    sizer.appendChild(stage);

    var st = { k: 1, ox: 0, oy: 0 };
    var level = null;
    var changeFns = [];

    function view(w, h) {
        var full = { w: vp.offsetWidth || vp.clientWidth, h: vp.offsetHeight || vp.clientHeight };
        if (w !== undefined && w <= full.w && h <= full.h) return full;
        return { w: vp.clientWidth, h: vp.clientHeight };
    }

    function sizeStage() {
        var bw = el.clientWidth || comp.w, bh = el.clientHeight || comp.h;
        if (stage.style.width !== bw + "px") stage.style.width = bw + "px";
        if (stage.style.height !== bh + "px") stage.style.height = bh + "px";
    }

    function content() {
        sizeStage();
        var t = stage.style.transform;
        stage.style.transform = "none";
        var s = { w: Math.max(stage.scrollWidth, stage.offsetWidth, 1), h: Math.max(stage.scrollHeight, stage.offsetHeight, 1) };
        stage.style.transform = t;
        return s;
    }

    function clampK(k) { return Math.min(z.max || 5, Math.max(z.min || 0.1, Math.round(k * 1000) / 1000)); }

    function apply() {
        var c = content(), w = c.w * st.k, h = c.h * st.k, v = view(w, h);
        sizer.style.width = Math.max(v.w, w) + "px";
        sizer.style.height = Math.max(v.h, h) + "px";
        st.ox = w < v.w ? (v.w - w) / 2 : 0;
        st.oy = h < v.h ? (v.h - h) / 2 : 0;
        stage.style.transform = "translate(" + st.ox + "px, " + st.oy + "px) scale(" + st.k + ")";
        if (level) level.textContent = Math.round(st.k * 100) + "%";
        changeFns.slice().forEach(function (fn) { try { fn(); } catch (e) { /* listener error guarded */ } });
    }

    function zoomTo(k, px, py) {
        k = clampK(k);
        var v = view();
        if (px === undefined) { px = v.w / 2; py = v.h / 2; }
        var cx = (vp.scrollLeft + px - st.ox) / st.k, cy = (vp.scrollTop + py - st.oy) / st.k;
        st.k = k;
        apply();
        vp.scrollLeft = cx * k + st.ox - px;
        vp.scrollTop = cy * k + st.oy - py;
    }

    function zoomIn() { zoomTo(st.k + ZOOM_STEP_LIVE); }
    function zoomOut() { zoomTo(st.k - ZOOM_STEP_LIVE); }
    function reset() { st.k = clampK(1); apply(); vp.scrollLeft = 0; vp.scrollTop = 0; }
    function fit() {
        var c = content(), v = view(0, 0);
        st.k = clampK(Math.min(v.w / c.w, v.h / c.h));
        apply();
        vp.scrollLeft = 0; vp.scrollTop = 0;
    }
    function home() { if (z.start === "fit") fit(); else reset(); }

    function local(e) {
        var r = vp.getBoundingClientRect(), s = vp.offsetWidth ? r.width / vp.offsetWidth : 1;
        return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s, s: s };
    }

    function onControl(e) {
        var path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
        for (var i = 0; i < path.length && path[i] !== el; i++) {
            var t = path[i];
            if (t && t.tagName && /^(BUTTON|INPUT|TEXTAREA|SELECT|A|LABEL)$/.test(t.tagName)) return true;
            if (t && t.classList && t.classList.contains("nexa-zoom-toolbar")) return true;
        }
        return false;
    }

    vp.addEventListener("wheel", function (e) {
        if (!(e.ctrlKey || e.metaKey || z.wheel === "always")) return;
        e.preventDefault();
        var p = local(e);
        var small = Math.abs(e.deltaY) < 50;
        zoomTo(small ? st.k * Math.exp(-e.deltaY * 0.01) : st.k + (e.deltaY < 0 ? ZOOM_STEP_LIVE : -ZOOM_STEP_LIVE), p.x, p.y);
    }, { passive: false });

    var pointers = {}, pan = null, pinch = null, lastTap = null;
    vp.addEventListener("pointerdown", function (e) {
        if (onControl(e)) return;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pointers);
        if (ids.length === 2) {
            var a = pointers[ids[0]], b = pointers[ids[1]];
            pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: st.k };
            pan = null;
            return;
        }
        var onBackground = e.target === vp || e.target === sizer || e.target === stage;
        if (e.pointerType !== "touch" && (onBackground || e.button === 1)) {
            pan = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, stp: vp.scrollTop, s: local(e).s };
            if (vp.setPointerCapture) { try { vp.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } }
            e.preventDefault();
            stage.style.userSelect = "none";
        }
    });

    vp.addEventListener("dragstart", function (e) { if (pan) e.preventDefault(); });
    vp.addEventListener("pointermove", function (e) {
        if (!pointers[e.pointerId]) return;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pointers);
        if (pinch && ids.length === 2) {
            var a = pointers[ids[0]], b = pointers[ids[1]];
            var mid = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
            zoomTo(pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), mid.x, mid.y);
            return;
        }
        if (!pan) return;
        vp.scrollLeft = pan.sl - (e.clientX - pan.x) / pan.s;
        vp.scrollTop = pan.stp - (e.clientY - pan.y) / pan.s;
    });

    function up(e) {
        if (!pointers[e.pointerId]) return;
        if (pan && !pinch && e.type === "pointerup") {
            vp.scrollLeft = pan.sl - (e.clientX - pan.x) / pan.s;
            vp.scrollTop = pan.stp - (e.clientY - pan.y) / pan.s;
        }
        delete pointers[e.pointerId];
        if (Object.keys(pointers).length < 2) pinch = null;
        if (!Object.keys(pointers).length) { pan = null; stage.style.userSelect = ""; }
        if (e.type === "pointerup" && e.pointerType === "touch" && z.dblclick !== false) {
            var now = Date.now();
            if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
                lastTap = null;
                home();
            } else {
                lastTap = { t: now, x: e.clientX, y: e.clientY };
            }
        }
    }

    vp.addEventListener("pointerup", up);
    vp.addEventListener("pointercancel", up);
    if (z.dblclick !== false) {
        vp.addEventListener("dblclick", function (e) {
            if (onControl(e)) return;
            e.preventDefault();
            home();
        });
    }

    var bar = document.createElement("div");
    bar.className = "nexa-zoom-toolbar";
    function tool(icon, title, fn) {
        var b = document.createElement("button");
        b.type = "button";
        b.title = title;
        b.setAttribute("aria-label", title);
        b.innerHTML = ZOOM_ICONS[icon];
        b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
        bar.appendChild(b);
    }
    tool("minus", "Zoom out", zoomOut);
    level = document.createElement("span");
    level.className = "nexa-zoom-level";
    bar.appendChild(level);
    tool("reset", "Reset zoom", reset);
    tool("plus", "Zoom in", zoomIn);
    tool("fit", "Zoom to fit", fit);
    bar.style.display = z.controls ? "" : "none";
    el.appendChild(bar);

    if (typeof ResizeObserver === "function") new ResizeObserver(function () { apply(); }).observe(el);

    el.__zoom = {
        stage: stage,
        viewport: vp,
        start: function () {
            if (typeof requestAnimationFrame === "function") requestAnimationFrame(home);
            else home();
        },
        zoomTo: zoomTo,
        zoomIn: zoomIn,
        zoomOut: zoomOut,
        fit: fit,
        reset: reset,
        home: home,
        showToolbar: function (on) { bar.style.display = on ? "" : "none"; },
        state: function () { return { k: st.k, ox: st.ox, oy: st.oy, left: vp.scrollLeft, top: vp.scrollTop }; },
        refresh: function () { apply(); },
        onChange: function (fn) {
            changeFns.push(fn);
            return function () {
                var i = changeFns.indexOf(fn);
                if (i !== -1) changeFns.splice(i, 1);
            };
        }
    };
    return stage;
}
