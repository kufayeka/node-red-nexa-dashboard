import {
    state, SVG_NS, LOGIC_CANVAS_W, LOGIC_CANVAS_H, LOGIC_NODE_W, LOGIC_NODE_H,
    LOGIC_NODE_KINDS, getActiveScreen, findComponent, findTemplate, findLogicNode, genId, markDirty, Tree
} from "../state.js";
import { pushHistory } from "../history.js";
import { wireLogicOutputPort, renderLogicWires } from "./logic-wires.js";
import { isLogicSelected, selectLogicOnly, refreshLogicSelectionVisuals } from "./logic-selection.js";
import { openFunctionNodeEditor } from "../dialogs/function-dialog.js";
import { openUiUpdateNodeEditor } from "../dialogs/ui-update-dialog.js";
import { openInjectNodeEditor } from "../dialogs/inject-dialog.js";
import { openOpenUrlNodeEditor } from "../dialogs/open-url-dialog.js";
import { openLayerControlNodeEditor } from "../dialogs/layer-control-dialog.js";
import { openSetVariableNodeEditor } from "../dialogs/set-variable-dialog.js";
import { openSparkplugWriteNodeEditor } from "../dialogs/sparkplug-write-dialog.js";
import { openSparkplugWriteMultiNodeEditor } from "../dialogs/sparkplug-write-multi-dialog.js";

export function logicNodeLabel(node) {
    var kind = LOGIC_NODE_KINDS[node.type] || {};
    if (node.type === "ui-event" || node.type === "ui-update") {
        var comp = findComponent(node.compId);
        var typeDef = comp && window.NEXA.getComponent(comp.type);
        var typeLabel = comp ? (comp.type === "@lit-component" ? "Lit Component" : comp.type === "@template" ? "Instance" : (typeDef ? typeDef.label : comp.type)) : "?";
        var name = typeLabel + " #" + (comp ? comp.id.slice(-4) : "?");
        if (node.type === "ui-event") {
            if (node.event === "sparkplug-change" || node.event === "sparkplug-update") {
                return name + " on Sparkplug Update";
            }
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
    if (node.type === "sparkplug-write") {
        var tagRef = node.tag && node.tag.replace(/^\{sparkplug:/, "").replace(/\}$/, "");
        return "Sparkplug Write" + (tagRef ? (" (" + tagRef + ")") : "");
    }
    if (node.type === "layer-control") {
        var n = (node.states || []).length;
        return "Layer Control" + (n ? (" (" + n + ")") : "");
    }
    if (node.type === "set-variable") {
        var vScreen = getActiveScreen();
        var owner = node.scope && vScreen ? Tree.find(vScreen, node.scope) : null;
        var where = node.scope ? (owner ? (owner.name || owner.type) : "?") : (state.editingMode === "template" ? "template" : "screen");
        return node.name ? "Set " + where + "." + node.name + (node.valueSource === "static" ? " = " + JSON.stringify(node.value) : "") : "Set Variable";
    }
    if (node.type === "set-template-param") {
        var instComp = findComponent(node.instanceId);
        var instTemplate = instComp && findTemplate(instComp.templateId);
        var param = instTemplate && (instTemplate.params || []).find(function (p) { return p.name === node.paramName; });
        return "Instance #" + (instComp ? instComp.id.slice(-4) : "?") + " → Set " + (param ? param.label : node.paramName);
    }
    return kind.label || node.type;
}

export function addLogicNode(nodeData, x, y) {
    var screen = getActiveScreen();
    if (!screen) return;
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
    var box = window.$("<div>", { "class": "nexa-logic-node", "data-node-id": node.id }).css({
        position: "absolute", left: node.x + "px", top: node.y + "px",
        width: LOGIC_NODE_W + "px", height: LOGIC_NODE_H + "px",
        background: "var(--red-ui-view-background, #fff)",
        color: "var(--red-ui-node-label-color, #333)",
        "border-radius": "4px", "font-size": "12px",
        display: "flex", "align-items": "center",
        "padding-left": "16px", "padding-right": "10px", "box-sizing": "border-box", cursor: "move",
        overflow: "hidden", "white-space": "nowrap", "text-overflow": "ellipsis",
        border: "1px solid var(--red-ui-node-border, #999)",
        "box-shadow": "0 1px 3px rgba(0,0,0,0.3)"
    }).text(logicNodeLabel(node)).appendTo(state.logicArtboardEl);

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
        } else if (!isLogicSelected(node.id)) {
            selectLogicOnly(node.id);
        }
    });

    if (node.type === "function") {
        box.attr("title", "Double-click to edit code").on("dblclick", function (e) {
            e.stopPropagation();
            openFunctionNodeEditor(node);
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
    if (node.type === "layer-control") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openLayerControlNodeEditor(node);
        });
    }
    if (node.type === "set-variable") {
        box.attr("title", "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            openSetVariableNodeEditor(node);
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
        var outDot = window.$("<div>", { "class": "nexa-logic-port-out" }).css({
            position: "absolute", right: "-4px", top: "50%", "margin-top": "-4px",
            width: "8px", height: "8px",
            background: "var(--red-ui-node-border, #999)", cursor: "crosshair",
            transform: "scale(" + (1 / state.logicZoomLevel) + ")"
        }).appendTo(box);
        wireLogicOutputPort(outDot, node);
    }
    if (kind.hasInput) {
        window.$("<div>", { "class": "nexa-logic-port-in", "data-node-id": node.id }).css({
            position: "absolute", left: "-4px", top: "50%", "margin-top": "-4px",
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
            localLeft = Math.max(0, Math.min(localLeft, LOGIC_CANVAS_W - LOGIC_NODE_W));
            localTop = Math.max(0, Math.min(localTop, LOGIC_CANVAS_H - LOGIC_NODE_H));
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
            node.x = Math.max(0, Math.min(localLeft, LOGIC_CANVAS_W - LOGIC_NODE_W));
            node.y = Math.max(0, Math.min(localTop, LOGIC_CANVAS_H - LOGIC_NODE_H));
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
}
