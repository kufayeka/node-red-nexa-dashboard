import { findComponent, markDirty } from "../state.js";

export function openUiUpdateNodeEditor(node) {
    var comp = findComponent(node.compId);
    var isLitComponent = comp && comp.type === "@lit-component";
    var typeDef = comp && !isLitComponent && window.NEXA.getComponent(comp.type);
    var fieldEls = {};
    window.RED.tray.show({
        id: "nexa-logic-uiupdate-editor",
        title: "Configure Update Node",
        width: 450,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    var config = {};
                    Object.keys(fieldEls).forEach(function (key) {
                        var item = fieldEls[key];
                        if (item.type === "checkbox") {
                            if (item.overrideCheck.is(":checked")) {
                                config[key] = item.input.is(":checked");
                            }
                        } else {
                            var raw = item.input.val();
                            if (raw !== "" && raw !== null && raw !== undefined) {
                                config[key] = item.type === "number" ? (parseFloat(raw) || 0) : raw;
                            }
                        }
                    });
                    node.config = config;
                    markDirty();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            if (!comp || (!typeDef && !isLitComponent)) {
                window.$("<div>").text("This component no longer exists.").appendTo(body);
                return;
            }
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("Leave a field blank to keep it unchanged or set via msg.properties.<field> / msg.payload.<field> at runtime. Fill in a field to give it a fixed default value.")
                .appendTo(body);

            function field(key, label, type) {
                var row = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(body);
                window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888" }).text(label).appendTo(row);
                var current = node.config && node.config[key] !== undefined ? node.config[key] : "";
                var input;
                if (type === "checkbox") {
                    var checkWrap = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "6px" }).appendTo(row);
                    var overrideCheck = window.$("<input>", { type: "checkbox" }).prop("checked", node.config && node.config[key] !== undefined).appendTo(checkWrap);
                    window.$("<label>").css({ "font-size": "11px", color: "#555" }).text("Override").appendTo(checkWrap);
                    input = window.$("<input>", { type: "checkbox" }).prop("checked", !!current).appendTo(checkWrap);
                    fieldEls[key] = { input: input, overrideCheck: overrideCheck, type: "checkbox" };
                } else if (type === "color") {
                    var colorWrap = window.$("<div>").css({ display: "flex", gap: "6px", "align-items": "center" }).appendTo(row);
                    input = window.$("<input>", { type: "text", placeholder: "leave blank to keep unchanged (e.g. #ff8800)" })
                        .css({ flex: "1", "box-sizing": "border-box" })
                        .val(current)
                        .appendTo(colorWrap);
                    var picker = window.$("<input>", { type: "color" })
                        .css({ width: "36px", height: "26px", padding: "0", cursor: "pointer", border: "1px solid #ccc" })
                        .val(current && /^#[0-9a-fA-F]{6}$/.test(current) ? current : "#cfe0ff")
                        .appendTo(colorWrap);
                    var clearBtn = window.$("<button>", { type: "button" })
                        .text("Clear")
                        .css({ "font-size": "11px", padding: "2px 6px" })
                        .appendTo(colorWrap);
                    picker.on("input change", function () {
                        input.val(picker.val());
                    });
                    input.on("input change", function () {
                        if (/^#[0-9a-fA-F]{6}$/.test(input.val())) {
                            picker.val(input.val());
                        }
                    });
                    clearBtn.on("click", function () {
                        input.val("");
                    });
                    fieldEls[key] = { input: input, type: "color" };
                } else {
                    input = window.$("<input>", { type: type || "text", placeholder: "leave blank to keep unchanged" })
                        .css({ width: "100%", "box-sizing": "border-box" })
                        .val(current)
                        .appendTo(row);
                    fieldEls[key] = { input: input, type: type || "text" };
                }
            }
            field("x", "X", "number");
            field("y", "Y", "number");
            field("w", "Width", "number");
            field("h", "Height", "number");
            field("rotation", "Rotation", "number");
            if (isLitComponent) {
                // object/array-typed bindable props aren't a good fit for
                // this plain-text-field dialog — drive those via
                // msg.properties.<field> (a Function node building a real
                // object) instead of a static default here.
                (comp.litBindable || []).forEach(function (p) {
                    var inputType = p.type === "number" ? "number" : p.type === "color" ? "color" : p.type === "boolean" ? "checkbox" : "text";
                    field(p.name, p.name, inputType);
                });
            } else {
                Object.keys(typeDef.defaults || {}).forEach(function (key) {
                    var fieldDef = typeDef.defaults[key] || {};
                    var inputType = fieldDef.type === "number" ? "number" : fieldDef.type === "color" ? "color" : fieldDef.type === "checkbox" ? "checkbox" : "text";
                    field(key, key, inputType);
                });
            }
        }
    });
}
