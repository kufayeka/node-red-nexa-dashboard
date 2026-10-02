/**
 * @file src/runtime/features/overlays.js
 * @description Modal, dialog, popover, and drawer overlay manager for Nexa runtime.
 * Manages backdrops, Esc key dismissal, auto-close timers, and viewport constraints.
 */

import { logicTrace, cloneMsg, cloneValue } from "../logic/context.js";
import { queuePins } from "../mounting/pins.js";
import { fireUiEvent } from "../logic/runner.js";

export var OVERLAYS = {};
export var overlayStack = [];
export var overlayZ = 1000;
export var overlayKeysWired = false;
export var FLEX = { start: "flex-start", center: "center", end: "flex-end" };

export function overlayModel(node) {
    return window.NexaModel && window.NexaModel.overlayOf ? window.NexaModel.overlayOf(node) : null;
}

export function setupOverlay(screen, el, comp, ns, parentEl) {
    var root = parentEl && parentEl.id === "nexa-runtime-artboard";
    var layer = document.createElement("div");
    layer.className = "nexa-overlay-layer";
    layer.setAttribute("data-overlay", ns);
    var ls = layer.style;
    var scaled = root && typeof getComputedStyle === "function" && getComputedStyle(parentEl).transform && getComputedStyle(parentEl).transform !== "none";
    ls.position = root && !scaled ? "fixed" : "absolute";
    ls.left = ls.top = ls.right = ls.bottom = "0";
    ls.display = "none";
    ls.overflow = "hidden";
    ls.boxSizing = "border-box";

    var backdrop = document.createElement("div");
    backdrop.className = "nexa-overlay-backdrop";
    backdrop.style.position = "absolute";
    backdrop.style.left = backdrop.style.top = backdrop.style.right = backdrop.style.bottom = "0";
    parentEl.insertBefore(layer, el);
    layer.appendChild(backdrop);
    layer.appendChild(el);

    var st = {
        ns: ns, node: comp, screen: screen, layer: layer, el: el, backdrop: backdrop, open: false,
        pending: null, timer: null, dx: 0, dy: 0, hideTimer: null, scope: parentEl, root: root, fixedRoot: root && !scaled
    };

    st.place = function () { placeOverlay(st); if (st.open) st.pin(); };
    st.pin = function () { pinOverlayLayer(st); };

    if (!st.fixedRoot) {
        var onScroll = function () { if (st.open) st.pin(); };
        if (root) {
            window.addEventListener("scroll", onScroll, { passive: true });
            window.addEventListener("resize", onScroll);
        } else if (typeof parentEl.addEventListener === "function") {
            parentEl.addEventListener("scroll", onScroll, { passive: true });
        }
    }
    el.__overlay = st;
    OVERLAYS[ns] = st;

    backdrop.addEventListener("click", function () {
        var o = overlayModel(st.node);
        if (o && o.closeOnBackdrop) closeOverlay(st, undefined, "backdrop");
    });
    wireOverlayDrag(st);

    if (!overlayKeysWired && typeof document.addEventListener === "function") {
        overlayKeysWired = true;
        document.addEventListener("keydown", function (e) {
            if (e.key !== "Escape") return;
            for (var i = overlayStack.length - 1; i >= 0; i--) {
                var o = overlayModel(overlayStack[i].node);
                if (o && o.closeOnEsc) {
                    closeOverlay(overlayStack[i], undefined, "esc");
                    e.stopPropagation();
                    return;
                }
                if (o && o.modal) return;
            }
        });
    }
    placeOverlay(st);
    var o0 = overlayModel(comp);
    if (o0 && o0.startOpen) setTimeout(function () { openOverlay(screen, ns, null, null); }, 0);
    return st;
}

export function pinOverlayLayer(st) {
    if (st.fixedRoot) return;
    var p = st.scope, ls = st.layer.style, left, top, w, h;
    if (st.root) {
        var r = p.getBoundingClientRect(), s = p.offsetWidth ? r.width / p.offsetWidth : 1;
        var vw = window.innerWidth || r.right, vh = window.innerHeight || r.bottom;
        left = -r.left / s;
        top = -r.top / s;
        w = vw / s;
        h = vh / s;
    } else {
        left = p.scrollLeft || 0;
        top = p.scrollTop || 0;
        w = p.clientWidth;
        h = p.clientHeight;
    }
    ls.right = ls.bottom = "auto";
    ls.left = left + "px";
    ls.top = top + "px";
    ls.width = w + "px";
    ls.height = h + "px";
}

export function overlayHiddenTransform(o) {
    var anim = o.animation || "auto";
    if (anim === "auto") anim = o.kind === "drawer" ? "slide" : "scale";
    if (anim === "slide-left") {
        return o.kind === "drawer" && o.side === "left" ? "translateX(-100%)" : "translateX(-100vw)";
    }
    if (anim === "slide-right") {
        return o.kind === "drawer" && o.side === "right" ? "translateX(100%)" : "translateX(100vw)";
    }
    if (anim === "slide-top" || anim === "slide-up") {
        return o.kind === "drawer" && o.side === "top" ? "translateY(-100%)" : "translateY(-100vh)";
    }
    if (anim === "slide-bottom" || anim === "slide-down") {
        return o.kind === "drawer" && o.side === "bottom" ? "translateY(100%)" : "translateY(100vh)";
    }
    if (anim === "slide") {
        if (o.kind === "drawer") return { left: "translateX(-100%)", right: "translateX(100%)", top: "translateY(-100%)", bottom: "translateY(100%)" }[o.side] || "translateY(100%)";
        return "translateY(100vh)";
    }
    if (anim === "scale") return "scale(0.94)";
    return "";
}

export function placeOverlay(st) {
    var o = overlayModel(st.node);
    if (!o) return;
    var el = st.el, ls = st.layer.style, es = el.style;
    var bd = st.backdrop.style;
    bd.background = o.backdrop === "none" ? "transparent" : "rgba(0,0,0," + (o.backdrop === "blur" ? Math.min(o.backdropOpacity, 0.25) : o.backdropOpacity) + ")";
    bd.backdropFilter = bd.webkitBackdropFilter = o.backdrop === "blur" ? "blur(4px)" : "";
    var passThrough = !o.modal && o.backdrop === "none";
    ls.overflow = o.draggable && o.dragWithin === "page" ? "visible" : "hidden";
    ls.pointerEvents = passThrough ? "none" : "auto";
    bd.pointerEvents = passThrough ? "none" : "auto";
    es.pointerEvents = "auto";
    es.right = es.bottom = "";
    es.maxWidth = es.maxHeight = "";

    if (o.kind === "drawer") {
        ls.padding = "0";
        es.position = "absolute";
        var horizontal = o.side === "left" || o.side === "right";
        es.top = horizontal || o.side === "top" ? "0" : "auto";
        es.bottom = horizontal || o.side === "bottom" ? "0" : "";
        es.left = !horizontal || o.side === "left" ? "0" : "auto";
        es.right = !horizontal || o.side === "right" ? "0" : "";
        es.width = horizontal ? (st.node.w || 320) + "px" : "auto";
        es.height = horizontal ? "auto" : (st.node.h || 240) + "px";
        es.maxWidth = "100%";
        es.maxHeight = "100%";
    } else {
        ls.padding = o.margin + "px";
        ls.justifyContent = FLEX[o.alignX] || "center";
        ls.alignItems = FLEX[o.alignY] || "center";
        es.position = "relative";
        es.left = es.top = "auto";
        es.width = (st.node.w || 320) + "px";
        es.height = (st.node.h || 200) + "px";
        es.maxWidth = "100%";
        es.maxHeight = "100%";
        es.flex = "0 0 auto";
    }
    var anim = o.animation || "auto";
    if (anim === "auto") anim = o.kind === "drawer" ? "slide" : "scale";
    var dur = anim === "none" ? 0 : (o.duration != null ? o.duration : 250);
    es.transition = dur ? "transform " + dur + "ms cubic-bezier(0.16, 1, 0.3, 1), opacity " + dur + "ms ease" : "";
    bd.transition = dur ? "opacity " + dur + "ms ease" : "";
    applyOverlayState(st, o);
}

export function applyOverlayState(st, o) {
    var es = st.el.style, move = st.dx || st.dy ? "translate(" + st.dx + "px," + st.dy + "px) " : "";
    var anim = o.animation || "auto";
    if (anim === "auto") anim = o.kind === "drawer" ? "slide" : "scale";
    var isNone = anim === "none";

    if (st.open) {
        es.opacity = "1";
        es.transform = move || "none";
        st.backdrop.style.opacity = "1";
    } else {
        es.opacity = isNone ? "1" : "0";
        var hidden = overlayHiddenTransform(o);
        es.transform = move ? (hidden ? move + " " + hidden : move) : (hidden || "none");
        st.backdrop.style.opacity = "0";
    }
}

export function openOverlay(screen, ns, msg, onClose) {
    var st = OVERLAYS[ns];
    if (!st) { logicTrace("open: no overlay", ns); return false; }
    var o = overlayModel(st.node);
    if (!o) return false;
    if (onClose) st.pending = { msg: msg || {}, onClose: onClose };
    if (screen) st.screen = screen;
    clearTimeout(st.hideTimer);
    st.layer.style.zIndex = String(++overlayZ);
    var i = overlayStack.indexOf(st);
    if (i !== -1) overlayStack.splice(i, 1);
    overlayStack.push(st);
    if (o.autoClose) {
        clearTimeout(st.timer);
        st.timer = setTimeout(function () { closeOverlay(st, undefined, "timer"); }, o.autoClose);
    }
    if (st.open) return true;

    var anim = o.animation || "auto";
    if (anim === "auto") anim = o.kind === "drawer" ? "slide" : "scale";
    var dur = anim === "none" ? 0 : (o.duration != null ? o.duration : 250);

    st.layer.style.display = o.kind === "drawer" ? "block" : "flex";
    st.pin();

    // 1. Initial hidden state without transition
    st.el.style.transition = "none";
    st.backdrop.style.transition = "none";
    st.open = false;
    applyOverlayState(st, o);

    // 2. Force reflow
    void st.el.offsetWidth;
    void st.backdrop.offsetWidth;

    // 3. Arm transition for opening
    if (dur > 0) {
        st.el.style.transition = "transform " + dur + "ms cubic-bezier(0.16, 1, 0.3, 1), opacity " + dur + "ms ease";
        st.backdrop.style.transition = "opacity " + dur + "ms ease";
    }

    // 4. Animate to open state
    st.open = true;
    applyOverlayState(st, o);

    if (st.el.__carousel) st.el.__carousel.refresh();
    if (st.el.__zoom) st.el.__zoom.refresh();
    queuePins(true);
    fireUiEvent(st.screen, ns, "open", msg ? msg.payload : undefined);
    return true;
}

export function closeOverlay(st, result, by) {
    if (!st || !st.open) return false;
    var o = overlayModel(st.node) || { duration: 0, animation: "none" };
    var anim = o.animation || "auto";
    if (anim === "auto") anim = o.kind === "drawer" ? "slide" : "scale";
    var dur = anim === "none" ? 0 : (o.duration != null ? o.duration : 250);

    st.open = false;
    clearTimeout(st.timer);
    var i = overlayStack.indexOf(st);
    if (i !== -1) overlayStack.splice(i, 1);

    // 1. Arm transition for closing
    if (dur > 0) {
        st.el.style.transition = "transform " + dur + "ms cubic-bezier(0.4, 0, 0.2, 1), opacity " + dur + "ms ease";
        st.backdrop.style.transition = "opacity " + dur + "ms ease";
    } else {
        st.el.style.transition = "none";
        st.backdrop.style.transition = "none";
    }

    // 2. Animate to closed state
    applyOverlayState(st, o);

    // 3. Hide after duration
    st.hideTimer = setTimeout(function () {
        if (st.open) return;
        st.layer.style.display = "none";
        st.dx = st.dy = 0;
        st.el.style.transition = "";
        st.backdrop.style.transition = "";
    }, dur);

    var p = st.pending;
    st.pending = null;
    fireUiEvent(st.screen, st.ns, "close", result === undefined ? null : result);
    if (p) {
        var out = cloneMsg(p.msg || {});
        out.payload = result === undefined ? null : cloneValue(result);
        out.closedBy = by;
        p.onClose(out);
    }
    return true;
}

export function overlayForNode(node) {
    if (node.overlay) {
        var cut = node.id.lastIndexOf("::");
        return OVERLAYS[(cut === -1 ? "" : node.id.slice(0, cut + 2)) + node.overlay] || null;
    }
    return overlayStack[overlayStack.length - 1] || null;
}

export function wireOverlayDrag(st) {
    var el = st.el;
    if (typeof el.addEventListener !== "function") return;
    el.addEventListener("pointerdown", function (e) {
        var o = overlayModel(st.node);
        if (!o || !o.draggable || !st.open || e.button !== 0) return;
        var path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
        for (var i = 0; i < path.length && path[i] !== el; i++) {
            var t = path[i];
            if (t && t.matches && t.matches("button, input, select, textarea, a, [contenteditable], [role=button], [role=slider], [data-no-drag]")) return;
        }
        e.preventDefault();
        var sx = e.clientX, sy = e.clientY, ox = st.dx, oy = st.dy;
        var lr = st.layer.getBoundingClientRect(), er = el.getBoundingClientRect();
        var bx = er.left - ox, by = er.top - oy;
        var prevTransition = el.style.transition;
        el.style.transition = "";
        el.style.userSelect = "none";
        function move(ev) {
            var nx = ox + ev.clientX - sx, ny = oy + ev.clientY - sy;
            if (o.dragWithin !== "page") {
                nx = Math.min(lr.right - er.width - bx, Math.max(lr.left - bx, nx));
                ny = Math.min(lr.bottom - er.height - by, Math.max(lr.top - by, ny));
            }
            st.dx = nx; st.dy = ny;
            applyOverlayState(st, o);
        }
        function up() {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
            el.style.transition = prevTransition;
            el.style.userSelect = "";
        }
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
    });
}
