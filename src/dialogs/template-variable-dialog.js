import { markDirty, getApp, Scope } from "../state.js";
import { renderScreenList } from "../sidebar/screens-panel.js";
import { buildTypedInputWidget, mapParamTypeToTypedInputType } from "../param-types.js";

export function openTemplateVariablePropertiesDialog(variable, template) {
    if (!variable) return;

    var curName = variable.name || "";
    var curType = variable.type || "string";
    var curVal = variable.defaultValue;

    window.RED.tray.show({
        id: "nexa-template-variable-dialog",
        title: "Template Variable Properties: " + (variable.name || "Variable"),
        width: 460,
        buttons: [
            {
                text: "Cancel",
                click: function () {
                    window.RED.tray.close();
                }
            },
            {
                text: "Save",
                "class": "primary",
                click: function () {
                    var val = curName.trim();
                    if (!val || (Scope && Scope.NAME_RE && !Scope.NAME_RE.test(val))) {
                        if (window.RED && window.RED.notify) window.RED.notify("Invalid variable name. Must start with a letter/$/_ and contain only alphanumeric characters.", "error");
                        return;
                    }
                    variable.name = val;
                    variable.type = curType;
                    variable.defaultValue = curVal;
                    markDirty();
                    renderScreenList();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "16px 20px" });

            // Info box
            window.$("<div>").css({
                "margin-bottom": "14px", padding: "10px 12px", background: "#f0f9ff",
                border: "1px solid #bae6fd", "border-radius": "6px", "font-size": "11px",
                color: "#0369a1", "line-height": "1.45"
            }).html('<strong>Template-Scoped Variable (' + (template ? template.name : "Template") + ')</strong><br>Internal variable scoped to this template. Available to all components inside this template. Bind in components using <code>{' + (variable.name || "var") + '}</code>.').appendTo(body);

            // Variable Name
            var nameRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Variable Name").appendTo(nameRow);
            var nameInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(curName).appendTo(nameRow);
            var nameError = window.$("<div>").css({ "font-size": "10.5px", color: "#ef4444", "margin-top": "3px", display: "none" }).appendTo(nameRow);

            nameInput.on("input change", function () {
                var val = nameInput.val().trim();
                curName = val;
                if (!val || (Scope && Scope.NAME_RE && !Scope.NAME_RE.test(val))) {
                    nameError.text("Invalid name. Must start with a letter/$/_ and contain only alphanumeric characters.").show();
                } else {
                    nameError.hide();
                }
            });

            // Type
            var typeRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Type").appendTo(typeRow);
            var typeSelect = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" }).appendTo(typeRow);
            ["string", "number", "boolean", "object", "array", "color"].forEach(function (t) {
                window.$("<option>", { value: t }).text(t).appendTo(typeSelect);
            });
            (getApp().types || []).forEach(function (t) {
                window.$("<option>", { value: "type:" + t.id }).text(t.name + " (custom type)").appendTo(typeSelect);
            });
            typeSelect.val(curType);

            // Default Value
            var valRow = window.$("<div>").css({ "margin-bottom": "16px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Default Value").appendTo(valRow);
            var valContainer = window.$("<div>").css({ width: "100%" }).appendTo(valRow);

            var typedInputEl = buildTypedInputWidget(valContainer, curType, curVal, function (parsedVal, detType) {
                curVal = parsedVal;
                if (detType && detType !== curType) {
                    curType = detType;
                    typeSelect.val(detType);
                }
            });

            typeSelect.on("change", function () {
                curType = typeSelect.val();
                var tiType = mapParamTypeToTypedInputType(curType);
                if (typedInputEl && typeof typedInputEl.typedInput === "function") {
                    typedInputEl.typedInput("type", tiType);
                    if (curType === "boolean") {
                        typedInputEl.typedInput("value", "false");
                        curVal = false;
                    } else if (curType === "number") {
                        typedInputEl.typedInput("value", "0");
                        curVal = 0;
                    } else if (curType === "object") {
                        typedInputEl.typedInput("value", "{}");
                        curVal = {};
                    } else if (curType === "array") {
                        typedInputEl.typedInput("value", "[]");
                        curVal = [];
                    } else if (curType === "string") {
                        typedInputEl.typedInput("value", "");
                        curVal = "";
                    }
                }
            });

            // Delete button row
            var delRow = window.$("<div>").css({ "margin-top": "20px", "padding-top": "12px", "border-top": "1px solid #f1f5f9" }).appendTo(body);
            window.$("<button>", { type: "button", class: "red-ui-button red-ui-button-small" })
                .css({ color: "#ef4444", display: "inline-flex", "align-items": "center", gap: "5px" })
                .html('<i class="fa fa-trash"></i> Delete Variable')
                .on("click", function () {
                    if (template && template.variables) {
                        template.variables = template.variables.filter(function (v) { return v.id !== variable.id; });
                        markDirty();
                        renderScreenList();
                        window.RED.tray.close();
                    }
                }).appendTo(delRow);
        }
    });
}
