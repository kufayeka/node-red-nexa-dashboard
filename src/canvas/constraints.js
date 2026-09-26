// --- Constraints in the editor: a frame (or the screen) changed size -----------
// Its children that no auto layout places keep to its edges per their
// constraints (src/model/layout.js) — recursively, for a child frame that
// resized with it. Works from a snapshot of the boxes taken before the change,
// so a live resize (a handle drag) never accumulates rounding.
import { Tree, Layout } from "../state.js";

/** { id: { x, y, w, h } } for every node inside `node` (or in a list of nodes). */
export function snapshotBoxes(nodeOrList) {
    var out = {};
    (function walk(list) {
        list.forEach(function (c) {
            out[c.id] = { x: c.x, y: c.y, w: c.w, h: c.h };
            if (c.children) walk(c.children);
        });
    })(Array.isArray(nodeOrList) ? nodeOrList : Tree.kids(nodeOrList));
    return out;
}

/**
 * Re-places the children of `parent` (null = the root, then `list` is
 * screen.components) after its inner size went from oldInner to newInner.
 * Returns the ids that changed.
 */
export function applyConstraints(parent, list, oldInner, newInner, orig) {
    var changed = [];
    if (!oldInner || !newInner || (oldInner.w === newInner.w && oldInner.h === newInner.h)) return changed;
    orig = orig || snapshotBoxes(list);
    list.forEach(function (c) {
        if (!Layout.hasConstraints(c, parent)) return; // an auto layout places it
        var o = orig[c.id];
        if (!o) return;
        var nb = Layout.resizeWithConstraints(o, Layout.constraintsOf(c), oldInner, newInner);
        // a group is the box of its members: it moves, its size stays theirs
        if (c.type === "@group") { nb.w = o.w; nb.h = o.h; }
        if (nb.x === c.x && nb.y === c.y && nb.w === c.w && nb.h === c.h) return;
        var oldChildInner = c.type === "@frame" ? Layout.innerSize(Object.assign({}, c, o)) : null;
        c.x = nb.x; c.y = nb.y; c.w = nb.w; c.h = nb.h;
        changed.push(c.id);
        if (c.type === "@frame" && (nb.w !== o.w || nb.h !== o.h)) {
            changed = changed.concat(applyConstraints(c, Tree.kids(c), oldChildInner, Layout.innerSize(c), orig));
        }
    });
    return changed;
}

/** The same for a frame node itself (its own children). */
export function constrainFrameChildren(frame, oldBox, orig) {
    if (!frame || frame.type !== "@frame") return [];
    return applyConstraints(frame, Tree.kids(frame), Layout.innerSize(Object.assign({}, frame, oldBox)), Layout.innerSize(frame), orig);
}
