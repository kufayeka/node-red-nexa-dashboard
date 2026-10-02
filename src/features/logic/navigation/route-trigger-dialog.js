import { markDirty, getActiveScreen } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";

export function openRouteTriggerNodeEditor(node) {
    var cookiesInput, includeDeviceCheck;
    var flow = getActiveScreen();
    var flowEp = (flow && flow.endpoint) || "/flow";

    window.RED.tray.show({
        id: "nexa-logic-route-trigger-editor",
        title: "Configure Route Trigger",
        width: 480,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.path = flowEp;
                    node.cookies = (cookiesInput.val() || "").trim();
                    node.includeDevice = includeDeviceCheck.is(":checked");
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "14px" });
            window.$("<div>").css({ "font-size": "12px", color: "var(--red-ui-secondary-text-color, #64748b)", "margin-bottom": "14px" })
                .text("Entrypoint for public web routing. Emits route path, params, query, selective cookies, and client device context.")
                .appendTo(body);

            // Flow Starting Endpoint Info Banner
            var endpointBanner = window.$("<div>").css({
                padding: "10px 12px",
                background: "var(--red-ui-secondary-background, #f1f5f9)",
                border: "1px solid var(--red-ui-secondary-border-color, #cbd5e1)",
                "border-radius": "6px",
                "margin-bottom": "14px",
                "font-size": "12px",
                color: "var(--red-ui-primary-text-color, #334155)"
            }).appendTo(body);
            window.$("<div>").css({ "font-weight": "600", "margin-bottom": "4px" })
                .html('<i class="fa fa-road" style="color: #a855f7;"></i> Flow Entrypoint: <code>' + flowEp + '</code>')
                .appendTo(endpointBanner);
            window.$("<div>").css({ "font-size": "11px", color: "var(--red-ui-secondary-text-color, #64748b)" })
                .text("This Route Trigger is automatically bound to the Flow's starting endpoint. Incoming visits to /nexa" + flowEp + " initiate this flow sequence.")
                .appendTo(endpointBanner);

            // Selective Cookies row
            var cookiesRow = window.$("<div>").css({ "margin-bottom": "14px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Selective Cookies to Extract").appendTo(cookiesRow);
            cookiesInput = window.$("<input>", { type: "text", placeholder: "token, session_id, user_role (or * for all)" }).css({ width: "100%", "box-sizing": "border-box" })
                .val(node.cookies || "").appendTo(cookiesRow);
            window.$("<div>").css({ "font-size": "11px", color: "#94a3b8", "margin-top": "3px" })
                .text("Comma-separated cookie names. Extracted cookies appear on msg.cookies.").appendTo(cookiesRow);

            // Device Context checkbox
            var deviceRow = window.$("<label>").css({ "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)", "margin-top": "10px", display: "flex", "align-items": "center", cursor: "pointer" }).appendTo(body);
            includeDeviceCheck = window.$("<input>", { type: "checkbox" }).prop("checked", node.includeDevice !== false).css({ "margin-right": "8px" }).appendTo(deviceRow);
            deviceRow.append("Include client device metadata (mobile/desktop, screen size, userAgent, client IP) in msg.device");
        }
    });
}
