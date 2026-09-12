// --- Reusable Screen Templates: the "Templates" sidebar tab -------------
// A Template is data-shape-identical to a Screen (see makeTemplate() in
// state.js) plus a declared `params` list — named, typed values an instance
// of it exposes outward, modeled directly on Node-RED's own Subflow
// env-vars + Input port (see logic-nodes.js's "param-input"/
// "set-template-param" node kinds and component-renderer.js's {name}
// interpolation for how a param's value actually reaches things). Editing a
// template reuses the exact same tray canvas used for screens (see
// getActiveScreen()'s editingMode branch in state.js) rather than a second,
// parallel canvas implementation.
import { state, genId, markDirty, findTemplate, makeTemplate } from "../state.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { refreshLogicCanvasIfActive } from "./screens-panel.js";
import { buildPalette } from "./palette-events-panel.js";
import { PARAM_TYPES, normalizeParamType, defaultValueForType, buildParamValueInput } from "../param-types.js";

function refreshComponentsPaletteIfVisible() {
    // The Components palette filters out templates that would close a cycle
    // with whichever template is currently being edited (see buildPalette()),
    // so entering/leaving template-editing mode can change what it should
    // show — refresh it in place rather than leaving it stale until the user
    // happens to switch away and back to that tab.
    if (state.componentsPane && state.componentsPane.is(":visible")) {
        buildPalette(state.componentsPane);
    }
}

var editBarEl = null;

function templateUsageCount(id) {
    var count = 0;
    function scan(list) {
        (list || []).forEach(function (surface) {
            (surface.components || []).forEach(function (c) {
                if (c.type === "@template" && c.templateId === id) count++;
            });
        });
    }
    scan(state.screens);
    scan(state.templates);
    return count;
}

export function renderTemplateList() {
    if (!state.templateListEl) return;
    state.templateListEl.empty();
    state.templates.forEach(function (t) {
        var isActive = state.editingMode === "template" && state.activeTemplateId === t.id;
        var row = window.$("<div>", { "class": "nexa-template-row" }).css({
            padding: "6px 8px", "border-radius": "3px", "margin-bottom": "4px",
            display: "flex", "justify-content": "space-between", "align-items": "center",
            background: isActive ? "#d0e2ff" : "#f5f5f5"
        }).appendTo(state.templateListEl);

        window.$("<span>").text(t.name).css({ flex: "1", cursor: "pointer" })
            .on("click", function () { editTemplate(t.id); }).appendTo(row);

        window.$("<a>", { href: "#", title: "Edit" }).html('<i class="fa fa-pencil"></i>').css({ color: "#555", "margin-right": "6px" })
            .on("click", function (e) { e.preventDefault(); editTemplate(t.id); }).appendTo(row);

        window.$("<a>", { href: "#", title: "Delete" }).html('<i class="fa fa-trash"></i>').css({ color: "#999" })
            .on("click", function (e) {
                e.preventDefault();
                var usages = templateUsageCount(t.id);
                if (usages > 0) {
                    if (window.RED && window.RED.notify) {
                        window.RED.notify("This template is used by " + usages + " instance(s) — remove them first.", { type: "warning", timeout: 3000 });
                    }
                    return;
                }
                state.templates = state.templates.filter(function (x) { return x.id !== t.id; });
                if (state.activeTemplateId === t.id) exitTemplateEditing();
                markDirty();
                renderTemplateList();
            }).appendTo(row);
    });
    if (!state.templates.length) {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("No templates yet.").appendTo(state.templateListEl);
    }
}

export function addTemplateFromSidebar() {
    var template = makeTemplate({});
    state.templates.push(template);
    markDirty();
    renderTemplateList();
    editTemplate(template.id);
}

export function editTemplate(id) {
    state.editingMode = "template";
    state.activeTemplateId = id;
    state.selectedIds = [];
    state.logicSelectedIds = [];
    renderTemplateList();
    renderTemplateForm();
    refreshComponentsPaletteIfVisible();
    if (state.trayContent) {
        renderActiveScreen();
        refreshLogicCanvasIfActive();
        showEditBar();
    } else if (window.RED && window.RED.actions) {
        window.RED.actions.invoke("nexa:open-pages-editor");
    }
}

export function exitTemplateEditing() {
    state.editingMode = "screen";
    state.activeTemplateId = null;
    state.selectedIds = [];
    state.logicSelectedIds = [];
    renderTemplateList();
    renderTemplateForm();
    refreshComponentsPaletteIfVisible();
    if (state.trayContent) {
        renderActiveScreen();
        refreshLogicCanvasIfActive();
        hideEditBar();
    }
}

function showEditBar() {
    if (!state.trayContent) return;
    var template = findTemplate(state.activeTemplateId);
    // The tray body is torn down and rebuilt fresh every time the tray opens
    // (see editor-tray.js's open handler), so a bar reference surviving a
    // previous close would be detached — recreate whenever that's the case.
    if (!editBarEl || !editBarEl.parent().length) {
        editBarEl = window.$("<div>", { "class": "nexa-template-edit-bar" }).css({
            flex: "0 0 auto", padding: "6px 12px", background: "#fff3e0",
            "border-bottom": "1px solid #ffcc80", "font-size": "12px",
            display: "flex", "align-items": "center", gap: "8px"
        }).prependTo(state.trayContent);
        window.$("<span>", { "class": "nexa-template-edit-label" }).appendTo(editBarEl);
        window.$("<a>", { href: "#" }).text("← Back to Screens").css({ "margin-left": "auto" })
            .on("click", function (e) { e.preventDefault(); exitTemplateEditing(); }).appendTo(editBarEl);
    }
    editBarEl.find(".nexa-template-edit-label").text("Editing Template: " + (template ? template.name : "?"));
    editBarEl.show();
}

function hideEditBar() {
    if (editBarEl) editBarEl.hide();
}

// Settings form — deliberately mirrors screens-panel.js's renderScreenForm()
// field-for-field, swapping the routing-specific "URL path" for a plain
// "Identifier" reference field (see makeTemplate()'s comment: it's not a
// routing key and not the internal join key, just a readable label the user
// controls). Width/Height are real, editable fields here — a template's
// canvas can be resized after creation, unlike before.
export function renderTemplateForm() {
    if (!state.templateFormEl) return;
    state.templateFormEl.empty();
    if (state.editingMode !== "template") return;
    var template = findTemplate(state.activeTemplateId);
    if (!template) return;

    function row(label, field, value, type) {
        var r = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.templateFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text(label).appendTo(r);
        var input = window.$("<input>", { type: type || "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(value).appendTo(r);
        input.on("change", function () {
            var v = type === "number" ? (parseInt(input.val(), 10) || 0) : input.val();
            template[field] = v;
            if (field === "name") renderTemplateList();
            markDirty();
            renderActiveScreen();
        });
        return input;
    }

    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", "margin-bottom": "8px" }).text("Template Settings").appendTo(state.templateFormEl);
    row("Name", "name", template.name);
    row("Identifier", "identifier", template.identifier);
    row("Width (px)", "width", template.width, "number");
    row("Height (px)", "height", template.height, "number");
    row("Grid size (px)", "gridSize", template.gridSize, "number");

    var snapRow = window.$("<div>").appendTo(state.templateFormEl);
    var snapInput = window.$("<input>", { type: "checkbox" }).prop("checked", template.snap).css({ "margin-right": "6px" });
    snapInput.on("change", function () {
        template.snap = snapInput.is(":checked");
        markDirty();
    });
    window.$("<label>").css({ "font-size": "11px", color: "#888" }).append(snapInput).append("Snap to grid").appendTo(snapRow);

    renderTemplateParamsSection();
}

function renderTemplateParamsSection() {
    state.templateFormEl.find(".nexa-template-params-section").remove();
    var template = findTemplate(state.activeTemplateId);
    if (!template) return;

    var section = window.$("<div>", { "class": "nexa-template-params-section" }).css({
        "margin-top": "14px", "border-top": "1px solid #ddd", "padding-top": "10px"
    }).appendTo(state.templateFormEl);

    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", "margin-bottom": "4px" }).text("Parameters").appendTo(section);
    window.$("<div>").css({ color: "#888", "font-size": "11px", "margin-bottom": "6px" })
        .text("Declared like a Subflow's env vars. Reference one anywhere in this template's component props as {" + "name" + "}, or wire from the \"On Params Change\" node on this template's own Logic canvas.")
        .appendTo(section);

    var listEl = window.$("<div>").appendTo(section);
    (template.params || []).forEach(function (p) {
        var row = window.$("<div>").css({
            display: "flex", "justify-content": "space-between", "align-items": "center",
            padding: "4px 6px", background: "#f5f5f5", "border-radius": "3px", "margin-bottom": "4px", "font-size": "12px"
        }).appendTo(listEl);
        window.$("<span>").text("{" + p.name + "} — " + p.label + " (" + normalizeParamType(p.type) + ")").appendTo(row);
        window.$("<a>", { href: "#" }).html('<i class="fa fa-trash"></i>').css({ color: "#999" })
            .on("click", function (e) {
                e.preventDefault();
                template.params = template.params.filter(function (x) { return x.id !== p.id; });
                markDirty();
                renderTemplateParamsSection();
            }).appendTo(row);
    });
    if (!template.params.length) {
        window.$("<div>").css({ color: "#999", "font-size": "12px", "margin-bottom": "6px" }).text("No parameters declared yet.").appendTo(listEl);
    }

    var addRow = window.$("<div>").css({ display: "flex", gap: "4px", "margin-top": "6px", "flex-wrap": "wrap" }).appendTo(section);
    var nameInput = window.$("<input>", { type: "text", placeholder: "name, e.g. value" }).css({ flex: "1 1 40%", "box-sizing": "border-box" }).appendTo(addRow);
    var labelInput = window.$("<input>", { type: "text", placeholder: "label, e.g. Value" }).css({ flex: "1 1 40%", "box-sizing": "border-box" }).appendTo(addRow);
    var typeSelect = window.$("<select>").css({ flex: "1 1 100%" }).appendTo(addRow);
    PARAM_TYPES.forEach(function (t) { window.$("<option>", { value: t }).text(t).appendTo(typeSelect); });
    var defaultWrap = window.$("<div>").css({ flex: "1 1 100%" }).appendTo(addRow);
    var pendingDefault;

    // object/array need a JSON textarea, boolean a checkbox, color a color
    // picker — buildParamValueInput() (param-types.js) picks the right one
    // for whatever type is currently selected, shared with the Properties
    // panel's per-instance fields so both stay in sync as types are added.
    function rebuildDefaultWidget() {
        defaultWrap.empty();
        window.$("<label>").css({ display: "block", "font-size": "10px", color: "#888", "margin-bottom": "2px" }).text("Default value").appendTo(defaultWrap);
        pendingDefault = defaultValueForType(typeSelect.val());
        // allowBinding:false — a template's own DECLARED default is a
        // literal fallback; binding to "a parent scope" doesn't mean
        // anything at declaration time (there's no instance/parent yet).
        buildParamValueInput(defaultWrap, typeSelect.val(), pendingDefault, function (v) { pendingDefault = v; }, false);
    }
    typeSelect.on("change", rebuildDefaultWidget);
    rebuildDefaultWidget();

    window.$("<button>", { type: "button" }).text("+ Add Parameter").css({ flex: "1 1 100%" }).on("click", function () {
        var name = (nameInput.val() || "").trim();
        if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            if (window.RED && window.RED.notify) window.RED.notify("Parameter name must look like a plain identifier (letters, numbers, _), e.g. \"value\"", { type: "warning", timeout: 3000 });
            return;
        }
        if ((template.params || []).some(function (p) { return p.name === name; })) {
            if (window.RED && window.RED.notify) window.RED.notify("A parameter named \"" + name + "\" already exists on this template", { type: "warning", timeout: 3000 });
            return;
        }
        template.params.push({ id: genId(), name: name, label: labelInput.val() || name, type: typeSelect.val(), defaultValue: pendingDefault });
        markDirty();
        renderTemplateParamsSection(); // rebuilds this whole section fresh, including a blank add-row
    }).appendTo(addRow);
}
