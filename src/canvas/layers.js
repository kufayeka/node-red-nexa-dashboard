import { state, genId, markDirty, getActiveScreen, findLayer, findTemplate, findComponent, getLayerChildren, getComponentsInLayer, isLayerVisible } from "../state.js";
import { selectOnly } from "./selection.js";
import { renderActiveScreen } from "./canvas-ui.js";

export { isLayerVisible, getLayerChildren, getComponentsInLayer };

// Expansion & selection state for the layers tree
var expandedLayers = new Set();
var initialExpandDone = false;
var selectedTreeItemId = null;
var draggedItem = null;

function ensureInitialExpanded(screen) {
    if (!initialExpandDone && screen && screen.layers) {
        screen.layers.forEach(function (l) { expandedLayers.add(l.id); });
        initialExpandDone = true;
    }
}

function isExpanded(layerId) {
    return expandedLayers.has(layerId);
}

function setExpanded(layerId, val) {
    if (val) expandedLayers.add(layerId);
    else expandedLayers.delete(layerId);
}

export function addLayer(parentId) {
    var screen = getActiveScreen();
    if (!screen) return;
    var layer = { id: genId(), name: "New Layer", parentId: parentId || null, visible: true };
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
    expandedLayers.delete(id);
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

function isDescendantLayer(candidateParentId, targetLayerId) {
    if (!candidateParentId || !targetLayerId) return false;
    if (candidateParentId === targetLayerId) return true;
    var children = getLayerChildren(targetLayerId);
    return children.some(function (child) {
        return child.id === candidateParentId || isDescendantLayer(candidateParentId, child.id);
    });
}

export function renderLayersPanel() {
    if (!state.layersPane) return;
    state.layersPane.empty();
    var screen = getActiveScreen();
    if (!screen) return;

    ensureInitialExpanded(screen);

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
    }).text(screen.layers.length + " layers, " + screen.components.length + " items").appendTo(titleBox);

    var btnGroup = $("<div>").css({ display: "flex", gap: "4px" }).appendTo(header);

    $("<button>", { type: "button", class: "red-ui-button red-ui-button-small", title: "Expand All" })
        .html('<i class="fa fa-angle-double-down"></i>')
        .on("click", function () {
            screen.layers.forEach(function (l) { expandedLayers.add(l.id); });
            renderLayersPanel();
        }).appendTo(btnGroup);

    $("<button>", { type: "button", class: "red-ui-button red-ui-button-small", title: "Collapse All" })
        .html('<i class="fa fa-angle-double-up"></i>')
        .on("click", function () {
            expandedLayers.clear();
            renderLayersPanel();
        }).appendTo(btnGroup);

    $("<button>", { type: "button", class: "red-ui-button red-ui-button-small red-ui-button-primary", title: "Add Layer" })
        .html('<i class="fa fa-plus"></i> Layer')
        .on("click", function () { addLayer(null); }).appendTo(btnGroup);

    // 2. Boxed Tree Container (styled like Bindable Properties / EditableList)
    var treeContainer = $("<div>", { class: "red-ui-editableList-container nexa-layer-tree-container" }).css({
        min_height: "260px",
        "max-height": "calc(100vh - 280px)",
        "overflow-y": "auto",
        "overflow-x": "hidden",
        padding: "4px",
        border: "1px solid var(--red-ui-secondary-border-color, #ccc)",
        "border-radius": "4px",
        background: "var(--red-ui-secondary-background, #fff)",
        "box-shadow": "inset 0 1px 2px rgba(0,0,0,0.03)",
        "box-sizing": "border-box"
    }).appendTo(state.layersPane);

    function renderLayerNode(layer, depth) {
        var directComponents = getComponentsInLayer(layer.id);
        var childLayers = getLayerChildren(layer.id);
        var hasChildren = directComponents.length > 0 || childLayers.length > 0;
        var expanded = isExpanded(layer.id);

        // Layer Row Container
        var layerRow = $("<div>", {
            class: "nexa-layer-tree-item nexa-layer-node" + (selectedTreeItemId === layer.id ? " selected" : ""),
            "data-layer-id": layer.id,
            draggable: "true"
        }).css({
            display: "flex", "align-items": "center", gap: "4px",
            padding: "3px 6px",
            "margin-left": (depth * 16) + "px",
            "margin-bottom": "2px",
            "border-radius": "3px",
            background: selectedTreeItemId === layer.id ? "var(--red-ui-list-item-selected-background, #e3f2fd)" : "transparent",
            border: selectedTreeItemId === layer.id ? "1px solid #90caf9" : "1px solid transparent",
            cursor: "pointer",
            "font-size": "12px",
            "user-select": "none",
            transition: "background 0.15s, border-color 0.15s"
        }).appendTo(treeContainer);

        // HTML5 Drag & Drop for Layer
        layerRow.on("dragstart", function (ev) {
            draggedItem = { type: "layer", id: layer.id };
            if (ev && ev.originalEvent && ev.originalEvent.dataTransfer) {
                ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(draggedItem));
                ev.originalEvent.dataTransfer.effectAllowed = "move";
            }
            layerRow.css("opacity", "0.4");
        });
        layerRow.on("dragend", function () {
            draggedItem = null;
            layerRow.css("opacity", "1");
            if (treeContainer.find) {
                treeContainer.find(".nexa-layer-tree-item").css({ "border-top": "1px solid transparent", "border-bottom": "1px solid transparent" });
            }
        });
        layerRow.on("dragover", function (ev) {
            if (ev && ev.preventDefault) ev.preventDefault();
            if (ev && ev.originalEvent && ev.originalEvent.dataTransfer) ev.originalEvent.dataTransfer.dropEffect = "move";
            layerRow.css("border", "1px dashed #2196f3");
        });
        layerRow.on("dragleave", function () {
            layerRow.css("border", selectedTreeItemId === layer.id ? "1px solid #90caf9" : "1px solid transparent");
        });
        layerRow.on("drop", function (ev) {
            if (ev && ev.preventDefault) ev.preventDefault();
            layerRow.css("border", selectedTreeItemId === layer.id ? "1px solid #90caf9" : "1px solid transparent");
            if (!draggedItem) return;
            if (draggedItem.type === "comp") {
                var comp = findComponent(draggedItem.id);
                if (comp) {
                    comp.layerId = layer.id;
                    markDirty();
                    renderActiveScreen();
                    renderLayersPanel();
                }
            } else if (draggedItem.type === "layer" && draggedItem.id !== layer.id) {
                if (!isDescendantLayer(layer.id, draggedItem.id)) {
                    var dLayer = findLayer(draggedItem.id);
                    if (dLayer) {
                        dLayer.parentId = layer.id;
                        setExpanded(layer.id, true);
                        markDirty();
                        renderActiveScreen();
                        renderLayersPanel();
                    }
                }
            }
        });

        // Caret arrow for expand / collapse
        if (hasChildren) {
            $("<span>", { class: "nexa-tree-caret", style: "width: 14px; text-align: center; cursor: pointer; flex: 0 0 14px; color: #666;" })
                .html(expanded ? '<i class="fa fa-caret-down"></i>' : '<i class="fa fa-caret-right"></i>')
                .on("click", function (e) {
                    if (e && e.stopPropagation) e.stopPropagation();
                    setExpanded(layer.id, !expanded);
                    renderLayersPanel();
                }).appendTo(layerRow);
        } else {
            $("<span>", { style: "width: 14px; flex: 0 0 14px; opacity: 0.25; text-align: center;" })
                .html('<i class="fa fa-circle" style="font-size: 5px; vertical-align: middle;"></i>')
                .appendTo(layerRow);
        }

        // Visibility toggle
        $("<span>", {
            style: "cursor: pointer; width: 16px; text-align: center; flex: 0 0 16px; margin-right: 2px;",
            title: layer.visible ? "Hide layer" : "Show layer"
        })
            .html(layer.visible ? '<i class="fa fa-eye"></i>' : '<i class="fa fa-eye-slash"></i>')
            .css({ color: layer.visible ? "var(--red-ui-primary-text-color, #333)" : "#bbb" })
            .on("click", function (e) {
                if (e && e.stopPropagation) e.stopPropagation();
                toggleLayerVisibility(layer.id);
            })
            .appendTo(layerRow);

        // Layer Folder Icon
        $("<span>", { style: "margin-right: 4px; color: #f59e0b; flex: 0 0 auto; font-size: 13px;" })
            .html(expanded ? '<i class="fa fa-folder-open"></i>' : '<i class="fa fa-folder"></i>')
            .appendTo(layerRow);

        // Layer Name with inline edit
        var nameBox = $("<div>", { style: "flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px;" }).appendTo(layerRow);
        var nameEl = $("<span>", {
            style: "font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red-ui-primary-text-color, #222);"
        }).text(layer.name).appendTo(nameBox);

        function startRename() {
            var input = $("<input>", { type: "text" }).val(layer.name).css({
                width: "100%", "box-sizing": "border-box", padding: "1px 4px", "font-size": "12px", height: "22px"
            });
            nameBox.empty().append(input);
            if (input.get && input.get(0) && input.get(0).focus) input.get(0).focus();
            input.on("blur keydown", function (ev) {
                if (ev.type === "keydown" && ev.keyCode !== 13 && ev.keyCode !== 27) return;
                if (ev.type === "keydown" && ev.keyCode === 27) { renderLayersPanel(); return; }
                renameLayer(layer.id, input.val());
                renderLayersPanel();
            });
        }

        nameEl.on("dblclick", function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            startRename();
        });

        // Layer item count badge
        var totalDirect = directComponents.length + childLayers.length;
        $("<span>", {
            style: "font-size: 10px; color: #888; background: rgba(0,0,0,0.06); padding: 0 5px; border-radius: 8px; flex: 0 0 auto;"
        }).text(totalDirect).appendTo(nameBox);

        // Right side Layer Actions
        var actionsBox = $("<div>", { style: "display: flex; align-items: center; gap: 2px; flex: 0 0 auto;" }).appendTo(layerRow);

        $("<a>", { href: "#", title: "Add sub-layer", class: "red-ui-button red-ui-button-small", style: "padding: 1px 5px; font-size: 10px; color: #555;" })
            .html('<i class="fa fa-plus"></i>')
            .on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                addLayer(layer.id);
                setExpanded(layer.id, true);
            }).appendTo(actionsBox);

        $("<a>", { href: "#", title: "Rename layer", class: "red-ui-button red-ui-button-small", style: "padding: 1px 5px; font-size: 10px; color: #555;" })
            .html('<i class="fa fa-pencil"></i>')
            .on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                startRename();
            }).appendTo(actionsBox);

        if (screen.layers.length > 1) {
            $("<a>", { href: "#", title: "Delete layer", class: "red-ui-button red-ui-button-small", style: "padding: 1px 5px; font-size: 10px; color: #d32f2f;" })
                .html('<i class="fa fa-trash"></i>')
                .on("click", function (e) {
                    if (e && e.preventDefault) e.preventDefault();
                    if (e && e.stopPropagation) e.stopPropagation();
                    deleteLayer(layer.id);
                }).appendTo(actionsBox);
        }

        // Layer Row Click (selects locally in tree without switching tabs or canvas selection)
        layerRow.on("click", function () {
            selectedTreeItemId = layer.id;
            if (treeContainer.find) {
                treeContainer.find(".nexa-layer-tree-item").css({
                    background: "transparent",
                    border: "1px solid transparent"
                });
            }
            layerRow.css({
                background: "var(--red-ui-list-item-selected-background, #e3f2fd)",
                border: "1px solid #90caf9"
            });
        });

        // If expanded, render child components & sub-layers
        if (expanded) {
            // Components in layer (reversed for display: top of tree = front-most on canvas)
            directComponents.slice().reverse().forEach(function (comp) {
                var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
                var rowLabel = (comp.props && comp.props.name) || (typeDef ? typeDef.label : comp.type);
                if (comp.type === "@template") {
                    var template = findTemplate(comp.templateId);
                    rowLabel = "Template: " + (template ? template.name : "(missing)");
                }

                var compRow = $("<div>", {
                    class: "nexa-layer-tree-item nexa-comp-node" + (selectedTreeItemId === comp.id ? " selected" : ""),
                    "data-comp-id": comp.id,
                    "data-id": comp.id,
                    draggable: "true"
                }).css({
                    display: "flex", "align-items": "center", gap: "4px",
                    padding: "3px 6px",
                    "margin-left": ((depth + 1) * 16) + "px",
                    "margin-bottom": "2px",
                    "border-radius": "3px",
                    background: selectedTreeItemId === comp.id ? "var(--red-ui-list-item-selected-background, #e3f2fd)" : "transparent",
                    border: selectedTreeItemId === comp.id ? "1px solid #90caf9" : "1px solid transparent",
                    cursor: "pointer",
                    "font-size": "12px",
                    "user-select": "none",
                    transition: "background 0.15s, border-color 0.15s"
                }).appendTo(treeContainer);

                // HTML5 Drag & Drop for Component Reorder
                compRow.on("dragstart", function (ev) {
                    draggedItem = { type: "comp", id: comp.id, layerId: comp.layerId };
                    if (ev && ev.originalEvent && ev.originalEvent.dataTransfer) {
                        ev.originalEvent.dataTransfer.setData("text/plain", JSON.stringify(draggedItem));
                        ev.originalEvent.dataTransfer.effectAllowed = "move";
                    }
                    compRow.css("opacity", "0.4");
                });
                compRow.on("dragend", function () {
                    draggedItem = null;
                    compRow.css("opacity", "1");
                    if (treeContainer.find) {
                        treeContainer.find(".nexa-layer-tree-item").css({ "border-top": "1px solid transparent", "border-bottom": "1px solid transparent" });
                    }
                });
                compRow.on("dragover", function (ev) {
                    if (ev && ev.preventDefault) ev.preventDefault();
                    if (ev && ev.originalEvent && ev.originalEvent.dataTransfer) ev.originalEvent.dataTransfer.dropEffect = "move";
                    var offset = compRow.offset ? compRow.offset() : { top: 0 };
                    var relY = (ev.pageY || (ev.originalEvent && ev.originalEvent.pageY) || 0) - (offset ? offset.top : 0);
                    var h = compRow.height ? compRow.height() : 24;
                    var isTopHalf = relY < (h / 2);
                    compRow.css({
                        "border-top": isTopHalf ? "2px solid #2196f3" : "1px solid transparent",
                        "border-bottom": !isTopHalf ? "2px solid #2196f3" : "1px solid transparent"
                    });
                });
                compRow.on("dragleave", function () {
                    compRow.css({
                        "border-top": "1px solid transparent",
                        "border-bottom": "1px solid transparent",
                        border: selectedTreeItemId === comp.id ? "1px solid #90caf9" : "1px solid transparent"
                    });
                });
                compRow.on("drop", function (ev) {
                    if (ev && ev.preventDefault) ev.preventDefault();
                    compRow.css({
                        "border-top": "1px solid transparent",
                        "border-bottom": "1px solid transparent",
                        border: selectedTreeItemId === comp.id ? "1px solid #90caf9" : "1px solid transparent"
                    });
                    if (!draggedItem || draggedItem.type !== "comp" || draggedItem.id === comp.id) return;
                    var dIdx = screen.components.findIndex(function (c) { return c.id === draggedItem.id; });
                    var tIdx = screen.components.findIndex(function (c) { return c.id === comp.id; });
                    if (dIdx === -1 || tIdx === -1) return;
                    var dComp = screen.components[dIdx];
                    screen.components.splice(dIdx, 1);
                    tIdx = screen.components.findIndex(function (c) { return c.id === comp.id; });
                    var offset = compRow.offset ? compRow.offset() : { top: 0 };
                    var relY = (ev.pageY || (ev.originalEvent && ev.originalEvent.pageY) || 0) - (offset ? offset.top : 0);
                    var h = compRow.height ? compRow.height() : 24;
                    var isTopHalf = relY < (h / 2);
                    var insertIdx = isTopHalf ? tIdx + 1 : tIdx;
                    screen.components.splice(Math.max(0, Math.min(insertIdx, screen.components.length)), 0, dComp);
                    dComp.layerId = comp.layerId;
                    markDirty();
                    renderActiveScreen();
                    renderLayersPanel();
                });

                // Component Icon
                $("<span>", { style: "margin-right: 4px; color: #2196f3; flex: 0 0 auto; font-size: 11px;" })
                    .html(comp.type === "@template" ? '<i class="fa fa-clone"></i>' : '<i class="fa fa-cube"></i>')
                    .appendTo(compRow);

                // Component Name
                $("<span>", {
                    style: "flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red-ui-primary-text-color, #444);"
                }).text(rowLabel).appendTo(compRow);

                // Dedicated "See" Button (Locates, selects on canvas, and opens properties tab)
                $("<a>", {
                    href: "#",
                    title: "See component on canvas & inspect properties",
                    class: "red-ui-button red-ui-button-small nexa-btn-see",
                    style: "padding: 1px 7px; font-size: 11px; height: 20px; display: inline-flex; align-items: center; gap: 3px; margin-right: 4px; font-weight: 500; color: #1976d2; background: #fff;"
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
                    }).appendTo(compRow);

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
                        }).appendTo(compRow);
                });

                // Row click on Component (selects locally in tree without switching tabs or canvas selection)
                compRow.on("click", function () {
                    selectedTreeItemId = comp.id;
                    if (treeContainer.find) {
                        treeContainer.find(".nexa-layer-tree-item").css({
                            background: "transparent",
                            border: "1px solid transparent"
                        });
                    }
                    compRow.css({
                        background: "var(--red-ui-list-item-selected-background, #e3f2fd)",
                        border: "1px solid #90caf9"
                    });
                });
            });

            // Sub-layers
            childLayers.forEach(function (child) {
                renderLayerNode(child, depth + 1);
            });
        }
    }

    // Render Root Layers
    getLayerChildren(null).forEach(function (layer) {
        renderLayerNode(layer, 0);
    });

    // Empty State if no layers
    if (screen.layers.length === 0) {
        $("<div>", { style: "padding: 16px; text-align: center; color: #888; font-size: 12px;" })
            .text("No layers available in this screen.")
            .appendTo(treeContainer);
    }
}
