import { state, genId, markDirty, getActiveScreen, findLayer, findTemplate, findComponent, getLayerChildren, getComponentsInLayer, isLayerVisible, isLayerInteractable, shouldRenderLayer, getLayerRenderState } from "../state.js";
import { selectOnly, deselectAll } from "./selection.js";
import { renderActiveScreen } from "./canvas-ui.js";

export { isLayerVisible, isLayerInteractable, shouldRenderLayer, getLayerRenderState, getLayerChildren, getComponentsInLayer };

// Cycle order for the Layers panel's one-click toggle — show -> hide ->
// remove -> show. "remove" is the last stop (not the first past "show")
// since it's the most destructive/least-common choice.
var LAYER_STATE_CYCLE = ["show", "hide", "remove"];

// Layers are expanded by default unless explicitly collapsed
var collapsedLayers = new Set();
var activeTreeWidget = null;

function isExpanded(layerId) {
    return !collapsedLayers.has(layerId);
}

function setExpanded(layerId, val) {
    if (val) collapsedLayers.delete(layerId);
    else collapsedLayers.add(layerId);
}

export function addLayer(parentId) {
    var screen = getActiveScreen();
    if (!screen) return;
    var layer = { id: genId(), name: "New Layer", parentId: parentId || null, state: "show" };
    screen.layers.push(layer);
    setExpanded(layer.id, true);
    if (parentId) setExpanded(parentId, true);
    markDirty();
    renderLayersPanel();
    return layer;
}

export function renameLayer(id, name) {
    var layer = findLayer(id);
    if (!layer) return;
    layer.name = name || layer.name;
    markDirty();
}

// Replaces the old boolean toggleLayerVisibility — a layer now has 3
// states (see state.js's getLayerRenderState/LAYER_STATE_RANK): "show" is
// normal; "hide" still renders but is invisible+locked out of selection;
// "remove" isn't rendered at all. setLayerState(id) with no explicit
// `next` cycles show -> hide -> remove -> show (used by the panel's
// one-click toggle); pass `next` directly for the Layer Control logic
// node, which sets an exact state by name instead of cycling.
export function setLayerState(id, next) {
    var layer = findLayer(id);
    if (!layer) return;
    if (next === undefined) {
        var cur = LAYER_STATE_CYCLE.indexOf(layer.state || "show");
        next = LAYER_STATE_CYCLE[(cur + 1) % LAYER_STATE_CYCLE.length];
    }
    layer.state = next;
    // Anything selected may have just become non-interactable (hide/remove
    // lock a layer's components out of selection) — drop the stale
    // selection rather than leave selectedIds pointing at components the
    // user can no longer click, drag, or group.
    deselectAll();
    markDirty();
    renderActiveScreen();
    renderLayersPanel();
}

export function deleteLayer(id) {
    var screen = getActiveScreen();
    if (!screen) return;
    if (screen.layers.length <= 1) {
        RED.notify("A screen must have at least one layer", { type: "warning", timeout: 2000 });
        return;
    }
    var layer = findLayer(id);
    if (!layer) return;
    var fallbackId = layer.parentId || screen.layers.filter(function (l) { return l.id !== id; })[0].id;
    screen.components.forEach(function (c) { if (c.layerId === id) c.layerId = fallbackId; });
    getLayerChildren(id).forEach(function (child) { child.parentId = layer.parentId; });
    screen.layers = screen.layers.filter(function (l) { return l.id !== id; });
    collapsedLayers.delete(id);
    markDirty();
    renderActiveScreen();
    renderLayersPanel();
}

export function moveComponentZ(id, mode) {
    var screen = getActiveScreen();
    if (!screen) return;
    var idx = screen.components.findIndex(function (c) { return c.id === id; });
    if (idx === -1) return;
    var comp = screen.components[idx];
    screen.components.splice(idx, 1);
    if (mode === "front") screen.components.push(comp);
    else if (mode === "back") screen.components.unshift(comp);
    else if (mode === "forward") screen.components.splice(Math.min(idx + 1, screen.components.length), 0, comp);
    else if (mode === "backward") screen.components.splice(Math.max(idx - 1, 0), 0, comp);
    markDirty();
    renderActiveScreen();
    renderLayersPanel();
}

export function renderLayersPanel() {
    if (!state.layersPane) return;
    state.layersPane.empty();
    var screen = getActiveScreen();
    if (!screen) return;

    // 1. Panel Header & Controls Toolbar
    var header = $("<div>", { class: "nexa-layers-header" }).css({
        display: "flex", "align-items": "center", "justify-content": "space-between",
        "margin-bottom": "8px", gap: "6px"
    }).appendTo(state.layersPane);

    var titleBox = $("<div>").css({
        display: "flex", "align-items": "center", gap: "6px",
        "font-weight": "600", "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)"
    }).appendTo(header);

    $("<i>", { class: "fa fa-layer-group", style: "color: #2196f3;" }).appendTo(titleBox);
    $("<span>").text("Layers & Elements").appendTo(titleBox);
    $("<span>", {
        style: "font-size: 10px; font-weight: normal; color: #777; background: rgba(0,0,0,0.06); padding: 1px 6px; border-radius: 10px;"
    }).text((screen.layers ? screen.layers.length : 0) + " layers, " + (screen.components ? screen.components.length : 0) + " items").appendTo(titleBox);

    var btnGroup = $("<div>").css({ display: "flex", gap: "4px" }).appendTo(header);

    $("<button>", { type: "button", class: "red-ui-button red-ui-button-small", title: "Expand All" })
        .html('<i class="fa fa-angle-double-down"></i>')
        .on("click", function () {
            collapsedLayers.clear();
            renderLayersPanel();
        }).appendTo(btnGroup);

    $("<button>", { type: "button", class: "red-ui-button red-ui-button-small", title: "Collapse All" })
        .html('<i class="fa fa-angle-double-up"></i>')
        .on("click", function () {
            (screen.layers || []).forEach(function (l) { collapsedLayers.add(l.id); });
            renderLayersPanel();
        }).appendTo(btnGroup);

    $("<button>", { type: "button", class: "red-ui-button red-ui-button-small red-ui-button-primary", title: "Add Layer" })
        .html('<i class="fa fa-plus"></i> Layer')
        .on("click", function () { addLayer(null); }).appendTo(btnGroup);

    // 2. Tree Data Builder for Node-RED's native treeList widget
    function buildLayerItem(layer) {
        var directComponents = getComponentsInLayer(layer.id);
        var childLayers = getLayerChildren(layer.id);

        var layerRow = $("<div>", {
            class: "nexa-layer-tree-item nexa-layer-node",
            style: "display: flex; align-items: center; justify-content: space-between; width: calc(100% - 16px); gap: 4px; padding: 2px 0; font-size: 12px; user-select: none;"
        });

        var left = $("<div>", { style: "display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0;" }).appendTo(layerRow);

        // State toggle — cycles show -> hide -> remove -> show on click.
        var layerState = layer.state || "show";
        var STATE_ICON = { show: "fa-eye", hide: "fa-eye-slash", remove: "fa-ban" };
        var STATE_COLOR = { show: "var(--red-ui-primary-text-color, #333)", hide: "#bbb", remove: "#d32f2f" };
        var STATE_NEXT_LABEL = { show: "Hide layer (still rendered, locked)", hide: "Remove layer (not rendered)", remove: "Show layer" };
        $("<span>", {
            style: "cursor: pointer; width: 16px; text-align: center; flex: 0 0 16px; color: " + STATE_COLOR[layerState] + ";",
            title: STATE_NEXT_LABEL[layerState]
        })
            .html('<i class="fa ' + STATE_ICON[layerState] + '"></i>')
            .on("click", function (e) {
                if (e && e.stopPropagation) e.stopPropagation();
                setLayerState(layer.id);
            }).appendTo(left);

        // Folder Icon
        $("<i>", { class: isExpanded(layer.id) ? "fa fa-folder-open" : "fa fa-folder", style: "color: #f59e0b; flex: 0 0 auto;" }).appendTo(left);

        // Layer Name with inline edit
        var nameSpan = $("<span>", {
            style: "font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red-ui-primary-text-color, #222); cursor: pointer;"
        }).text(layer.name).appendTo(left);

        function startRename() {
            var inp = $("<input>", { type: "text" }).val(layer.name).css({ width: "120px", height: "20px", "font-size": "11px", padding: "1px 3px" });
            nameSpan.empty().append(inp);
            if (inp.get && inp.get(0) && inp.get(0).focus) inp.get(0).focus();
            inp.on("blur keydown", function (ev) {
                if (ev.type === "keydown" && ev.keyCode !== 13 && ev.keyCode !== 27) return;
                if (ev.type === "keydown" && ev.keyCode === 27) { renderLayersPanel(); return; }
                renameLayer(layer.id, inp.val());
                renderLayersPanel();
            });
        }

        nameSpan.on("dblclick", function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            startRename();
        });

        // Count Badge
        var totalDirect = directComponents.length + childLayers.length;
        $("<span>", {
            style: "font-size: 10px; color: #888; background: rgba(0,0,0,0.06); padding: 0 5px; border-radius: 8px; flex: 0 0 auto;"
        }).text(totalDirect).appendTo(left);

        // Action Buttons on Right
        var right = $("<div>", { style: "display: flex; align-items: center; gap: 2px; flex: 0 0 auto;" }).appendTo(layerRow);

        $("<a>", { href: "#", title: "Add sub-layer", class: "red-ui-button red-ui-button-small", style: "padding: 1px 4px; font-size: 10px;" })
            .html('<i class="fa fa-plus"></i>')
            .on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                addLayer(layer.id);
                setExpanded(layer.id, true);
            }).appendTo(right);

        $("<a>", { href: "#", title: "Rename layer", class: "red-ui-button red-ui-button-small", style: "padding: 1px 4px; font-size: 10px;" })
            .html('<i class="fa fa-pencil"></i>')
            .on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                startRename();
            }).appendTo(right);

        if (screen.layers && screen.layers.length > 1) {
            $("<a>", { href: "#", title: "Delete layer", class: "red-ui-button red-ui-button-small", style: "padding: 1px 4px; font-size: 10px; color: #d32f2f;" })
                .html('<i class="fa fa-trash"></i>')
                .on("click", function (e) {
                    if (e && e.preventDefault) e.preventDefault();
                    if (e && e.stopPropagation) e.stopPropagation();
                    deleteLayer(layer.id);
                }).appendTo(right);
        }

        var children = [];

        // Add sub-layers
        childLayers.forEach(function (child) {
            children.push(buildLayerItem(child));
        });

        // Add components in layer (top of tree = front-most on canvas)
        directComponents.slice().reverse().forEach(function (comp) {
            children.push(buildCompItem(comp));
        });

        return {
            id: layer.id,
            element: layerRow,
            expanded: isExpanded(layer.id),
            children: children.length > 0 ? children : undefined
        };
    }

    function buildCompItem(comp) {
        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        var rowLabel = (comp.props && comp.props.name) || (typeDef ? typeDef.label : comp.type);
        if (comp.type === "@template") {
            var template = findTemplate(comp.templateId);
            rowLabel = "Template: " + (template ? template.name : "(missing)");
        }

        var compRow = $("<div>", {
            class: "nexa-layer-tree-item nexa-comp-node",
            style: "display: flex; align-items: center; justify-content: space-between; width: calc(100% - 16px); gap: 4px; padding: 2px 0; font-size: 12px; user-select: none;",
            "data-comp-id": comp.id,
            "data-id": comp.id
        });

        var left = $("<div>", { style: "display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0;" }).appendTo(compRow);

        $("<i>", {
            class: comp.type === "@template" ? "fa fa-clone" : "fa fa-cube",
            style: "color: #2196f3; font-size: 11px; flex: 0 0 auto;"
        }).appendTo(left);

        $("<span>", {
            style: "overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red-ui-primary-text-color, #333);"
        }).text(rowLabel).appendTo(left);

        var right = $("<div>", { style: "display: flex; align-items: center; gap: 2px; flex: 0 0 auto;" }).appendTo(compRow);

        // Dedicated "See" Button (Locates, selects on canvas, and opens properties tab)
        $("<button>", {
            type: "button",
            title: "See component on canvas & inspect properties",
            class: "red-ui-button red-ui-button-small nexa-btn-see",
            style: "padding: 1px 6px; font-size: 10px; height: 20px; line-height: 18px; margin-right: 4px; color: #1976d2; font-weight: 500;"
        }).html('<i class="fa fa-eye"></i> See')
            .on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                selectOnly(comp.id);
                if (state.artboardEl && state.artboardEl.find) {
                    var targetEl = state.artboardEl.find('[data-id="' + comp.id + '"]');
                    if (targetEl && targetEl.length) {
                        targetEl.css("box-shadow", "0 0 10px #2196f3");
                        setTimeout(function () { targetEl.css("box-shadow", "none"); }, 600);
                    }
                }
            }).appendTo(right);

        // Z-Order Buttons
        [
            ["front", "fa-angle-double-up", "Bring to front"],
            ["forward", "fa-angle-up", "Bring forward"],
            ["backward", "fa-angle-down", "Send backward"],
            ["back", "fa-angle-double-down", "Send to back"]
        ].forEach(function (btn) {
            $("<a>", { href: "#", title: btn[2], style: "padding: 1px 3px; font-size: 11px; color: #777; margin-left: 1px;" })
                .html('<i class="fa ' + btn[1] + '"></i>')
                .on("click", function (e) {
                    if (e && e.preventDefault) e.preventDefault();
                    if (e && e.stopPropagation) e.stopPropagation();
                    moveComponentZ(comp.id, btn[0]);
                }).appendTo(right);
        });

        return {
            id: comp.id,
            element: compRow
        };
    }

    // Build data for all root layers
    var rootLayers = getLayerChildren(null);
    if ((!rootLayers || rootLayers.length === 0) && screen.layers && screen.layers.length > 0) {
        rootLayers = screen.layers;
    }

    var treeData = [];
    var processedIds = new Set();

    (rootLayers || []).forEach(function (layer) {
        processedIds.add(layer.id);
        treeData.push(buildLayerItem(layer));
    });

    // Fallback: render any orphan layers
    (screen.layers || []).forEach(function (layer) {
        if (!processedIds.has(layer.id)) {
            processedIds.add(layer.id);
            treeData.push(buildLayerItem(layer));
        }
    });

    // 3. Mount Native Node-RED TreeList Widget
    var treeContainer = $("<div>", { class: "nexa-layers-tree-wrap" }).css({
        width: "100%",
        height: "460px",
        "min-height": "320px",
        position: "relative",
        "box-sizing": "border-box"
    }).appendTo(state.layersPane);

    if (typeof treeContainer.treeList === "function") {
        activeTreeWidget = treeContainer.treeList({
            data: treeData,
            autoSelect: false
        });
    } else {
        // Fallback for headless / test runner where $.fn.treeList is not initialized
        var flatBox = $("<div>", { class: "red-ui-treeList-container" }).css({
            width: "100%", "min-height": "300px", padding: "4px", border: "1px solid #ccc", background: "#fff"
        }).appendTo(treeContainer);

        function renderFallbackNode(item, depth) {
            if (!item) return;
            var rowWrap = $("<div>").css({ "margin-left": (depth * 14) + "px", "margin-bottom": "2px" }).appendTo(flatBox);
            if (item.element) item.element.appendTo(rowWrap);
            if (item.children && Array.isArray(item.children)) {
                item.children.forEach(function (c) { renderFallbackNode(c, depth + 1); });
            }
        }
        treeData.forEach(function (t) { renderFallbackNode(t, 0); });
    }

    if (!screen.layers || screen.layers.length === 0) {
        $("<div>", { style: "padding: 16px; text-align: center; color: #888; font-size: 12px;" })
            .text("No layers available in this screen.")
            .appendTo(treeContainer);
    }
}
