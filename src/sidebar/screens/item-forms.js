// Screens & Flows tab: the property forms of a flow, a folder, a variable and a template param.
import { state, markDirty, getApp, Scope, deleteFolder } from "../../state.js";
import { buildTypedInputWidget, mapParamTypeToTypedInputType } from "../../param-types.js";
import { renderScreenList } from "../screens-panel.js";
import { renderScreenForm } from "./screen-form.js";
import { isFolderDescendant } from "./tree-events.js";

export function renderFlowForm(flow) {
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
    }).html('<i class="fa fa-code-fork" style="color: #6366f1;"></i> Flow Properties').appendTo(state.screenFormEl);

    function row(label, field, value, type) {
        var r = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text(label).appendTo(r);
        var input = window.$("<input>", { type: type || "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(value).appendTo(r);
        input.on("change", function () {
            flow[field] = input.val();
            if (field === "name") renderScreenList();
            markDirty();
        });
        return input;
    }

    row("Flow Name", "name", flow.name);

    // Starting Endpoint with uniqueness guard
    var epRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Starting Endpoint").appendTo(epRow);
    var epInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(flow.endpoint || "/flow").appendTo(epRow);
    var epError = window.$("<div>").css({ color: "#ef4444", "font-size": "11px", "margin-top": "4px", display: "none" }).appendTo(epRow);

    function validateEndpoint(val) {
        var raw = (val || "").trim();
        if (!raw) raw = "/flow";
        if (raw.charAt(0) !== "/") raw = "/" + raw;
        raw = raw.replace(/\/+$/, "") || "/";
        var duplicate = (state.flows || []).find(function (f) {
            if (f.id === flow.id) return false;
            var other = (f.endpoint || "").trim();
            if (other.charAt(0) !== "/") other = "/" + other;
            other = other.replace(/\/+$/, "") || "/";
            return other.toLowerCase() === raw.toLowerCase();
        });
        if (duplicate) {
            epInput.css({ border: "1px solid #ef4444", background: "#fff5f5" });
            epError.html('<i class="fa fa-exclamation-circle"></i> Endpoint <code>' + raw + '</code> is already in use by Flow "<b>' + (duplicate.name || duplicate.id) + '</b>". Flow endpoints must be unique!').show();
            if (window.RED && window.RED.notify) {
                window.RED.notify("Flow endpoint '" + raw + "' is already in use by Flow '" + (duplicate.name || duplicate.id) + "'. Endpoint must be unique.", "error");
            }
            return false;
        } else {
            epInput.css({ border: "", background: "" });
            epError.hide();
            return raw;
        }
    }

    epInput.on("input", function () {
        var res = validateEndpoint(epInput.val());
        if (res !== false) {
            flow.endpoint = res;
            renderScreenList();
            markDirty();
        }
    });

    epInput.on("blur", function () {
        var res = validateEndpoint(epInput.val());
        if (res === false) {
            epInput.val(flow.endpoint);
            validateEndpoint(flow.endpoint);
        } else {
            epInput.val(res);
            flow.endpoint = res;
            renderScreenList();
            markDirty();
        }
    });

    // Default Flow Checkbox
    var defaultRow = window.$("<div>").css({
        "margin-bottom": "12px",
        padding: "8px 10px",
        background: "var(--red-ui-secondary-background, #f8fafc)",
        border: "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
        "border-radius": "6px"
    }).appendTo(state.screenFormEl);
    var defaultLabel = window.$("<label>").css({
        display: "flex", "align-items": "center", gap: "8px", "font-size": "12px",
        cursor: "pointer", color: "var(--red-ui-primary-text-color, #333)", margin: 0
    }).appendTo(defaultRow);
    var defaultCheck = window.$("<input>", { type: "checkbox" }).appendTo(defaultLabel);
    defaultCheck.prop("checked", !!flow.isDefault);
    window.$("<span>").html("<strong>Default Flow</strong> (Redirect root <code>/</code> and <code>/nexa</code> to this flow)").appendTo(defaultLabel);
    defaultCheck.on("change", function () {
        var isChecked = defaultCheck.is(":checked");
        if (isChecked) {
            (state.flows || []).forEach(function (f) { f.isDefault = false; });
            flow.isDefault = true;
        } else {
            flow.isDefault = false;
        }
        renderScreenList();
        markDirty();
    });

    // Flow Routing Policy
    var policyRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Flow Routing Rules").appendTo(policyRow);
    var policySelect = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" }).appendTo(policyRow);
    window.$("<option>", { value: "strict" }).text("Strict Sequential (Must enter via Route Trigger)").appendTo(policySelect);
    window.$("<option>", { value: "free" }).text("Free Jump (Allow direct jump to any flow screen)").appendTo(policySelect);
    policySelect.val(flow.routingPolicy || "strict");
    policySelect.on("change", function () {
        flow.routingPolicy = policySelect.val();
        markDirty();
    });

    window.$("<div>").css({
        "margin-top": "12px",
        padding: "10px 12px",
        background: "#f0fdf4",
        border: "1px solid #bbf7d0",
        "border-radius": "6px",
        "font-size": "11px",
        color: "#166534",
        "line-height": "1.5"
    }).html('<strong><i class="fa fa-info-circle"></i> Screen Flow Gateway</strong><br>Flow is the exclusive public entrypoint. Screens are rendered as internal views.<br><br>Public URL format: <code>/nexa' + (flow.endpoint || '/flow') + '/&lt;screen-path&gt;</code>.<br>Configure logic & routing in the <strong>Logic</strong> tab.').appendTo(state.screenFormEl);

    var btnRow = window.$("<div>").css({ "margin-top": "14px" }).appendTo(state.screenFormEl);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-primary" })
        .html('<i class="fa fa-code-fork"></i> Open Flow Logic Canvas')
        .css({ width: "100%", height: "30px", "font-size": "12px", display: "inline-flex", "align-items": "center", "justify-content": "center", gap: "6px" })
        .on("click", function () {
            if (state.canvasTabs && typeof state.canvasTabs.activateTab === "function") {
                state.canvasTabs.activateTab("logic");
            }
        }).appendTo(btnRow);
}

export function renderFolderForm(folder) {
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
    }).html('<i class="fa fa-folder-open-o" style="color: #f59e0b;"></i> Group Properties').appendTo(state.screenFormEl);

    var r = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text("Group Name").appendTo(r);
    var input = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(folder.name).appendTo(r);
    input.on("change", function () {
        folder.name = input.val();
        renderScreenList();
        markDirty();
    });

    var pRow = window.$("<div>").css({ "margin-bottom": "14px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text("Parent Group").appendTo(pRow);
    var pSel = window.$("<select>").css({ width: "100%" }).appendTo(pRow);
    window.$("<option>", { value: "" }).text("(Root level)").appendTo(pSel);
    state.folders.forEach(function (f) {
        if (f.id !== folder.id && !isFolderDescendant(folder.id, f.id)) {
            window.$("<option>", { value: f.id }).text(f.name).appendTo(pSel);
        }
    });
    pSel.val(folder.parentId || "");
    pSel.on("change", function () {
        folder.parentId = pSel.val() || null;
        renderScreenList();
        markDirty();
    });

    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small" })
        .css({ color: "#ef4444", "margin-top": "12px", display: "inline-flex", "align-items": "center", gap: "4px" })
        .html('<i class="fa fa-trash"></i> Delete Group')
        .on("click", function () {
            deleteFolder(folder.id);
            state.selectedFolderId = null;
            markDirty();
            renderScreenList();
            renderScreenForm();
        }).appendTo(state.screenFormEl);
}

export function renderVariablePropertiesForm(variable, isApp, surface) {
    var isTmpl = isApp === "template";
    var isAppVar = isApp === true;
    var isSharedVar = isApp === "shared";
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
    }).html(isSharedVar
        ? '<i class="fa fa-refresh" style="color: #059669;"></i> Shared Variable Properties (Server Realtime)'
        : isAppVar
            ? '<i class="fa fa-globe" style="color: #6366f1;"></i> App Variable Properties'
            : isTmpl
                ? '<i class="fa fa-tag" style="color: #0284c7;"></i> Template Variable Properties (' + (surface ? surface.name : "Template") + ')'
                : '<i class="fa fa-tag" style="color: #0284c7;"></i> Screen Variable Properties (' + (surface ? surface.name : "Screen") + ')'
    ).appendTo(state.screenFormEl);

    // Context / info box
    window.$("<div>").css({
        "margin-bottom": "14px",
        padding: "8px 12px",
        background: isSharedVar ? "#ecfdf5" : isAppVar ? "#f5f3ff" : "#f0f9ff",
        border: "1px solid " + (isSharedVar ? "#a7f3d0" : isAppVar ? "#ddd6fe" : "#bae6fd"),
        "border-radius": "6px",
        "font-size": "11px",
        color: isSharedVar ? "#065f46" : isAppVar ? "#5b21b6" : "#0369a1",
        "line-height": "1.4"
    }).html(isSharedVar
        ? '<strong>Realtime Shared Variable</strong><br>Synchronized across all screens, tabs, and client devices in realtime via the realtime nexa io protocol. Bind using <code>{' + (variable.name || "var") + '}</code> or access in Logic via "Set Variable" / "Watch Variable".'
        : isAppVar
            ? '<strong>Global App Variable</strong><br>Shared across every screen. Bind in components using <code>{' + (variable.name || "var") + '}</code> or access in Logic via "Set Variable" / Function.'
            : isTmpl
                ? '<strong>Template-Scoped Variable (' + (surface ? surface.name : "Template") + ')</strong><br>Internal variable for this template. Available to all components inside this template. Bind in components using <code>{' + (variable.name || "var") + '}</code>.'
                : '<strong>Screen-Scoped Variable (' + (surface ? surface.name : "Screen") + ')</strong><br>Available to all components on this screen. Bind in components using <code>{' + (variable.name || "var") + '}</code>.'
    ).appendTo(state.screenFormEl);

    // Variable Name Row
    var nameRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Variable Name").appendTo(nameRow);
    var nameInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(variable.name || "").appendTo(nameRow);
    var nameError = window.$("<div>").css({ "font-size": "10.5px", color: "#ef4444", "margin-top": "3px", display: "none" }).appendTo(nameRow);

    nameInput.on("input change", function () {
        var val = nameInput.val().trim();
        if (!val || (Scope && Scope.NAME_RE && !Scope.NAME_RE.test(val))) {
            nameError.text('Invalid name. Must start with a letter/$/_ and contain only alphanumeric characters.').show();
        } else {
            nameError.hide();
            variable.name = val;
            renderScreenList();
            markDirty();
        }
    });

    // Type Row
    var typeRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Type").appendTo(typeRow);
    var typeSelect = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" }).appendTo(typeRow);
    ["string", "number", "boolean", "object", "array", "color"].forEach(function (t) {
        window.$("<option>", { value: t }).text(t).appendTo(typeSelect);
    });
    (getApp().types || []).forEach(function (t) {
        window.$("<option>", { value: "type:" + t.id }).text(t.name + " (custom type)").appendTo(typeSelect);
    });
    typeSelect.val(variable.type || "string");

    // Default Value Row (Native Node-RED TypedInput)
    var valRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Default Value").appendTo(valRow);
    var valInputContainer = window.$("<div>").css({ width: "100%" }).appendTo(valRow);

    var typedInputEl = buildTypedInputWidget(valInputContainer, variable.type || "string", variable.defaultValue, function (parsedVal, detType) {
        variable.defaultValue = parsedVal;
        if (detType && detType !== variable.type) {
            variable.type = detType;
            typeSelect.val(detType);
        }
        markDirty();
    });

    typeSelect.on("change", function () {
        var newType = typeSelect.val();
        variable.type = newType;
        var tiType = mapParamTypeToTypedInputType(newType);
        if (typedInputEl && typeof typedInputEl.typedInput === "function") {
            typedInputEl.typedInput("type", tiType);
            if (newType === "boolean") {
                typedInputEl.typedInput("value", "false");
                variable.defaultValue = false;
            } else if (newType === "number") {
                typedInputEl.typedInput("value", "0");
                variable.defaultValue = 0;
            } else if (newType === "object") {
                typedInputEl.typedInput("value", "{}");
                variable.defaultValue = {};
            } else if (newType === "array") {
                typedInputEl.typedInput("value", "[]");
                variable.defaultValue = [];
            } else if (newType === "string") {
                typedInputEl.typedInput("value", "");
                variable.defaultValue = "";
            }
        }
        markDirty();
    });

    // Kept for (Persistence) - Only for App Variables
    if (isAppVar) {
        var persistRow = window.$("<div>").css({ "margin-bottom": "14px" }).appendTo(state.screenFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
            .text("Kept for (Persistence)").appendTo(persistRow);
        var persistSelect = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" }).appendTo(persistRow);
        window.$("<option>", { value: "none" }).text("this page (resets on reload)").appendTo(persistSelect);
        window.$("<option>", { value: "session" }).text("tab session (sessionStorage)").appendTo(persistSelect);
        window.$("<option>", { value: "local" }).text("browser (localStorage — kept across reloads)").appendTo(persistSelect);
        persistSelect.val(variable.persist || "none");
        persistSelect.on("change", function () {
            variable.persist = persistSelect.val();
            markDirty();
        });
    }

    // Delete Button
    var btnRow = window.$("<div>").css({ "margin-top": "16px", "padding-top": "12px", "border-top": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)" }).appendTo(state.screenFormEl);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small" })
        .css({ color: "#ef4444", display: "inline-flex", "align-items": "center", gap: "5px" })
        .html('<i class="fa fa-trash"></i> Delete Variable')
        .on("click", function () {
            if (isSharedVar) {
                var app = getApp();
                app.sharedVariables = (app.sharedVariables || []).filter(function (v) { return v.id !== variable.id; });
                state.activeSharedVariableId = null;
                state.editingMode = "screen";
            } else if (isAppVar) {
                var app = getApp();
                app.variables = (app.variables || []).filter(function (v) { return v.id !== variable.id; });
                state.activeAppVariableId = null;
                state.editingMode = "screen";
            } else if (isTmpl && surface) {
                surface.variables = (surface.variables || []).filter(function (v) { return v.id !== variable.id; });
                state.activeTemplateVariableId = null;
                state.editingMode = "template";
            } else if (surface) {
                surface.variables = (surface.variables || []).filter(function (v) { return v.id !== variable.id; });
                state.activeScreenVariableId = null;
                state.editingMode = "screen";
            }
            markDirty();
            renderScreenList();
            renderScreenForm();
        }).appendTo(btnRow);
}

export function renderTemplateParamPropertiesForm(param, template) {
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
    }).html('<i class="fa fa-sliders" style="color: #6366f1;"></i> Template Parameter Properties (' + (template ? template.name : "Template") + ')').appendTo(state.screenFormEl);

    // Info box
    window.$("<div>").css({
        "margin-bottom": "14px",
        padding: "8px 12px",
        background: "#f5f3ff",
        border: "1px solid #ddd6fe",
        "border-radius": "6px",
        "font-size": "11px",
        color: "#5b21b6",
        "line-height": "1.4"
    }).html('<strong>Template Parameter (' + (template ? template.name : "Template") + ')</strong><br>Exposed outward when this template is used as an instance. Reference inside this template using <code>{' + (param.name || "param") + '}</code> or bind outward.').appendTo(state.screenFormEl);

    // Param Name Row
    var nameRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Parameter Name").appendTo(nameRow);
    var nameInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(param.name || "").appendTo(nameRow);
    var nameError = window.$("<div>").css({ "font-size": "10.5px", color: "#ef4444", "margin-top": "3px", display: "none" }).appendTo(nameRow);

    nameInput.on("input change", function () {
        var val = nameInput.val().trim();
        if (!val || (Scope && Scope.NAME_RE && !Scope.NAME_RE.test(val))) {
            nameError.text('Invalid name. Must start with a letter/$/_ and contain only alphanumeric characters.').show();
        } else {
            nameError.hide();
            param.name = val;
            if (!param.label || param.label === param.name) {
                param.label = val;
                if (labelInput) labelInput.val(val);
            }
            renderScreenList();
            markDirty();
        }
    });

    // Label Row
    var labelRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Display Label").appendTo(labelRow);
    var labelInput = window.$("<input>", { type: "text", placeholder: "e.g. Motor Speed" }).css({ width: "100%", "box-sizing": "border-box" }).val(param.label || param.name || "").appendTo(labelRow);
    labelInput.on("change", function () {
        param.label = labelInput.val().trim() || param.name;
        renderScreenList();
        markDirty();
    });

    // Type Row
    var typeRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Type").appendTo(typeRow);
    var typeSelect = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" }).appendTo(typeRow);
    ["string", "number", "boolean", "object", "array", "color"].forEach(function (t) {
        window.$("<option>", { value: t }).text(t).appendTo(typeSelect);
    });
    (getApp().types || []).forEach(function (t) {
        window.$("<option>", { value: "type:" + t.id }).text(t.name + " (custom type)").appendTo(typeSelect);
    });
    typeSelect.val(param.type || "string");

    // Default Value Row
    var valRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Default Value").appendTo(valRow);
    var valInputContainer = window.$("<div>").css({ width: "100%" }).appendTo(valRow);

    var typedInputEl = buildTypedInputWidget(valInputContainer, param.type || "string", param.defaultValue, function (parsedVal, detType) {
        param.defaultValue = parsedVal;
        if (detType && detType !== param.type) {
            param.type = detType;
            typeSelect.val(detType);
        }
        markDirty();
    });

    typeSelect.on("change", function () {
        var newType = typeSelect.val();
        param.type = newType;
        var tiType = mapParamTypeToTypedInputType(newType);
        if (typedInputEl && typeof typedInputEl.typedInput === "function") {
            typedInputEl.typedInput("type", tiType);
            if (newType === "boolean") {
                typedInputEl.typedInput("value", "false");
                param.defaultValue = false;
            } else if (newType === "number") {
                typedInputEl.typedInput("value", "0");
                param.defaultValue = 0;
            } else if (newType === "object") {
                typedInputEl.typedInput("value", "{}");
                param.defaultValue = {};
            } else if (newType === "array") {
                typedInputEl.typedInput("value", "[]");
                param.defaultValue = [];
            } else if (newType === "string") {
                typedInputEl.typedInput("value", "");
                param.defaultValue = "";
            }
        }
        markDirty();
    });

    // Delete Button
    var btnRow = window.$("<div>").css({ "margin-top": "16px", "padding-top": "12px", "border-top": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)" }).appendTo(state.screenFormEl);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small" })
        .css({ color: "#ef4444", display: "inline-flex", "align-items": "center", gap: "5px" })
        .html('<i class="fa fa-trash"></i> Delete Parameter')
        .on("click", function () {
            if (template && template.params) {
                template.params = template.params.filter(function (p) { return p.id !== param.id; });
                state.activeTemplateParamId = null;
                state.editingMode = "template";
                markDirty();
                renderScreenList();
                renderScreenForm();
            }
        }).appendTo(btnRow);
}
