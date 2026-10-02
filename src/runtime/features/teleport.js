/**
 * @file src/runtime/features/teleport.js
 * @description Teleportation & Docking subsystem for Nexa runtime.
 * Allows components to mount outside their DOM parent hierarchy (e.g. to #nexa-runtime-artboard
 * or designated slot targets) while preserving lexical scoping, variables, and logic wires.
 */

import { logicTrace } from "../logic/context.js";
import { queuePins } from "../mounting/pins.js";
import { applyNodeBox } from "../mounting/box.js";

export var PENDING_TELEPORTS = [];

export function teleportTarget(name) {
    var art = document.getElementById("nexa-runtime-artboard");
    if (name === "@page") return art;
    var list = document.querySelectorAll("[data-teleport-slot]");
    for (var i = 0; i < list.length; i++) {
        if (list[i].getAttribute("data-teleport-slot") === name) return list[i].__childHost || list[i];
    }
    return null;
}

export function applyTeleports(screen) {
    var pending = PENDING_TELEPORTS.splice(0);
    pending.forEach(function (t) {
        var host = teleportTarget(t.node.teleport);
        if (!host) {
            logicTrace("teleport: no target", t.node.teleport, t.ns);
            return;
        }
        teleportEl(t.el, host, t.node.teleport);
    });
    if (pending.length) queuePins(true);
}

export function teleportEl(el, host, label) {
    var st = el.__overlay;
    var moving = st ? st.layer : el;
    if (!host || moving === host || (typeof moving.contains === "function" && moving.contains(host))) return false;
    if (!el.__home && moving.parentNode) {
        var mark = document.createComment("nexa-home");
        moving.parentNode.insertBefore(mark, moving);
        el.__home = mark;
    }
    host.appendChild(moving);
    if (label) el.setAttribute("data-teleported", label);
    placeIn(el, host);
    return true;
}

export function teleportHome(el) {
    var mark = el.__home;
    if (!mark || !mark.parentNode) return false;
    var st = el.__overlay;
    var moving = st ? st.layer : el;
    mark.parentNode.insertBefore(moving, mark);
    el.removeAttribute("data-teleported");
    placeIn(el, mark.parentNode);
    return true;
}

export function placeIn(el, host) {
    var st = el.__overlay, node = el.__nexaModel;
    if (st) {
        var root = host.id === "nexa-runtime-artboard";
        var scaled = root && typeof getComputedStyle === "function" && getComputedStyle(host).transform && getComputedStyle(host).transform !== "none";
        st.scope = host;
        st.root = root;
        st.fixedRoot = root && !scaled;
        st.layer.style.position = st.fixedRoot ? "fixed" : "absolute";
        st.place();
    } else if (node) {
        var shown = el.style.display;
        applyNodeBox(el, node, host.__nexaNode || null, host.__nexaSize || null);
        if (shown === "none") el.style.display = "none";
    }
    if (el.__carousel) el.__carousel.refresh();
    if (el.__zoom) el.__zoom.refresh();
    queuePins(true);
}

export function surfaceElOf(el) {
    for (var e = el; e; e = e.parentElement) {
        if (e.__nexaSurface || e.id === "nexa-runtime-artboard") return e;
    }
    return el;
}

export function dockLayerOf(scopeEl) {
    if (scopeEl.__dockLayer && scopeEl.__dockLayer.parentNode === scopeEl) return scopeEl.__dockLayer;
    var root = scopeEl.id === "nexa-runtime-artboard";
    var layer = document.createElement("div");
    layer.className = "nexa-dock-layer";
    var ls = layer.style;
    ls.position = "absolute";
    ls.left = "0px";
    ls.top = "0px";
    ls.pointerEvents = "none";
    ls.boxSizing = "border-box";
    layer.__nexaNode = scopeEl.__nexaNode || null;
    layer.__nexaSize = scopeEl.__nexaSize || null;
    scopeEl.appendChild(layer);
    scopeEl.__dockLayer = layer;

    var pin = function () {
        var left, top, w, h;
        if (root) {
            var r = scopeEl.getBoundingClientRect(), k = scopeEl.offsetWidth ? r.width / scopeEl.offsetWidth : 1;
            if (!k) k = 1;
            var de = document.documentElement || {};
            var vw = de.clientWidth || window.innerWidth || r.right, vh = de.clientHeight || window.innerHeight || r.bottom;
            var x0 = Math.max(r.left, 0), y0 = Math.max(r.top, 0), x1 = Math.min(r.right, vw), y1 = Math.min(r.bottom, vh);
            left = (x0 - r.left) / k; top = (y0 - r.top) / k;
            w = Math.max(0, x1 - x0) / k; h = Math.max(0, y1 - y0) / k;
        } else {
            left = scopeEl.scrollLeft || 0; top = scopeEl.scrollTop || 0;
            w = scopeEl.clientWidth; h = scopeEl.clientHeight;
        }
        ls.left = left + "px"; ls.top = top + "px"; ls.width = w + "px"; ls.height = h + "px";
    };
    layer.__pin = pin;
    if (root) {
        window.addEventListener("scroll", pin, { passive: true });
        window.addEventListener("resize", pin);
    } else if (typeof scopeEl.addEventListener === "function") {
        scopeEl.addEventListener("scroll", pin, { passive: true });
    }
    if (typeof ResizeObserver === "function") new ResizeObserver(pin).observe(scopeEl);
    pin();
    return layer;
}
