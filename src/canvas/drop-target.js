// --- Where does a dragged / dropped node land? (Figma-style) --------------------
// Frames capture: a node dragged (or dropped from the palette) over a frame goes
// INTO it — into its auto layout at the pointer's place in the flow, or at the
// pointer in a frame without one. Out of every frame = the screen (root).
// Groups don't capture (a group is just its members).
import { Tree, Layout, isNodeLocked } from "../state.js";

/**
 * The top-most visible, unlocked frame under a point (surface coordinates),
 * not one of `excludeIds` nor inside them. null = the root.
 */
export function frameAt(screen, x, y, excludeIds) {
    var excluded = {};
    (excludeIds || []).forEach(function (id) { excluded[id] = true; });
    var hit = null;
    // pre-order is paint order: the last frame containing the point is on top
    Tree.walk(screen, function (node) {
        if (excluded[node.id]) return false;             // nor anything inside it
        if (Tree.effectiveVisibility(screen, node.id) !== "show") return false;
        if (node.type !== "@frame" || isNodeLocked(node.id)) return;
        var b = Tree.absBox(screen, node.id);
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) hit = node;
    });
    return hit;
}

function flowKids(frame, excludeIds) {
    return Tree.kids(frame).filter(function (c) {
        return (excludeIds || []).indexOf(c.id) === -1 && Layout.isInFlow(c, frame);
    });
}

/**
 * Where a node dropped at (x, y) goes in a frame's auto layout: the index in
 * frame.children (as if the dragged nodes were already out of it), and a line
 * to show it: { index, line: { x, y, w, h } } (surface coordinates).
 */
export function flowInsert(screen, frame, x, y, excludeIds) {
    var l = Layout.layoutOf(frame);
    var fb = Tree.absBox(screen, frame.id);
    var list = flowKids(frame, excludeIds);
    var boxes = list.map(function (c) { return Tree.absBox(screen, c.id); });
    var horizontal = l.mode === "horizontal";
    var readingOrder = l.mode === "grid" || (horizontal && l.wrap);
    var at = list.length;
    for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        var before;
        if (readingOrder) {
            var above = y < b.y;                              // on a row above this child
            var sameRow = y >= b.y && y <= b.y + b.h;
            before = above || (sameRow && x < b.x + b.w / 2);
        } else {
            before = horizontal ? x < b.x + b.w / 2 : y < b.y + b.h / 2;
        }
        if (before) { at = i; break; }
    }
    // index in the full children list (absolute children and the dragged nodes skipped)
    var all = Tree.kids(frame).filter(function (c) { return (excludeIds || []).indexOf(c.id) === -1; });
    var index = at < list.length ? all.indexOf(list[at]) : all.length;
    // the insert line: between the neighbours, across the content box
    var pad = l.padding;
    var line;
    var prev = boxes[at - 1], next = boxes[at];
    if (horizontal || readingOrder) {
        var lx = next && prev && Math.abs(next.y - prev.y) < 1 ? (prev.x + prev.w + next.x) / 2
            : next ? next.x - 2 : prev ? prev.x + prev.w + 2 : fb.x + pad.l;
        var ref = next || prev;
        line = ref ? { x: lx - 1, y: ref.y, w: 2, h: ref.h } : { x: lx - 1, y: fb.y + pad.t, w: 2, h: Math.max(8, fb.h - pad.t - pad.b) };
    } else {
        var ly = next && prev ? (prev.y + prev.h + next.y) / 2 : next ? next.y - 2 : prev ? prev.y + prev.h + 2 : fb.y + pad.t;
        line = { x: fb.x + pad.l, y: ly - 1, w: Math.max(8, fb.w - pad.l - pad.r), h: 2 };
    }
    return { index: index, line: line };
}

/**
 * Moves a node under parentId (null = root) at index (null = on top), keeping
 * its place on screen — or, for a parent with an auto layout, letting the
 * layout place it. Groups on both ends hug again (an emptied one goes).
 * Throws on a move into itself.
 */
export function reparentKeepingPlace(screen, id, parentId, index) {
    var loc = Tree.locate(screen, id);
    if (!loc) return;
    // (an orphan's x / y are already surface coordinates)
    var abs = loc.orphan ? { x: loc.node.x || 0, y: loc.node.y || 0 } : Tree.absBox(screen, id);
    var oldParent = loc.parent ? loc.parent.id : null;
    if (loc.orphan) Tree.placeOrphan(screen, id, parentId, index);
    else Tree.move(screen, id, parentId, index);
    var node = Tree.find(screen, id);
    var p = parentId ? Tree.contentOrigin(screen, parentId) : { x: 0, y: 0 };
    node.x = abs.x - p.x;
    node.y = abs.y - p.y;
    if (parentId) Tree.tidyContainer(screen, parentId);                          // the new group hugs it
    if (oldParent && oldParent !== parentId) Tree.tidyContainer(screen, oldParent); // the old one hugs the rest, or goes
}

/** The frame a node is "in" for dropping (its nearest frame ancestor), or null = the root. */
export function homeFrameOf(screen, id) {
    var chain = Tree.ancestors(screen, id);
    for (var i = chain.length - 1; i >= 0; i--) if (chain[i].type === "@frame") return chain[i];
    return null;
}

/**
 * What dropping `ids` (siblings in one home frame) at point p would do:
 * { targetId (null = root), change (a different frame than now), flow ({ index, line } in an auto layout) }
 * or null when the nodes don't share a home.
 */
export function planDrop(screen, ids, p) {
    if (!ids.length || !p) return null;
    var home = homeFrameOf(screen, ids[0]);
    var homeId = home ? home.id : null;
    if (ids.some(function (id) { var h = homeFrameOf(screen, id); return (h ? h.id : null) !== homeId; })) return null;
    var target = frameAt(screen, p.x, p.y, ids);
    var targetId = target ? target.id : null;
    return {
        targetId: targetId,
        change: targetId !== homeId,
        flow: target && Layout.hasAutoLayout(target) ? flowInsert(screen, target, p.x, p.y, ids) : null
    };
}

/**
 * Carries out a plan: into the auto layout at plan.flow.index (in order), or
 * into the frame / root keeping each node's place — `places` (optional)
 * { id: { x, y } } overrides that place (surface coordinates).
 */
export function applyDrop(screen, ids, plan, places) {
    ids.forEach(function (id, k) {
        var loc = Tree.locate(screen, id);
        if (!loc) return;
        var sameList = !loc.orphan && (loc.parent ? loc.parent.id : null) === plan.targetId;
        var index = null;
        if (plan.flow) {
            index = plan.flow.index + k;
            // the plan counted without the dragged nodes; Tree.move counts with this one still in
            if (sameList && index >= loc.index) index++;
        }
        var node = loc.node;
        if (!sameList && node.layoutChild && node.layoutChild.absolute) {
            // "absolute" belongs to the frame it was set in
            node.layoutChild = Object.assign({}, node.layoutChild);
            delete node.layoutChild.absolute;
            if (!Object.keys(node.layoutChild).length) delete node.layoutChild;
        }
        reparentKeepingPlace(screen, id, plan.targetId, index);
        if (places && places[id] && !plan.flow) {
            var p = plan.targetId ? Tree.contentOrigin(screen, plan.targetId) : { x: 0, y: 0 };
            node.x = Math.round(places[id].x - p.x);
            node.y = Math.round(places[id].y - p.y);
        }
    });
}
