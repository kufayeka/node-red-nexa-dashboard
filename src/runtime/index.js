/**
 * @file src/runtime/index.js
 * @description Nexa Dashboard Client Runtime - Master Entry Point.
 * Orchestrates real-time IO client, reactive state, visual layout engine, and logic flow runner.
 */

import { ioSubscribedKeys, setUpSparkplugLiveBinding } from "./io/client.js";
import {
    navigateToScreen, mountScreen, dismountScreen, findFlowForRoute, matchFlowAndExecute,
    extractDeviceContext, extractCookies, getFlowAllowedScreenIds, syncScreenWithFlow,
    getActiveRenderScreen, getEffectiveScreen, getActiveFlow
} from "./features/navigation.js";
import { runLogicGraph } from "./logic/runner.js";
import { state } from "./state.js";
import { migrateLogic } from "../model/migrate-logic.js";

// Export modular submodules for programmatic testing and integration
export * from "./state.js";
export * from "./mounting/box.js";
export * from "./mounting/pins.js";
export * from "./mounting/slots.js";
export * from "./mounting/lit.js";
export * from "./mounting/render.js";
export * from "./state/scope.js";
export * from "./state/variable.js";
export * from "./io/sparkplug.js";
export * from "./io/frame.js";
export * from "./io/client.js";
export * from "./logic/context.js";
export * from "./logic/runner.js";
export * from "./logic/widgets/carousel.js";
export * from "./logic/widgets/zoom.js";
export * from "./logic/widgets/virtual.js";
export * from "./logic/widgets/populate.js";
export * from "./features/breakpoints.js";
export * from "./features/theme.js";
export * from "./features/teleport.js";
export * from "./features/overlays.js";
export * from "./features/navigation.js";

// Register global runtime facade for browser consumers and test suites
if (typeof window !== "undefined") {
    window.__nexaRuntime = Object.assign(window.__nexaRuntime || {}, {
        subscribedTags: ioSubscribedKeys,
        navigateToScreen: navigateToScreen,
        mountScreen: mountScreen,
        dismountScreen: dismountScreen,
        findFlowForRoute: findFlowForRoute,
        matchFlowAndExecute: matchFlowAndExecute,
        extractDeviceContext: extractDeviceContext,
        extractCookies: extractCookies,
        getFlowAllowedScreenIds: getFlowAllowedScreenIds,
        syncScreenWithFlow: syncScreenWithFlow,
        runLogicGraph: runLogicGraph,
        getActiveRenderScreen: getActiveRenderScreen,
        getEffectiveScreen: getEffectiveScreen,
        getActiveFlow: getActiveFlow,
        state: state
    });

    // logic nodes saved before node.props (a page built by hand, an older embed): bring them up to date
    [window.__NEXA_SCREEN__].concat(window.__NEXA_SCREENS__ || [], window.__NEXA_FLOWS__ || [], window.__NEXA_TEMPLATES__ || [])
        .forEach(function (s) { if (s && s.logic) migrateLogic(s.logic); });

    // Auto-bootstrap runtime on page load if artboard is mounted
    var prefix = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";
    var currentPath = (window.location && window.location.pathname) || "";
    var subPath = currentPath.indexOf(prefix) === 0 ? currentPath.slice(prefix.length) : currentPath;
    if (!subPath || subPath === "") subPath = "/";

    var flowMatched = findFlowForRoute(subPath);
    if (flowMatched) {
        matchFlowAndExecute(subPath);
    } else if (!window.__NEXA_FLOWS__ || window.__NEXA_FLOWS__.length === 0) {
        if (window.__NEXA_SCREEN__) {
            mountScreen(window.__NEXA_SCREEN__, window.__NEXA_TEMPLATES__ || []);
        }
    } else {
        var artboard = document.getElementById("nexa-runtime-artboard");
        if (artboard) {
            artboard.innerHTML = '<div style="padding: 40px; text-align: center; font-family: sans-serif; color: #64748b;">' +
                '<h2 style="color: #ef4444; margin-bottom: 8px;">Access Denied</h2>' +
                '<p>Standalone screen access is disabled. All pages must be accessed through a Flow gateway (e.g. /nexa' +
                ((window.__NEXA_FLOWS__ && window.__NEXA_FLOWS__[0] && window.__NEXA_FLOWS__[0].endpoint) || '/flow1') + ').</p>' +
                '</div>';
        }
    }
}
