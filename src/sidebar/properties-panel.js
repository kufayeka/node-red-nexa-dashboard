import { state, findComponent, groupMemberIds, markDirty } from "../state.js";
import { isSelected, selectOnly, groupSelection, ungroupSelection, setLockedForSelection } from "../canvas/selection.js";
import { getLayerChildren } from "../canvas/layers.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { refreshComponentRender } from "../canvas/component-renderer.js";
import { updateComponentBox } from "../canvas/selection-handles.js";

export function renderPropertiesPanel() {
    if (!state.propertiesPane) return;
    state.propertiesPane.empty();
    if (state.selectedIds.length > 1) {
        window.$("<div>").css({ color: "#666", "font-size": "12px", "margin-bottom": "10px" }).text(state.selectedIds.length + " components selected.").appendTo(state.propertiesPane);

        var isOneWholeGroup = (function () {
            var first = findComponent(state.selectedIds[0]);
            if (!first || !first.g) return false;
            var members = groupMemberIds(first.g);
            return members.length === state.selectedIds.length && members.every(isSelected);
        })();
        var groupRow = window.$("<div>").css({ display: "flex", gap: "6px", "margin-bottom": "6px" }).appendTo(state.propertiesPane);
        if (isOneWholeGroup) {
            window.$("<button>", { type: "button" }).text("Ungroup").css({ flex: "1" }).on("click", ungroupSelection).appendTo(groupRow);
        } else {
            window.$("<button>", { type: "button" }).text("Group").css({ flex: "1" }).on("click", groupSelection).appendTo(groupRow);
        }

        var lockRow = window.$("<div>").css({ display: "flex", gap: "6px" }).appendTo(state.propertiesPane);
        window.$("<button>", { type: "button" }).text("Lock all").css({ flex: "1" })
            .on("click", function () { setLockedForSelection(true); }).appendTo(lockRow);
        window.$("<button>", { type: "button" }).text("Unlock all").css({ flex: "1" })
            .on("click", function () { setLockedForSelection(false); }).appendTo(lockRow);
        return;
    }
    var comp = state.selectedIds.length === 1 ? findComponent(state.selectedIds[0]) : null;
    if (!comp) {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("Select a component on the canvas to edit its properties.").appendTo(state.propertiesPane);
        return;
    }
    var typeDef = window.NEXA.getComponent(comp.type);
    if (!typeDef) {
        window.$("<div>").css({ color: "#a00", "font-size": "12px" }).text("Unknown component type: " + comp.type).appendTo(state.propertiesPane);
        return;
    }

    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", "margin-bottom": "8px" }).text(typeDef.label || comp.type).appendTo(state.propertiesPane);

    var lockRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.propertiesPane);
    var lockInput = window.$("<input>", { type: "checkbox" }).prop("checked", !!comp.locked).css({ "margin-right": "6px" });
    lockRow.append(lockInput).append(window.$("<label>").css({ "font-size": "11px", color: "#888" }).text("Locked"));
    lockInput.on("change", function () {
        setLockedForSelection(lockInput.is(":checked"), [comp.id]);
    });

    var layerRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.propertiesPane);
    window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text("Layer").appendTo(layerRow);
    var layerSelect = window.$("<select>").css({ width: "100%" }).appendTo(layerRow);
    (function buildLayerOptions(parentId, depth) {
        getLayerChildren(parentId).forEach(function (layer) {
            window.$("<option>", { value: layer.id }).text(new Array(depth + 1).join("— ") + layer.name)
                .prop("selected", comp.layerId === layer.id).appendTo(layerSelect);
            buildLayerOptions(layer.id, depth + 1);
        });
    })(null, 0);
    layerSelect.on("change", function () {
        comp.layerId = layerSelect.val();
        markDirty();
        renderActiveScreen();
        selectOnly(comp.id);
    });

    var defaults = typeDef.defaults || {};
    Object.keys(defaults).forEach(function (key) {
        var fieldDef = defaults[key] || {};
        var inputType = fieldDef.type === "number" ? "number" : fieldDef.type === "color" ? "color" : fieldDef.type === "checkbox" ? "checkbox" : "text";
        var row = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.propertiesPane);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text(key).appendTo(row);

        var input;
        if (inputType === "checkbox") {
            input = window.$("<input>", { type: "checkbox" }).prop("checked", !!comp.props[key]).appendTo(row);
        } else {
            input = window.$("<input>", { type: inputType }).css({ width: "100%", "box-sizing": "border-box" }).val(comp.props[key]).appendTo(row);
        }
        input.on("change", function () {
            var v = inputType === "checkbox" ? input.is(":checked") : inputType === "number" ? (parseFloat(input.val()) || 0) : input.val();
            comp.props[key] = v;
            refreshComponentRender(comp);
            markDirty();
        });
    });

    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", margin: "14px 0 8px", "border-top": "1px solid #ddd", "padding-top": "10px" }).text("Position & Size").appendTo(state.propertiesPane);
    [["x", "X"], ["y", "Y"], ["w", "Width"], ["h", "Height"], ["rotation", "Rotation"]].forEach(function (pair) {
        var field = pair[0], label = pair[1];
        var row = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.propertiesPane);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text(label).appendTo(row);
        var input = window.$("<input>", { type: "number" }).css({ width: "100%", "box-sizing": "border-box" }).val(comp[field]).prop("disabled", comp.locked).appendTo(row);
        input.on("change", function () {
            comp[field] = parseFloat(input.val()) || 0;
            updateComponentBox(comp);
            markDirty();
        });
    });
}
