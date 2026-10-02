// The Logic canvas: draws the nodes, drag / select / add / remove. What a node type looks like
// and which dialog it opens comes from the registry (src/features/logic/).
import {
    state, SVG_NS, LOGIC_CANVAS_W, LOGIC_CANVAS_H, LOGIC_NODE_W, LOGIC_NODE_H,
    snapLogic, getActiveScreen, findLogicNode, genId, markDirty
} from "../state.js";
import { logicMeta, logicEditor, logicOutputCount } from "../features/logic/registry.js";
import "../features/logic/editor.js";
import { pushHistory } from "../history.js";
import { wireLogicOutputPort, renderLogicWires } from "./logic-wires.js";
import { isLogicSelected, selectLogicOnly, refreshLogicSelectionVisuals, syncComponentFromLogicSelection } from "./logic-selection.js";

export function logicNodeLabel(node) {
    var ed = logicEditor(node.type);
    if (ed && typeof ed.label === "function") return ed.label(node);
    return logicMeta(node.type).label || node.type;
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

    var padLeft = 16;
    var padRight = logicMeta(node.type).outputs > 0 ? 14 : 10;
    var border = 2;
    var extra = 8;

    var needed = Math.ceil(textWidth + padLeft + padRight + border + extra);
    return Math.max(LOGIC_NODE_W, needed);
}

export function logicNodeHeight(node) {
    var numPorts = logicOutputCount(node);
    if (numPorts > 1) return Math.max(LOGIC_NODE_H, numPorts * 20 + 10);
    return LOGIC_NODE_H;
}

export function addLogicNode(nodeData, x, y) {
    var screen = getActiveScreen();
    if (!screen) return;
    var ed = logicEditor(nodeData.type);
    var refusal = ed && typeof ed.canAdd === "function" ? ed.canAdd(screen) : null;
    if (refusal) {
        if (window.RED && window.RED.notify) window.RED.notify(refusal, "warning");
        return;
    }
    if (ed && typeof ed.onAdd === "function") ed.onAdd(nodeData, screen);
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
    var meta = logicMeta(node.type);
    var ed = logicEditor(node.type) || {};
    var numPorts = logicOutputCount(node);
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
        "padding-left": "16px", "padding-right": (numPorts > 0 ? "14px" : "10px"), "box-sizing": "border-box", cursor: "move",
        overflow: "hidden", "white-space": "nowrap", "text-overflow": "ellipsis",
        border: "1px solid var(--red-ui-node-border, #999)",
        "box-shadow": "0 1px 3px rgba(0,0,0,0.3)"
    }).text(label).appendTo(state.logicArtboardEl);

    window.$("<div>").css({
        position: "absolute", left: "0", top: "0", bottom: "0", width: "6px",
        background: meta.color,
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

    if (typeof ed.edit === "function") {
        box.attr("title", ed.hint || "Double-click to configure").on("dblclick", function (e) {
            e.stopPropagation();
            ed.edit(node);
        });
    }
    if (typeof ed.decorate === "function") ed.decorate(box, node, getActiveScreen());

    if (numPorts > 1) {
        for (var pIdx = 0; pIdx < numPorts; pIdx++) {
            var yOffset = ((pIdx + 1) / (numPorts + 1)) * nodeH;
            var portTitle = typeof ed.portTitle === "function" ? ed.portTitle(node, pIdx) : ((meta.outputLabels || [])[pIdx] || "");
            var outDot = window.$("<div>", {
                "class": "nexa-logic-port-out",
                "data-port-index": pIdx
            }).css({
                position: "absolute", right: "-4px", top: yOffset + "px", "margin-top": "-4px",
                width: "8px", height: "8px",
                background: "var(--red-ui-node-border, #999)", cursor: "crosshair",
                transform: "scale(" + (1 / state.logicZoomLevel) + ")"
            }).attr("title", "Port " + (pIdx + 1) + ": " + portTitle).appendTo(box);
            wireLogicOutputPort(outDot, node, pIdx);
        }
    } else if (numPorts === 1) {
        var outDot = window.$("<div>", { "class": "nexa-logic-port-out" }).css({
            position: "absolute", right: "-4px", top: (nodeH / 2) + "px", "margin-top": "-4px",
            width: "8px", height: "8px",
            background: "var(--red-ui-node-border, #999)", cursor: "crosshair",
            transform: "scale(" + (1 / state.logicZoomLevel) + ")"
        }).appendTo(box);
        wireLogicOutputPort(outDot, node, 0);
    }
    if (meta.inputs > 0) {
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
