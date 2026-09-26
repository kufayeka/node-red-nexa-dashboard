// --- Hierarchy panel: the screen's node tree (replaces the old Layers tab) -------
// Figma-style: the top of the stack is listed first (display order is the
// reverse of the stacking order in the data). Per row: visibility (show ->
// hide -> remove) and lock. Double click a name to rename; drag to reorder or
// to move into / out of a group (the node keeps its place on screen). Nodes
// taken out of the tree without being deleted — the children of a deleted
// container — are listed under "Unplaced": drag one back into the tree to use
// it again, or delete it for good.
// Built on the property kit's nx-tree (the MQTT Sparkplug explorer's look).
import { state, getActiveScreen, markDirty, Tree, findTemplate } from "../state.js";
import { pushHistory, pushTreeChange, treeSnapshot, onTreeChange } from "../history.js";
import { selectOnly, selectMultiple, onSelectionChange, isSelected, groupSelection, frameSelection } from "../canvas/selection.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { setHierarchyRefresher } from "./properties-panel.js";

var VIS_CYCLE = ["show", "hide", "remove"];
var VIS_ICON = { show: "fa fa-eye", hide: "fa fa-eye-slash", remove: "fa fa-ban" };
var VIS_TITLE = { show: "Visible — click to hide (still rendered)", hide: "Hidden — click to remove (not rendered)", remove: "Removed — click to show" };
var UNPLACED_ID = "__unplaced__";

var treeEl = null, orphanEl = null;

function labelOf(node) {
    if (node.name) return node.name;
    if (node.type === "@group") return "Group";
    if (node.type === "@frame") return "Frame";
    if (node.type === "@template") {
        var t = findTemplate(node.templateId);
        return (t ? t.name : "Template") + " (instance)";
    }
    if (node.type === "@lit-component") return "Lit Component";
    var def = window.NEXA && window.NEXA.getComponent(node.type);
    return (def && def.label) || node.type;
}

function iconOf(node) {
    if (node.type === "@group") return "fa fa-object-group";
    if (node.type === "@frame") return "fa fa-square-o";
    if (node.type === "@template") return "fa fa-clone";
    if (node.type === "@lit-component") return "fa fa-code";
    var def = window.NEXA && window.NEXA.getComponent(node.type);
    return (def && def.icon) || "fa fa-cube";
}

// Tree rows for a list of sibling nodes, top of the stack first.
function rows(screen, list, orphan) {
    return list.slice().reverse().map(function (node) {
        var vis = node.visibility || "show";
        var eff = orphan ? vis : Tree.effectiveVisibility(screen, node.id);
        return {
            id: node.id,
            label: labelOf(node),
            title: labelOf(node) + " — " + node.type,
            icon: iconOf(node),
            container: Tree.isContainer(node),
            badge: Tree.isContainer(node) ? String(Tree.kids(node).length) : "",
            muted: eff !== "show",
            children: Tree.isContainer(node) ? rows(screen, Tree.kids(node), orphan) : [],
            actions: orphan
                ? [{ id: "delete", icon: "fa fa-trash-o", title: "Delete for good" }]
                : [
                    { id: "visibility", icon: VIS_ICON[vis], title: VIS_TITLE[vis], on: vis !== "show" },
                    { id: "lock", icon: node.locked ? "fa fa-lock" : "fa fa-unlock-alt", title: node.locked ? "Locked — click to unlock" : "Click to lock", on: !!node.locked }
                ]
        };
    });
}

// Moves a node under parentId at a DATA index, keeping its place on screen.
function moveKeepingPlace(screen, id, parentId, dataIndex) {
    var loc = Tree.locate(screen, id);
    // (an orphan's x / y are already surface coordinates)
    var abs = !loc ? null : loc.orphan ? { x: loc.node.x || 0, y: loc.node.y || 0 } : Tree.absBox(screen, id);
    var oldParent = loc && loc.parent ? loc.parent.id : null;
    if (loc && loc.orphan) Tree.placeOrphan(screen, id, parentId, dataIndex);
    else Tree.move(screen, id, parentId, dataIndex);
    var node = Tree.find(screen, id);
    if (abs) {
        var p = parentId ? Tree.absBox(screen, parentId) : { x: 0, y: 0 };
        node.x = abs.x - p.x;
        node.y = abs.y - p.y;
    }
    if (parentId) Tree.tidyContainer(screen, parentId);   // the new group hugs it
    if (oldParent && oldParent !== parentId) Tree.tidyContainer(screen, oldParent); // the old one hugs the rest, or goes when empty
}

function onMove(e) {
    var screen = getActiveScreen();
    if (!screen) return;
    var d = e.detail;
    var before = treeSnapshot(screen);
    try {
        if (d.targetId === UNPLACED_ID) {
            // dropped on "Unplaced": out of the tree, not deleted
            var abs = Tree.locate(screen, d.id) && !Tree.locate(screen, d.id).orphan ? Tree.absBox(screen, d.id) : null;
            var node = Tree.detach(screen, d.id);
            if (node) {
                // an orphan keeps its place on screen for when it comes back
                if (abs) { node.node.x = abs.x; node.node.y = abs.y; }
                (screen.orphans = screen.orphans || []).push(node.node);
                if (!node.orphan) Tree.tidyContainer(screen, node.parentId);
            }
        } else {
            var target = Tree.locate(screen, d.targetId);
            if (!target) return;
            if (target.orphan) return; // arranging the Unplaced list itself isn't a thing
            if (d.position === "inside") {
                // on top of the container's stack
                moveKeepingPlace(screen, d.id, d.targetId, null);
            } else {
                // display order is reversed: "before" a row = above it = later in the data
                var parentId = target.parent ? target.parent.id : null;
                var index = target.index + (d.position === "before" ? 1 : 0);
                moveKeepingPlace(screen, d.id, parentId, index); // Tree.move handles a move within the same list
            }
        }
    } catch (err) {
        if (window.RED && window.RED.notify) window.RED.notify(err.message, { type: "warning", timeout: 2500 });
        return;
    }
    pushTreeChange(screen, before);
    markDirty();
    renderActiveScreen();
    if (Tree.find(screen, d.id) && !Tree.locate(screen, d.id).orphan) selectOnly(d.id);
    renderHierarchyPanel();
}

function onAction(e) {
    var screen = getActiveScreen();
    if (!screen) return;
    var node = Tree.find(screen, e.detail.id);
    if (!node) return;
    if (e.detail.action === "visibility") {
        var cur = node.visibility || "show";
        var next = VIS_CYCLE[(VIS_CYCLE.indexOf(cur) + 1) % VIS_CYCLE.length];
        pushHistory({ t: "node", screenId: screen.id, id: node.id, key: "visibility", from: node.visibility, to: next === "show" ? undefined : next });
        if (next === "show") delete node.visibility; else node.visibility = next;
        // a hidden / removed node can't stay selected
        state.selectedIds = state.selectedIds.filter(function (id) { return Tree.effectiveVisibility(screen, id) === "show"; });
    } else if (e.detail.action === "lock") {
        pushHistory({ t: "node", screenId: screen.id, id: node.id, key: "locked", from: node.locked, to: !node.locked || undefined });
        if (node.locked) delete node.locked; else node.locked = true;
    } else if (e.detail.action === "delete") {
        var before = treeSnapshot(screen);
        screen.orphans = (screen.orphans || []).filter(function (o) { return o.id !== node.id; });
        pushTreeChange(screen, before);
    }
    markDirty();
    var keep = state.selectedIds.slice();
    renderActiveScreen();
    selectMultiple(keep);
    renderHierarchyPanel();
}

function onRename(e) {
    var screen = getActiveScreen();
    var node = screen && Tree.find(screen, e.detail.id);
    if (!node) return;
    var name = e.detail.name;
    if ((node.name || "") === name) return;
    pushHistory({ t: "node", screenId: screen.id, id: node.id, key: "name", from: node.name, to: name || undefined });
    if (name) node.name = name; else delete node.name;
    markDirty();
    renderHierarchyPanel();
}

function onSelect(e) {
    var screen = getActiveScreen();
    var loc = screen && Tree.locate(screen, e.detail.id);
    if (!loc || loc.orphan) return; // an orphan isn't on the canvas
    if (e.detail.additive) {
        if (isSelected(e.detail.id)) selectMultiple(state.selectedIds.filter(function (id) { return id !== e.detail.id; }));
        else selectMultiple(state.selectedIds.concat([e.detail.id]));
    } else {
        selectOnly(e.detail.id);
    }
}

var wired = false;
function wireOnce() {
    if (wired) return;
    wired = true;
    onSelectionChange(function (ids) {
        if (!treeEl) return;
        treeEl.selected = ids.slice();
        if (ids.length === 1 && typeof treeEl.reveal === "function") treeEl.reveal(ids[0]);
    });
    setHierarchyRefresher(renderHierarchyPanel);
    // any structural change (canvas, undo / redo, paste…) refreshes an open panel
    onTreeChange(function () { if (state.hierarchyPane && state.hierarchyPane.is(":visible")) renderHierarchyPanel(); });
}

export function renderHierarchyPanel() {
    if (!state.hierarchyPane) return;
    wireOnce();
    var pane = state.hierarchyPane;
    var screen = getActiveScreen();
    if (!screen) { pane.empty(); return; }
    if (!window.NexaKit) {
        pane.empty();
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("The hierarchy needs the Nexa property kit.").appendTo(pane);
        return;
    }
    var nodes = rows(screen, screen.components || [], false);
    var orphans = rows(screen, screen.orphans || [], true);
    if (!treeEl || !pane.get(0).contains(treeEl)) {
        pane.empty();
        var host = pane.get(0);
        var bar = document.createElement("div");
        bar.className = "nx-kit";
        bar.style.cssText = "display:flex;align-items:center;gap:4px;margin-bottom:6px;";
        bar.innerHTML = '<span style="flex:1;font-weight:600;font-size:12px;"><i class="fa fa-sitemap"></i> Hierarchy</span>';
        [["fa fa-object-group", "Group selection (Ctrl+G)", function () { groupSelection(); }],
            ["fa fa-square-o", "Frame selection (Ctrl+Alt+G)", function () { frameSelection(); }],
            ["fa fa-angle-double-down", "Expand all", function () { treeEl.setAllCollapsed(false); }],
            ["fa fa-angle-double-up", "Collapse all", function () { treeEl.setAllCollapsed(true); }]].forEach(function (b) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "nx-icon-btn";
            btn.title = b[1];
            btn.innerHTML = '<i class="' + b[0] + '"></i>';
            btn.addEventListener("click", b[2]);
            bar.appendChild(btn);
        });
        host.appendChild(bar);
        treeEl = document.createElement("nx-tree");
        treeEl.setAttribute("empty-text", "Nothing on this screen yet");
        treeEl.addEventListener("nx-tree-select", onSelect);
        treeEl.addEventListener("nx-tree-move", onMove);
        treeEl.addEventListener("nx-tree-action", onAction);
        treeEl.addEventListener("nx-tree-rename", onRename);
        host.appendChild(treeEl);
        orphanEl = document.createElement("nx-tree");
        orphanEl.className = "nexa-hierarchy-unplaced";
        orphanEl.style.cssText = "display:block;margin-top:10px;";
        orphanEl.addEventListener("nx-tree-move", onMove);
        orphanEl.addEventListener("nx-tree-action", onAction);
        orphanEl.addEventListener("nx-tree-rename", onRename);
        // dragging from the Unplaced list into the main tree
        orphanEl.addEventListener("dragstart", function (ev) { treeEl._dragId = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-id"); });
        treeEl.addEventListener("dragstart", function (ev) { orphanEl._dragId = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-id"); });
        host.appendChild(orphanEl);
    }
    treeEl.setAttribute("persist-key", "hierarchy:" + screen.id);
    treeEl.nodes = nodes;
    treeEl.selected = state.selectedIds.slice();
    // "Unplaced" is one container row: drop a tree node on it to take it out of the tree
    orphanEl.nodes = [{ id: UNPLACED_ID, label: "Unplaced", icon: "fa fa-archive", container: true, renamable: false, badge: String(orphans.length),
        title: "Taken out of the tree, not deleted (e.g. the children of a deleted group) — drag back to use", children: orphans }];
}
