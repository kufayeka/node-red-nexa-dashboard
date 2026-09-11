import { state, getActiveScreen, findComponent, snap, genId, markDirty, groupMemberIds } from "../state.js";
import { isLayerVisible } from "./layers.js";
import { isSelected, selectOnly, selectMultiple, refreshSelectionVisuals } from "./selection.js";
import { updateComponentBox } from "./selection-handles.js";
import { pushHistory } from "../history.js";

// Re-invokes just one component's render() with its current props
export function refreshComponentRender(comp) {
    if (!state.artboardEl) return;
    var el = state.artboardEl.find('[data-id="' + comp.id + '"]');
    var node = el && el.get && el.get(0);
    if (!node) return;
    var typeDef = window.NEXA.getComponent(comp.type);
    if (!typeDef || typeof typeDef.render !== "function") return;
    try {
        typeDef.render(node, comp.props || {}, {
            emit: function (eventName, payload) {
                if (window.RED && window.RED.log) window.RED.log.info("[kufayeka-nexa-dashboard] component event: " + comp.type + "#" + comp.id + " " + eventName + " " + JSON.stringify(payload));
            }
        });
    } catch (e) {
        el.text("(render error: " + e.message + ")");
    }
}

export function removeComponents(ids) {
    var screen = getActiveScreen();
    if (!screen) return;
    var toRemove = ids
        .map(function (id) { return screen.components.find(function (c) { return c.id === id; }); })
        .filter(function (c) { return c && !c.locked; });
    if (!toRemove.length) return;
    var removeIds = toRemove.map(function (c) { return c.id; });
    screen.components = screen.components.filter(function (c) { return removeIds.indexOf(c.id) === -1; });
    if (state.artboardEl) {
        removeIds.forEach(function (id) { state.artboardEl.find('[data-id="' + id + '"]').remove(); });
    }
    state.selectedIds = state.selectedIds.filter(function (id) { return removeIds.indexOf(id) === -1; });
    refreshSelectionVisuals();
    if (toRemove.length === 1) {
        pushHistory({ t: "delete", screenId: screen.id, comp: toRemove[0] });
    } else {
        pushHistory({ t: "multi", screenId: screen.id, events: toRemove.map(function (c) { return { t: "delete", screenId: screen.id, comp: c }; }) });
    }
    markDirty();
}

export function getComponentTransform(comp) {
    var transform = "rotate(" + (comp.rotation || 0) + "deg)";
    if (comp.flipH || comp.flipV) {
        var sx = comp.flipH ? -1 : 1;
        var sy = comp.flipV ? -1 : 1;
        transform += " scale(" + sx + "," + sy + ")";
    }
    return transform;
}

export function renderComponent(comp) {
    var screen = getActiveScreen();
    if (!screen || !state.artboardEl) return;
    var dragStart = null;
    var typeDef = window.NEXA.getComponent(comp.type);
    var el = window.$("<div>", { "data-id": comp.id, "class": "nexa-component" }).css({
        position: "absolute",
        left: comp.x + "px",
        top: comp.y + "px",
        width: comp.w + "px",
        height: comp.h + "px",
        transform: getComponentTransform(comp),
        "box-sizing": "border-box",
        cursor: comp.locked ? "default" : "move",
        "user-select": "none",
        display: isLayerVisible(comp.layerId) ? "" : "none"
    }).appendTo(state.artboardEl);

    if (typeDef && typeof typeDef.render === "function") {
        try {
            typeDef.render(el.get(0), comp.props || {}, {
                emit: function (eventName, payload) {
                    if (window.RED && window.RED.log) window.RED.log.info("[kufayeka-nexa-dashboard] component event: " + comp.type + "#" + comp.id + " " + eventName + " " + JSON.stringify(payload));
                }
            });
        } catch (e) {
            el.text("(render error: " + e.message + ")").css({ color: "#a00", "font-size": "11px", background: "#fee", padding: "4px" });
        }
    } else {
        el.text("(unknown component: " + comp.type + ")").css({ color: "#a00", "font-size": "11px", background: "#fee", padding: "4px" });
    }

    el.on("mousedown", function (e) {
        e.stopPropagation();
        var targetIds = comp.g ? groupMemberIds(comp.g) : [comp.id];
        var alreadyAllSelected = targetIds.every(isSelected);
        if (e.shiftKey) {
            if (alreadyAllSelected) {
                state.selectedIds = state.selectedIds.filter(function (id) { return targetIds.indexOf(id) === -1; });
            } else {
                targetIds.forEach(function (id) { if (!isSelected(id)) state.selectedIds.push(id); });
            }
            refreshSelectionVisuals();
        } else if (!alreadyAllSelected) {
            selectMultiple(targetIds);
        }
    });

    if (!comp.locked) {
        var groupStart = null;
        var dragStartPage = null;
        el.draggable({
            start: function (e) {
                if (!isSelected(comp.id)) selectOnly(comp.id);
                dragStart = { x: comp.x, y: comp.y };
                dragStartPage = { x: e.pageX, y: e.pageY };
                groupStart = {};
                state.selectedIds.forEach(function (id) {
                    var c = findComponent(id);
                    if (c) groupStart[id] = { x: c.x, y: c.y };
                });
            },
            drag: function (e, ui) {
                var localLeft = dragStart.x + (e.pageX - dragStartPage.x) / state.zoomLevel;
                var localTop = dragStart.y + (e.pageY - dragStartPage.y) / state.zoomLevel;
                localLeft = snap(localLeft, screen.gridSize);
                localTop = snap(localTop, screen.gridSize);
                localLeft = Math.max(0, Math.min(localLeft, screen.width - comp.w));
                localTop = Math.max(0, Math.min(localTop, screen.height - comp.h));
                ui.position.left = localLeft;
                ui.position.top = localTop;
                if (state.selectionHandlesEl && state.selectedIds.length === 1 && state.selectedIds[0] === comp.id) {
                    state.selectionHandlesEl.css({ left: localLeft + "px", top: localTop + "px" });
                }
                var dx = localLeft - dragStart.x;
                var dy = localTop - dragStart.y;
                state.selectedIds.forEach(function (id) {
                    if (id === comp.id) return;
                    var c = findComponent(id);
                    var start = groupStart[id];
                    if (!c || !start) return;
                    c.x = start.x + dx;
                    c.y = start.y + dy;
                    updateComponentBox(c);
                });
            },
            stop: function (e) {
                var localLeft = dragStart.x + (e.pageX - dragStartPage.x) / state.zoomLevel;
                var localTop = dragStart.y + (e.pageY - dragStartPage.y) / state.zoomLevel;
                localLeft = snap(localLeft, screen.gridSize);
                localTop = snap(localTop, screen.gridSize);
                localLeft = Math.max(0, Math.min(localLeft, screen.width - comp.w));
                localTop = Math.max(0, Math.min(localTop, screen.height - comp.h));
                comp.x = localLeft;
                comp.y = localTop;
                updateComponentBox(comp);
                var moved = [];
                state.selectedIds.forEach(function (id) {
                    var c = findComponent(id);
                    var start = groupStart[id];
                    if (!c || !start) return;
                    if (start.x !== c.x || start.y !== c.y) {
                        moved.push({ id: id, from: start, to: { x: c.x, y: c.y } });
                    }
                });
                if (moved.length === 1) {
                    pushHistory({ t: "move", screenId: screen.id, id: moved[0].id, from: moved[0].from, to: moved[0].to });
                } else if (moved.length > 1) {
                    pushHistory({
                        t: "multi", screenId: screen.id,
                        events: moved.map(function (m) { return { t: "move", screenId: screen.id, id: m.id, from: m.from, to: m.to }; })
                    });
                }
                if (moved.length) markDirty();
            }
        });
    }
}

export function addComponentAt(type, artboardX, artboardY) {
    var screen = getActiveScreen();
    if (!screen) return;
    var def = window.NEXA.getComponent(type);
    if (!def) return;
    var size = def.defaultSize || { w: 100, h: 60 };
    var props = {};
    Object.keys(def.defaults || {}).forEach(function (k) {
        props[k] = def.defaults[k].value;
    });
    var comp = {
        id: genId(),
        type: type,
        x: Math.max(0, screen.snap ? snap(artboardX - size.w / 2, screen.gridSize) : artboardX - size.w / 2),
        y: Math.max(0, screen.snap ? snap(artboardY - size.h / 2, screen.gridSize) : artboardY - size.h / 2),
        w: size.w,
        h: size.h,
        rotation: 0,
        locked: false,
        layerId: (screen.layers[0] || {}).id,
        props: props
    };
    screen.components.push(comp);
    renderComponent(comp);
    selectOnly(comp.id);
    pushHistory({ t: "add", screenId: screen.id, comp: comp });
    markDirty();
}
