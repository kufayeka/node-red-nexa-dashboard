import { state, markDirty } from "../state.js";
import { renderScreenList } from "../sidebar/screens-panel.js";

export function openFlowPropertiesDialog(flow) {
    if (!flow) return;

    var curName = flow.name || "";
    var curEndpoint = flow.endpoint || "/flow";
    var curIsDefault = !!flow.isDefault;
    var curPolicy = flow.routingPolicy || "strict";

    window.RED.tray.show({
        id: "nexa-flow-properties-dialog",
        title: "Flow Properties: " + (flow.name || "Flow"),
        width: 500,
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
                    var valName = curName.trim();
                    if (!valName) {
                        if (window.RED && window.RED.notify) window.RED.notify("Flow name cannot be empty.", "error");
                        return;
                    }
                    var cleanEp = (curEndpoint || "").trim();
                    if (!cleanEp) cleanEp = "/flow";
                    if (cleanEp.charAt(0) !== "/") cleanEp = "/" + cleanEp;
                    cleanEp = cleanEp.replace(/\/+$/, "") || "/";

                    // Uniqueness check
                    var dup = (state.flows || []).find(function (f) {
                        if (f.id === flow.id) return false;
                        var other = (f.endpoint || "").trim();
                        if (other.charAt(0) !== "/") other = "/" + other;
                        other = other.replace(/\/+$/, "") || "/";
                        return other.toLowerCase() === cleanEp.toLowerCase();
                    });
                    if (dup) {
                        if (window.RED && window.RED.notify) window.RED.notify("Flow endpoint '" + cleanEp + "' is already in use by Flow '" + (dup.name || dup.id) + "'.", "error");
                        return;
                    }

                    flow.name = valName;
                    flow.endpoint = cleanEp;
                    flow.routingPolicy = curPolicy;
                    if (curIsDefault) {
                        (state.flows || []).forEach(function (f) { f.isDefault = false; });
                        flow.isDefault = true;
                    } else {
                        flow.isDefault = false;
                    }

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
                "margin-bottom": "14px", padding: "10px 12px", background: "#f0fdf4",
                border: "1px solid #bbf7d0", "border-radius": "6px", "font-size": "11px",
                color: "#166534", "line-height": "1.5"
            }).html('<strong><i class="fa fa-info-circle"></i> Screen Flow Gateway</strong><br>Flow is the exclusive public entrypoint. Screens are rendered as internal views.<br>Public URL format: <code>/nexa' + (flow.endpoint || '/flow') + '/&lt;screen-path&gt;</code>.<br>Configure logic & routing in the <strong>Logic</strong> tab.').appendTo(body);

            function createRow(label, inputEl) {
                var r = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
                window.$("<label>").css({
                    display: "block", "font-size": "11px", "font-weight": "600",
                    "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)"
                }).text(label).appendTo(r);
                inputEl.appendTo(r);
                return r;
            }

            // Flow Name
            var nameInp = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(curName);
            nameInp.on("input change", function () { curName = nameInp.val(); });
            createRow("Flow Name", nameInp);

            // Starting Endpoint
            var epInp = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(curEndpoint);
            var epError = window.$("<div>").css({ color: "#ef4444", "font-size": "11px", "margin-top": "4px", display: "none" });

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
                    epInp.css({ border: "1px solid #ef4444", background: "#fff5f5" });
                    epError.html('<i class="fa fa-exclamation-circle"></i> Endpoint <code>' + raw + '</code> is already in use by Flow "<b>' + (duplicate.name || duplicate.id) + '</b>".').show();
                    return false;
                } else {
                    epInp.css({ border: "", background: "" });
                    epError.hide();
                    return raw;
                }
            }

            epInp.on("input change", function () {
                curEndpoint = epInp.val();
                validateEndpoint(curEndpoint);
            });

            var epWrap = window.$("<div>");
            epInp.appendTo(epWrap);
            epError.appendTo(epWrap);
            createRow("Starting Endpoint", epWrap);

            // Default Flow Checkbox
            var defRow = window.$("<div>").css({
                "margin-bottom": "14px", padding: "10px 12px", background: "var(--red-ui-secondary-background, #f8fafc)",
                border: "1px solid var(--red-ui-secondary-border-color, #e2e8f0)", "border-radius": "6px"
            }).appendTo(body);
            var defLabel = window.$("<label>").css({ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px", cursor: "pointer", margin: 0 }).appendTo(defRow);
            var defCheck = window.$("<input>", { type: "checkbox" }).prop("checked", curIsDefault).appendTo(defLabel);
            window.$("<span>").html("<strong>Default Flow</strong> (Redirect root <code>/</code> and <code>/nexa</code> to this flow)").appendTo(defLabel);
            defCheck.on("change", function () { curIsDefault = defCheck.is(":checked"); });

            // Routing Policy
            var policySel = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" });
            window.$("<option>", { value: "strict" }).text("Strict Sequential (Must enter via Route Trigger)").appendTo(policySel);
            window.$("<option>", { value: "free" }).text("Free Jump (Allow direct jump to any flow screen)").appendTo(policySel);
            policySel.val(curPolicy);
            policySel.on("change", function () { curPolicy = policySel.val(); });
            createRow("Flow Routing Rules", policySel);

            // Open Flow Logic Canvas button
            var btnRow = window.$("<div>").css({ "margin-top": "16px", "padding-top": "12px", "border-top": "1px solid #e2e8f0" }).appendTo(body);
            window.$("<button>", { type: "button", class: "red-ui-button red-ui-button-primary" })
                .html('<i class="fa fa-code-fork"></i> Open Flow Logic Canvas')
                .css({ width: "100%", height: "32px", "font-size": "12px", display: "inline-flex", "align-items": "center", "justify-content": "center", gap: "6px" })
                .on("click", function () {
                    window.RED.tray.close();
                    if (state.canvasTabs && typeof state.canvasTabs.activateTab === "function") {
                        state.canvasTabs.activateTab("logic");
                    }
                }).appendTo(btnRow);
        }
    });
}
