/**
 * @file src/runtime/features/breakpoints.js
 * @description Responsive breakpoint engine for Nexa dashboards.
 * Dynamically computes active breakpoint bands (xs, sm, md, lg, xl, 2xl, 3xl)
 * and reconciles layout/style/prop overrides live without unmounting component state.
 */

import { walkNodes, compIndex, isStructural, isContainerNode } from "../mounting/slots.js";
import { applyNodeBox, combineVisibility } from "../mounting/box.js";
import { refreshComponentRender } from "../mounting/render.js";
import { registerSparkplugBoundComponentsFrom } from "../io/sparkplug.js";
import { queuePins } from "../mounting/pins.js";
import { writeVariable } from "../state/variable.js";
import { state } from "../state.js";
import { elById } from "../logic/widgets/populate.js";

export var ACTIVE_BREAKPOINT_RESIZE = null;

export function appBreakpoints() {
    return window.__NEXA_APP__ || {};
}

export function startBreakpoints(screen, effectiveScreen) {
    var M = window.NexaModel;
    if (!M || !M.activeBreakpoint) {
        if (state.currentAppScope) state.currentAppScope.$breakpoint = "";
        return;
    }
    walkNodes(screen.components, function (n) {
        if (!n.__bpBase) Object.defineProperty(n, "__bpBase", { value: M.baseOf(n), writable: true, configurable: true });
    });
    var width = function () {
        return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || screen.width;
    };
    var current = M.activeBreakpoint(appBreakpoints(), screen, width());
    applyBreakpointTree(screen, current);
    if (state.currentAppScope) state.currentAppScope.$breakpoint = current;
    effectiveScreen.__breakpoint = current;
    var queued = false;

    if (typeof window.addEventListener === "function") {
        var onResize = function () {
            if (queued) return;
            queued = true;
            (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () {
                queued = false;
                var next = M.activeBreakpoint(appBreakpoints(), screen, width());
                if (next === effectiveScreen.__breakpoint) return;
                effectiveScreen.__breakpoint = next;
                applyBreakpointTree(screen, next);
                redrawForBreakpoint(effectiveScreen, screen);
                if (state.currentAppScope) writeVariable(effectiveScreen, state.currentAppScope, "$breakpoint", next);
            });
        };
        ACTIVE_BREAKPOINT_RESIZE = onResize;
        window.addEventListener("resize", onResize);
    }
}

export function applyBreakpointTree(screen, id) {
    var M = window.NexaModel;
    if (!M) return;
    var chain = M.chainFor(appBreakpoints(), screen, id);
    walkNodes(screen.components, function (n) {
        M.applyOverrides(n, n.__bpBase || M.baseOf(n), chain);
    });
}

export function redrawForBreakpoint(effectiveScreen, screen) {
    var M = window.NexaModel;
    function visit(list, inheritedVis) {
        (list || []).forEach(function (node) {
            var vis = combineVisibility(inheritedVis, node);
            var el = elById(node.id);
            if (el) {
                var host = el.parentNode;
                var parentNode = host && host.__nexaNode || null;
                var parentSize = host && host.__nexaSize || null;
                if (el.__carousel || el.__zoom) {
                    var box = M.boxCss(node, parentNode, { constraints: true, parentSize: parentSize });
                    Object.keys(box).forEach(function (k) { el.style.setProperty(k, box[k]); });
                } else {
                    applyNodeBox(el, node, parentNode, parentSize);
                }
                if (vis !== "show") el.style.display = "none";
                else if (el.style.display === "none") el.style.display = el.__carousel || el.__zoom ? "block" : "";
                var comp = compIndex(effectiveScreen)[node.id];
                if (comp && !isStructural(node) && node.type !== "@template") {
                    ["props", "x", "y", "w", "h"].forEach(function (k) { comp[k] = node[k]; });
                    refreshComponentRender(effectiveScreen, comp);
                }
                if (el.__carousel) el.__carousel.refresh();
                if (el.__zoom) el.__zoom.refresh();
                if (el.__overlay) el.__overlay.place();
            }
            if (isContainerNode(node)) visit(node.children, vis);
        });
    }
    visit(screen.components, "show");
    registerSparkplugBoundComponentsFrom(effectiveScreen);
    queuePins(true);
}
