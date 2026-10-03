// --- Reusable Screen Templates: the "Templates" sidebar tab -------------
import { state, genId, markDirty, findTemplate, makeTemplate, Tree, Layout } from "../state.js";
import { pushTreeChange, treeSnapshot } from "../history.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { refreshLogicCanvasIfActive, renderScreenList, renderScreenForm } from "./screens-panel.js";
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
            Tree.allNodes(surface, { orphans: true }).forEach(function (c) {
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
        display: "none",
        "flex-direction": "column",
        gap: "6px",
        "box-sizing": "border-box"
    });

    state.templates.forEach(function (t) {
        var isActive = state.editingMode === "template" && state.activeTemplateId === t.id;
        var usages = templateUsageCount(t.id);

        var row = window.$("<div>", { "class": "nexa-template-row" }).css({
            padding: "8px 10px",
            "border-radius": "5px",
            display: "flex",
            "flex-wrap": "wrap",
            "align-items": "center",
            cursor: "pointer",
            background: isActive ? "var(--red-ui-list-item-selected-background, #e0f2fe)" : "var(--red-ui-secondary-background, #ffffff)",
            border: isActive ? "1px solid #7dd3fc" : "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
            "box-shadow": isActive ? "0 1px 3px rgba(2,132,199,0.12)" : "0 1px 2px rgba(0,0,0,0.02)",
            "font-size": "12px",
            "user-select": "none",
            gap: "4px",
            transition: "all 0.15s ease"
        }).appendTo(state.templateListEl);

        // --- ROW 1: Icon + Template Name + Identifier ---
        // Icon
        window.$("<i>", { class: t.kind === "component" ? "fa fa-puzzle-piece" : "fa fa-clone", style: (t.kind === "component" ? "color: #10b981;" : "color: #f59e0b;") + " font-size: 11px; margin-right: 4px; flex: 0 0 auto;" }).appendTo(row);

        // Name
        window.$("<span>", {
            style: "flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red-ui-primary-text-color, #222); font-weight: 600; cursor: pointer;"
        }).text(t.name).on("click", function () { editTemplate(t.id); }).appendTo(row);

        // Identifier badge
        if (t.identifier) {
            window.$("<span>", {
                style: "font-size: 10px; color: #64748b; background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; flex: 0 0 auto;"
            }).text("{" + t.identifier + "}").appendTo(row);
        }

        // --- ROW 2: Uses count ---
        window.$("<div>", {
            style: "width: 100%; flex: 0 0 100%; font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 4px; padding: 2px 0;"
        }).html('<i class="fa fa-cubes" style="font-size: 10px; color: #94a3b8;"></i> <span>' + usages + " " + (usages === 1 ? "usage" : "usages") + '</span>').appendTo(row);

        // --- ROW 3: Actions (Edit | Delete) ---
        // Edit button
        window.$("<a>", {
            href: "#",
            title: "Edit",
            class: "red-ui-button red-ui-button-small",
            style: "flex: 1 1 auto; height: 22px; line-height: 20px; font-size: 11px; color: #334155; display: inline-flex; align-items: center; justify-content: center; gap: 4px;"
        }).html('<i class="fa fa-pencil"></i> Edit')
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
            style: "flex: 0 0 auto; height: 22px; line-height: 20px; padding: 0 8px; font-size: 11px; color: #ef4444; display: inline-flex; align-items: center; justify-content: center;"
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
    if (typeof renderScreenList === "function") renderScreenList();
    if (typeof renderScreenForm === "function") renderScreenForm();
    refreshComponentsPaletteIfVisible();
    if (state.trayContent) {
        renderActiveScreen();
        refreshLogicCanvasIfActive();
        hideEditBar();
    }
}

export function showEditBar() {
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
    var isComp = template && template.kind === "component";
    editBarEl.css({
        background: isComp ? "#f0fdf4" : "#fff3e0",
        "border-bottom": isComp ? "1px solid #bbf7d0" : "1px solid #ffcc80"
    });
    var labelHtml = isComp
        ? '<i class="fa fa-puzzle-piece" style="color: #16a34a; margin-right: 5px;"></i><strong>Editing Component Template (Preview Stage):</strong> ' + (template ? template.name : "?")
        : '<i class="fa fa-clone" style="color: #f59e0b; margin-right: 5px;"></i><strong>Editing Template:</strong> ' + (template ? template.name : "?");
    editBarEl.find(".nexa-template-edit-label").html(labelHtml);
    editBarEl.show();
}

export function hideEditBar() {
    if (editBarEl) editBarEl.hide();
}

export function renderTemplateForm(targetEl) {
    var formEl = targetEl || state.templateFormEl;
    if (!formEl) return;
    formEl.empty();
    if (state.editingMode !== "template") {
        window.$("<div>", { style: "text-align: center; color: var(--red-ui-secondary-text-color, #94a3b8); padding: 32px 16px; font-size: 12px;" })
            .html('<i class="fa fa-clone" style="font-size: 24px; color: #cbd5e1; display: block; margin-bottom: 8px;"></i>Select or add a template on the left to edit its properties.')
            .appendTo(formEl);
        return;
    }
    var template = findTemplate(state.activeTemplateId);
    if (!template) return;

    var isComp = template.kind === "component";
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
    }).html(isComp
        ? '<i class="fa fa-puzzle-piece" style="color: #10b981;"></i> Component Template Properties'
        : '<i class="fa fa-sliders" style="color: #f59e0b;"></i> Template Properties'
    ).appendTo(formEl);

    if (isComp) {
        window.$("<div>").css({
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            "border-radius": "6px",
            padding: "8px 12px",
            "margin-bottom": "12px",
            "font-size": "11px",
            color: "#166534",
            "line-height": "1.4"
        }).html('<strong><i class="fa fa-info-circle"></i> Component Template</strong><br>This canvas is an isolated preview stage for a single component. When populated or rendered into a container, only the single component inside is rendered directly without extra canvas wrapper frames.').appendTo(formEl);
    }

    // Template Kind Selector
    var kindRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(formEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text("Template Type").appendTo(kindRow);
    var kindSelect = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" }).appendTo(kindRow);
    window.$("<option>", { value: "composite" }).text("Composite Template (Full layout)").appendTo(kindSelect);
    window.$("<option>", { value: "component" }).text("Component Template (Single component preview)").appendTo(kindSelect);
    kindSelect.val(template.kind || "composite");
    kindSelect.on("change", function () {
        template.kind = kindSelect.val();
        markDirty();
        renderTemplateList();
        if (typeof window.__refreshScreensFlowsTree === "function") window.__refreshScreensFlowsTree();
        renderTemplateForm(targetEl);
        showEditBar();
    });

    function row(label, field, value, type) {
        var r = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(formEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text(label).appendTo(r);
        var input = window.$("<input>", { type: type || "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(value).appendTo(r);
        input.on("change", function () {
            var v = type === "number" ? (parseInt(input.val(), 10) || 0) : input.val();
            template[field] = v;
            if (field === "name") {
                renderTemplateList();
                if (typeof window.__refreshScreensFlowsTree === "function") window.__refreshScreensFlowsTree();
            }
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

    var snapRow = window.$("<div>").css({ "margin-top": "6px", "margin-bottom": "12px" }).appendTo(formEl);
    var snapInput = window.$("<input>", { type: "checkbox" }).prop("checked", template.snap !== false).css({ "margin-right": "6px" });
    snapInput.on("change", function () {
        template.snap = snapInput.is(":checked");
        markDirty();
    });
    window.$("<label>").css({ "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer", display: "flex", "align-items": "center" }).append(snapInput).append("Snap to grid").appendTo(snapRow);

    renderTemplateLiveSection(template, formEl);
}

// On the live page: how big this template is where it is used (a list row, a grid cell, a
// carousel slide, a Populate's copies) — per axis its design size, or filling what its host
// gives it (then what is inside follows its constraints, like a screen in Fill mode).
function renderTemplateLiveSection(template, formEl) {
    var $ = window.$;
    formEl = formEl || state.templateFormEl;
    if (!formEl) return;
    var live = Object.assign({ w: "fixed", h: "fixed", minW: "", maxW: "", minH: "", maxH: "", content: "constraints" }, template.live || {});
    var box = $("<div>", { "class": "nexa-template-live" }).css({ "margin": "4px 0 14px", padding: "10px", border: "1px solid var(--red-ui-secondary-border-color, #e2e8f0)", "border-radius": "6px" }).appendTo(formEl);
    $("<div>").css({ "font-size": "11px", "font-weight": "700", "text-transform": "uppercase", color: "var(--red-ui-secondary-text-color, #64748b)", "margin-bottom": "6px" }).text("On the live page").appendTo(box);
    $("<div>").css({ "font-size": "11px", color: "#888", "margin-bottom": "8px", "line-height": "1.45" })
        .html("<b>Fixed</b>: its design size. <b>Fill</b>: the space its host gives it (a list row, a grid cell, a slide). The host places it: alignment, padding, gap. An instance placed on a screen is also a box you can resize.").appendTo(box);
    function save() {
        var out = {};
        Object.keys(live).forEach(function (k) { if (live[k] !== "" && live[k] !== "fixed" && !(k === "content" && live[k] === "constraints")) out[k] = live[k]; });
        if (Object.keys(out).length) template.live = out; else delete template.live;
        markDirty();
        renderActiveScreen();
    }
    var grid = $("<div>").css({ display: "grid", "grid-template-columns": "1fr 1fr", gap: "8px" }).appendTo(box);
    function sizing(axis, label) {
        var cell = $("<div>").appendTo(grid);
        $("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px" }).text(label).appendTo(cell);
        var sel = $("<select>").css({ width: "100%" }).appendTo(cell);
        [["fixed", "Fixed"], ["fill", "Fill"]].forEach(function (o) { $("<option>", { value: o[0] }).text(o[1]).appendTo(sel); });
        sel.val(live[axis]).on("change", function () { live[axis] = sel.val(); save(); });
    }
    sizing("w", "Width");
    sizing("h", "Height");
    function limit(key, label) {
        var cell = $("<div>").appendTo(grid);
        $("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px" }).text(label).appendTo(cell);
        var input = $("<input>", { type: "number", min: 0, placeholder: "none" }).css({ width: "100%", "box-sizing": "border-box" }).val(live[key]).appendTo(cell);
        input.on("change", function () { var v = input.val().trim(); live[key] = v === "" ? "" : Math.max(0, Number(v) || 0); save(); });
    }
    limit("minW", "Min width (px)");
    limit("maxW", "Max width (px)");
    limit("minH", "Min height (px)");
    limit("maxH", "Max height (px)");

    // what its content does in a box of another size (filling, or a resized instance)
    var content = $("<div>").css({ "margin-top": "10px" }).appendTo(box);
    $("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px" }).text("When its box is another size").appendTo(content);
    var csel = $("<select>", { "class": "nexa-template-content" }).css({ width: "100%" }).appendTo(content);
    [["constraints", "Follow constraints (like a frame)"], ["scale", "Scale to fit (keep proportions)"], ["stretch", "Stretch (distorts)"]]
        .forEach(function (o) { $("<option>", { value: o[0] }).text(o[1]).appendTo(csel); });
    csel.val(live.content);
    var chelp = $("<div>").css({ "font-size": "11px", color: "#888", "margin-top": "4px", "line-height": "1.45" }).appendTo(content);
    function contentHelp() {
        chelp.html(live.content === "scale" ? "The whole design gets bigger or smaller, centred in the box — like an image: nothing moves, text scales too."
            : live.content === "stretch" ? "Scaled to the box on each axis: text and shapes are squeezed. Rarely what you want."
            : "Each element follows its <b>constraints</b> (select it inside the template): Left &amp; Right stretches with the width, Right stays at the right edge, Scale keeps its share. An auto layout frame as the background fills and lays out its content.");
    }
    contentHelp();
    csel.on("change", function () { live.content = csel.val(); contentHelp(); auto.toggle(live.content === "constraints"); save(); });
    var auto = $("<button>", { type: "button", "class": "red-ui-button red-ui-button-small nexa-template-autoconstraints", title: "Sets each element's constraints from where it sits: wide ones Left & Right, the ones near the right edge Right, centred ones Center… A start: adjust them after." })
        .css({ "margin-top": "6px" }).html('<i class="fa fa-magic"></i> Auto constraints').appendTo(content).toggle(live.content === "constraints")
        .on("click", function () {
            if (!window.confirm("Set the constraints of every element of " + (template.name || "this template") + " from where it sits? (Undo with Ctrl+Z.)")) return;
            var before = treeSnapshot(template);
            var count = autoConstrain(template.components, { w: template.width, h: template.height });
            pushTreeChange(template, before);
            markDirty();
            renderActiveScreen();
            window.RED.notify(count + " element(s) of " + (template.name || "the template") + " follow their place now. Select one to see / change its constraints.", { type: "success", timeout: 3000 });
        });
    if (!state.screensFlowsTreeEl) renderTemplateParamsSection(formEl);
}

// Constraints from where each node sits (Layout.guessConstraints), into frames that do
// not lay out their children themselves; returns how many were set.
function autoConstrain(nodes, size) {
    var count = 0;
    (nodes || []).forEach(function (n) {
        var c = Layout.guessConstraints(n, size.w, size.h);
        if (c.h === "left" && c.v === "top") delete n.constraints; else n.constraints = c;
        count++;
        if (n.type === "@frame" && !Layout.hasAutoLayout(n) && n.children && n.children.length) count += autoConstrain(n.children, { w: n.w, h: n.h });
    });
    return count;
}

function renderTemplateParamsSection(formEl) {
    formEl = formEl || state.templateFormEl;
    if (!formEl) return;
    formEl.find(".nexa-template-params-section").remove();
    var template = findTemplate(state.activeTemplateId);
    if (!template) return;

    var section = window.$("<div>", { "class": "nexa-template-params-section" }).css({
        "margin-top": "14px", "border-top": "1px solid var(--red-ui-secondary-border-color, #eee)", "padding-top": "10px"
    }).appendTo(formEl);

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
