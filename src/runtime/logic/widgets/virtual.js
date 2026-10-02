/**
 * @file src/runtime/logic/widgets/virtual.js
 * @description Virtualized list rendering engine for large collections in Nexa containers.
 * Mounts only items within the visible viewport (+ overscan) to maintain 60 FPS performance.
 */

import { findComponent, findTemplateById, getComponentTemplateTarget, compIndex } from "../../mounting/slots.js";
import { batchSparkplugIndex, registerSparkplugBoundComponentsFrom } from "../../io/sparkplug.js";
import { mountRepeated, elById } from "./populate.js";

export var VIRTUAL_OVERSCAN = 3;

export function startVirtual(screen, list, frameNs, frameEl) {
    var sizer = document.createElement("div");
    sizer.setAttribute("data-virtual-sizer", frameNs);
    sizer.style.position = "relative";
    sizer.style.flex = "none";
    sizer.style.gridColumn = "1 / -1";
    frameEl.appendChild(sizer);

    var frame = findComponent(screen, frameNs);
    var mode = window.NexaModel && frame ? window.NexaModel.layoutOf(frame).mode : "vertical";
    var outerEl = elById(frameNs);
    var zoom = outerEl && outerEl.__zoom && outerEl.__childHost === frameEl ? outerEl.__zoom : null;

    if (zoom) {
        // zoom viewport handles scroll
    } else if (mode === "horizontal") {
        if (!frameEl.style.overflowX || frameEl.style.overflowX === "hidden") frameEl.style.overflowX = "auto";
    } else {
        if (!frameEl.style.overflowY || frameEl.style.overflowY === "hidden") frameEl.style.overflowY = "auto";
    }
    var scrollEl = zoom ? zoom.viewport : frameEl;
    var scheduled = false;

    function onScroll() {
        if (scheduled) return;
        scheduled = true;
        (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () {
            scheduled = false;
            if (list.virtual) renderVirtual(screen, list);
        });
    }

    if (scrollEl.addEventListener) scrollEl.addEventListener("scroll", onScroll);
    if (window.addEventListener) window.addEventListener("resize", onScroll);
    var offZoom = zoom ? zoom.onChange(onScroll) : null;
    list.virtual = { sizer: sizer, frameEl: frameEl, frameNs: frameNs, onScroll: onScroll, node: null, scrollEl: scrollEl, zoom: zoom, offZoom: offZoom };
}

export function stopVirtual(list) {
    var v = list.virtual;
    if (!v) return;
    var se = v.scrollEl || v.frameEl;
    if (se.removeEventListener) se.removeEventListener("scroll", v.onScroll);
    if (v.offZoom) v.offZoom();
    if (window.removeEventListener) window.removeEventListener("resize", v.onScroll);
    if (v.sizer.parentNode) v.sizer.parentNode.removeChild(v.sizer);
    list.virtual = null;
}

export function virtualGeometry(screen, list) {
    var v = list.virtual, node = v.node;
    var t = findTemplateById(screen.__templates, node.template) || {};
    var frame = findComponent(screen, v.frameNs);
    var L = window.NexaModel && frame ? window.NexaModel.layoutOf(frame) : { mode: "vertical", gap: 0, columns: [] };
    var gap = Number(L.gap) || 0;
    var rowGap = L.rowGap !== undefined && L.rowGap !== "" ? Number(L.rowGap) || 0 : gap;
    var inner = v.sizer.clientWidth || (v.frameEl.clientWidth || 0);
    var innerH = v.sizer.clientHeight || 0;
    var w = t.width || 100, h = t.height || 40;
    var it = sizingOf(t, node);
    var M = window.NexaModel;
    var ax = M ? M.alignFraction(L.alignX) : 0, ay = M ? M.alignFraction(L.alignY) : 0;
    var g = { horizontal: L.mode === "horizontal", cols: 1, w: w, h: h, fill: false, fillH: false, offX: 0, offY: 0, inner: inner };

    if (L.mode === "grid") {
        g.cols = Math.max(1, (L.columns || []).length || 1);
        var cell = inner ? (inner - gap * (g.cols - 1)) / g.cols : w;
        if (it.w === "fill" && inner) { g.w = cell; g.fill = true; }
        g.offX = Math.max(0, (cell - g.w) * ax);
        g.strideX = cell + gap;
        g.stride = h + rowGap;
    } else if (g.horizontal) {
        if (it.h === "fill" && innerH) { g.h = innerH; g.fillH = true; }
        g.offY = Math.max(0, (innerH - g.h) * ay);
        g.stride = w + gap;
    } else {
        if (it.w === "fill" && inner) { g.w = inner; g.fill = true; }
        g.offX = Math.max(0, (inner - g.w) * ax);
        g.stride = h + gap;
    }
    g.lines = Math.ceil(list.entries.length / g.cols);
    g.total = g.lines ? g.lines * g.stride - (g.horizontal ? gap : (L.mode === "grid" ? rowGap : gap)) : 0;
    return g;
}

export function virtualBox(g, i) {
    if (g.horizontal) return { x: i * g.stride, y: g.offY, w: g.fill ? g.w : 0, h: g.fillH ? g.h : 0 };
    var line = Math.floor(i / g.cols), col = i % g.cols;
    return { x: col * (g.strideX || 0) + g.offX, y: line * g.stride, w: g.fill ? g.w : 0 };
}

export function renderVirtual(screen, list) {
    batchSparkplugIndex(function () {
        var v = list.virtual;
        if (!v) return;
        var g = virtualGeometry(screen, list);
        var el = v.frameEl, sizer = v.sizer;
        if (g.horizontal) {
            sizer.style.width = g.total + "px";
            sizer.style.height = "auto";
            sizer.style.minHeight = g.h + "px";
            sizer.style.alignSelf = "stretch";
            sizer.style.minWidth = g.total + "px";
        } else {
            sizer.style.height = g.total + "px";
            sizer.style.minHeight = g.total + "px";
            sizer.style.width = g.cols > 1 || g.fill ? "100%" : g.w + "px";
            sizer.style.alignSelf = "stretch";
        }
        if (v.zoom && v.lastTotal !== g.total) {
            v.lastTotal = g.total;
            v.zoom.refresh();
        }
        var se = v.scrollEl || el, start, size;
        if (v.zoom) {
            var zs = v.zoom.state(), zk = zs.k || 1;
            start = g.horizontal ? ((se.scrollLeft || 0) - zs.ox) / zk - (sizer.offsetLeft || 0) : ((se.scrollTop || 0) - zs.oy) / zk - (sizer.offsetTop || 0);
            size = (g.horizontal ? (se.clientWidth || 0) : (se.clientHeight || 0)) / zk;
        } else {
            start = g.horizontal ? (se.scrollLeft || 0) - (sizer.offsetLeft || 0) : (se.scrollTop || 0) - (sizer.offsetTop || 0);
            size = g.horizontal ? (se.clientWidth || 0) : (se.clientHeight || 0);
        }
        if (!size) size = 20 * g.stride;
        var firstLine = Math.max(0, Math.floor(start / g.stride) - VIRTUAL_OVERSCAN);
        var lastLine = Math.min(g.lines - 1, Math.floor((start + size) / g.stride) + VIRTUAL_OVERSCAN);
        var from = firstLine * g.cols, to = Math.min(list.entries.length, (lastLine + 1) * g.cols);
        var want = {};
        for (var i = from; i < to; i++) want[list.entries[i].key] = true;

        (v.mountedList || []).forEach(function (e) {
            if (e.mounted && (!want[e.key] || e.dropped)) {
                unmountRepeated(screen, e.ns);
                e.mounted = false;
            }
        });
        var mountedList = [];
        for (var j = from; j < to; j++) {
            var e = list.entries[j];
            var box = virtualBox(g, j);
            if (!e.mounted) {
                if (!mountRepeated(screen, v.node, v.frameNs, sizer, e, box)) continue;
            } else {
                var ce = elById(e.ns);
                if (ce) {
                    ce.style.left = box.x + "px";
                    ce.style.top = box.y + "px";
                    if (box.w) ce.style.width = box.w + "px";
                    if (box.h) ce.style.height = box.h + "px";
                }
            }
            mountedList.push(e);
        }
        v.mountedList = mountedList;

        var kids = sizer.children || [], inOrder = kids.length === mountedList.length;
        for (var k = 0; inOrder && k < kids.length; k++) inOrder = kids[k].getAttribute("data-id") === mountedList[k].ns;
        if (!inOrder) mountedList.forEach(function (entry) { var cardEl = elById(entry.ns); if (cardEl) sizer.appendChild(cardEl); });
        registerSparkplugBoundComponentsFrom(screen);

        if (!g.horizontal && sizer.clientWidth && sizer.clientWidth !== g.inner && !v.relayout) {
            v.relayout = true;
            (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () {
                renderVirtual(screen, list);
                v.relayout = false;
            });
        }
    });
}

export function sizingOf(template, node) {
    if (template && template.kind === "component") {
        var target = getComponentTemplateTarget(template);
        if (target) {
            var lc = target.layoutChild || {};
            var csz = {
                w: lc.w || "fixed",
                h: lc.h || "fixed",
                minW: target.minW || "",
                maxW: target.maxW || "",
                minH: target.minH || "",
                maxH: target.maxH || ""
            };
            if (target.w !== undefined) csz.width = target.w;
            if (target.h !== undefined) csz.height = target.h;
            return node && node.fill ? Object.assign({}, csz, { w: "fill" }) : csz;
        }
    }
    var sz = window.NexaModel && window.NexaModel.templateLiveOf ? window.NexaModel.templateLiveOf(template) : { w: "fixed", h: "fixed" };
    return node && node.fill ? Object.assign({}, sz, { w: "fill" }) : sz;
}

export function unmountRepeated(screen, ns) {
    var el = elById(ns);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    var pre = ns + "::";
    Array.prototype.slice.call(document.querySelectorAll("[data-teleported]")).forEach(function (t) {
        var id = t.getAttribute("data-id") || "";
        if (id.indexOf(pre) !== 0) return;
        var moved = t.__overlay ? t.__overlay.layer : t;
        if (moved.parentNode) moved.parentNode.removeChild(moved);
    });
    var mine = function (id) { return id === ns || id.indexOf(pre) === 0; };
    var ix = compIndex(screen);
    for (var i = screen.components.length - 1; i >= 0; i--) {
        if (mine(screen.components[i].id)) {
            delete ix[screen.components[i].id];
            screen.components.splice(i, 1);
        }
    }
    var nodes = screen.logic.nodes, wires = screen.logic.wires;
    for (var j = nodes.length - 1; j >= 0; j--) if (mine(nodes[j].id)) nodes.splice(j, 1);
    for (var w = wires.length - 1; w >= 0; w--) if (mine(wires[w].from) || mine(wires[w].to)) wires.splice(w, 1);
    if (screen.__paramStates) Object.keys(screen.__paramStates).forEach(function (k) { if (mine(k)) delete screen.__paramStates[k]; });
    if (screen.__scopes) Object.keys(screen.__scopes).forEach(function (k) { if (mine(k)) delete screen.__scopes[k]; });
}
