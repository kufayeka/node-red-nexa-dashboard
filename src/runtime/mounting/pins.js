// Fixed / Sticky Scroll Pins
// Handles fixed/sticky elements inside scrollable frames and the screen.

import { state } from "../state.js";

export function registerPin(el, comp) {
    state.pins.push({ el: el, comp: comp, base: el.style.transform || "" });
    if (!el.style.zIndex) el.style.zIndex = "20";
    if (!state.pinPageListener && typeof window.addEventListener === "function") {
        state.pinPageListener = true;
        window.addEventListener("scroll", function () { queuePins(false); }, { passive: true });
        window.addEventListener("resize", function () { queuePins(true); });
    }
    queuePins(true);
}

export function queuePins(remeasure) {
    if (remeasure) state.pinsRemeasure = true;
    if (state.pinsQueued) return;
    state.pinsQueued = true;
    (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () {
        state.pinsQueued = false;
        const again = state.pinsRemeasure;
        state.pinsRemeasure = false;
        state.pins = state.pins.filter(function (p) { return p.el.isConnected; });
        if (again) state.pins.forEach(measurePin);
        state.pins.forEach(updatePin);
    });
}

export function screenScale() {
    const art = document.getElementById("nexa-runtime-artboard");
    const w = art && art.offsetWidth;
    return w ? (art.getBoundingClientRect().width / w) || 1 : 1;
}

export function scrollHostOf(el) {
    const art = document.getElementById("nexa-runtime-artboard");
    for (let e = el.parentElement; e && e !== art && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (/(auto|scroll)/.test(cs.overflowY + " " + cs.overflowX)) return e;
    }
    return null; // the page
}

export function measurePin(p) {
    p.el.style.transform = p.base;   // where it sits unscrolled
    p.host = scrollHostOf(p.el);
    if (p.host && !p.host.__nexaPinListener) {
        p.host.__nexaPinListener = true;
        p.host.addEventListener("scroll", function () { queuePins(false); }, { passive: true });
    }
    const c = window.NexaModel ? window.NexaModel.constraintsOf(p.comp) : { h: "leftRight", v: "topBottom" };
    p.bottom = c.v === "bottom";
    p.right = c.h === "right";
    p.k = screenScale();
    const r = p.el.getBoundingClientRect();
    if (p.host) {
        const hr = p.host.getBoundingClientRect();
        p.x0 = (r.left - hr.left) / p.k + p.host.scrollLeft;
        p.y0 = (r.top - hr.top) / p.k + p.host.scrollTop;
    } else {
        p.x0 = r.left + (window.scrollX || 0);
        p.y0 = r.top + (window.scrollY || 0);
    }
}

export function pinShift(mode, far, s, view, content, at0) {
    if (mode === "sticky") return Math.max(0, s - at0);
    return far ? Math.min(0, s + view - content) : s;
}

export function updatePin(p) {
    const mode = p.comp.scrollBehavior;
    let tx, ty;
    if (p.host) {
        const h = p.host;
        tx = pinShift(mode, p.right, h.scrollLeft, h.clientWidth, h.scrollWidth, p.x0);
        ty = pinShift(mode, p.bottom, h.scrollTop, h.clientHeight, h.scrollHeight, p.y0);
    } else {
        const d = document.documentElement;
        tx = pinShift(mode, p.right, window.scrollX || 0, window.innerWidth, d.scrollWidth, p.x0) / p.k;
        ty = pinShift(mode, p.bottom, window.scrollY || 0, window.innerHeight, d.scrollHeight, p.y0) / p.k;
    }
    p.el.style.transform = (tx || ty ? "translate(" + tx + "px, " + ty + "px) " : "") + p.base;
}
