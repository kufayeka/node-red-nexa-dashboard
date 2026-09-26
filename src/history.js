// --- Undo / Redo History Stack -------------------------------------------
import { state, markDirty, findSurfaceById, getActiveScreen, Tree } from "./state.js";

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

// The tree of a surface as JSON — the "before" of a structural change.
export function treeSnapshot(surface) {
    return JSON.stringify({ c: surface.components || [], o: surface.orphans || [] });
}

// Puts a snapshot back IN PLACE: node objects (and the arrays holding them)
// that exist on both sides are reused by id, so anything still holding a
// node — a rendered element's handlers, the inspector — keeps a live object.
function restoreTree(surface, snap) {
    var existing = {};
    Tree.allNodes(surface, { orphans: true }).forEach(function (n) { existing[n.id] = n; });
    function revive(list, into) {
        var out = into || [];
        out.length = 0;
        list.forEach(function (s) {
            var node = existing[s.id] || {};
            var oldChildren = node.children;
            Object.keys(node).forEach(function (k) { delete node[k]; });
            Object.keys(s).forEach(function (k) { if (k !== "children") node[k] = s[k]; });
            if (s.children) node.children = revive(s.children, Array.isArray(oldChildren) ? oldChildren : []);
            out.push(node);
        });
        return out;
    }
    surface.components = revive(snap.c, surface.components);
    surface.orphans = revive(snap.o, surface.orphans);
}

var treeListeners = [];
/** Called after every structural change of a tree (and after undo / redo). */
export function onTreeChange(fn) { treeListeners.push(fn); }
function notifyTreeChange() {
    treeListeners.forEach(function (fn) { try { fn(); } catch (e) { /* a listener must not break editing */ } });
}

/** Records a structural change: call treeSnapshot() before it, this after. */
export function pushTreeChange(surface, before) {
    var after = treeSnapshot(surface);
    if (after === before) return;
    pushHistory({ t: "tree", screenId: surface.id, before: before, after: after });
    notifyTreeChange();
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
    } else if (ev.t === "tree") {
        // a structural change (add / delete / group / ungroup / reparent / paste /
        // orphan): the surface's whole tree before and after, as JSON
        var snap = JSON.parse(direction === "undo" ? ev.before : ev.after);
        restoreTree(screen, snap);
    } else if (ev.t === "move") {
        var comp = Tree.find(screen, ev.id);
        if (!comp) return;
        var pos = direction === "undo" ? ev.from : ev.to;
        comp.x = pos.x;
        comp.y = pos.y;
        Tree.refitGroupsUp(screen, ev.id);
    } else if (ev.t === "resize") {
        var rcomp = Tree.find(screen, ev.id);
        if (!rcomp) return;
        var box = direction === "undo" ? ev.from : ev.to;
        rcomp.x = box.x; rcomp.y = box.y; rcomp.w = box.w; rcomp.h = box.h;
        Tree.refitGroupsUp(screen, ev.id);
    } else if (ev.t === "rotate") {
        var tcomp = Tree.find(screen, ev.id);
        if (!tcomp) return;
        tcomp.rotation = direction === "undo" ? ev.from : ev.to;
    } else if (ev.t === "flip") {
        var fcomp = Tree.find(screen, ev.id);
        if (!fcomp) return;
        var fstate = direction === "undo" ? ev.from : ev.to;
        fcomp.flipH = fstate.flipH;
        fcomp.flipV = fstate.flipV;
    } else if (ev.t === "props") {
        // one prop of an SDK component, edited in the property kit (sidebar/kit-inspector.js)
        var pcomp = Tree.find(screen, ev.id);
        if (!pcomp) return;
        pcomp.props = pcomp.props || {};
        var pv = direction === "undo" ? ev.from : ev.to;
        if (pv === undefined) delete pcomp.props[ev.key];
        else pcomp.props[ev.key] = pv !== null && typeof pv === "object" ? JSON.parse(JSON.stringify(pv)) : pv;
    } else if (ev.t === "node") {
        // one field of a node itself (name, visibility, locked, layout, …)
        var ncomp = Tree.find(screen, ev.id);
        if (!ncomp) return;
        var nv = direction === "undo" ? ev.from : ev.to;
        if (nv === undefined) delete ncomp[ev.key];
        else ncomp[ev.key] = nv !== null && typeof nv === "object" ? JSON.parse(JSON.stringify(nv)) : nv;
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
        notifyTreeChange();
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
