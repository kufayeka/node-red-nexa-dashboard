// --- Reusable Screen Templates: the "Templates" sidebar tab -------------
import { state, genId, markDirty, findTemplate, makeTemplate } from "../state.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { refreshLogicCanvasIfActive } from "./screens-panel.js";
import { buildPalette } from "./palette-events-panel.js";
import { normalizeParamType, buildTypedInputWidget, buildEditableListWidget } from "../param-types.js";

function refreshComponentsPaletteIfVisible() {
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

    state.templateListEl.css({
        width: "100%",
        display: "flex",
        "flex-direction": "column",
        gap: "3px",
        "box-sizing": "border-box"
    });

    state.templates.forEach(function (t) {
        var isActive = state.editingMode === "template" && state.activeTemplateId === t.id;
        var usages = templateUsageCount(t.id);

        var row = window.$("<div>", { "class": "nexa-template-row" }).css({
            padding: "5px 8px",
            "border-radius": "4px",
            display: "flex",
            "align-items": "center",
            cursor: "pointer",
            background: isActive ? "var(--red-ui-list-item-selected-background, #e0f2fe)" : "var(--red-ui-secondary-background, #ffffff)",
            border: isActive ? "1px solid #7dd3fc" : "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
            "box-shadow": isActive ? "0 1px 2px rgba(2,132,199,0.08)" : "none",
            "font-size": "12px",
            "user-select": "none",
            transition: "all 0.15s ease"
        }).appendTo(state.templateListEl);

        // Icon
        window.$("<i>", { class: "fa fa-clone", style: "color: #f59e0b; font-size: 11px; margin-right: 6px; flex: 0 0 auto;" }).appendTo(row);

        // Name
        window.$("<span>", {
            style: "flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red-ui-primary-text-color, #222); font-weight: 600; cursor: pointer;"
        }).text(t.name).on("click", function () { editTemplate(t.id); }).appendTo(row);

        // Identifier badge
        if (t.identifier) {
            window.$("<span>", {
                style: "font-size: 10px; color: #64748b; background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; margin-right: 4px; flex: 0 0 auto;"
            }).text("{" + t.identifier + "}").appendTo(row);
        }

        // Usage count badge
        window.$("<span>", {
            style: "font-size: 10px; color: #888; background: rgba(0,0,0,0.05); padding: 1px 5px; border-radius: 8px; margin-right: 4px; flex: 0 0 auto;"
        }).text(usages + " " + (usages === 1 ? "use" : "uses")).appendTo(row);

        // Edit button
        window.$("<a>", {
            href: "#",
            title: "Edit",
            class: "red-ui-button red-ui-button-small",
            style: "padding: 1px 5px; font-size: 10px; color: #555; margin-right: 4px; flex: 0 0 auto;"
        }).html('<i class="fa fa-pencil"></i>')
            .on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                editTemplate(t.id);
            })
            .appendTo(row);

        // Delete button
        window.$("<a>", {
            href: "#",
            title: "Delete",
            class: "red-ui-button red-ui-button-small",
            style: "padding: 1px 5px; font-size: 10px; color: #d32f2f; flex: 0 0 auto;"
        }).html('<i class="fa fa-trash"></i>')
            .on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                var currentUsages = templateUsageCount(t.id);
                if (currentUsages > 0) {
                    if (window.RED && window.RED.notify) {
                        window.RED.notify("This template is used by " + currentUsages + " instance(s) — remove them first.", { type: "warning", timeout: 3000 });
                    }
                    return;
                }
                state.templates = state.templates.filter(function (x) { return x.id !== t.id; });
                if (state.activeTemplateId === t.id) exitTemplateEditing();
                markDirty();
                renderTemplateList();
            })
            .appendTo(row);

        row.on("click", function () { editTemplate(t.id); });
    });

    if (!state.templates.length) {
        window.$("<div>", { style: "padding: 16px 8px; text-align: center; color: #94a3b8; font-size: 11px;" })
            .text("No templates yet.")
            .appendTo(state.templateListEl);
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

export function renderTemplateForm() {
    if (!state.templateFormEl) return;
    state.templateFormEl.empty();
    if (state.editingMode !== "template") {
        window.$("<div>", { style: "text-align: center; color: var(--red-ui-secondary-text-color, #94a3b8); padding: 32px 16px; font-size: 12px;" })
            .html('<i class="fa fa-clone" style="font-size: 24px; color: #cbd5e1; display: block; margin-bottom: 8px;"></i>Select or add a template on the left to edit its properties.')
            .appendTo(state.templateFormEl);
        return;
    }
    var template = findTemplate(state.activeTemplateId);
    if (!template) return;

    var header = window.$("<div>").css({
        "font-weight": "bold",
        "font-size": "13px",
        "margin-bottom": "14px",
        "padding-bottom": "8px",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
        color: "var(--red-ui-primary-text-color, #1e293b)",
        display: "flex",
        "align-items": "center",
        gap: "6px"
    }).html('<i class="fa fa-sliders" style="color: #f59e0b;"></i> Template Properties').appendTo(state.templateFormEl);

    function row(label, field, value, type) {
        var r = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.templateFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text(label).appendTo(r);
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

    row("Name", "name", template.name);
    row("Identifier", "identifier", template.identifier);
    row("Width (px)", "width", template.width, "number");
    row("Height (px)", "height", template.height, "number");
    row("Grid size (px)", "gridSize", template.gridSize, "number");

    var snapRow = window.$("<div>").css({ "margin-top": "6px", "margin-bottom": "12px" }).appendTo(state.templateFormEl);
    var snapInput = window.$("<input>", { type: "checkbox" }).prop("checked", template.snap !== false).css({ "margin-right": "6px" });
    snapInput.on("change", function () {
        template.snap = snapInput.is(":checked");
        markDirty();
    });
    window.$("<label>").css({ "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer", display: "flex", "align-items": "center" }).append(snapInput).append("Snap to grid").appendTo(snapRow);

    renderTemplateParamsSection();
}

function renderTemplateParamsSection() {
    if (!state.templateFormEl) return;
    state.templateFormEl.find(".nexa-template-params-section").remove();
    var template = findTemplate(state.activeTemplateId);
    if (!template) return;

    var section = window.$("<div>", { "class": "nexa-template-params-section" }).css({
        "margin-top": "14px", "border-top": "1px solid var(--red-ui-secondary-border-color, #eee)", "padding-top": "10px"
    }).appendTo(state.templateFormEl);

    window.$("<label>").css({ "font-weight": "bold", "font-size": "12px", "margin-bottom": "4px", display: "flex", "align-items": "center", gap: "6px", color: "var(--red-ui-primary-text-color, #333)" })
        .html('<i class="fa fa-list" style="color: #2196f3;"></i> Parameters')
        .appendTo(section);

    window.$("<div>").css({ color: "var(--red-ui-secondary-text-color, #888)", "font-size": "11px", "margin-bottom": "8px" })
        .text("Declared like a Subflow's env vars. Reference one anywhere in this template's component props as {name}, or wire from the \"On Params Change\" node on this template's own Logic canvas.")
        .appendTo(section);

    template.params = template.params || [];

    var paramList = buildEditableListWidget(section, {
        minHeight: "260px",
        removable: true,
        sortable: true,
        addItem: function (container, i, opt) {
            var p = opt || {};
            if (!p.id) p.id = genId();
            if (!p.name) p.name = "param" + (template.params.length + 1);
            if (!p.label) p.label = p.name;
            if (p.type === undefined) p.type = "string";
            if (p.defaultValue === undefined) p.defaultValue = "";

            if (template.params.indexOf(p) === -1) {
                template.params.push(p);
                markDirty();
            }

            var row = window.$("<div>").css({ display: "flex", "flex-direction": "column", gap: "6px", padding: "4px 0" }).appendTo(container);

            // Sub-row 1: Name
            var nameRow = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "8px" }).appendTo(row);
            window.$("<span>").css({ width: "50px", "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)" })
                .html('<i class="fa fa-tag"></i> Name')
                .appendTo(nameRow);
            var nameInput = window.$("<input>", { type: "text", "class": "node-input-param-name", placeholder: "e.g. speed" })
                .css({ flex: "1" })
                .val(p.name)
                .appendTo(nameRow);
            nameInput.on("change", function () {
                var newName = nameInput.val().trim();
                p.name = newName;
                markDirty();
            });

            // Sub-row 2: Label
            var labelRow = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "8px" }).appendTo(row);
            window.$("<span>").css({ width: "50px", "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)" })
                .html('<i class="fa fa-font"></i> Label')
                .appendTo(labelRow);
            var labelInput = window.$("<input>", { type: "text", "class": "node-input-param-label", placeholder: "e.g. Motor Speed" })
                .css({ flex: "1" })
                .val(p.label)
                .appendTo(labelRow);
            labelInput.on("change", function () {
                p.label = labelInput.val();
                markDirty();
            });

            // Sub-row 3: Default Value (TypedInput)
            var valRow = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "8px" }).appendTo(row);
            window.$("<span>").css({ width: "50px", "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)" })
                .html('<i class="fa fa-arrow-left"></i> Value')
                .appendTo(valRow);
            var valWrapper = window.$("<div>").css({ flex: "1" }).appendTo(valRow);
            buildTypedInputWidget(valWrapper, p.type || "string", p.defaultValue, function (parsedVal, detType) {
                p.defaultValue = parsedVal;
                p.type = detType;
                markDirty();
            });
        },
        removeItem: function (opt) {
            var idx = template.params.indexOf(opt);
            if (idx !== -1) {
                template.params.splice(idx, 1);
                markDirty();
            }
        }
    });

    template.params.forEach(function (p) {
        paramList.editableList("addItem", p);
    });
}
