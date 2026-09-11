import { state, SVG_NS, LOGIC_NODE_W, LOGIC_NODE_H, LOGIC_NODE_KINDS, getActiveScreen, findLogicNode, genId, markDirty } from "../state.js";
import { pushHistory } from "../history.js";

var LOGIC_PORT_HIT_RADIUS = 26;

export function logicNodePortPoint(node, role) {
    return { x: role === "input" ? node.x : node.x + LOGIC_NODE_W, y: node.y + LOGIC_NODE_H / 2 };
}

export function logicWirePath(p1, p2) {
    var dx = p2.x - p1.x;
    var scale = Math.abs(dx) < LOGIC_NODE_W ? 0.75 - 0.75 * ((LOGIC_NODE_W - Math.abs(dx)) / LOGIC_NODE_W) : 0.75;
    var cp1x = p1.x + scale * LOGIC_NODE_W, cp2x = p2.x - scale * LOGIC_NODE_W;
    return "M " + p1.x + " " + p1.y + " C " + cp1x + " " + p1.y + " " + cp2x + " " + p2.y + " " + p2.x + " " + p2.y;
}

export function removeLogicWire(id) {
    var screen = getActiveScreen();
    if (!screen) return;
    var wire = screen.logic.wires.find(function (w) { return w.id === id; });
    if (!wire) return;
    screen.logic.wires = screen.logic.wires.filter(function (w) { return w.id !== id; });
    pushHistory({ t: "deleteLogicWire", screenId: screen.id, wire: wire });
    renderLogicWires();
    markDirty();
}

export function renderLogicWires() {
    if (!state.logicSvgEl) return;
    state.logicSvgEl.empty();
    var screen = getActiveScreen();
    if (!screen) return;
    (screen.logic.wires || []).forEach(function (w) {
        var fromNode = findLogicNode(screen, w.from);
        var toNode = findLogicNode(screen, w.to);
        if (!fromNode || !toNode) return;
        var p1 = logicNodePortPoint(fromNode, "output");
        var p2 = logicNodePortPoint(toNode, "input");
        var line = window.$(document.createElementNS(SVG_NS, "path")).attr({
            d: logicWirePath(p1, p2), fill: "none"
        }).css({ stroke: "var(--red-ui-node-border, #888)", "stroke-width": "2", cursor: "pointer", "pointer-events": "auto" })
            .appendTo(state.logicSvgEl);
        line.attr("title", "Click to delete this wire");
        line.on("mouseenter", function () { line.css("stroke", "#d32f2f"); });
        line.on("mouseleave", function () { line.css("stroke", "var(--red-ui-node-border, #888)"); });
        line.on("click", function () { removeLogicWire(w.id); });
    });
}

export function pointDistanceSq(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
}

export function findNearestInputPort(screen, excludeNodeId, localX, localY) {
    var best = null, bestDist = LOGIC_PORT_HIT_RADIUS * LOGIC_PORT_HIT_RADIUS;
    (screen.logic.nodes || []).forEach(function (n) {
        if (n.id === excludeNodeId) return;
        var kind = LOGIC_NODE_KINDS[n.type] || {};
        if (!kind.hasInput) return;
        var d = pointDistanceSq(logicNodePortPoint(n, "input"), { x: localX, y: localY });
        if (d <= bestDist) { bestDist = d; best = n; }
    });
    return best;
}

export function wireLogicOutputPort(outDot, node) {
    outDot.get(0).addEventListener("mousedown", function (e) {
        e.stopPropagation();
        e.preventDefault();
        var start = logicNodePortPoint(node, "output");
        var tempLine = window.$(document.createElementNS(SVG_NS, "path")).attr({
            d: logicWirePath(start, start), fill: "none"
        }).css({ stroke: "#2196f3", "stroke-width": "2", "stroke-dasharray": "4,3", "pointer-events": "none" })
            .appendTo(state.logicSvgEl);
        var artboardOffset = state.logicArtboardEl.offset();
        var hovered = null;

        function onMove(ev) {
            var localX = (ev.clientX - artboardOffset.left) / state.logicZoomLevel;
            var localY = (ev.clientY - artboardOffset.top) / state.logicZoomLevel;
            var screen = getActiveScreen();
            hovered = findNearestInputPort(screen, node.id, localX, localY);
            var end = hovered ? logicNodePortPoint(hovered, "input") : { x: localX, y: localY };
            tempLine.attr({ d: logicWirePath(start, end) }).css("stroke", hovered ? "#4caf50" : "#2196f3");
        }
        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            tempLine.remove();
            if (!hovered) return;
            var screen = getActiveScreen();
            var alreadyWired = screen.logic.wires.some(function (w) { return w.from === node.id && w.to === hovered.id; });
            if (alreadyWired) return;
            var wire = { id: genId(), from: node.id, to: hovered.id };
            screen.logic.wires.push(wire);
            pushHistory({ t: "addLogicWire", screenId: screen.id, wire: wire });
            renderLogicWires();
            markDirty();
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
}
