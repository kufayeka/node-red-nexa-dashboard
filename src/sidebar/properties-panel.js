import { state, findComponent, findTemplate, groupMemberIds, markDirty, genId } from "../state.js";
import { buildTypedInputWidget, PARAM_TYPES, defaultValueForType } from "../param-types.js";
import { isSelected, selectOnly, groupSelection, ungroupSelection, setLockedForSelection, toggleFlipForSelection } from "../canvas/selection.js";
import { getLayerChildren } from "../canvas/layers.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { refreshComponentRender } from "../canvas/component-renderer.js";
import { updateComponentBox } from "../canvas/selection-handles.js";
import { openLitComponentCodeEditor } from "../dialogs/lit-code-dialog.js";

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

        var lockRow = window.$("<div>").css({ display: "flex", gap: "6px", "margin-bottom": "6px" }).appendTo(state.propertiesPane);
        window.$("<button>", { type: "button" }).text("Lock all").css({ flex: "1" })
            .on("click", function () { setLockedForSelection(true); }).appendTo(lockRow);
        window.$("<button>", { type: "button" }).text("Unlock all").css({ flex: "1" })
            .on("click", function () { setLockedForSelection(false); }).appendTo(lockRow);

        var flipRow = window.$("<div>").css({ display: "flex", gap: "6px" }).appendTo(state.propertiesPane);
        window.$("<button>", { type: "button", title: "Flip Horizontal (Shift+H)" }).html('<i class="fa fa-arrows-h"></i> Flip H').css({ flex: "1" })
            .on("click", function () { toggleFlipForSelection("h"); }).appendTo(flipRow);
        window.$("<button>", { type: "button", title: "Flip Vertical (Shift+V)" }).html('<i class="fa fa-arrows-v"></i> Flip V').css({ flex: "1" })
            .on("click", function () { toggleFlipForSelection("v"); }).appendTo(flipRow);
        return;
    }
    var comp = state.selectedIds.length === 1 ? findComponent(state.selectedIds[0]) : null;
    if (!comp) {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("Select a component on the canvas to edit its properties.").appendTo(state.propertiesPane);
        return;
    }
    var isTemplateInstance = comp.type === "@template";
    var isLitComponent = comp.type === "@lit-component";
    var typeDef = (isTemplateInstance || isLitComponent) ? null : window.NEXA.getComponent(comp.type);
    if (!isTemplateInstance && !isLitComponent && !typeDef) {
        window.$("<div>").css({ color: "#a00", "font-size": "12px" }).text("Unknown component type: " + comp.type).appendTo(state.propertiesPane);
        return;
    }
    var templateRef = isTemplateInstance ? findTemplate(comp.templateId) : null;

    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", "margin-bottom": "8px" })
        .text(isTemplateInstance ? ("Template instance: " + (templateRef ? templateRef.name : "(missing)")) : isLitComponent ? "Lit Component" : (typeDef.label || comp.type))
        .appendTo(state.propertiesPane);

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

    var defaults = (typeDef && typeDef.defaults) || {};
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

    // One field per param this instance's template declares — like a
    // Subflow instance's own env-var dialog: sets this ONE instance's
    // static/default value (comp.paramValues[name]), separate from any live
    // override a "set-template-param" Logic node applies at runtime. A full
    // re-render is the simplest correct way to make {name} interpolation
    // reactive to this edit (design-time, low-frequency — not worth a more
    // surgical update path).
    if (isTemplateInstance && templateRef) {
        if ((templateRef.params || []).length) {
            window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", margin: "14px 0 8px", "border-top": "1px solid #ddd", "padding-top": "10px" }).text("Parameters").appendTo(state.propertiesPane);
        }
        (templateRef.params || []).forEach(function (param) {
            var row = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.propertiesPane);
            window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text(param.label + " {" + param.name + "}").appendTo(row);
            var current = (comp.paramValues && comp.paramValues[param.name] !== undefined) ? comp.paramValues[param.name] : param.defaultValue;
            buildTypedInputWidget(row, param.type, current, function (v) {
                comp.paramValues = comp.paramValues || {};
                comp.paramValues[param.name] = v;
                markDirty();
                renderActiveScreen();
                selectOnly(comp.id);
            });
        });
    }

    // "@lit-component": code lives on the instance itself, authored here.
    // Bindable Properties doubles as the Lit `static properties` declaration
    // (see compileLitComponentClass) AND the ui-update/Properties default
    // value targets — one list, same role `typeDef.defaults` plays for a
    // registered component. Events just needs names so palette-events-panel
    // can offer "on <name>" chips for whatever this.emit(name, payload) call
    // the user's own code makes.
    if (isLitComponent) {
        window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", margin: "14px 0 8px", "border-top": "1px solid #ddd", "padding-top": "10px" }).text("Lit Code").appendTo(state.propertiesPane);

        // Read-only PREVIEW fields only — just enough to see at a glance
        // that code exists (and roughly how much). The actual editing
        // happens in a modal dialog (openLitComponentCodeEditor), exactly
        // like the Function Logic node's own code editor — NOT inline here.
        // An earlier version embedded live ace/monaco editors directly in
        // this panel; that broke badly because this panel fully rebuilds
        // (destroy + recreate everything) on almost any interaction
        // elsewhere in it (editing a Bindable Property row, adding one,
        // etc.), which silently discarded anything typed but not yet
        // explicitly "applied" — a real bug, not just an inconvenience. A
        // modal dialog is immune to that: it owns the editor exclusively
        // while open, and nothing outside it can tear it down mid-edit.
        function previewText(code, emptyLabel) {
            if (!code) return emptyLabel;
            var firstLine = code.split("\n")[0];
            return (firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine) +
                " (" + code.length + " chars)";
        }
        var jsPreviewRow = window.$("<div>").css({ "margin-bottom": "6px" }).appendTo(state.propertiesPane);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text("Class body").appendTo(jsPreviewRow);
        window.$("<input>", { type: "text", readonly: "readonly" })
            .css({ width: "100%", "box-sizing": "border-box", color: "#888", background: "#f7f7f7" })
            .val(previewText(comp.litCode, "(empty — click Edit Code to write render())"))
            .appendTo(jsPreviewRow);

        var cssPreviewRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.propertiesPane);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text("CSS").appendTo(cssPreviewRow);
        window.$("<input>", { type: "text", readonly: "readonly" })
            .css({ width: "100%", "box-sizing": "border-box", color: "#888", background: "#f7f7f7" })
            .val(previewText(comp.litStyles, "(empty)"))
            .appendTo(cssPreviewRow);

        window.$("<button>", { type: "button" }).text("Edit Code...").css({ width: "100%", "margin-bottom": "12px" }).on("click", function () {
            openLitComponentCodeEditor(comp);
        }).appendTo(state.propertiesPane);

        window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", margin: "10px 0 8px" }).text("Bindable Properties").appendTo(state.propertiesPane);
        comp.litBindable = comp.litBindable || [];
        comp.litBindable.forEach(function (p, idx) {
            var row = window.$("<div>").css({ display: "flex", gap: "6px", "margin-bottom": "6px", "align-items": "center" }).appendTo(state.propertiesPane);
            var nameInput = window.$("<input>", { type: "text", placeholder: "name" })
                .css({ width: "90px", "flex-shrink": "0", "box-sizing": "border-box" })
                .val(p.name)
                .appendTo(row);
            nameInput.on("change", function () {
                p.name = nameInput.val().trim();
                markDirty();
                refreshComponentRender(comp);
            });

            var valWrap = window.$("<div>").css({ flex: "1", "min-width": "0" }).appendTo(row);
            buildTypedInputWidget(valWrap, p.type || "string", p.defaultValue, function (parsedVal, detType) {
                p.defaultValue = parsedVal;
                p.type = detType;
                if (comp.props && comp.props[p.name] === undefined) comp.props[p.name] = parsedVal;
                markDirty();
                refreshComponentRender(comp);
            });

            window.$("<button>", { type: "button", title: "Delete property" }).text("×").css({ width: "22px", "flex-shrink": "0" }).on("click", function () {
                comp.litBindable.splice(idx, 1);
                markDirty();
                renderPropertiesPanel();
                refreshComponentRender(comp);
            }).appendTo(row);
        });
        window.$("<button>", { type: "button" }).text("+ Add Bindable Property").css({ width: "100%", "margin-bottom": "10px" }).on("click", function () {
            comp.litBindable.push({ name: "prop" + (comp.litBindable.length + 1), type: "string", defaultValue: "" });
            markDirty();
            renderPropertiesPanel();
        }).appendTo(state.propertiesPane);



        window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", margin: "10px 0 8px" }).text("Events").appendTo(state.propertiesPane);
        comp.litEvents = comp.litEvents || [];
        comp.litEvents.forEach(function (evt, idx) {
            var row = window.$("<div>").css({ display: "flex", gap: "4px", "margin-bottom": "4px" }).appendTo(state.propertiesPane);
            var nameInput = window.$("<input>", { type: "text", placeholder: "event name" }).css({ flex: "1" }).val(evt.name).appendTo(row);
            nameInput.on("change", function () { evt.name = nameInput.val(); markDirty(); });
            window.$("<button>", { type: "button" }).text("×").css({ width: "20px" }).on("click", function () {
                comp.litEvents.splice(idx, 1);
                markDirty();
                renderPropertiesPanel();
            }).appendTo(row);
        });
        window.$("<button>", { type: "button" }).text("+ Add Event").css({ width: "100%", "margin-bottom": "10px" }).on("click", function () {
            comp.litEvents.push({ name: "myEvent" + (comp.litEvents.length + 1) });
            markDirty();
            renderPropertiesPanel();
        }).appendTo(state.propertiesPane);
    }

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

    var caps = (typeDef && typeDef.capabilities) || {};
    if (caps.flippable !== false) {
        var flipRow = window.$("<div>").css({ display: "flex", gap: "6px", "margin-top": "6px", "margin-bottom": "8px" }).appendTo(state.propertiesPane);
        window.$("<button>", { type: "button", title: "Flip Horizontal (Shift+H)" })
            .css({
                flex: "1", padding: "5px 8px", "font-size": "11px", cursor: comp.locked ? "default" : "pointer",
                background: comp.flipH ? "var(--red-ui-secondary-background-selected, #cfe0ff)" : "",
                border: comp.flipH ? "1px solid #2196f3" : "1px solid #ccc",
                "font-weight": comp.flipH ? "bold" : "normal"
            })
            .html('<i class="fa fa-arrows-h"></i> Flip H')
            .prop("disabled", comp.locked)
            .on("click", function () { toggleFlipForSelection("h"); })
            .appendTo(flipRow);

        window.$("<button>", { type: "button", title: "Flip Vertical (Shift+V)" })
            .css({
                flex: "1", padding: "5px 8px", "font-size": "11px", cursor: comp.locked ? "default" : "pointer",
                background: comp.flipV ? "var(--red-ui-secondary-background-selected, #cfe0ff)" : "",
                border: comp.flipV ? "1px solid #2196f3" : "1px solid #ccc",
                "font-weight": comp.flipV ? "bold" : "normal"
            })
            .html('<i class="fa fa-arrows-v"></i> Flip V')
            .prop("disabled", comp.locked)
            .on("click", function () { toggleFlipForSelection("v"); })
            .appendTo(flipRow);
    }
}
