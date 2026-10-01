import {
    state, SVG_NS, LOGIC_CANVAS_W, LOGIC_CANVAS_H, LOGIC_NODE_W, LOGIC_NODE_H,
    LOGIC_NODE_KINDS, snapLogic, getActiveScreen, findComponent, findTemplate, findLogicNode, genId, markDirty, Tree
} from "../state.js";
import { pushHistory } from "../history.js";
import { wireLogicOutputPort, renderLogicWires } from "./logic-wires.js";
import { isLogicSelected, selectLogicOnly, refreshLogicSelectionVisuals, syncComponentFromLogicSelection } from "./logic-selection.js";
import { openFunctionNodeEditor } from "../dialogs/function-dialog.js";
import { openUiUpdateNodeEditor } from "../dialogs/ui-update-dialog.js";
import { openInjectNodeEditor } from "../dialogs/inject-dialog.js";
import { openOpenUrlNodeEditor } from "../dialogs/open-url-dialog.js";
import { openLayerControlNodeEditor } from "../dialogs/layer-control-dialog.js";
import { openSetVariableNodeEditor } from "../dialogs/set-variable-dialog.js";
import { openSetVariableMultiNodeEditor } from "../dialogs/set-variable-multi-dialog.js";
import { openGetVariableMultiNodeEditor } from "../dialogs/get-variable-multi-dialog.js";
import { openJoinNodeEditor } from "../dialogs/join-dialog.js";
import { openWebIoNodeEditor } from "../dialogs/web-io-dialog.js";
import { openPopulateNodeEditor, openLayoutNodeEditor } from "../dialogs/populate-dialog.js";
import { openTemplateOutputNodeEditor } from "../dialogs/template-output-dialog.js";
import { openSparkplugWriteNodeEditor } from "../dialogs/sparkplug-write-dialog.js";
import { openSparkplugWriteMultiNodeEditor } from "../dialogs/sparkplug-write-multi-dialog.js";
import { openOverlayNodeEditor, overlayLabel } from "../dialogs/overlay-dialog.js";
import { openTeleportNodeEditor, teleportNodeLabel } from "../dialogs/teleport-dialog.js";
import { openDelayNodeEditor } from "../dialogs/delay-dialog.js";
import { openNavigateNodeEditor } from "../dialogs/navigate-dialog.js";
import { openRouteTriggerNodeEditor } from "../dialogs/route-trigger-dialog.js";
import { openRouteNotFoundNodeEditor } from "../dialogs/route-not-found-dialog.js";
import { openRenderScreenNodeEditor } from "../dialogs/render-screen-dialog.js";
import { openSendToFlowNodeEditor } from "../dialogs/send-to-flow-dialog.js";
import { openSwitchNodeEditor } from "../dialogs/switch-dialog.js";
import { getReachableRenderScreens, hasIllegalRouteFanOut } from "./logic-wires.js";

export function logicNodeLabel(node) {
    var kind = LOGIC_NODE_KINDS[node.type] || {};
    if (node.type === "ui-event" || node.type === "ui-update") {
        var comp = findComponent(node.compId);
        var typeDef = comp && window.NEXA.getComponent(comp.type);
        var typeLabel = comp ? (comp.type === "@lit-component" ? "Lit Component" : comp.type === "@template" ? "Instance" : comp.type === "@frame" ? (comp.name || "Frame") : (typeDef ? typeDef.label : comp.type)) : "?";
        var name = (comp && comp.name) ? comp.name : (typeLabel + " #" + (comp ? comp.id.slice(-4) : "?"));
        if (node.type === "ui-event") {
            if (node.event === "sparkplug-change" || node.event === "sparkplug-update") {
                return name + " on Sparkplug Update";
            }
            if (node.event === "slide-change") return name + " on Slide Change";
            var evtDef = typeDef && typeDef.events && typeDef.events.find(function (e) { return e.name === node.event; });
            return name + " " + (evtDef ? evtDef.label : "on " + node.event);
        }
        return "Update " + name;
    }
    if (node.type === "inject") {
        var pLabel = node.payloadType === "json" ? "JSON" : node.payloadType === "str" ? (node.payload || "str") : (node.payloadType || "date");
        return "Inject (" + pLabel + ")";
    }
    if (node.type === "open-url") {
        return "Open URL" + (node.url ? (" (" + node.url + ")") : "");
    }
    if (node.type === "delay") {
        return "Delay (" + (node.delay != null ? node.delay : 500) + (node.unit || "ms") + ")";
    }
    if (node.type === "navigate") {
        if (node.mode === "history") {
            return "Goto (" + (node.historyAction === "forward" ? "Forward" : "Back") + ")";
        }
        if (node.mode === "url") {
            return "Goto Route" + (node.url ? (" (" + node.url + ")") : "");
        }
        var s = (state.screens || []).find(function (x) { return x.id === node.screenId; });
        return "Goto Screen (" + (s ? s.name : (node.screenId || "?")) + ")";
    }
    if (node.type === "route-trigger") {
        var activeFl = getActiveScreen();
        var ep = (activeFl && activeFl.endpoint) || node.path || "/";
        return "Route Trigger (" + ep + ")";
    }
    if (node.type === "route-not-found") {
        return "Route Not Found (404)";
    }
    if (node.type === "render-screen") {
        var rScreen = (state.screens || []).find(function (x) { return x.id === node.screenId; });
        return "Render Screen (" + (rScreen ? rScreen.name : (node.screenId || "?")) + ")";
    }
    if (node.type === "send-to-flow") {
        return "Send to Flow" + (node.action ? (" (" + node.action + ")") : "");
    }
    if (node.type === "sparkplug-write") {
        var tagRef = node.tag && node.tag.replace(/^\{sparkplug:/, "").replace(/\}$/, "");
        return "Sparkplug Write" + (tagRef ? (" (" + tagRef + ")") : "");
    }
    if (node.type === "layer-control") {
        var n = (node.states || []).length;
        return "Layer Control" + (n ? (" (" + n + ")") : "");
    }
    if (node.type === "layout") {
        var lScreen = getActiveScreen();
        var lf = node.container && lScreen ? Tree.find(lScreen, node.container) : null;
        return lf ? (lf.name || ("Frame #" + lf.id.slice(-4))) : "Layout (missing frame)";
    }
    if (node.type === "teleport") return teleportNodeLabel(node);
    if (node.type === "overlay-open" || node.type === "overlay-close") {
        var oScreen = getActiveScreen();
        var of = node.overlay && oScreen ? Tree.find(oScreen, node.overlay) : null;
        var verb = node.type === "overlay-open" ? "Open " : "Close ";
        return verb + (of ? overlayLabel(of) : node.type === "overlay-close" && !node.overlay ? "the top overlay" : "(missing overlay)");
    }
    if (node.type === "populate" && !node.container) {
        var tplP = node.template ? findTemplate(node.template) : null;
        var mw = { append: "Append ", prepend: "Prepend ", upsert: "Update ", remove: "Remove ", clear: "Clear " }[node.mode] || "Populate ";
        return mw + (node.mode === "clear" || node.mode === "remove" ? "items" : (tplP ? tplP.name : "?") + (node.itemParam ? " → " + node.itemParam : "")) + " → layout";
    }
    if (node.type === "populate") {
        var pScreen = getActiveScreen();
        var target = node.container && pScreen ? Tree.find(pScreen, node.container) : null;
        var tpl = node.template ? findTemplate(node.template) : null;
        var modeWord = { append: "Append to ", prepend: "Prepend to ", upsert: "Update ", remove: "Remove from ", clear: "Clear " }[node.mode] || "Populate ";
        return modeWord + (target ? (target.name || "Frame") : "?") + (node.mode === "clear" || node.mode === "remove" ? "" : " × " + (tpl ? tpl.name : "?") + (node.itemParam ? " → " + node.itemParam : ""));
    }
    if (node.type === "http-request") {
        var u = node.url || "";
        return (node.method || "GET") + " " + (u ? (u.length > 50 ? u.slice(0, 49) + "…" : u) : "(no URL)");
    }
    if (node.type === "storage" || node.type === "cookie") {
        var what = node.type === "storage" ? (node.store === "session" ? "session" : "local") + " " + (node.key || "?") : "cookie " + (node.name || "?");
        return ({ set: "Set ", remove: "Remove " }[node.action] || "Get ") + what;
    }
    if (node.type === "set-variable-multi") {
        var n = (node.assignments || []).length;
        return "Set Variables" + (n ? " (" + n + ")" : "");
    }
    if (node.type === "get-variable-multi") {
        var n = (node.reads || []).length;
        return "Get Variables" + (n ? " (" + n + ")" : "");
    }
    if (node.type === "join") {
        var modeLabels = { "wait-all": "Wait All", "combine-latest": "Combine Latest", "sequence-n": "Seq " + (node.count || 2) };
        var mLabel = modeLabels[node.mode || "wait-all"] || "Join";
        var sCount = (node.slots || []).length;
        return "Join [" + mLabel + (sCount ? ": " + sCount : "") + "]";
    }
    if (node.type === "set-variable" || node.type === "get-variable" || node.type === "on-variable-change") {
        var vScreen = getActiveScreen();
        var formatVarRef = function (vScope, vName) {
            var owner = vScope && vScope !== "@app" && vScreen ? Tree.find(vScreen, vScope) : null;
            var where = vScope === "@app" ? "App" : vScope ? (owner ? (owner.name || owner.type) : "?") : (state.editingMode === "template" ? "template" : "screen");
            return where + "." + vName;
        };

        if (node.type === "on-variable-change") {
            if (Array.isArray(node.variables) && node.variables.length > 0) {
                var deps = node.variables.map(function (v) {
                    return v ? formatVarRef(v.scope, v.name) : "?";
                });
                return "Watch (" + deps.join(", ") + ")";
            }
            if (node.name) {
                return "Watch " + formatVarRef(node.scope, node.name);
            }
            return "Watch Variable";
        }

        var owner = node.scope && node.scope !== "@app" && vScreen ? Tree.find(vScreen, node.scope) : null;
        var where = node.scope === "@app" ? "App" : node.scope ? (owner ? (owner.name || owner.type) : "?") : (state.editingMode === "template" ? "template" : "screen");
        var ref = where + "." + node.name;
        if (!node.name) return kind.label;
        if (node.type === "get-variable") return "Get " + ref + (node.target && node.target !== "payload" ? " → msg." + node.target : "");
        var OPS = { merge: "Merge into ", append: "Append to ", remove: "Remove from ", toggle: "Toggle ", increment: "Increment " };
        return (OPS[node.op] || "Set ") + ref + (node.valueSource === "static" && node.op !== "toggle" ? " = " + JSON.stringify(node.value) : node.valueSource === "msg" ? " ← msg." + node.msgPath : "");
    }
    if (node.type === "template-output") return "Send to Host" + (node.output && node.output !== "out" ? " (" + node.output + ")" : "");
    if (node.type === "template-event") {
        var evComp = findComponent(node.instanceId);
        var evTemplate = evComp && findTemplate(evComp.templateId);
        var evName = (evComp && evComp.name) ? evComp.name : ((evTemplate ? evTemplate.name : "Instance") + " #" + (evComp ? evComp.id.slice(-4) : "?"));
        return evName + " on " + (node.output || "any output");
    }
    if (node.type === "set-template-param") {
        var instComp = findComponent(node.instanceId);
        var instTemplate = instComp && findTemplate(instComp.templateId);
        var param = instTemplate && (instTemplate.params || []).find(function (p) { return p.name === node.paramName; });
        var instName = (instComp && instComp.name) ? instComp.name : ("Instance #" + (instComp ? instComp.id.slice(-4) : "?"));
        return instName + " → Set " + (param ? param.label : node.paramName);
    }
    if (node.type === "switch") {
        var p = (node.propertyType === "var" ? "$" : node.propertyType === "tag" ? "" : "msg.") + (node.property || "payload");
        var nRules = (node.rules || []).length;
        return (node.name || "Switch") + " [" + p + " : " + nRules + "]";
    }
    return kind.label || node.type;
}

var _measureCanvasCtx = null;
export function logicNodeWidth(node) {
    if (!node) return LOGIC_NODE_W;
    var label = logicNodeLabel(node);
    if (!label) return LOGIC_NODE_W;

    var textWidth = 0;
    try {
        if (typeof document !== "undefined" && typeof document.createElement === "function") {
            if (!_measureCanvasCtx) {
                var canvas = document.createElement("canvas");
                if (canvas && typeof canvas.getContext === "function") {
                    _measureCanvasCtx = canvas.getContext("2d");
                }
            }
            if (_measureCanvasCtx) {
                _measureCanvasCtx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
                var metrics = _measureCanvasCtx.measureText(label);
                if (metrics && metrics.width) {
                    textWidth = metrics.width;
                }
            }
        }
    } catch (e) {}

    if (!textWidth) {
        textWidth = label.length * 7.5;
    }

    var kind = LOGIC_NODE_KINDS[node.type] || {};
    var padLeft = 16;
    var padRight = kind.hasOutput ? 14 : 10;
    var border = 2;
    var extra = 8;

    var needed = Math.ceil(textWidth + padLeft + padRight + border + extra);
    return Math.max(LOGIC_NODE_W, needed);
}

export function logicNodeHeight(node) {
    if (node && node.type === "switch") {
        var numRules = (node.rules && node.rules.length) ? node.rules.length : 1;
        return Math.max(LOGIC_NODE_H, numRules * 20 + 10);
    }
    return LOGIC_NODE_H;
}

export function addLogicNode(nodeData, x, y) {
    var screen = getActiveScreen();
    if (!screen) return;
    if (nodeData.type === "route-trigger") {
        if (state.editingMode !== "flow") {
            if (window.RED && window.RED.notify) window.RED.notify("Route Trigger can only be used in a Screen Flow.", "warning");
            return;
        }
        var hasTrigger = (screen.logic && screen.logic.nodes || []).some(function (n) { return n.type === "route-trigger"; });
        if (hasTrigger) {
            if (window.RED && window.RED.notify) window.RED.notify("Only 1 Route Trigger node is allowed per flow.", "warning");
            return;
        }
        nodeData.path = screen.endpoint || "/";
    }
    if (nodeData.type === "route-not-found") {
        if (state.editingMode !== "flow") {
            if (window.RED && window.RED.notify) window.RED.notify("Route Not Found can only be used in a Screen Flow.", "warning");
            return;
        }
        var hasNotFound = (screen.logic && screen.logic.nodes || []).some(function (n) { return n.type === "route-not-found"; });
        if (hasNotFound) {
            if (window.RED && window.RED.notify) window.RED.notify("Only 1 Route Not Found node is allowed per flow.", "warning");
            return;
        }
    }
    var node = { id: genId(), x: x, y: y };
    for (var k in nodeData) node[k] = nodeData[k];
    screen.logic.nodes.push(node);
    pushHistory({ t: "addLogicNode", screenId: screen.id, node: node });
    renderLogicCanvas();
    markDirty();
}

export function removeLogicNodes(ids) {
    var screen = getActiveScreen();
    if (!screen || !screen.logic) return;
    var toRemove = ids.map(function (id) { return findLogicNode(screen, id); }).filter(Boolean);
    if (!toRemove.length) return;
    var removeIds = toRemove.map(function (n) { return n.id; });
    var events = toRemove.map(function (node) {
        var touchingWires = screen.logic.wires.filter(function (w) { return w.from === node.id || w.to === node.id; });
        return { t: "deleteLogicNode", screenId: screen.id, node: node, wires: touchingWires };
    });
    screen.logic.nodes = screen.logic.nodes.filter(function (n) { return removeIds.indexOf(n.id) === -1; });
    screen.logic.wires = screen.logic.wires.filter(function (w) { return removeIds.indexOf(w.from) === -1 && removeIds.indexOf(w.to) === -1; });
    pushHistory(events.length === 1 ? events[0] : { t: "multi", screenId: screen.id, events: events });
    state.logicSelectedIds = state.logicSelectedIds.filter(function (id) { return removeIds.indexOf(id) === -1; });
    renderLogicCanvas();
    markDirty();
}

export function renderLogicNode(node) {
    var kind = LOGIC_NODE_KINDS[node.type] || {};
    var label = logicNodeLabel(node);
    var nodeW = logicNodeWidth(node);
    var nodeH = logicNodeHeight(node);
    node.w = nodeW;
    node.h = nodeH;
    var box = window.$("<div>", { "class": "nexa-logic-node", "data-node-id": node.id }).css({
        position: "absolute", left: node.x + "px", top: node.y + "px",
        width: nodeW + "px", height: nodeH + "px",
        background: "var(--red-ui-view-background, #fff)",
        color: "var(--red-ui-node-label-color, #333)",
        "border-radius": "4px", "font-size": "12px",
        display: "flex", "align-items": "center",
        "padding-left": "16px", "padding-right": (kind.hasOutput ? "14px" : "10px"), "box-sizing": "border-box", cursor: "move",
        overflow: "hidden", "white-space": "nowrap", "text-overflow": "ellipsis",
        border: "1px solid var(--red-ui-node-border, #999)",
        "box-shadow": "0 1px 3px rgba(0,0,0,0.3)"
    }).text(label).appendTo(state.logicArtboardEl);

    window.$("<div>").css({
        position: "absolute", left: "0", top: "0", bottom: "0", width: "6px",
        background: kind.color || "#607d8b",
        "border-top-left-radius": "4px", "border-bottom-left-radius": "4px"
    }).appendTo(box);

    box.on("mousedown", function (e) {
        e.stopPropagation();
        if (e.shiftKey) {
            if (isLogicSelected(node.id)) {
                state.logicSelectedIds = state.logicSelectedIds.filter(function (id) { return id !== node.id; });
            } else {
                state.logicSelectedIds.push(node.id);
            }
            refreshLogicSelectionVisuals();
            syncComponentFromLogicSelection();
        } else if (!isLogicSelected(node.id)) {
            selectLogicOnly(node.id);
        } else {
            syncComponentFromLogicSelection();
        }
    });

    if (node.type === "function") {
        box.attr("title", "Double-click to edit code").on("dblclick", function (e) {
            e.stopPropagation();
            openFunctionNodeEditor(node);
        });
    }
    if (node.type === "switch") {
        box.attr("title", "Double-click to configure switch rules").on("dblclick", function (e) {
            e.stopPropagation();
            openSwitchNodeEditor(node);
        });
    }
    if (node.type === "ui-update") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openUiUpdateNodeEditor(node);
        });
    }
    if (node.type === "inject") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openInjectNodeEditor(node);
        });
    }
    if (node.type === "open-url") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openOpenUrlNodeEditor(node);
        });
    }
    if (node.type === "delay") {
        box.attr("title", "Double-click to configure delay").on("dblclick", function (e) {
            e.stopPropagation();
            openDelayNodeEditor(node);
        });
    }
    if (node.type === "navigate") {
        box.attr("title", "Double-click to configure navigation").on("dblclick", function (e) {
            e.stopPropagation();
            openNavigateNodeEditor(node);
        });
    }
    if (node.type === "route-trigger") {
        box.attr("title", "Double-click to configure route trigger").on("dblclick", function (e) {
            e.stopPropagation();
            openRouteTriggerNodeEditor(node);
        });
        if (state.editingMode === "flow" && screen && screen.logic) {
            if (hasIllegalRouteFanOut(node.id, screen.logic.nodes, screen.logic.wires)) {
                box.css("border", "2px solid #ef4444");
                window.$("<div>").css({
                    position: "absolute", right: "-8px", top: "-8px",
                    background: "#ef4444", color: "#fff",
                    "border-radius": "50%", width: "18px", height: "18px",
                    "font-size": "11px", "font-weight": "bold",
                    display: "flex", "align-items": "center", "justify-content": "center",
                    cursor: "help"
                }).text("!").attr("title", "Fan-out error: Route Trigger branches to multiple concurrent Render Screen nodes on the same path!").appendTo(box);
            }
        }
    }
    if (node.type === "route-not-found") {
        box.attr("title", "Double-click to configure route not found").on("dblclick", function (e) {
            e.stopPropagation();
            openRouteNotFoundNodeEditor(node);
        });
    }
    if (node.type === "render-screen") {
        box.attr("title", "Double-click to choose screen to render").on("dblclick", function (e) {
            e.stopPropagation();
            openRenderScreenNodeEditor(node);
        });
    }
    if (node.type === "send-to-flow") {
        box.attr("title", "Double-click to configure message to flow").on("dblclick", function (e) {
            e.stopPropagation();
            openSendToFlowNodeEditor(node);
        });
    }
    if (node.type === "layer-control") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openLayerControlNodeEditor(node);
        });
    }
    if (node.type === "template-output" || node.type === "template-event") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openTemplateOutputNodeEditor(node);
        });
    }
    if (node.type === "layout") {
        box.attr("title", "Double-click to choose the frame. Its output: what its copies send (Send to Host).").on("dblclick", function (e) {
            e.stopPropagation();
            openLayoutNodeEditor(node);
        });
    }
    if (node.type === "teleport") {
        box.attr("title", "Double-click to choose the node and where it goes").on("dblclick", function (e) {
            e.stopPropagation();
            openTeleportNodeEditor(node);
        });
    }
    if (node.type === "overlay-open" || node.type === "overlay-close") {
        box.attr("title", node.type === "overlay-open" ? "Double-click to choose the dialog / drawer. Its output fires when it closes (msg.payload = the result)." : "Double-click to choose what it closes and its result").on("dblclick", function (e) {
            e.stopPropagation();
            openOverlayNodeEditor(node);
        });
    }
    if (node.type === "populate") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openPopulateNodeEditor(node);
        });
    }
    if (node.type === "http-request" || node.type === "storage" || node.type === "cookie") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openWebIoNodeEditor(node);
        });
    }
    if (node.type === "set-variable" || node.type === "get-variable" || node.type === "on-variable-change") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openSetVariableNodeEditor(node);
        });
    }
    if (node.type === "set-variable-multi") {
        box.attr("title", "Double-click to configure variable assignments").on("dblclick", function (e) {
            e.stopPropagation();
            openSetVariableMultiNodeEditor(node);
        });
    }
    if (node.type === "get-variable-multi") {
        box.attr("title", "Double-click to configure variable reads").on("dblclick", function (e) {
            e.stopPropagation();
            openGetVariableMultiNodeEditor(node);
        });
    }
    if (node.type === "join") {
        box.attr("title", "Double-click to configure join mode and slots").on("dblclick", function (e) {
            e.stopPropagation();
            openJoinNodeEditor(node);
        });
    }
    if (node.type === "sparkplug-write") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openSparkplugWriteNodeEditor(node);
        });
    }
    if (node.type === "sparkplug-write-multi") {
        box.attr("title", "Double-click for usage").on("dblclick", function (e) {
            e.stopPropagation();
            openSparkplugWriteMultiNodeEditor(node);
        });
    }

    if (kind.hasOutput) {
        if (node.type === "switch") {
            var rules = (node.rules && node.rules.length) ? node.rules : [{ t: "eq", v: "", vt: "str" }];
            var numPorts = rules.length;
            for (var pIdx = 0; pIdx < numPorts; pIdx++) {
                var yOffset = ((pIdx + 1) / (numPorts + 1)) * nodeH;
                var outDot = window.$("<div>", {
                    "class": "nexa-logic-port-out",
                    "data-port-index": pIdx
                }).css({
                    position: "absolute", right: "-4px", top: yOffset + "px", "margin-top": "-4px",
                    width: "8px", height: "8px",
                    background: "var(--red-ui-node-border, #999)", cursor: "crosshair",
                    transform: "scale(" + (1 / state.logicZoomLevel) + ")"
                }).attr("title", "Port " + (pIdx + 1) + ": " + (rules[pIdx] ? (rules[pIdx].t || "rule") : "")).appendTo(box);
                wireLogicOutputPort(outDot, node, pIdx);
            }
        } else {
            var outDot = window.$("<div>", { "class": "nexa-logic-port-out" }).css({
                position: "absolute", right: "-4px", top: (nodeH / 2) + "px", "margin-top": "-4px",
                width: "8px", height: "8px",
                background: "var(--red-ui-node-border, #999)", cursor: "crosshair",
                transform: "scale(" + (1 / state.logicZoomLevel) + ")"
            }).appendTo(box);
            wireLogicOutputPort(outDot, node, 0);
        }
    }
    if (kind.hasInput) {
        window.$("<div>", { "class": "nexa-logic-port-in", "data-node-id": node.id }).css({
            position: "absolute", left: "-4px", top: (nodeH / 2) + "px", "margin-top": "-4px",
            width: "8px", height: "8px",
            background: "var(--red-ui-node-border, #999)",
            transform: "scale(" + (1 / state.logicZoomLevel) + ")"
        }).appendTo(box);
    }

    var moveStart = null;
    var dragStartPage = null;
    var groupStart = null;
    box.draggable({
        start: function (e) {
            if (!isLogicSelected(node.id)) selectLogicOnly(node.id);
            moveStart = { x: node.x, y: node.y };
            dragStartPage = { x: e.pageX, y: e.pageY };
            groupStart = {};
            state.logicSelectedIds.forEach(function (id) {
                var n = findLogicNode(getActiveScreen(), id);
                if (n) groupStart[id] = { x: n.x, y: n.y };
            });
        },
        drag: function (e, ui) {
            var localLeft = moveStart.x + (e.pageX - dragStartPage.x) / state.logicZoomLevel;
            var localTop = moveStart.y + (e.pageY - dragStartPage.y) / state.logicZoomLevel;
            if (!e.altKey) { localLeft = snapLogic(localLeft); localTop = snapLogic(localTop); }
            localLeft = Math.max(0, Math.min(localLeft, LOGIC_CANVAS_W - nodeW));
            localTop = Math.max(0, Math.min(localTop, LOGIC_CANVAS_H - nodeH));
            ui.position.left = localLeft;
            ui.position.top = localTop;
            var dx = localLeft - node.x, dy = localTop - node.y;
            node.x = localLeft;
            node.y = localTop;
            state.logicSelectedIds.forEach(function (id) {
                if (id === node.id) return;
                var n = findLogicNode(getActiveScreen(), id);
                if (!n) return;
                n.x += dx; n.y += dy;
                state.logicArtboardEl.find('.nexa-logic-node[data-node-id="' + id + '"]').css({ left: n.x + "px", top: n.y + "px" });
            });
            renderLogicWires();
        },
        stop: function (e) {
            var localLeft = moveStart.x + (e.pageX - dragStartPage.x) / state.logicZoomLevel;
            var localTop = moveStart.y + (e.pageY - dragStartPage.y) / state.logicZoomLevel;
            if (!e.altKey) { localLeft = snapLogic(localLeft); localTop = snapLogic(localTop); }
            // the others moved along by the same step (drag above): keep them there
            var ddx = Math.max(0, Math.min(localLeft, LOGIC_CANVAS_W - nodeW)) - node.x;
            var ddy = Math.max(0, Math.min(localTop, LOGIC_CANVAS_H - nodeH)) - node.y;
            node.x += ddx;
            node.y += ddy;
            state.logicSelectedIds.forEach(function (id) {
                if (id === node.id || (!ddx && !ddy)) return;
                var n = findLogicNode(getActiveScreen(), id);
                if (n) { n.x += ddx; n.y += ddy; state.logicArtboardEl.find('.nexa-logic-node[data-node-id="' + id + '"]').css({ left: n.x + "px", top: n.y + "px" }); }
            });
            var moved = [];
            state.logicSelectedIds.forEach(function (id) {
                var n = findLogicNode(getActiveScreen(), id);
                var start = groupStart[id];
                if (!n || !start) return;
                if (start.x !== n.x || start.y !== n.y) {
                    moved.push({ t: "moveLogicNode", screenId: getActiveScreen().id, id: id, from: start, to: { x: n.x, y: n.y } });
                }
            });
            if (moved.length === 1) {
                pushHistory(moved[0]);
            } else if (moved.length > 1) {
                pushHistory({ t: "multi", screenId: getActiveScreen().id, events: moved });
            }
            if (moved.length) markDirty();
            renderLogicWires();
        }
    });
}

export function renderLogicCanvas() {
    if (!state.logicArtboardEl) return;
    state.logicArtboardEl.empty();
    state.logicSvgEl = window.$(document.createElementNS(SVG_NS, "svg")).attr({
        width: LOGIC_CANVAS_W, height: LOGIC_CANVAS_H
    }).css({ position: "absolute", left: "0", top: "0", "pointer-events": "none" }).appendTo(state.logicArtboardEl);
    var screen = getActiveScreen();
    if (!screen || !screen.logic) return;
    (screen.logic.nodes || []).forEach(renderLogicNode);
    renderLogicWires();
    // the nodes were re-created: show what is selected again
    refreshLogicSelectionVisuals();
}
