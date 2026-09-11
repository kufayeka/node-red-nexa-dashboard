import { state, genId, markDirty, getActiveScreen, findLayer, getLayerChildren, getComponentsInLayer, isLayerVisible } from "../state.js";
import { selectMultiple, selectOnly } from "./selection.js";
import { renderActiveScreen } from "./canvas-ui.js";

export { isLayerVisible, getLayerChildren, getComponentsInLayer };

export function addLayer(parentId) {
    var screen = getActiveScreen();
    if (!screen) return;
    var layer = { id: genId(), name: "New Layer", parentId: parentId || null, visible: true };
    screen.layers.push(layer);
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

export function toggleLayerVisibility(id) {
    var layer = findLayer(id);
    if (!layer) return;
    layer.visible = !layer.visible;
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
    var keepSelected = state.selectedIds.slice();
    renderActiveScreen();
    selectMultiple(keepSelected);
    renderLayersPanel();
}

export function renderLayersPanel() {
    if (!state.layersPane) return;
    state.layersPane.empty();
    var screen = getActiveScreen();
    if (!screen) return;

    function renderLayerNode(layer, depth) {
        var row = $("<div>").css({
            display: "flex", "align-items": "center", gap: "4px",
            "margin-left": (depth * 14) + "px", "margin-bottom": "2px", "font-size": "12px"
        }).appendTo(state.layersPane);

        $("<span>", { style: "cursor:pointer; width:16px; text-align:center;" })
            .html(layer.visible ? '<i class="fa fa-eye"></i>' : '<i class="fa fa-eye-slash"></i>')
            .css({ color: layer.visible ? "#333" : "#bbb" })
            .on("click", function () { toggleLayerVisibility(layer.id); })
            .appendTo(row);

        var nameEl = $("<span>", { style: "flex:1; cursor:text;" }).text(layer.name).appendTo(row);
        nameEl.on("click", function () {
            var input = $("<input>", { type: "text" }).val(layer.name).css({ width: "100%", "box-sizing": "border-box" });
            nameEl.empty().append(input);
            if (input.get && input.get(0) && input.get(0).focus) input.get(0).focus();
            input.on("blur", function () {
                renameLayer(layer.id, input.val());
                renderLayersPanel();
            });
        });

        $("<a>", { href: "#", title: "Add sub-layer" }).html('<i class="fa fa-plus"></i>').css({ color: "#888" })
            .on("click", function (e) { e.preventDefault(); addLayer(layer.id); }).appendTo(row);

        if (screen.layers.length > 1) {
            $("<a>", { href: "#", title: "Delete layer" }).html('<i class="fa fa-trash"></i>').css({ color: "#888" })
                .on("click", function (e) { e.preventDefault(); deleteLayer(layer.id); }).appendTo(row);
        }

        getComponentsInLayer(layer.id).slice().reverse().forEach(function (comp) {
            var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
            var compRow = $("<div>").css({
                display: "flex", "align-items": "center", gap: "3px", color: "#555",
                "margin-left": ((depth + 1) * 14) + "px", "margin-bottom": "2px", "font-size": "12px"
            }).appendTo(state.layersPane);
            $("<span>", { style: "flex:1; cursor:pointer;" }).text(typeDef ? typeDef.label : comp.type)
                .on("click", function () { selectOnly(comp.id); }).appendTo(compRow);
            [
                ["front", "fa-angle-double-up", "Bring to front"],
                ["forward", "fa-angle-up", "Bring forward"],
                ["backward", "fa-angle-down", "Send backward"],
                ["back", "fa-angle-double-down", "Send to back"]
            ].forEach(function (btn) {
                $("<a>", { href: "#", title: btn[2] }).html('<i class="fa ' + btn[1] + '"></i>')
                    .on("click", function (e) { e.preventDefault(); moveComponentZ(comp.id, btn[0]); }).appendTo(compRow);
            });
        });

        getLayerChildren(layer.id).forEach(function (child) { renderLayerNode(child, depth + 1); });
    }

    getLayerChildren(null).forEach(function (layer) { renderLayerNode(layer, 0); });

    $("<button>", { type: "button" }).text("+ Add Layer").css({ width: "100%", "margin-top": "8px" })
        .on("click", function () { addLayer(null); }).appendTo(state.layersPane);
}
