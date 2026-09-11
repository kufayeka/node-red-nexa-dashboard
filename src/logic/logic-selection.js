import { state, LOGIC_NODE_W, LOGIC_NODE_H, getActiveScreen, genId, markDirty } from "../state.js";
import { pushHistory } from "../history.js";
import { removeLogicNodes, renderLogicCanvas } from "./logic-nodes.js";

var logicClipboard = null; // { nodes: [], wires: [] }

export function isLogicSelected(id) {
    return state.logicSelectedIds.indexOf(id) !== -1;
}

export function selectLogicOnly(id) {
    state.logicSelectedIds = [id];
    refreshLogicSelectionVisuals();
}

export function selectLogicMultiple(ids) {
    state.logicSelectedIds = ids.slice();
    refreshLogicSelectionVisuals();
}

export function deselectAllLogic() {
    state.logicSelectedIds = [];
    refreshLogicSelectionVisuals();
}

export function copyLogicSelection(isCut) {
    if (!state.logicSelectedIds.length) return;
    var screen = getActiveScreen();
    if (!screen || !screen.logic) return;
    var selectedNodes = (screen.logic.nodes || []).filter(function (n) {
        return state.logicSelectedIds.indexOf(n.id) !== -1;
    });
    if (!selectedNodes.length) return;

    var selectedWires = (screen.logic.wires || []).filter(function (w) {
        return state.logicSelectedIds.indexOf(w.from) !== -1 && state.logicSelectedIds.indexOf(w.to) !== -1;
    });

    logicClipboard = {
        nodes: JSON.parse(JSON.stringify(selectedNodes)),
        wires: JSON.parse(JSON.stringify(selectedWires))
    };

    if (isCut) {
        removeLogicNodes(state.logicSelectedIds.slice());
    }
}

export function pasteLogicClipboard() {
    if (!logicClipboard || !logicClipboard.nodes.length) return;
    var screen = getActiveScreen();
    if (!screen) return;
    if (!screen.logic) screen.logic = { nodes: [], wires: [] };

    var idMap = {};
    var newNodes = logicClipboard.nodes.map(function (n) {
        var copy = JSON.parse(JSON.stringify(n));
        var newId = genId();
        idMap[copy.id] = newId;
        copy.id = newId;
        copy.x = (copy.x || 0) + 30;
        copy.y = (copy.y || 0) + 30;
        return copy;
    });

    logicClipboard.nodes.forEach(function (n) {
        n.x = (n.x || 0) + 30;
        n.y = (n.y || 0) + 30;
    });

    var newWires = logicClipboard.wires.map(function (w) {
        return {
            id: genId(),
            from: idMap[w.from] || w.from,
            to: idMap[w.to] || w.to
        };
    });

    newNodes.forEach(function (n) { screen.logic.nodes.push(n); });
    newWires.forEach(function (w) { screen.logic.wires.push(w); });

    var historyEvents = newNodes.map(function (n) {
        return { t: "addLogicNode", screenId: screen.id, node: n };
    }).concat(newWires.map(function (w) {
        return { t: "addLogicWire", screenId: screen.id, wire: w };
    }));
    pushHistory(historyEvents.length === 1 ? historyEvents[0] : { t: "multi", screenId: screen.id, events: historyEvents });

    selectLogicMultiple(newNodes.map(function (n) { return n.id; }));
    renderLogicCanvas();
    markDirty();
}

export function refreshLogicSelectionVisuals() {
    if (!state.logicArtboardEl) return;
    state.logicArtboardEl.find(".nexa-logic-node").css("border-color", "transparent");
    state.logicSelectedIds.forEach(function (id) {
        state.logicArtboardEl.find('.nexa-logic-node[data-node-id="' + id + '"]').css("border-color", "#ffeb3b");
    });
}

export function startLogicMarqueeSelect(e) {
    if (!state.logicArtboardEl) return;
    var offset = state.logicArtboardEl.offset();
    var startX = (e.pageX - offset.left) / state.logicZoomLevel;
    var startY = (e.pageY - offset.top) / state.logicZoomLevel;
    var box = { left: startX, top: startY, width: 0, height: 0 };
    var shiftHeld = e.shiftKey;
    var marqueeEl = window.$("<div>").css({
        position: "absolute", left: startX + "px", top: startY + "px",
        width: "0px", height: "0px",
        border: "1px dashed #2196f3", background: "rgba(33,150,243,0.1)",
        "pointer-events": "none", "z-index": 999
    }).appendTo(state.logicArtboardEl);

    function onMove(ev) {
        var curX = (ev.pageX - offset.left) / state.logicZoomLevel;
        var curY = (ev.pageY - offset.top) / state.logicZoomLevel;
        box.left = Math.min(startX, curX);
        box.top = Math.min(startY, curY);
        box.width = Math.abs(curX - startX);
        box.height = Math.abs(curY - startY);
        marqueeEl.css({ left: box.left + "px", top: box.top + "px", width: box.width + "px", height: box.height + "px" });
    }
    function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        marqueeEl.remove();
        if (box.width < 3 && box.height < 3) return;
        var screen = getActiveScreen();
        if (!screen || !screen.logic) return;
        var hits = (screen.logic.nodes || []).filter(function (n) {
            return !(n.x > box.left + box.width || n.x + LOGIC_NODE_W < box.left || n.y > box.top + box.height || n.y + LOGIC_NODE_H < box.top);
        }).map(function (n) { return n.id; });
        if (shiftHeld) {
            hits.forEach(function (id) { if (!isLogicSelected(id)) state.logicSelectedIds.push(id); });
            refreshLogicSelectionVisuals();
        } else {
            selectLogicMultiple(hits);
        }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
}
