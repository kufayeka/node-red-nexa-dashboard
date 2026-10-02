// Screens & Flows tab: the property form of the open screen / template.
import * as BP from "../../model/breakpoints.js";
import { state, getActiveScreen, markDirty, getApp, findTemplate, findFolder, findFlow } from "../../state.js";
import { renderActiveScreen } from "../../canvas/canvas-ui.js";
import { applyConstraints } from "../../canvas/constraints.js";
import { renderTemplateForm } from "../templates-panel.js";
import { renderScreenList } from "../screens-panel.js";
import { renderFlowForm, renderFolderForm, renderTemplateParamPropertiesForm, renderVariablePropertiesForm } from "./item-forms.js";
import { onScreensFlowsAction } from "./tree-actions.js";

export function renderScreenForm() {
    if (!state.screenFormEl) return;
    state.screenFormEl.empty();

    if (state.selectedFolderId) {
        var folder = findFolder(state.selectedFolderId);
        if (folder) {
            renderFolderForm(folder);
            return;
        }
    }

    if (state.editingMode === "app-variable") {
        var app = getApp();
        var appVar = (app.variables || []).find(function (v) { return v.id === state.activeAppVariableId; });
        if (appVar) {
            renderVariablePropertiesForm(appVar, true, null);
            return;
        }
    }

    if (state.editingMode === "shared-variable") {
        var app = getApp();
        var sharedVar = (app.sharedVariables || []).find(function (v) { return v.id === state.activeSharedVariableId; });
        if (sharedVar) {
            renderVariablePropertiesForm(sharedVar, "shared", null);
            return;
        }
    }

    if (state.editingMode === "screen-variable") {
        var sc = state.screens.find(function (s) { return s.id === state.activeScreenId; });
        var scVar = sc && (sc.variables || []).find(function (v) { return v.id === state.activeScreenVariableId; });
        if (scVar) {
            renderVariablePropertiesForm(scVar, false, sc);
            return;
        }
    }

    if (state.editingMode === "template-variable") {
        var tmpl = findTemplate(state.activeTemplateId);
        var tmplVar = tmpl && (tmpl.variables || []).find(function (v) { return v.id === state.activeTemplateVariableId; });
        if (tmplVar) {
            renderVariablePropertiesForm(tmplVar, "template", tmpl);
            return;
        }
    }

    if (state.editingMode === "template-param") {
        var tmpl = findTemplate(state.activeTemplateId);
        var tmplParam = tmpl && (tmpl.params || []).find(function (p) { return p.id === state.activeTemplateParamId; });
        if (tmplParam) {
            renderTemplateParamPropertiesForm(tmplParam, tmpl);
            return;
        }
    }

    if (state.editingMode === "screen-vars-group") {
        var scr = state.screens.find(function (s) { return s.id === state.activeScreenId; });
        window.$("<div>").css({
            "font-weight": "bold", "font-size": "13px", "margin-bottom": "14px", "padding-bottom": "8px",
            "border-bottom": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
            color: "var(--red-ui-primary-text-color, #1e293b)", display: "flex", "align-items": "center", gap: "6px"
        }).html('<i class="fa fa-tags" style="color: #0284c7;"></i> Screen Variables (' + (scr ? scr.name : "Screen") + ')').appendTo(state.screenFormEl);

        window.$("<div>").css({
            "margin-bottom": "14px", padding: "10px 12px", background: "#f0f9ff", border: "1px solid #bae6fd",
            "border-radius": "6px", "font-size": "11px", color: "#0369a1", "line-height": "1.4"
        }).html('<strong>Screen Variables (' + (scr ? scr.name : "Screen") + ')</strong><br>Variables scoped to this screen. Available to all components on this screen. Click <strong>+ Add Variable</strong> to create one.').appendTo(state.screenFormEl);

        window.$("<button>", { type: "button", class: "red-ui-button red-ui-button-small" })
            .css({ display: "inline-flex", "align-items": "center", gap: "4px" })
            .html('<i class="fa fa-plus"></i> Add Variable')
            .on("click", function () {
                if (scr) onScreensFlowsAction({ detail: { id: "screen-vars-group:" + scr.id, action: "add-screen-var" } });
            }).appendTo(state.screenFormEl);
        return;
    }

    if (state.editingMode === "template-vars-group") {
        var tmpl = findTemplate(state.activeTemplateId);
        window.$("<div>").css({
            "font-weight": "bold", "font-size": "13px", "margin-bottom": "14px", "padding-bottom": "8px",
            "border-bottom": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
            color: "var(--red-ui-primary-text-color, #1e293b)", display: "flex", "align-items": "center", gap: "6px"
        }).html('<i class="fa fa-tags" style="color: #0284c7;"></i> Template Variables (' + (tmpl ? tmpl.name : "Template") + ')').appendTo(state.screenFormEl);

        window.$("<div>").css({
            "margin-bottom": "14px", padding: "10px 12px", background: "#f0f9ff", border: "1px solid #bae6fd",
            "border-radius": "6px", "font-size": "11px", color: "#0369a1", "line-height": "1.4"
        }).html('<strong>Template Variables (' + (tmpl ? tmpl.name : "Template") + ')</strong><br>Internal variables scoped to this template. Available to all components inside this template. Click <strong>+ Add Variable</strong> to create one.').appendTo(state.screenFormEl);

        window.$("<button>", { type: "button", class: "red-ui-button red-ui-button-small" })
            .css({ display: "inline-flex", "align-items": "center", gap: "4px" })
            .html('<i class="fa fa-plus"></i> Add Variable')
            .on("click", function () {
                if (tmpl) onScreensFlowsAction({ detail: { id: "template-vars-group:" + tmpl.id, action: "add-template-var" } });
            }).appendTo(state.screenFormEl);
        return;
    }

    if (state.editingMode === "template-params-group") {
        var tmpl = findTemplate(state.activeTemplateId);
        window.$("<div>").css({
            "font-weight": "bold", "font-size": "13px", "margin-bottom": "14px", "padding-bottom": "8px",
            "border-bottom": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
            color: "var(--red-ui-primary-text-color, #1e293b)", display: "flex", "align-items": "center", gap: "6px"
        }).html('<i class="fa fa-sliders" style="color: #6366f1;"></i> Template Parameters (' + (tmpl ? tmpl.name : "Template") + ')').appendTo(state.screenFormEl);

        window.$("<div>").css({
            "margin-bottom": "14px", padding: "10px 12px", background: "#f5f3ff", border: "1px solid #ddd6fe",
            "border-radius": "6px", "font-size": "11px", color: "#5b21b6", "line-height": "1.4"
        }).html('<strong>Template Parameters (' + (tmpl ? tmpl.name : "Template") + ')</strong><br>Parameters exposed outward when this template is used as an instance. Click <strong>+ Add Parameter</strong> to create one.').appendTo(state.screenFormEl);

        window.$("<button>", { type: "button", class: "red-ui-button red-ui-button-small" })
            .css({ display: "inline-flex", "align-items": "center", gap: "4px" })
            .html('<i class="fa fa-plus"></i> Add Parameter')
            .on("click", function () {
                if (tmpl) onScreensFlowsAction({ detail: { id: "template-params-group:" + tmpl.id, action: "add-template-param" } });
            }).appendTo(state.screenFormEl);
        return;
    }

    if (state.editingMode === "flow") {
        var flow = findFlow(state.activeFlowId);
        if (flow) {
            renderFlowForm(flow);
            return;
        }
    }

    if (state.editingMode === "template") {
        renderTemplateForm(state.screenFormEl);
        return;
    }

    var screen = getActiveScreen();
    if (!screen || state.editingMode !== "screen") {
        window.$("<div>", { style: "text-align: center; color: var(--red-ui-secondary-text-color, #94a3b8); padding: 32px 16px; font-size: 12px;" })
            .html('<i class="fa fa-desktop" style="font-size: 24px; color: #cbd5e1; display: block; margin-bottom: 8px;"></i>Select a screen, template, or flow from the tree on the left.')
            .appendTo(state.screenFormEl);
        return;
    }

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
    }).html('<i class="fa fa-sliders" style="color: #0284c7;"></i> Screen Properties').appendTo(state.screenFormEl);

    function row(label, field, value, type) {
        var r = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text(label).appendTo(r);
        var input = window.$("<input>", { type: type || "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(value).appendTo(r);
        input.on("change", function () {
            var v = type === "number" ? (parseInt(input.val(), 10) || 0) : input.val();
            var oldSize = { w: screen.width, h: screen.height };
            screen[field] = v;
            if (field === "width" || field === "height") applyConstraints(null, screen.components || [], oldSize, { w: screen.width, h: screen.height });
            if (field === "name" || field === "path") renderScreenList();
            markDirty();
            renderActiveScreen();
        });
        return input;
    }

    row("Name", "name", screen.name);
    row("URL path", "path", screen.path);
    var DEVICES = [
        ["", "Custom size"], ["1920x1080", "Full HD 1920 × 1080"], ["1366x768", "Laptop 1366 × 768"],
        ["1280x800", "HMI panel 10\" 1280 × 800"], ["1024x768", "HMI panel 1024 × 768"], ["800x480", "HMI panel 7\" 800 × 480"],
        ["1180x820", "Tablet landscape 1180 × 820"], ["820x1180", "Tablet portrait 820 × 1180"], ["390x844", "Phone 390 × 844"]
    ];
    var presetRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text("Device").appendTo(presetRow);
    var presetSel = window.$("<select>").css({ width: "100%" }).appendTo(presetRow);
    DEVICES.forEach(function (d) { window.$("<option>", { value: d[0] }).text(d[1]).appendTo(presetSel); });
    presetSel.val(screen.width + "x" + screen.height);
    if (!presetSel.val()) presetSel.val("");
    var widthInput = row("Width (px)", "width", screen.width, "number");
    var heightInput = row("Height (px)", "height", screen.height, "number");
    presetSel.on("change", function () {
        var m = /^(\d+)x(\d+)$/.exec(presetSel.val());
        if (!m) return;
        var oldSize = { w: screen.width, h: screen.height };
        screen.width = Number(m[1]); screen.height = Number(m[2]);
        widthInput.val(screen.width); heightInput.val(screen.height);
        applyConstraints(null, screen.components || [], oldSize, { w: screen.width, h: screen.height });
        markDirty();
        renderActiveScreen();
        syncHelp();
    });
    [widthInput, heightInput].forEach(function (inp) { inp.on("change", function () { presetSel.val(screen.width + "x" + screen.height); if (!presetSel.val()) presetSel.val(""); syncHelp(); }); });

    var modeRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text("On the live page").appendTo(modeRow);
    var modeSel = window.$("<select>").css({ width: "100%" }).appendTo(modeRow);
    [["fixed", "Exact size (this device), centred"], ["fit", "Scale to fit the window (keep proportions)"],
    ["fitWidth", "Scale to the window width (scroll down)"],
    ["fill", "Fill the window (responsive, by constraints)"]]
        .forEach(function (o) { window.$("<option>", { value: o[0] }).text(o[1]).appendTo(modeSel); });
    modeSel.val(screen.displayMode || "fixed");
    var modeHelp = window.$("<div>").css({ "font-size": "11px", color: "var(--red-ui-secondary-text-color, #888)", "margin-top": "4px" }).appendTo(modeRow);
    var HELP = {
        fixed: function () { return "Shown at exactly " + screen.width + " × " + screen.height + " px — for a known panel / device."; },
        fit: "Everything scales together so the whole screen fits any window.",
        fitWidth: "Scales to the window's width; taller content scrolls — good for web pages.",
        fill: "The screen takes the window's size. Nothing scales: set constraints (left / right / scale…) on top-level items and use frames with auto layout. Customize scale per breakpoint below."
    };
    var syncHelp = function () { var h = HELP[modeSel.val()]; modeHelp.text(typeof h === "function" ? h() : (h || "")); };
    syncHelp();
    modeSel.on("change", function () {
        if (modeSel.val() === "fixed") delete screen.displayMode; else screen.displayMode = modeSel.val();
        if (modeSel.val() !== "fill") {
            delete screen.scaleFactor;
            delete screen.breakpointScales;
        }
        syncHelp();
        syncScaleVis();
        markDirty();
    });

    // Scale factor section (only visible for fill mode)
    var scaleRow = window.$("<div>").css({ "margin-bottom": "12px", display: "none" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text("Base scale factor").appendTo(scaleRow);
    var scaleWrap = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "8px" }).appendTo(scaleRow);
    var scaleRange = window.$("<input>", { type: "range", min: "0.25", max: "3", step: "0.05" }).css({ flex: "1" }).val(screen.scaleFactor || 1).appendTo(scaleWrap);
    var scaleNum = window.$("<input>", { type: "number", min: "0.1", max: "5", step: "0.05" }).css({ width: "55px", "text-align": "center" }).val(screen.scaleFactor || 1).appendTo(scaleWrap);
    window.$("<div>").css({ "font-size": "10px", color: "var(--red-ui-secondary-text-color, #94a3b8)", "margin-top": "2px", "margin-bottom": "8px" }).text("Default scale across all screens (1.0 = 100%)").appendTo(scaleRow);

    function syncScaleVis() {
        scaleRow.css("display", modeSel.val() === "fill" ? "block" : "none");
    }
    syncScaleVis();

    scaleRange.on("input change", function () {
        screen.scaleFactor = parseFloat(scaleRange.val()) || 1;
        scaleNum.val(screen.scaleFactor);
        markDirty();
    });
    scaleNum.on("input change", function () {
        screen.scaleFactor = parseFloat(scaleNum.val()) || 1;
        scaleRange.val(screen.scaleFactor);
        markDirty();
    });

    // Breakpoint scales list
    window.$("<div>").css({ "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)", "margin-bottom": "2px" }).text("Scale per breakpoint").appendTo(scaleRow);
    window.$("<div>").css({ "font-size": "10px", color: "var(--red-ui-secondary-text-color, #94a3b8)", "margin-bottom": "6px" }).text("Set custom scale for specific screen sizes (leave blank to inherit base scale)").appendTo(scaleRow);
    var bpListEl = window.$("<div>").css({ display: "flex", "flex-direction": "column", gap: "4px" }).appendTo(scaleRow);

    function renderBpScales() {
        bpListEl.empty();
        if (!screen.breakpointScales) screen.breakpointScales = {};
        var app = getApp();
        var bps = BP.breakpointsOf(app);
        bps.forEach(function (bp) {
            var row = window.$("<div>").css({
                display: "flex", "align-items": "center", "justify-content": "space-between",
                padding: "3px 6px", background: "var(--red-ui-secondary-background, #f8fafc)",
                "border-radius": "4px", border: "1px solid var(--red-ui-secondary-border-color, #e2e8f0)"
            }).appendTo(bpListEl);

            var labelWrap = window.$("<div>").appendTo(row);
            window.$("<span>").css({ "font-weight": "600", "font-size": "11px", color: "var(--red-ui-primary-text-color, #334155)" }).text(bp.id).appendTo(labelWrap);
            var range = BP.rangeOf(app, bp.id);
            var info = (bp.device ? bp.device + " · " : "") + range;
            window.$("<span>").css({ "font-size": "10px", color: "var(--red-ui-secondary-text-color, #64748b)", "margin-left": "6px" }).text(info).appendTo(labelWrap);

            var inputWrap = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "4px" }).appendTo(row);
            var curVal = screen.breakpointScales[bp.id];
            var inp = window.$("<input>", { type: "number", step: "0.05", min: "0.1", max: "5", placeholder: "Base" })
                .css({ width: "55px", "text-align": "center", height: "22px", "font-size": "11px" })
                .val(curVal !== undefined && curVal !== null ? curVal : "")
                .appendTo(inputWrap);
            window.$("<span>").css({ "font-size": "10px", color: "var(--red-ui-secondary-text-color, #94a3b8)" }).text("x").appendTo(inputWrap);

            inp.on("change input", function () {
                var v = inp.val().trim();
                if (v === "") {
                    delete screen.breakpointScales[bp.id];
                } else {
                    var n = parseFloat(v);
                    if (isFinite(n) && n > 0) screen.breakpointScales[bp.id] = n;
                    else delete screen.breakpointScales[bp.id];
                }
                if (Object.keys(screen.breakpointScales).length === 0) delete screen.breakpointScales;
                markDirty();
            });
        });
    }
    renderBpScales();
    row("Grid size (px)", "gridSize", screen.gridSize, "number");

    var checksWrap = window.$("<div>").css({
        "margin-top": "12px",
        "padding-top": "10px",
        "border-top": "1px solid var(--red-ui-secondary-border-color, #f1f5f9)",
        display: "flex",
        "flex-direction": "column",
        gap: "8px"
    }).appendTo(state.screenFormEl);

    var snapRow = window.$("<label>").css({ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer" }).appendTo(checksWrap);
    var snapInput = window.$("<input>", { type: "checkbox" }).prop("checked", screen.snap !== false).appendTo(snapRow);
    window.$("<span>").text("Snap to grid").appendTo(snapRow);
    snapInput.on("change", function () {
        screen.snap = snapInput.is(":checked");
        markDirty();
    });

    var enableRow = window.$("<label>").css({ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer" }).appendTo(checksWrap);
    var enableInput = window.$("<input>", { type: "checkbox" }).prop("checked", !screen.disabled).appendTo(enableRow);
    window.$("<span>").text("Enable screen (live page at URL path)").appendTo(enableRow);
    enableInput.on("change", function () {
        screen.disabled = !enableInput.is(":checked");
        markDirty();
        renderScreenList();
    });
}
