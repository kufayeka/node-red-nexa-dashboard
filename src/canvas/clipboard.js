// --- Copy / cut / paste of canvas nodes (whole subtrees) ------------------------
import { state, findComponent, getActiveScreen, genId, markDirty, Tree } from "../state.js";
import { removeComponents, renderComponent } from "./component-renderer.js";
import { pushTreeChange, treeSnapshot } from "../history.js";
import { selectMultiple } from "./selection.js";
import { renderActiveScreen } from "./canvas-ui.js";

var clipboard = null;        // deep copies of the copied nodes (a container carries its children)
var clipboardSource = null;  // "copy" | "cut"

export function copySelection(isCut) {
    if (!state.selectedIds.length) return;
    var screen = getActiveScreen();
    if (!screen) return;
    // a node inside another selected node travels with it
    var roots = state.selectedIds.filter(function (id) {
        return findComponent(id) && !state.selectedIds.some(function (o) { return o !== id && Tree.isAncestor(screen, o, id); });
    });
    if (!roots.length) return;
    clipboard = JSON.parse(JSON.stringify(roots.map(findComponent)));
    clipboardSource = isCut ? "cut" : "copy";
    if (isCut) removeComponents(roots);
}

// Pastes next to the selection (into the selected node's parent), or onto the
// root. A copy gets new ids (everywhere in its subtree) and a +20 offset; a
// cut comes back with the same ids and place, once — further pastes copy.
export function pasteClipboard() {
    if (!clipboard || !clipboard.length) return;
    var screen = getActiveScreen();
    if (!screen) return;
    var anchor = state.selectedIds[0] && findComponent(state.selectedIds[0]);
    var anchorLoc = anchor ? Tree.locate(screen, anchor.id) : null;
    var parent = anchorLoc && !anchorLoc.orphan ? anchorLoc.parent : null;
    var regenerateIds = clipboardSource === "copy";
    var before = treeSnapshot(screen);

    var newNodes = clipboard.map(function (c) {
        var copy = regenerateIds ? Tree.cloneWithNewIds(c, genId) : JSON.parse(JSON.stringify(c));
        if (regenerateIds) {
            copy.x = (copy.x || 0) + 20;
            copy.y = (copy.y || 0) + 20;
        }
        Tree.insert(screen, parent ? parent.id : null, null, copy);
        return copy;
    });
    if (parent && parent.type === "@group") {
        Tree.fitGroup(parent);                  // the group hugs the pasted nodes too
        Tree.refitGroupsUp(screen, parent.id);  // and so do the groups around it
    }

    pushTreeChange(screen, before);
    markDirty();
    if (parent) renderActiveScreen();
    else newNodes.forEach(function (n) { renderComponent(n); });
    selectMultiple(newNodes.map(function (c) { return c.id; }));

    if (clipboardSource === "cut") {
        clipboard = JSON.parse(JSON.stringify(newNodes));
        clipboardSource = "copy";
    }
}
