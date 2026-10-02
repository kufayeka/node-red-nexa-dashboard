// Moving around on the page: screens (SPA), URLs, Screen Flows. The navigation itself:
// src/runtime/features/navigation.js.
import { defineLogicRuntimes } from "../registry.js";
import { cloneMsg, logicTrace } from "../../../runtime/logic/context.js";
import {
    navigateToScreen, findScreenInProject, getActiveRenderScreen, getActiveFlowScreen, setActiveRenderScreen
} from "../../../runtime/features/navigation.js";

// "orders.example.com/x" -> https://…, "10.0.0.5:1880" -> http://…, a path in "endpoint" mode -> under /nexa
function resolveUrl(target, mode) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(target) || /^\/\//.test(target)) return target;
    if (/^(localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/.*)?$/i.test(target)) return "http://" + target;
    if (/^www\./i.test(target) || /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(target)) return "https://" + target;
    if (mode !== "endpoint") return target;
    if (target.charAt(0) === "/") {
        const base = window.location.pathname.startsWith("/nexa") ? "/nexa" : "";
        return base + (target.startsWith("/nexa") ? target.slice(5) : target);
    }
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length > 0) parts.pop();
    parts.push(target);
    return "/" + parts.join("/");
}

defineLogicRuntimes({
    "navigate": {
        run: function (node, msg) {
            const mode = (msg && msg.mode) || node.props.mode || "screen";
            if (mode === "history") {
                const action = (msg && msg.action) || node.props.historyAction || "back";
                const h = typeof window.history !== "undefined" ? window.history : null;
                if (action === "forward") { if (h && typeof h.forward === "function") h.forward(); }
                else if (h && typeof h.back === "function") h.back();
                return msg;
            }
            const targetId = mode === "url"
                ? ((msg && (msg.url || msg.path || msg.endpoint)) || node.props.url)
                : ((msg && (msg.screenId || msg.screen)) || node.props.screenId);
            const payload = node.props.forwardPayload !== false ? (msg && msg.payload) : undefined;
            navigateToScreen(targetId, payload, node.props.replace === true, true);
            return msg;
        }
    },
    "open-url": {
        run: function (node, msg) {
            const raw = (msg && typeof msg.payload === "string" && msg.payload) || (msg && (msg.url || msg.endpoint)) || node.props.url;
            const mode = (msg && msg.mode) || node.props.mode || "replace";
            const newTab = (msg && typeof msg.newTab === "boolean") ? msg.newTab : node.props.newTab;
            if (raw) {
                const url = resolveUrl(String(raw).trim(), mode);
                if (newTab) window.open(url, "_blank");
                else window.location.href = url;
            }
            return msg;
        }
    },
    "reload": {
        run: function (node, msg) {
            window.location.reload();
            return msg;
        }
    },
    // the flow's entry points: fired by the flow router (navigation.js runFlow / matchFlowAndExecute)
    "route-trigger": { run: function (node, msg) { return msg; } },
    "route-not-found": { run: function (node, msg) { return msg; } },
    "render-screen": {
        run: function (node, msg, ctx) {
            const target = (msg && (msg.screenId || msg.screen)) || node.props.screenId;
            const match = findScreenInProject(target);
            if (!match || !match.screen) {
                console.warn("[nexa-runtime] render-screen: target screen not found:", target);
                return;
            }
            setActiveRenderScreen({ flowScreen: ctx.screen, flowNode: node, screenId: match.screen.id });
            navigateToScreen(match.screen.id, node.props.forwardPayload !== false ? (msg && msg.payload) : undefined, false, true, node.id);
        }
    },
    // from the screen to the active flow's Render Screen node; the screen's own chain goes on too
    "send-to-flow": {
        run: function (node, msg, ctx) {
            const sendMsg = cloneMsg(msg);
            if (node.props.action) sendMsg.action = node.props.action;
            const render = getActiveRenderScreen();
            const flow = getActiveFlowScreen();
            if (flow && render && render.flowNode) {
                logicTrace("send-to-flow dispatching to Flow node:", render.flowNode.id);
                ctx.continuePropagation(flow, render.flowNode, sendMsg, ctx.budget);
            } else {
                console.warn("[nexa-runtime] send-to-flow: no active Render Screen node to receive message in current flow");
            }
            return msg;
        }
    }
});
