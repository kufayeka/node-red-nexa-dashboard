// --- Canvas Component Selection & Grouping -----------------------------
import { state, genId, markDirty, getActiveScreen, findComponent, findGroup, groupMemberIds } from "../state.js";
import { isLayerInteractable } from "./layers.js";
import { pushHistory } from "../history.js";
import { clearSelectionHandles, renderSelectionHandles, updateComponentBox } from "./selection-handles.js";
import { renderPropertiesPanel } from "../sidebar/properties-panel.js";
import { refreshEventsHighlight } from "../sidebar/palette-events-panel.js";
import { renderActiveScreen } from "./canvas-ui.js";

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
    if (state.selectedIds.length > 0 && state.sidebarTabs && typeof state.sidebarTabs.activateTab === "function") {
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

export function setLockedForSelection(locked, idsOverride) {
    var ids = idsOverride || state.selectedIds.slice();
    var changed = false;
    ids.forEach(function (id) {
        var c = findComponent(id);
        if (c && c.locked !== locked) { c.locked = locked; changed = true; }
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
        if (!c || c.locked) return;
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

export function groupSelection() {
    var screen = getActiveScreen();
    if (!screen) return;
    screen.groups = screen.groups || [];
    // Defensive, not just belt-and-suspenders: state.selectedIds can be set
    // through paths other than the canvas's own click/marquee handlers
    // (e.g. the Layers panel's "See" button), which don't all know to
    // reject a "hide"/"remove" layer's components the way those two do.
    var members = state.selectedIds.map(findComponent).filter(Boolean).filter(function (c) { return isLayerInteractable(c.layerId); });
    if (members.length < 2) {
        RED.notify("Select at least 2 components to group", { type: "warning", timeout: 2000 });
        return;
    }
    if (members.some(function (c) { return c.g; })) {
        RED.notify("One or more selected components are already in a group — ungroup first", { type: "warning", timeout: 2500 });
        return;
    }
    var minX = Math.min.apply(null, members.map(function (c) { return c.x; }));
    var minY = Math.min.apply(null, members.map(function (c) { return c.y; }));
    var maxX = Math.max.apply(null, members.map(function (c) { return c.x + c.w; }));
    var maxY = Math.max.apply(null, members.map(function (c) { return c.y + c.h; }));
    var pad = 10;
    var group = { id: genId(), x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
    var memberIds = members.map(function (c) { return c.id; });

    screen.groups.push(group);
    memberIds.forEach(function (id) { var c = findComponent(id); if (c) c.g = group.id; });
    pushHistory({ t: "group", screenId: screen.id, group: group, memberIds: memberIds });
    markDirty();
    renderActiveScreen();
    selectMultiple(memberIds);
}

export function ungroupSelection() {
    var screen = getActiveScreen();
    if (!screen) return;
    var groupIds = {};
    state.selectedIds.forEach(function (id) {
        var c = findComponent(id);
        if (c && c.g) groupIds[c.g] = true;
    });
    var ids = Object.keys(groupIds);
    if (!ids.length) return;
    var ungroupEvents = [];
    var allMemberIds = [];
    ids.forEach(function (gid) {
        var group = findGroup(gid);
        if (!group) return;
        var memberIds = groupMemberIds(gid);
        ungroupEvents.push({ t: "ungroup", screenId: screen.id, group: group, memberIds: memberIds });
        memberIds.forEach(function (id) { var c = findComponent(id); if (c) delete c.g; });
        screen.groups = (screen.groups || []).filter(function (g) { return g.id !== gid; });
        allMemberIds = allMemberIds.concat(memberIds);
    });
    if (!ungroupEvents.length) return;
    pushHistory(ungroupEvents.length === 1 ? ungroupEvents[0] : { t: "multi", screenId: screen.id, events: ungroupEvents });
    markDirty();
    renderActiveScreen();
    selectMultiple(allMemberIds);
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
        var hits = screen.components.filter(function (c) {
            // Marquee-select is pure geometry (never touches the DOM), so a
            // "hide"/"remove" layer's display:none never protected it here
            // the way it incidentally does for a direct click — has to be
            // checked explicitly, or a rubber-band drag over a locked layer
            // would happily select components the user can't even see.
            if (!isLayerInteractable(c.layerId)) return false;
            return !(c.x > box.left + box.width || c.x + c.w < box.left || c.y > box.top + box.height || c.y + c.h < box.top);
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
