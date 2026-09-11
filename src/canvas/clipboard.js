import { state, findComponent, groupMemberIds, getActiveScreen, genId, markDirty } from "../state.js";
import { removeComponents, renderComponent } from "./component-renderer.js";
import { pushHistory } from "../history.js";
import { selectMultiple } from "./selection.js";

var clipboard = null; // array of cloned component objects
var clipboardSource = null; // "copy" | "cut"
var clipboardFullGroups = null; // {groupId: true} — only groups where EVERY member was selected at copy time

export function copySelection(isCut) {
    if (!state.selectedIds.length) return;
    var members = state.selectedIds.map(findComponent).filter(Boolean);
    if (!members.length) return;

    var touchedGroups = {};
    members.forEach(function (c) { if (c.g) touchedGroups[c.g] = true; });
    var fullGroups = {};
    Object.keys(touchedGroups).forEach(function (gid) {
        var allMembers = groupMemberIds(gid);
        var selectedMembers = allMembers.filter(function (id) { return state.selectedIds.indexOf(id) !== -1; });
        if (allMembers.length && selectedMembers.length === allMembers.length) fullGroups[gid] = true;
    });

    clipboard = JSON.parse(JSON.stringify(members));
    clipboardFullGroups = fullGroups;
    clipboardSource = isCut ? "cut" : "copy";

    if (isCut) {
        removeComponents(state.selectedIds.slice());
    }
}

export function pasteClipboard() {
    if (!clipboard || !clipboard.length) return;
    var screen = getActiveScreen();
    if (!screen) return;
    screen.groups = screen.groups || [];
    var regenerateIds = clipboardSource === "copy";
    var groupIdMap = {};

    var newComps = clipboard.map(function (c) {
        var copy = JSON.parse(JSON.stringify(c));
        copy.id = regenerateIds ? genId() : copy.id;
        if (regenerateIds) {
            copy.x += 20;
            copy.y += 20;
        }
        return copy;
    });

    newComps.forEach(function (copy) {
        if (!copy.g) return;
        if (!clipboardFullGroups[copy.g]) {
            delete copy.g; // partial group membership — don't dangle-reference a group that won't have every member
        } else if (regenerateIds) {
            if (!groupIdMap[copy.g]) groupIdMap[copy.g] = genId();
            copy.g = groupIdMap[copy.g];
        }
    });

    Object.keys(groupIdMap).forEach(function (oldGid) {
        var original = (screen.groups || []).find(function (g) { return g.id === oldGid; });
        var newGroup = original ? JSON.parse(JSON.stringify(original)) : { x: 0, y: 0, w: 0, h: 0 };
        newGroup.id = groupIdMap[oldGid];
        screen.groups.push(newGroup);
    });

    newComps.forEach(function (copy) { screen.components.push(copy); });
    newComps.forEach(renderComponent);

    if (newComps.length === 1) {
        pushHistory({ t: "add", screenId: screen.id, comp: newComps[0] });
    } else {
        pushHistory({ t: "multi", screenId: screen.id, events: newComps.map(function (c) { return { t: "add", screenId: screen.id, comp: c }; }) });
    }
    markDirty();
    selectMultiple(newComps.map(function (c) { return c.id; }));

    if (clipboardSource === "cut") {
        clipboard = newComps;
        clipboardFullGroups = {};
        newComps.forEach(function (c) { if (c.g) clipboardFullGroups[c.g] = true; });
        clipboardSource = "copy";
    }
}
