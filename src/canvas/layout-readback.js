// --- Auto layout: boxes back from the DOM -----------------------------------
// A frame's auto layout is plain CSS (src/model/layout.js): the browser places
// the children. The editor reads the resulting boxes back into the nodes' x /
// y / w / h — the children in the flow, and a frame that hugs its content —
// so selection, handles, snapping and absBox() work on them like on any other
// node (Figma does the same: a node in auto layout still has a position).
// Derived values: no history, not "dirty" on their own.
import { state, getActiveScreen, Tree, Layout } from "../state.js";
import { constrainFrameChildren } from "./constraints.js";

function elementOf(id) {
    if (!state.artboardEl) return null;
    var el = state.artboardEl.find('[data-id="' + id + '"]').get(0);
    // only a real, laid-out element can be measured (not a test double)
    return el && typeof el.offsetWidth === "number" && el.isConnected ? el : null;
}

/**
 * Measures every node placed by a layout on the active screen and writes its
 * box into the node. Returns the ids whose box changed.
 */
export function readbackLayout(screen) {
    screen = screen || getActiveScreen();
    var changed = [];
    var redraw = false;
    if (!screen) return changed;
    Tree.walk(screen, function (node, parent) {
        var inFlow = Layout.isInFlow(node, parent);
        var hugW = Layout.frameHugs(node, "w"), hugH = Layout.frameHugs(node, "h");
        if (!inFlow && !hugW && !hugH) return;
        // hidden (display: none, itself or an ancestor): it measures 0 x 0 —
        // keep its real size for when it shows again
        if (Tree.effectiveVisibility(screen, node.id) !== "show") return false;
        var el = elementOf(node.id);
        if (!el || !el.getClientRects().length) return;
        var box = { x: node.x, y: node.y, w: node.w, h: node.h };
        if (inFlow) { box.x = el.offsetLeft; box.y = el.offsetTop; }
        if (inFlow || hugW) box.w = el.offsetWidth;
        if (inFlow || hugH) box.h = el.offsetHeight;
        if (box.x !== node.x || box.y !== node.y || box.w !== node.w || box.h !== node.h) {
            var old = { w: node.w, h: node.h };
            node.x = box.x; node.y = box.y; node.w = box.w; node.h = box.h;
            changed.push(node.id);
            // a frame the layout resized: what it holds keeps to its edges (drawn from data: redraw)
            var moved = constrainFrameChildren(node, old);
            if (moved.length) { redraw = true; changed = changed.concat(moved); }
        }
    });
    // a group hugs its children: one whose child changed size re-fits
    changed.forEach(function (id) {
        if (Tree.ancestors(screen, id).some(function (a) { return a.type === "@group"; })) redraw = true;
        Tree.refitGroupsUp(screen, id);
    });
    changed.redraw = redraw; // drawn from stale values: the caller draws once more
    return changed;
}
