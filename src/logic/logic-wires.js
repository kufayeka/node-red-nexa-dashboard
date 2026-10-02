import { state, SVG_NS, LOGIC_NODE_W, LOGIC_NODE_H, getActiveScreen, findLogicNode, genId, markDirty } from "../state.js";
import { logicMeta, logicOutputCount } from "../features/logic/registry.js";
import { pushHistory } from "../history.js";
import { logicNodeWidth, logicNodeHeight } from "./logic-nodes.js";

var LOGIC_PORT_HIT_RADIUS = 26;

export function logicNodePortPoint(node, role, portIndex) {
    var nodeH = typeof logicNodeHeight === "function" ? logicNodeHeight(node) : LOGIC_NODE_H;
    if (role === "input") {
        return { x: node.x, y: node.y + nodeH / 2 };
    }
    var numPorts = logicOutputCount(node);
    if (numPorts > 1) {
        var pIdx = (typeof portIndex === "number" && portIndex >= 0) ? portIndex : 0;
        var yOffset = ((pIdx + 1) / (numPorts + 1)) * nodeH;
        return { x: node.x + logicNodeWidth(node), y: node.y + yOffset };
    }
    return { x: node.x + logicNodeWidth(node), y: node.y + nodeH / 2 };
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
        var p1 = logicNodePortPoint(fromNode, "output", w.fromPort);
        var p2 = logicNodePortPoint(toNode, "input");
        var line = window.$(document.createElementNS(SVG_NS, "path")).attr({
            d: logicWirePath(p1, p2), fill: "none"
        }).css({ stroke: "var(--red-ui-node-border, #888)", "stroke-width": "2", cursor: "pointer", "pointer-events": "auto" })
            .appendTo(state.logicSvgEl);
        line.attr("title", "Click to delete this wire" + (w.fromPort !== undefined ? (" (Port " + (w.fromPort + 1) + ")") : ""));
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
        if (!(logicMeta(n.type).inputs > 0)) return;
        var d = pointDistanceSq(logicNodePortPoint(n, "input"), { x: localX, y: localY });
        if (d <= bestDist) { bestDist = d; best = n; }
    });
    return best;
}

export function getReachableRenderScreens(startNodeId, nodes, wires) {
    var reachable = [];
    var visited = {};
    var nodeMap = {};
    (nodes || []).forEach(function (n) { if (n && n.id) nodeMap[n.id] = n; });

    function dfs(currId) {
        if (visited[currId]) return;
        visited[currId] = true;
        (wires || []).forEach(function (w) {
            if (w.from === currId) {
                var target = nodeMap[w.to];
                if (target) {
                    if (target.type === "render-screen") {
                        if (reachable.indexOf(target.id) === -1) {
                            reachable.push(target.id);
                        }
                    }
                    if (target.type !== "render-screen") {
                        dfs(target.id);
                    }
                }
            }
        });
    }
    dfs(startNodeId);
    return reachable;
}

/**
 * Checks whether an incoming Route Trigger path can simultaneously trigger more than one Render Screen.
 * A 'switch' node branches into mutually exclusive conditional outputs, so multiple render screens
 * on different switch ports (or after a switch) do not execute concurrently and are permitted.
 */
export function hasIllegalRouteFanOut(startNodeId, nodes, wires) {
    var nodeMap = {};
    (nodes || []).forEach(function (n) { if (n && n.id) nodeMap[n.id] = n; });

    var visited = {};
    function countParallelRenders(currId) {
        if (visited[currId]) return 0;
        visited[currId] = true;
        var node = nodeMap[currId];
        if (!node) return 0;

        var outWires = (wires || []).filter(function (w) { return w.from === currId; });
        if (!outWires.length) return 0;

        if (logicMeta(node.type).exclusivePorts) {
            // its outputs are conditional / mutually exclusive (a Switch, a Request: answer or error).
            // Multiple wires on the SAME port fire in parallel.
            var portMap = {};
            outWires.forEach(function (w) {
                var p = w.fromPort || 0;
                if (!portMap[p]) portMap[p] = [];
                portMap[p].push(w);
            });
            var maxForAnyPort = 0;
            for (var p in portMap) {
                var portWires = portMap[p];
                var portTotal = 0;
                portWires.forEach(function (w) {
                    var target = nodeMap[w.to];
                    if (target) {
                        if (target.type === "render-screen") {
                            portTotal += 1;
                        } else {
                            portTotal += countParallelRenders(target.id);
                        }
                    }
                });
                if (portTotal > maxForAnyPort) maxForAnyPort = portTotal;
            }
            visited[currId] = false;
            return maxForAnyPort;
        } else {
            // Non-switch node: all outgoing wires fire in parallel.
            var total = 0;
            outWires.forEach(function (w) {
                var target = nodeMap[w.to];
                if (target) {
                    if (target.type === "render-screen") {
                        total += 1;
                    } else {
                        total += countParallelRenders(target.id);
                    }
                }
            });
            visited[currId] = false;
            return total;
        }
    }

    var maxConcurrent = countParallelRenders(startNodeId);
    return maxConcurrent > 1;
}

export function wireLogicOutputPort(outDot, node, portIndex) {
    outDot.get(0).addEventListener("mousedown", function (e) {
        e.stopPropagation();
        e.preventDefault();
        var pIdx = (typeof portIndex === "number" && portIndex >= 0) ? portIndex : 0;
        var start = logicNodePortPoint(node, "output", pIdx);
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
            var alreadyWired = screen.logic.wires.some(function (w) {
                return w.from === node.id && w.to === hovered.id && (w.fromPort || 0) === pIdx;
            });
            if (alreadyWired) return;

            // Guard: Prevent Route Trigger fan-out to multiple concurrent Render Screen nodes
            if (state.editingMode === "flow") {
                var testWires = (screen.logic.wires || []).concat([{ from: node.id, to: hovered.id, fromPort: pIdx }]);
                var triggerNodes = (screen.logic.nodes || []).filter(function (n) { return n.type === "route-trigger"; });
                var hasFanOutConflict = false;
                triggerNodes.forEach(function (trig) {
                    if (hasIllegalRouteFanOut(trig.id, screen.logic.nodes, testWires)) {
                        hasFanOutConflict = true;
                    }
                });
                if (hasFanOutConflict) {
                    if (window.RED && window.RED.notify) {
                        window.RED.notify("Route Trigger cannot fan out to multiple Render Screen nodes on the same execution path. Ambiguous entry screen: which screen should be rendered first?", "error");
                    }
                    return;
                }
            }

            var wire = { id: genId(), from: node.id, to: hovered.id, fromPort: pIdx };
            screen.logic.wires.push(wire);
            pushHistory({ t: "addLogicWire", screenId: screen.id, wire: wire });
            renderLogicWires();
            markDirty();
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
}
