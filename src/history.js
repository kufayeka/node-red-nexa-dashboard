// --- Undo / Redo History Stack -------------------------------------------
import { state, markDirty, findSurfaceById, getActiveScreen } from "./state.js";

let _renderActiveScreenFn = null;
let _renderLogicCanvasFn = null;

// Custom stack (not RED.history) -- previously unbounded, so a long editing
// session grows both arrays forever. Capped to the most recent 20 changes,
// same as most editors' default undo depth.
export const MAX_HISTORY = 20;

export function registerHistoryRenderers(renderActiveScreen, renderLogicCanvas) {
    _renderActiveScreenFn = renderActiveScreen;
    _renderLogicCanvasFn = renderLogicCanvas;
}

export function pushHistory(ev) {
    state.undoStack.push(ev);
    if (state.undoStack.length > MAX_HISTORY) {
        state.undoStack.splice(0, state.undoStack.length - MAX_HISTORY);
    }
    state.redoStack = [];
}

export function applyHistoryMutation(ev, direction) {
    var screen = findSurfaceById(ev.screenId);
    if (!screen) return;
    if (ev.t === "multi") {
        var subs = direction === "undo" ? ev.events.slice().reverse() : ev.events;
        subs.forEach(function (sub) { applyHistoryMutation(sub, direction); });
    } else if (ev.t === "add") {
        if (direction === "undo") {
            screen.components = screen.components.filter(function (c) { return c.id !== ev.comp.id; });
        } else {
            screen.components.push(ev.comp);
        }
    } else if (ev.t === "delete") {
        if (direction === "undo") {
            screen.components.push(ev.comp);
        } else {
            screen.components = screen.components.filter(function (c) { return c.id !== ev.comp.id; });
        }
    } else if (ev.t === "move") {
        var comp = screen.components.find(function (c) { return c.id === ev.id; });
        if (!comp) return;
        var pos = direction === "undo" ? ev.from : ev.to;
        comp.x = pos.x;
        comp.y = pos.y;
    } else if (ev.t === "resize") {
        var rcomp = screen.components.find(function (c) { return c.id === ev.id; });
        if (!rcomp) return;
        var box = direction === "undo" ? ev.from : ev.to;
        rcomp.x = box.x; rcomp.y = box.y; rcomp.w = box.w; rcomp.h = box.h;
    } else if (ev.t === "rotate") {
        var tcomp = screen.components.find(function (c) { return c.id === ev.id; });
        if (!tcomp) return;
        tcomp.rotation = direction === "undo" ? ev.from : ev.to;
    } else if (ev.t === "flip") {
        var fcomp = screen.components.find(function (c) { return c.id === ev.id; });
        if (!fcomp) return;
        var fstate = direction === "undo" ? ev.from : ev.to;
        fcomp.flipH = fstate.flipH;
        fcomp.flipV = fstate.flipV;
    } else if (ev.t === "props") {
        // one prop of an SDK component, edited in the property kit (sidebar/kit-inspector.js)
        var pcomp = screen.components.find(function (c) { return c.id === ev.id; });
        if (!pcomp) return;
        pcomp.props = pcomp.props || {};
        var pv = direction === "undo" ? ev.from : ev.to;
        if (pv === undefined) delete pcomp.props[ev.key];
        else pcomp.props[ev.key] = pv !== null && typeof pv === "object" ? JSON.parse(JSON.stringify(pv)) : pv;
    } else if (ev.t === "group") {
        screen.groups = screen.groups || [];
        if (direction === "undo") {
            ev.memberIds.forEach(function (id) { var c = screen.components.find(function (x) { return x.id === id; }); if (c) delete c.g; });
            screen.groups = screen.groups.filter(function (g) { return g.id !== ev.group.id; });
        } else {
            if (!screen.groups.some(function (g) { return g.id === ev.group.id; })) screen.groups.push(ev.group);
            ev.memberIds.forEach(function (id) { var c = screen.components.find(function (x) { return x.id === id; }); if (c) c.g = ev.group.id; });
        }
    } else if (ev.t === "ungroup") {
        screen.groups = screen.groups || [];
        if (direction === "undo") {
            if (!screen.groups.some(function (g) { return g.id === ev.group.id; })) screen.groups.push(ev.group);
            ev.memberIds.forEach(function (id) { var c = screen.components.find(function (x) { return x.id === id; }); if (c) c.g = ev.group.id; });
        } else {
            ev.memberIds.forEach(function (id) { var c = screen.components.find(function (x) { return x.id === id; }); if (c) delete c.g; });
            screen.groups = screen.groups.filter(function (g) { return g.id !== ev.group.id; });
        }
    } else if (ev.t === "addLogicNode") {
        if (direction === "undo") {
            screen.logic.nodes = screen.logic.nodes.filter(function (n) { return n.id !== ev.node.id; });
        } else {
            screen.logic.nodes.push(ev.node);
        }
    } else if (ev.t === "deleteLogicNode") {
        if (direction === "undo") {
            screen.logic.nodes.push(ev.node);
            ev.wires.forEach(function (w) { screen.logic.wires.push(w); });
        } else {
            screen.logic.nodes = screen.logic.nodes.filter(function (n) { return n.id !== ev.node.id; });
            var removedWireIds = ev.wires.map(function (w) { return w.id; });
            screen.logic.wires = screen.logic.wires.filter(function (w) { return removedWireIds.indexOf(w.id) === -1; });
        }
    } else if (ev.t === "moveLogicNode") {
        var lnode = screen.logic.nodes.find(function (n) { return n.id === ev.id; });
        if (!lnode) return;
        var lpos = direction === "undo" ? ev.from : ev.to;
        lnode.x = lpos.x; lnode.y = lpos.y;
    } else if (ev.t === "addLogicWire") {
        if (direction === "undo") {
            screen.logic.wires = screen.logic.wires.filter(function (w) { return w.id !== ev.wire.id; });
        } else {
            screen.logic.wires.push(ev.wire);
        }
    } else if (ev.t === "deleteLogicWire") {
        if (direction === "undo") {
            screen.logic.wires.push(ev.wire);
        } else {
            screen.logic.wires = screen.logic.wires.filter(function (w) { return w.id !== ev.wire.id; });
        }
    }
}

export function isLogicHistoryEvent(ev) {
    if (ev.t === "multi") return ev.events.length > 0 && isLogicHistoryEvent(ev.events[0]);
    return ev.t.indexOf("Logic") !== -1;
}

export function applyHistoryEvent(ev, direction) {
    applyHistoryMutation(ev, direction);
    var screen = findSurfaceById(ev.screenId);
    var active = getActiveScreen();
    var isActiveSurface = screen && active && screen.id === active.id;
    if (isLogicHistoryEvent(ev)) {
        state.logicSelectedIds = [];
        if (isActiveSurface && _renderLogicCanvasFn) _renderLogicCanvasFn();
    } else {
        state.selectedIds = [];
        if (isActiveSurface && _renderActiveScreenFn) _renderActiveScreenFn();
    }
    markDirty();
}

export function undo() {
    if (!state.undoStack.length) return;
    var ev = state.undoStack.pop();
    applyHistoryEvent(ev, "undo");
    state.redoStack.push(ev);
}

export function redo() {
    if (!state.redoStack.length) return;
    var ev = state.redoStack.pop();
    applyHistoryEvent(ev, "redo");
    state.undoStack.push(ev);
}
