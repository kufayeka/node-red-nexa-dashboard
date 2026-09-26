// --- Canvas selection, grouping and marquee ------------------------------------
// Figma-style selection over the node tree (see model/tree.js):
//   click          selects the node at the depth of the current selection —
//                  top-level by default, a sibling of what is selected otherwise
//   Ctrl / Cmd+click  selects the deepest node under the pointer
//   double click   dives one level into the selected container
import { state, genId, markDirty, getActiveScreen, findComponent, Tree, isNodeInteractable, isNodeLocked } from "../state.js";
import { pushHistory, pushTreeChange, treeSnapshot } from "../history.js";
import { clearSelectionHandles, renderSelectionHandles, updateComponentBox } from "./selection-handles.js";
import { renderPropertiesPanel } from "../sidebar/properties-panel.js";
import { refreshEventsHighlight } from "../sidebar/palette-events-panel.js";
import { renderActiveScreen } from "./canvas-ui.js";

var hierarchyListeners = [];
/** The Hierarchy panel follows the canvas selection. */
export function onSelectionChange(fn) { hierarchyListeners.push(fn); }

export function isSelected(id) {
    return state.selectedIds.indexOf(id) !== -1;
}

export function refreshSelectionVisuals() {
    if (!state.artboardEl) return;
    state.artboardEl.find(".nexa-component").css("outline", "none");
    state.selectedIds.forEach(function (id) {
        state.artboardEl.find('[data-id="' + id + '"]').css("outline", "2px solid #ff5722");
    });
    clearSelectionHandles();
    if (state.selectedIds.length === 1) {
        var comp = findComponent(state.selectedIds[0]);
        if (comp) renderSelectionHandles(comp);
    }
    renderPropertiesPanel();
    refreshEventsHighlight();
    hierarchyListeners.forEach(function (fn) { try { fn(state.selectedIds); } catch (e) { /* a panel must not break selection */ } });
    // (not away from the Hierarchy: selecting there — or arranging the tree —
    // must keep the tree in view)
    var inHierarchy = state.hierarchyPane && typeof state.hierarchyPane.is === "function" && state.hierarchyPane.is(":visible");
    if (state.selectedIds.length > 0 && !inHierarchy && state.sidebarTabs && typeof state.sidebarTabs.activateTab === "function") {
        state.sidebarTabs.activateTab("properties");
    }
}

export function selectOnly(id) {
    state.selectedIds = [id];
    refreshSelectionVisuals();
}

export function selectMultiple(ids) {
    state.selectedIds = ids.slice();
    refreshSelectionVisuals();
}

export function deselectAll() {
    state.selectedIds = [];
    refreshSelectionVisuals();
}

// The node a click on `nodeId` (the innermost node under the pointer) selects.
export function pickSelectionTarget(nodeId, e) {
    var screen = getActiveScreen();
    if (!screen) return nodeId;
    if (e && (e.ctrlKey || e.metaKey)) return nodeId;
    var chain = Tree.ancestors(screen, nodeId).map(function (a) { return a.id; }).concat([nodeId]);
    // clicking inside what is selected keeps it
    for (var i = 0; i < chain.length; i++) if (isSelected(chain[i])) return chain[i];
    // the depth of the current selection: a sibling of the selected node
    var sel = state.selectedIds[0] && findComponent(state.selectedIds[0]);
    if (sel) {
        var context = Tree.parentOf(screen, sel.id);
        var contextId = context ? context.id : null;
        for (var j = 0; j < chain.length; j++) {
            var parent = Tree.parentOf(screen, chain[j]);
            if ((parent ? parent.id : null) === contextId) return chain[j];
        }
    }
    return chain[0];
}

// Double click: one level deeper than the selected node, towards `nodeId`.
export function pickDeeperTarget(nodeId) {
    var screen = getActiveScreen();
    if (!screen) return null;
    var chain = Tree.ancestors(screen, nodeId).map(function (a) { return a.id; }).concat([nodeId]);
    var at = -1;
    for (var i = 0; i < chain.length; i++) if (isSelected(chain[i])) at = i;
    return at >= 0 && at < chain.length - 1 ? chain[at + 1] : null;
}

export function setLockedForSelection(locked, idsOverride) {
    var ids = idsOverride || state.selectedIds.slice();
    var changed = false;
    ids.forEach(function (id) {
        var c = findComponent(id);
        if (c && !!c.locked !== locked) {
            pushHistory({ t: "node", screenId: getActiveScreen().id, id: id, key: "locked", from: c.locked, to: locked });
            c.locked = locked;
            changed = true;
        }
    });
    if (!changed) return;
    markDirty();
    renderActiveScreen();
    selectMultiple(ids);
}

export function toggleFlipForSelection(axis) {
    var screen = getActiveScreen();
    if (!screen || !state.selectedIds.length) return;
    var events = [];
    state.selectedIds.forEach(function (id) {
        var c = findComponent(id);
        if (!c || isNodeLocked(id) || Tree.isContainer(c)) return;
        var typeDef = window.NEXA && window.NEXA.getComponent(c.type);
        if (typeDef && typeDef.capabilities && typeDef.capabilities.flippable === false) return;
        var from = { flipH: !!c.flipH, flipV: !!c.flipV };
        if (axis === "h") {
            c.flipH = !c.flipH;
        } else if (axis === "v") {
            c.flipV = !c.flipV;
        }
        var to = { flipH: !!c.flipH, flipV: !!c.flipV };
        events.push({ t: "flip", screenId: screen.id, id: c.id, from: from, to: to });
        updateComponentBox(c);
    });
    if (!events.length) return;
    pushHistory(events.length === 1 ? events[0] : { t: "multi", screenId: screen.id, events: events });
    markDirty();
    renderPropertiesPanel();
}

function nextGroupName(screen) {
    var n = 0;
    Tree.allNodes(screen, { orphans: true }).forEach(function (node) {
        var m = node.type === "@group" && /^Group (\d+)$/.exec(node.name || "");
        if (m) n = Math.max(n, Number(m[1]));
    });
    return "Group " + (n + 1);
}

/** Ctrl+G: the selected siblings go into a new group (it hugs them). */
export function groupSelection() {
    var screen = getActiveScreen();
    if (!screen) return;
    var ids = state.selectedIds.filter(function (id) { return findComponent(id) && isNodeInteractable(id); });
    if (ids.length < 1) {
        RED.notify("Select what to group", { type: "warning", timeout: 2000 });
        return;
    }
    var parents = ids.map(function (id) { var p = Tree.parentOf(screen, id); return p ? p.id : null; });
    if (parents.some(function (p) { return p !== parents[0]; })) {
        RED.notify("Select nodes that share one parent to group them", { type: "warning", timeout: 2500 });
        return;
    }
    var before = treeSnapshot(screen);
    var group = Tree.wrapInGroup(screen, ids, { id: genId(), name: nextGroupName(screen) });
    if (parents[0]) Tree.refitGroupsUp(screen, group.id);
    pushTreeChange(screen, before);
    markDirty();
    renderActiveScreen();
    selectOnly(group.id);
}

/** Ctrl+Shift+G: each selected container is replaced by its children. */
export function ungroupSelection() {
    var screen = getActiveScreen();
    if (!screen) return;
    var containers = state.selectedIds.map(findComponent).filter(function (c) { return c && Tree.isContainer(c) && !isNodeLocked(c.id); });
    if (!containers.length) return;
    var before = treeSnapshot(screen);
    var released = [];
    containers.forEach(function (g) { released = released.concat(Tree.unwrap(screen, g.id).map(function (c) { return c.id; })); });
    pushTreeChange(screen, before);
    markDirty();
    renderActiveScreen();
    selectMultiple(released);
}

export function startMarqueeSelect(e) {
    if (!state.artboardEl) return;
    var offset = state.artboardEl.offset();
    var startX = (e.pageX - offset.left) / state.zoomLevel;
    var startY = (e.pageY - offset.top) / state.zoomLevel;
    var box = { left: startX, top: startY, width: 0, height: 0 };
    var shiftHeld = e.shiftKey;

    var marqueeEl = $("<div>", { "class": "nexa-marquee" }).css({
        position: "absolute", left: startX + "px", top: startY + "px",
        width: "0px", height: "0px",
        border: "1px dashed #2196f3", background: "rgba(33,150,243,0.1)",
        "pointer-events": "none", "z-index": 999
    }).appendTo(state.artboardEl);

    function onMove(ev) {
        var curX = (ev.pageX - offset.left) / state.zoomLevel;
        var curY = (ev.pageY - offset.top) / state.zoomLevel;
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
        if (!screen) return;
        // The nodes at the depth of the current selection (top-level by default).
        // Pure geometry, so a hidden node is excluded explicitly.
        var sel = state.selectedIds[0] && findComponent(state.selectedIds[0]);
        var context = sel ? Tree.parentOf(screen, sel.id) : null;
        var candidates = context ? Tree.kids(context) : screen.components;
        var hits = candidates.filter(function (c) {
            if (!isNodeInteractable(c.id)) return false;
            var b = Tree.absBox(screen, c.id);
            return !(b.x > box.left + box.width || b.x + b.w < box.left || b.y > box.top + box.height || b.y + b.h < box.top);
        }).map(function (c) { return c.id; });
        if (shiftHeld) {
            hits.forEach(function (id) { if (!isSelected(id)) state.selectedIds.push(id); });
            refreshSelectionVisuals();
        } else {
            selectMultiple(hits);
        }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
}
