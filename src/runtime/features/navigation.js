/**
 * @file src/runtime/features/navigation.js
 * @description Single-Page Application (SPA) routing, screen tree flattening,
 * flow gateway enforcement, and screen lifecycle orchestration for Nexa runtime.
 */

import {
    compIndex, addComponent, isStructural, isContainerNode, isSlotHostNode,
    walkNodes, childNamespace, findTemplateById, getComponentTemplateTarget,
    findComponent, mountSlotFrames
} from "../mounting/slots.js";
import { makeScope, makeAppScope, makeSharedScope, hasVariables, resolveInstanceParamState } from "../state/scope.js";
import { applyNodeBox, applyDisplayMode, resetScreenStyles, combineVisibility, templateContentHost } from "../mounting/box.js";
import { registerPin } from "../mounting/pins.js";
import { surfaceElOf, dockLayerOf, PENDING_TELEPORTS, applyTeleports } from "./teleport.js";
import { setupCarousel } from "../logic/widgets/carousel.js";
import { setupZoom } from "../logic/widgets/zoom.js";
import { setupOverlay, overlayModel } from "./overlays.js";
import { renderLitComponentInstance } from "../mounting/lit.js";
import { interpolateProps, refreshComponentRender, fireParamInputForInstance, setUpInjectNodes, clearActiveScreenTimers } from "../mounting/render.js";
import { makeCtx, fireLifecycle, runLogicGraph } from "../logic/runner.js";
import { registerSparkplugBoundComponentsFrom } from "../io/sparkplug.js";
import { setUpSparkplugLiveBinding } from "../io/client.js";
import { syncLinkSubscriptions } from "../../features/logic/link/link-ops.js";
import { matchScreenPath, flowScreenIds } from "../../model/routes.js";
import { cloneMsg } from "../logic/context.js";
import { startBreakpoints } from "./breakpoints.js";
import { startTheme } from "./theme.js";

var CURRENT_ACTIVE_FLOW = null;
var CURRENT_ACTIVE_FLOW_SCREEN = null;
var CURRENT_ACTIVE_RENDER_SCREEN = null;
var CURRENT_EFFECTIVE_SCREEN = null;
var POPSTATE_WIRED = false;
var BEFOREUNLOAD_WIRED = false;

if (typeof window !== "undefined" && window.__NEXA_CURRENT_FLOW__) {
    CURRENT_ACTIVE_FLOW = (window.__NEXA_FLOWS__ || []).find(function (f) { return f.id === window.__NEXA_CURRENT_FLOW__; }) || null;
}

export function getActiveRenderScreen() { return CURRENT_ACTIVE_RENDER_SCREEN; }
export function setActiveRenderScreen(val) { CURRENT_ACTIVE_RENDER_SCREEN = val; }
export function getActiveFlowScreen() { return CURRENT_ACTIVE_FLOW_SCREEN; }
export function getActiveFlow() { return CURRENT_ACTIVE_FLOW; }
export function getEffectiveScreen() { return CURRENT_EFFECTIVE_SCREEN; }

// the same rules as the screen worker (src/model/routes.js), on the screens this page got
export function getFlowAllowedScreenIds(flow) {
    return flowScreenIds(flow, window.__NEXA_SCREENS__ || []);
}

export function findFlowForRoute(targetPath) {
    if (!targetPath) return null;
    var flows = window.__NEXA_FLOWS__ || [];
    if (!flows.length) return null;
    var clean = String(targetPath).trim();
    var prefix = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";
    if (clean.indexOf(prefix) === 0) clean = clean.slice(prefix.length);
    if (clean.charAt(0) !== "/") clean = "/" + clean;
    var qIdx = clean.indexOf("?");
    if (qIdx !== -1) clean = clean.slice(0, qIdx);
    if (!clean || clean === "/" || clean === "/nexa" || clean === "/nexa/") {
        var defaultFlow = flows.find(function (f) { return !f.disabled && f.isDefault; }) ||
                          flows.find(function (f) { return !f.disabled; });
        if (defaultFlow) {
            var defEp = (defaultFlow.endpoint || "").trim();
            if (!defEp) defEp = "/flow1";
            if (defEp.charAt(0) !== "/") defEp = "/" + defEp;
            var defTrigger = (defaultFlow.logic && defaultFlow.logic.nodes || []).find(function (n) { return n.type === "route-trigger"; });
            return {
                flow: defaultFlow,
                node: defTrigger || null,
                subPath: "/",
                fullPath: defEp,
                targetScreen: null,
                params: {}
            };
        }
    }

    for (var i = 0; i < flows.length; i++) {
        var flow = flows[i];
        if (flow.disabled) continue;
        var ep = (flow.endpoint || "").trim();
        if (!ep) ep = "/flow" + (i + 1);
        if (ep.charAt(0) !== "/") ep = "/" + ep;
        ep = ep.replace(/\/+$/, "");

        var triggerNode = (flow.logic && flow.logic.nodes || []).find(function (n) { return n.type === "route-trigger"; });

        if (clean === ep || clean === ep + "/") {
            return {
                flow: flow,
                node: triggerNode || null,
                subPath: "/",
                fullPath: clean,
                targetScreen: null,
                params: {}
            };
        }

        if (clean.indexOf(ep + "/") === 0) {
            var scrSub = clean.slice(ep.length);
            if (scrSub.charAt(0) !== "/") scrSub = "/" + scrSub;
            var scrMatch = findScreenInProject(scrSub);
            var allowed = getFlowAllowedScreenIds(flow);
            var isAllowed = scrMatch && scrMatch.screen && allowed.indexOf(scrMatch.screen.id) !== -1;
            return {
                flow: flow,
                node: triggerNode || null,
                subPath: scrSub,
                fullPath: clean,
                targetScreen: isAllowed ? scrMatch.screen : null,
                params: scrMatch ? scrMatch.params : {},
                inaccessible: scrMatch && scrMatch.screen && !isAllowed,
                notFound: !scrMatch || !scrMatch.screen
            };
        }
    }
    return null;
}

export function syncScreenWithFlow(screen, flowId, flowNodeId) {
    if (!screen) return;
    var flows = window.__NEXA_FLOWS__ || [];
    var targetFlow = null;
    if (flowId) {
        targetFlow = flows.find(function (f) { return f.id === flowId; });
    }
    if (!targetFlow && CURRENT_ACTIVE_FLOW) {
        targetFlow = CURRENT_ACTIVE_FLOW;
    }
    if (!targetFlow && typeof window !== "undefined" && window.location) {
        var fMatch = findFlowForRoute(window.location.pathname);
        if (fMatch && fMatch.flow) targetFlow = fMatch.flow;
    }
    if (!targetFlow) {
        for (var fi = 0; fi < flows.length; fi++) {
            if (getFlowAllowedScreenIds(flows[fi]).indexOf(screen.id) !== -1) {
                targetFlow = flows[fi];
                break;
            }
        }
    }
    if (targetFlow) {
        CURRENT_ACTIVE_FLOW = targetFlow;
        if (!CURRENT_ACTIVE_FLOW_SCREEN || CURRENT_ACTIVE_FLOW_SCREEN.id !== targetFlow.id) {
            var app = window.__NEXA_APP__ || { variables: [] };
            var sharedScope = makeSharedScope(app);
            var appScope = makeAppScope(app);
            CURRENT_ACTIVE_FLOW_SCREEN = {
                id: targetFlow.id,
                name: targetFlow.name,
                logic: {
                    nodes: (targetFlow.logic && targetFlow.logic.nodes) || [],
                    wires: (targetFlow.logic && targetFlow.logic.wires) || []
                },
                __scopes: {
                    "@shared": sharedScope,
                    "@app": appScope,
                    "": makeScope(appScope, targetFlow.variables || [])
                }
            };
        }
        var rNode = null;
        if (flowNodeId) {
            rNode = (targetFlow.logic && targetFlow.logic.nodes || []).find(function (n) { return n.id === flowNodeId; });
        }
        if (!rNode) {
            rNode = (targetFlow.logic && targetFlow.logic.nodes || []).find(function (n) {
                return (n.type === "render-screen" || n.type === "navigate") && n.screenId === screen.id;
            });
        }
        if (rNode) {
            CURRENT_ACTIVE_RENDER_SCREEN = {
                flowScreen: CURRENT_ACTIVE_FLOW_SCREEN,
                flowNode: rNode,
                screenId: screen.id
            };
        } else {
            CURRENT_ACTIVE_RENDER_SCREEN = null;
        }
    }
}

export function runFlow(flow, triggerNode, routeMsg) {
    if (!flow || !flow.logic) return false;
    CURRENT_ACTIVE_FLOW = flow;
    var app = window.__NEXA_APP__ || { variables: [] };
    var sharedScope = makeSharedScope(app);
    var appScope = makeAppScope(app);
    var flowScreen = {
        id: flow.id,
        name: flow.name,
        logic: {
            nodes: flow.logic.nodes || [],
            wires: flow.logic.wires || []
        },
        __scopes: {
            "@shared": sharedScope,
            "@app": appScope,
            "": makeScope(appScope, flow.variables || [])
        }
    };
    CURRENT_ACTIVE_FLOW_SCREEN = flowScreen;
    var nodeToRun = triggerNode || (flow.logic.nodes && flow.logic.nodes[0]);
    if (nodeToRun) {
        runLogicGraph(flowScreen, nodeToRun, routeMsg);
    }
    return true;
}

export function matchFlowAndExecute(subPath, initialPayload) {
    var match = findFlowForRoute(subPath);
    if (!match) return false;
    var flow = match.flow;
    CURRENT_ACTIVE_FLOW = flow;

    if (match.inaccessible) {
        console.warn("[nexa-runtime] Screen is not accessible in Flow: " + (flow.name || flow.id));
        var artboard = document.getElementById("nexa-runtime-artboard");
        if (artboard) {
            artboard.innerHTML = '<div style="padding: 40px; text-align: center; font-family: sans-serif; color: #64748b;">' +
                '<h2 style="color: #ef4444; margin-bottom: 8px;">Access Denied</h2>' +
                '<p>This screen is not accessible in Flow: ' + (flow.name || flow.id) + '. Only screens defined via "Render Screen" or "Goto Screen" nodes in this flow are accessible.</p>' +
                '</div>';
        }
        return false;
    }

    var query = window.__NEXA_QUERY__ || {};
    try {
        if (typeof window !== "undefined" && window.location && window.location.search) {
            var sp = new URLSearchParams(window.location.search);
            query = Object.fromEntries(sp.entries());
        }
    } catch (e) { /* ignore */ }

    if (match.notFound) {
        var notFoundNode = (flow.logic && flow.logic.nodes || []).find(function (n) { return n.type === "route-not-found"; });
        if (notFoundNode) {
            var notFoundCookies = notFoundNode.cookies ? extractCookies(notFoundNode.cookies) : {};
            var notFoundDevice = (notFoundNode.includeDevice !== false) ? extractDeviceContext() : undefined;
            var notFoundMsg = {
                path: match.subPath,
                fullPath: match.fullPath,
                params: match.params || {},
                query: query,
                cookies: notFoundCookies,
                device: notFoundDevice,
                error: "not_found",
                payload: initialPayload !== undefined ? initialPayload : {
                    error: "Screen not found",
                    path: match.subPath,
                    fullPath: match.fullPath
                }
            };
            return runFlow(flow, notFoundNode, notFoundMsg);
        }
        console.warn("[nexa-runtime] Screen '" + match.subPath + "' not found in Flow: " + (flow.name || flow.id));
        var art404 = document.getElementById("nexa-runtime-artboard");
        if (art404) {
            art404.innerHTML = '<div style="padding: 40px; text-align: center; font-family: sans-serif; color: #64748b;">' +
                '<h2 style="color: #ef4444; margin-bottom: 8px;">404 Not Found</h2>' +
                '<p>Screen \'' + (match.subPath || '') + '\' not found in Flow: ' + (flow.name || flow.id) + '</p>' +
                '</div>';
        }
        return false;
    }

    var node = match.node;
    var params = match.params || {};
    window.__NEXA_PARAMS__ = params;
    var cookies = node ? extractCookies(node.cookies) : {};
    var device = (node && node.includeDevice !== false) ? extractDeviceContext() : undefined;
    var msg = {
        path: match.fullPath,
        params: params,
        query: query,
        cookies: cookies,
        device: device,
        payload: initialPayload !== undefined ? initialPayload : {
            path: match.fullPath,
            params: params,
            query: query
        }
    };

    var policy = flow.routingPolicy || "strict";
    if (match.subPath === "/" || !match.targetScreen) {
        return runFlow(flow, node, msg);
    }
    if (policy === "free") {
        if (typeof document !== "undefined" && document.title !== undefined) {
            document.title = match.targetScreen.name || flow.name || "Nexa Dashboard";
        }
        syncScreenWithFlow(match.targetScreen, flow.id);
        mountScreen(match.targetScreen, window.__NEXA_TEMPLATES__ || [], initialPayload);
        return true;
    } else {
        return runFlow(flow, node, msg);
    }
}

export function findScreenInProject(target) {
    if (!target) return null;
    var screens = window.__NEXA_SCREENS__ || (window.__NEXA_SCREEN__ ? [window.__NEXA_SCREEN__] : []);
    var cleanTarget = String(target).trim();
    for (var i = 0; i < screens.length; i++) {
        if (screens[i].id === cleanTarget) return { screen: screens[i], params: {} };
    }
    for (var j = 0; j < screens.length; j++) {
        if ((screens[j].name || "").toLowerCase() === cleanTarget.toLowerCase()) return { screen: screens[j], params: {} };
    }
    var targetPath = cleanTarget;
    if (targetPath.charAt(0) !== "/") targetPath = "/" + targetPath;
    var qIdx = targetPath.indexOf("?");
    if (qIdx !== -1) targetPath = targetPath.slice(0, qIdx);
    for (var k = 0; k < screens.length; k++) {
        var s = screens[k];
        var sp = s.path || ("/" + s.id);
        if (sp.charAt(0) !== "/") sp = "/" + sp;
        if (sp === targetPath) return { screen: s, params: {} };
        var m = matchScreenPath(sp, targetPath);
        if (m) return { screen: s, params: m };
    }
    return null;
}

export function dismountScreen() {
    if (CURRENT_EFFECTIVE_SCREEN) {
        try { fireLifecycle(CURRENT_EFFECTIVE_SCREEN, "onclose"); } catch (e) { console.error("[nexa] onclose error:", e); }
    }
    clearActiveScreenTimers();
    resetScreenStyles(document.getElementById("nexa-runtime-artboard"));
    PENDING_TELEPORTS.length = 0;
    var artboard = document.getElementById("nexa-runtime-artboard");
    if (artboard) {
        artboard.innerHTML = "";
        if (artboard.children && artboard.children.length) artboard.children = [];
        artboard.__dockLayer = null;
    }
    CURRENT_EFFECTIVE_SCREEN = null;
}

export function navigateToScreen(target, forwardPayload, replace, isFreeJump, flowNodeId) {
    if (typeof target === "string" && (target.charAt(0) === "/" || target.indexOf("/") !== -1)) {
        var flowMatch = findFlowForRoute(target);
        if (flowMatch) {
            var prefix = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";
            var clean = flowMatch.fullPath;
            var newUrl = prefix + (clean === "/" ? "" : clean);
            var fState = {
                flowId: flowMatch.flow.id,
                screenId: flowMatch.targetScreen ? flowMatch.targetScreen.id : null,
                flowNodeId: flowNodeId || null,
                path: clean
            };
            try {
                if (typeof window.history !== "undefined") {
                    if (replace && typeof window.history.replaceState === "function") {
                        window.history.replaceState(fState, flowMatch.flow.name || "", newUrl);
                    } else if (typeof window.history.pushState === "function") {
                        window.history.pushState(fState, flowMatch.flow.name || "", newUrl);
                    }
                }
            } catch (e) { /* test environment */ }
            return matchFlowAndExecute(target, forwardPayload);
        }
    }

    var match = findScreenInProject(target);
    if (!match) {
        console.warn("[nexa-runtime] navigate: screen not found in project:", target);
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(target) || /^\/\//.test(target)) {
            window.location.href = target;
        }
        return false;
    }

    var nextScreen = match.screen;
    if (CURRENT_ACTIVE_FLOW) {
        var allowed = getFlowAllowedScreenIds(CURRENT_ACTIVE_FLOW);
        if (allowed.length > 0 && allowed.indexOf(nextScreen.id) === -1) {
            console.warn("[nexa-runtime] navigate: screen '" + nextScreen.id + "' is not accessible in active flow: " + (CURRENT_ACTIVE_FLOW.name || CURRENT_ACTIVE_FLOW.id));
            return false;
        }
    }

    syncScreenWithFlow(nextScreen, CURRENT_ACTIVE_FLOW ? CURRENT_ACTIVE_FLOW.id : null, flowNodeId);
    var isNamedScreen = match.screen.id === target || (match.screen.name || "").toLowerCase() === String(target).toLowerCase();
    var params = isNamedScreen ? Object.assign({}, window.__NEXA_PARAMS__ || {}, match.params || {}) : (match.params || {});

    var pfx = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";
    var scrSub = nextScreen.path || ("/" + nextScreen.id);
    if (scrSub.charAt(0) !== "/") scrSub = "/" + scrSub;

    var combinedPath = scrSub;
    if (CURRENT_ACTIVE_FLOW) {
        var flowEp = (CURRENT_ACTIVE_FLOW.endpoint || "/flow").trim();
        if (flowEp.charAt(0) !== "/") flowEp = "/" + flowEp;
        flowEp = flowEp.replace(/\/+$/, "");
        combinedPath = flowEp + scrSub;
    }
    var fullUrl = pfx + (combinedPath === "/" ? "" : combinedPath);
    var isInitialFlowPath = false;
    if (typeof window !== "undefined" && window.location) {
        var curr = window.location.pathname || "";
        if (curr.indexOf(pfx) === 0) curr = curr.slice(pfx.length);
        if (curr.charAt(0) !== "/") curr = "/" + curr;
        var q = curr.indexOf("?");
        if (q !== -1) curr = curr.slice(0, q);
        if (CURRENT_ACTIVE_FLOW) {
            var ep = (CURRENT_ACTIVE_FLOW.endpoint || "").trim();
            if (ep.charAt(0) !== "/") ep = "/" + ep;
            ep = ep.replace(/\/+$/, "");
            if (curr === ep || curr === ep + "/" || curr === "/" || curr === "") {
                isInitialFlowPath = true;
            }
        }
    }
    var shouldReplace = replace || isInitialFlowPath;
    var activeNodeId = flowNodeId || (CURRENT_ACTIVE_RENDER_SCREEN && CURRENT_ACTIVE_RENDER_SCREEN.flowNode ? CURRENT_ACTIVE_RENDER_SCREEN.flowNode.id : null);
    var stateObj = {
        screenId: nextScreen.id,
        flowId: CURRENT_ACTIVE_FLOW ? CURRENT_ACTIVE_FLOW.id : null,
        flowNodeId: activeNodeId,
        path: combinedPath
    };

    try {
        if (typeof window.history !== "undefined") {
            if (shouldReplace && typeof window.history.replaceState === "function") {
                window.history.replaceState(stateObj, nextScreen.name || "", fullUrl);
            } else if (typeof window.history.pushState === "function") {
                window.history.pushState(stateObj, nextScreen.name || "", fullUrl);
            }
        }
    } catch (e) { /* test environment */ }

    if (typeof document !== "undefined" && document.title !== undefined) {
        document.title = nextScreen.name || (CURRENT_ACTIVE_FLOW && CURRENT_ACTIVE_FLOW.name) || "Nexa Dashboard";
    }
    window.__NEXA_PARAMS__ = params;
    mountScreen(nextScreen, window.__NEXA_TEMPLATES__ || [], forwardPayload);
    return true;
}

export function buildComponentClone(comp, namespacedId) {
    var clone = {};
    for (var k in comp) {
        if (Object.prototype.hasOwnProperty.call(comp, k)) clone[k] = comp[k];
    }
    clone.id = namespacedId;
    return clone;
}

export function mountAndFlatten(parentEl, comp, inheritedVis, templates, namespace, visitedTemplateIds, effectiveScreen, paramState, beforeEl) {
    var namespacedComp = compIndex(effectiveScreen)[namespace];
    var firstMount = !namespacedComp;
    if (firstMount) {
        namespacedComp = buildComponentClone(comp, namespace);
        namespacedComp.__paramState = paramState;
        addComponent(effectiveScreen, namespacedComp);
    }

    var innerScope = paramState;
    if (isStructural(comp) && hasVariables(comp)) {
        effectiveScreen.__scopes = effectiveScreen.__scopes || {};
        innerScope = effectiveScreen.__scopes[namespace] || (effectiveScreen.__scopes[namespace] = makeScope(paramState, comp.variables));
    }
    var vis = combineVisibility(inheritedVis, comp);
    if (vis === "remove") {
        if (isContainerNode(comp)) {
            walkNodes(comp.children, function (n) {
                var ns = childNamespace(namespace, n);
                if (compIndex(effectiveScreen)[ns]) return;
                var clone = buildComponentClone(n, ns);
                clone.__paramState = innerScope;
                addComponent(effectiveScreen, clone);
            });
        }
        return;
    }

    var el = document.createElement("div");
    el.setAttribute("data-id", namespace);
    var place = window.NexaModel && window.NexaModel.placeOf ? window.NexaModel.placeOf(comp, parentEl.__nexaNode || null) : "free";
    var into = place === "screen" ? surfaceElOf(parentEl)
        : place === "dock" ? dockLayerOf(parentEl.__nexaFrameEl || parentEl) : parentEl;
    applyNodeBox(el, comp, into.__nexaNode || null, into.__nexaSize || null);
    if (place === "dock") el.style.pointerEvents = "auto";
    el.style.display = vis === "show" ? (el.style.display || "") : "none";
    if (beforeEl && beforeEl.parentNode === into) into.insertBefore(el, beforeEl);
    else into.appendChild(el);

    if (comp.type === "@frame" && comp.inSlot) el.setAttribute("slot", comp.inSlot);
    if ((comp.scrollBehavior === "fixed" || comp.scrollBehavior === "sticky") &&
        !(window.NexaModel && parentEl.__nexaNode && window.NexaModel.isInFlow(comp, parentEl.__nexaNode))) registerPin(el, comp);

    el.__nexaModel = comp;
    if (typeof comp.teleport === "string" && comp.teleport && comp.teleportOn !== "logic") PENDING_TELEPORTS.push({ el: el, node: comp, ns: namespace });

    if (isStructural(comp)) {
        el.setAttribute("data-nexa-container", comp.type);
        if (comp.name) el.setAttribute("data-name", comp.name);
        if (typeof comp.slot === "string" && comp.slot.trim()) el.setAttribute("data-teleport-slot", comp.slot.trim());
        var carousel = comp.type === "@frame" && window.NexaModel && window.NexaModel.carouselOf ? window.NexaModel.carouselOf(comp) : null;
        var zoom = !carousel && comp.type === "@frame" && window.NexaModel && window.NexaModel.zoomOf ? window.NexaModel.zoomOf(comp) : null;
        var host = carousel ? setupCarousel(effectiveScreen, el, comp, namespace, innerScope, carousel) : zoom ? setupZoom(el, comp, zoom) : el;
        if (overlayModel(comp)) setupOverlay(effectiveScreen, el, comp, namespace, parentEl);
        el.__childHost = host;
        host.__nexaNode = comp;
        host.__nexaFrameEl = el;
        (comp.children || []).forEach(function (child) {
            mountAndFlatten(host, child, vis, templates, childNamespace(namespace, child), visitedTemplateIds, effectiveScreen, innerScope);
        });
        if (el.__carousel) el.__carousel.refresh();
        if (el.__zoom) el.__zoom.start();
        return;
    }

    if (comp.type === "@template") {
        var template = findTemplateById(templates, comp.templateId);
        if (!template) {
            el.textContent = "(missing template)";
            return;
        }
        if (visitedTemplateIds.indexOf(comp.templateId) !== -1) {
            el.textContent = "(circular template reference: " + template.name + ")";
            return;
        }
        var innerVisited = visitedTemplateIds.concat([comp.templateId]);
        var instanceParamState = resolveInstanceParamState(comp, template, paramState);
        effectiveScreen.__paramStates[namespace] = instanceParamState;
        if (firstMount) {
            (template.logic.nodes || []).forEach(function (n) {
                var clone = {};
                for (var k in n) clone[k] = n[k];
                clone.id = namespace + "::" + n.id;
                if (clone.compId !== undefined) clone.compId = namespace + "::" + clone.compId;
                if (clone.instanceId !== undefined) clone.instanceId = namespace + "::" + clone.instanceId;
                effectiveScreen.logic.nodes.push(clone);
            });
            (template.logic.wires || []).forEach(function (w) {
                effectiveScreen.logic.wires.push({ id: namespace + "::" + w.id, from: namespace + "::" + w.from, to: namespace + "::" + w.to });
            });
        }

        if (template.kind === "component") {
            var targetComp = getComponentTemplateTarget(template);
            if (targetComp) {
                if (targetComp.type === "@frame") {
                    var M = window.NexaModel;
                    if (M) {
                        var f = M.frameCss(targetComp, { scroll: true });
                        Object.keys(f).forEach(function (k) { el.style[k.replace(/-([a-z])/g, function (_m, c) { return c.toUpperCase(); })] = f[k]; });
                    }
                }
                var targetNs = namespace + "::" + targetComp.id;
                var targetNsComp = buildComponentClone(targetComp, targetNs);
                targetNsComp.__paramState = instanceParamState;
                addComponent(effectiveScreen, targetNsComp);
                compIndex(effectiveScreen)[namespace] = targetNsComp;
                el.setAttribute("data-component-id", targetNs);

                if (targetComp.type === "@lit-component") {
                    renderLitComponentInstance(el, targetComp, interpolateProps(targetComp.props || {}, instanceParamState, targetNsComp), makeCtx(effectiveScreen, targetNsComp));
                    return;
                }
                var typeDef = window.NEXA && window.NEXA.getComponent(targetComp.type);
                if (typeDef && typeof typeDef.render === "function") {
                    if (el.__nexaPendingTimer) { clearTimeout(el.__nexaPendingTimer); el.__nexaPendingTimer = null; }
                    if (typeof el.removeAttribute === "function") el.removeAttribute("data-nexa-unknown");
                    if (typeof typeDef.migrateProps === "function") targetNsComp.props = typeDef.migrateProps(targetNsComp.props || {});
                    try {
                        typeDef.render(el, interpolateProps(targetNsComp.props || {}, instanceParamState, targetNsComp), makeCtx(effectiveScreen, targetNsComp));
                        mountSlotFrames(el, targetComp, typeDef, function (host, child) {
                            mountAndFlatten(host, child, vis, templates, childNamespace(targetNs, child), innerVisited, effectiveScreen, instanceParamState);
                        });
                    } catch (e) {
                        el.textContent = "(render error: " + e.message + ")";
                    }
                    return;
                }
                if (isStructural(targetComp)) {
                    el.setAttribute("data-nexa-container", targetComp.type);
                    if (targetComp.name) el.setAttribute("data-name", targetComp.name);
                    (targetComp.children || []).forEach(function (child) {
                        mountAndFlatten(el, child, "show", templates, childNamespace(targetNs, child), innerVisited, effectiveScreen, instanceParamState);
                    });
                    return;
                }
                el.setAttribute("data-nexa-unknown", targetComp.type);
                if (typeof window !== "undefined" && window.requestAnimationFrame && typeof setTimeout === "function") {
                    if (el.__nexaPendingTimer) clearTimeout(el.__nexaPendingTimer);
                    el.__nexaPendingTimer = setTimeout(function () {
                        if (el.getAttribute("data-nexa-unknown") === targetComp.type && (!window.NEXA || !window.NEXA.getComponent(targetComp.type))) {
                            el.textContent = "(unknown component: " + targetComp.type + ")";
                        }
                    }, 500);
                }
            }
            return;
        }

        var inner = document.createElement("div");
        inner.style.position = "absolute";
        inner.style.left = "0";
        inner.style.top = "0";
        var Mdl = window.NexaModel;
        var slideOf = parentEl.__nexaNode && Mdl && Mdl.carouselOf && Mdl.carouselOf(parentEl.__nexaNode) ? parentEl.__nexaNode : null;
        var lc = comp.layoutChild || {};
        if (slideOf) {
            var it = Mdl.layoutOf(slideOf).items;
            var px = Number(it.padX) || 0, py = Number(it.padY) || 0;
            if (lc.w === "fill") { inner.style.left = px + "px"; inner.style.right = px + "px"; inner.style.width = "auto"; }
            else { inner.style.width = template.width + "px"; inner.style.left = "calc(" + px + "px + (100% - " + (2 * px + template.width) + "px) * " + Mdl.alignFraction(it.alignX) + ")"; }
            if (lc.h === "fill") { inner.style.top = py + "px"; inner.style.bottom = py + "px"; inner.style.height = "auto"; }
            else { inner.style.height = template.height + "px"; inner.style.top = "calc(" + py + "px + (100% - " + (2 * py + template.height) + "px) * " + Mdl.alignFraction(it.alignY) + ")"; }
        } else {
            inner.style.width = "100%";
            inner.style.height = "100%";
        }
        el.appendChild(inner);
        inner.style.overflow = "hidden";
        var contentHost = templateContentHost(inner, template, comp);
        (template.components || []).forEach(function (innerComp) {
            mountAndFlatten(contentHost, innerComp, "show", templates, namespace + "::" + innerComp.id, innerVisited, effectiveScreen, instanceParamState);
        });
        return;
    }

    if (comp.type === "@lit-component") {
        renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, paramState, namespacedComp), makeCtx(effectiveScreen, namespacedComp));
        return;
    }

    var def = window.NEXA && window.NEXA.getComponent(comp.type);
    if (def && typeof def.render === "function") {
        if (el.__nexaPendingTimer) { clearTimeout(el.__nexaPendingTimer); el.__nexaPendingTimer = null; }
        if (typeof el.removeAttribute === "function") el.removeAttribute("data-nexa-unknown");
        if (typeof def.migrateProps === "function") namespacedComp.props = def.migrateProps(namespacedComp.props || {});
        try {
            def.render(el, interpolateProps(namespacedComp.props || {}, paramState, namespacedComp), makeCtx(effectiveScreen, namespacedComp));
        } catch (e) {
            el.textContent = "(render error: " + e.message + ")";
        }
        mountSlotFrames(el, comp, def, function (host, child) {
            mountAndFlatten(host, child, vis, templates, childNamespace(namespace, child), visitedTemplateIds, effectiveScreen, innerScope);
        });
    } else {
        el.setAttribute("data-nexa-unknown", comp.type);
        if (typeof window !== "undefined" && window.requestAnimationFrame && typeof setTimeout === "function") {
            if (el.__nexaPendingTimer) clearTimeout(el.__nexaPendingTimer);
            el.__nexaPendingTimer = setTimeout(function () {
                if (el.getAttribute("data-nexa-unknown") === comp.type && (!window.NEXA || !window.NEXA.getComponent(comp.type))) {
                    el.textContent = "(unknown component: " + comp.type + ")";
                }
            }, 500);
        } else {
            el.textContent = "(unknown component: " + comp.type + ")";
        }
        if (isSlotHostNode(comp)) {
            el.__mountSlots = function (lateDef) {
                mountSlotFrames(el, comp, lateDef, function (host, child) {
                    mountAndFlatten(host, child, vis, templates, childNamespace(namespace, child), visitedTemplateIds, effectiveScreen, innerScope);
                });
            };
        }
    }
}

export function mountScreen(screen, templates, forwardPayload) {
    var artboard = document.getElementById("nexa-runtime-artboard");
    if (!artboard || !screen) return;
    if (CURRENT_EFFECTIVE_SCREEN) {
        dismountScreen();
    }
    window.__NEXA_SCREEN__ = screen;
    artboard.__nexaSize = { w: Number(screen.width) || 1024, h: Number(screen.height) || 768 };
    applyDisplayMode(screen, artboard);

    var effectiveScreen = { components: [], logic: { nodes: [], wires: [] } };
    effectiveScreen.__templates = templates || [];
    effectiveScreen.__tree = screen;
    effectiveScreen.__paramStates = {};

    var app = window.__NEXA_APP__ || { variables: [] };
    if (window.NexaModel && window.NexaModel.setTypes) window.NexaModel.setTypes(app.types || []);
    var sharedScope = makeSharedScope(app);
    var appScope = makeAppScope(app);
    effectiveScreen.__scopes = {
        "@shared": sharedScope,
        "@app": appScope,
        "": makeScope(appScope, screen.variables)
    };

    startBreakpoints(screen, effectiveScreen);
    startTheme(effectiveScreen, app);

    (screen.logic && screen.logic.nodes || []).forEach(function (n) { effectiveScreen.logic.nodes.push(n); });
    if (screen.logic && screen.logic.wires) {
        if (Array.isArray(screen.logic.wires)) {
            screen.logic.wires.forEach(function (w) { effectiveScreen.logic.wires.push(w); });
        } else if (typeof screen.logic.wires === "object") {
            Object.keys(screen.logic.wires).forEach(function (srcId) {
                var targets = screen.logic.wires[srcId];
                if (Array.isArray(targets)) {
                    targets.forEach(function (tgt) { effectiveScreen.logic.wires.push({ from: srcId, to: tgt }); });
                }
            });
        }
    }

    (screen.components || []).forEach(function (comp) {
        mountAndFlatten(artboard, comp, "show", effectiveScreen.__templates, comp.id, [], effectiveScreen, effectiveScreen.__scopes[""]);
    });

    applyTeleports(effectiveScreen);
    registerSparkplugBoundComponentsFrom(effectiveScreen);
    setUpSparkplugLiveBinding();

    Object.keys(effectiveScreen.__paramStates).forEach(function (namespacedInstanceId) {
        fireParamInputForInstance(effectiveScreen, namespacedInstanceId, effectiveScreen.__paramStates[namespacedInstanceId]);
    });

    CURRENT_EFFECTIVE_SCREEN = effectiveScreen;
    // Nexa Link: listen to the channels this screen's (and the active flow's) From Node-RED nodes use
    syncLinkSubscriptions([effectiveScreen, CURRENT_ACTIVE_FLOW_SCREEN], runLogicGraph);

    var initialLoadMsg = forwardPayload !== undefined ? { payload: forwardPayload } : { payload: null };
    fireLifecycle(effectiveScreen, "onload", initialLoadMsg);
    fireLifecycle(effectiveScreen, "onrender", cloneMsg(initialLoadMsg));

    if (!BEFOREUNLOAD_WIRED && typeof window !== "undefined" && typeof window.addEventListener === "function") {
        BEFOREUNLOAD_WIRED = true;
        window.addEventListener("beforeunload", function () {
            if (CURRENT_EFFECTIVE_SCREEN) fireLifecycle(CURRENT_EFFECTIVE_SCREEN, "onclose");
        });
    }

    if (!POPSTATE_WIRED && typeof window !== "undefined" && typeof window.addEventListener === "function") {
        POPSTATE_WIRED = true;
        window.addEventListener("popstate", function (e) {
            var prefix = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";
            var currentPath = (window.location && window.location.pathname) || "";
            var subPath = currentPath.indexOf(prefix) === 0 ? currentPath.slice(prefix.length) : currentPath;
            if (!subPath || subPath === "") subPath = "/";
            var stateScreenId = e && e.state && e.state.screenId;
            var stateFlowId = e && e.state && e.state.flowId;
            var stateNodeId = e && e.state && e.state.flowNodeId;
            var target = stateScreenId || subPath;

            if (!stateScreenId && findFlowForRoute(subPath)) {
                var flowMatch = findFlowForRoute(subPath);
                if (flowMatch && flowMatch.targetScreen) {
                    target = flowMatch.targetScreen.id;
                    stateFlowId = flowMatch.flow.id;
                } else {
                    matchFlowAndExecute(subPath);
                    return;
                }
            }

            var match = findScreenInProject(target);
            if (match && match.screen) {
                syncScreenWithFlow(match.screen, stateFlowId, stateNodeId);
                window.__NEXA_PARAMS__ = match.params || {};
                if (typeof document !== "undefined" && document.title !== undefined) {
                    document.title = match.screen.name || (CURRENT_ACTIVE_FLOW && CURRENT_ACTIVE_FLOW.name) || "Nexa Dashboard";
                }
                mountScreen(match.screen, window.__NEXA_TEMPLATES__ || []);
            }
        });
    }

    setUpInjectNodes(effectiveScreen, runLogicGraph);

    if (window.NEXA && typeof window.NEXA.onRegister === "function") {
        window.NEXA.onRegister(function (id) {
            var pending = document.querySelectorAll('[data-nexa-unknown="' + id + '"]');
            var late = null;
            Array.prototype.forEach.call(pending, function (el) {
                var dataId = el.getAttribute("data-id");
                var compId = el.getAttribute("data-component-id") || dataId;
                var comp = findComponent(effectiveScreen, compId) || findComponent(effectiveScreen, dataId);
                if (!comp) return;
                if (el.__nexaPendingTimer) {
                    clearTimeout(el.__nexaPendingTimer);
                    el.__nexaPendingTimer = null;
                }
                el.removeAttribute("data-nexa-unknown");
                el.textContent = "";
                refreshComponentRender(effectiveScreen, comp);
                if (el.__mountSlots) {
                    var mountSlots = el.__mountSlots;
                    el.__mountSlots = null;
                    if (!late) late = beginLateMount(effectiveScreen);
                    mountSlots(window.NEXA.getComponent(id));
                }
            });
            if (late) endLateMount(effectiveScreen, late);
        });
    }
}

function beginLateMount(effectiveScreen) {
    return { logicCount: effectiveScreen.logic.nodes.length, instances: Object.keys(effectiveScreen.__paramStates || {}) };
}

function endLateMount(effectiveScreen, before) {
    applyTeleports(effectiveScreen);
    registerSparkplugBoundComponentsFrom(effectiveScreen);
    var states = effectiveScreen.__paramStates || {};
    Object.keys(states).forEach(function (ns) {
        if (before.instances.indexOf(ns) === -1) fireParamInputForInstance(effectiveScreen, ns, states[ns]);
    });
    var added = effectiveScreen.logic.nodes.slice(before.logicCount);
    ["onload", "onrender"].forEach(function (type) {
        added.filter(function (n) { return n.type === type; }).forEach(function (n) { runLogicGraph(effectiveScreen, n, cloneMsg({ payload: null })); });
    });
}

export { matchScreenPath };

export function extractDeviceContext() {
    var w = (typeof window !== "undefined" && window.innerWidth) || 1024;
    var h = (typeof window !== "undefined" && window.innerHeight) || 768;
    var deviceType = "desktop";
    if (w < 768) {
        deviceType = "mobile";
    } else if (w < 1024) {
        deviceType = "tablet";
    }
    var orientation = w >= h ? "landscape" : "portrait";
    var nav = typeof navigator !== "undefined" ? navigator : {};
    return {
        type: deviceType,
        screen: {
            width: w,
            height: h,
            orientation: orientation,
            colorDepth: (typeof screen !== "undefined" && screen.colorDepth) || 24,
            pixelRatio: (typeof window !== "undefined" && window.devicePixelRatio) || 1
        },
        userAgent: nav.userAgent || "",
        language: nav.language || (nav.languages && nav.languages[0]) || "",
        platform: nav.platform || "",
        online: nav.onLine !== false,
        ip: (typeof window !== "undefined" && window.__NEXA_CLIENT_IP__) || ""
    };
}

export function extractCookies(selectiveList) {
    var cookies = {};
    if (typeof document === "undefined" || !document.cookie) return cookies;
    var raw = document.cookie.split(";");
    var str = (selectiveList && typeof selectiveList === "string") ? selectiveList.trim() : "";
    if (!str) return cookies;
    var filter = null;
    if (str !== "*") {
        filter = str.split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
        if (!filter.length) return cookies;
    }
    raw.forEach(function (pair) {
        var parts = pair.split("=");
        var key = parts[0] ? parts[0].trim() : "";
        if (!key) return;
        if (!filter || filter.indexOf(key.toLowerCase()) !== -1) {
            var val = parts.slice(1).join("=").trim();
            try { val = decodeURIComponent(val); } catch (e) { /* ignore */ }
            cookies[key] = val;
        }
    });
    return cookies;
}
