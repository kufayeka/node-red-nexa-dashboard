import { markDirty } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

export function openRouteTriggerNodeEditor(node) {
    var pathInput, cookiesInput, includeDeviceCheck;
    window.RED.tray.show({
        id: "nexa-logic-route-trigger-editor",
        title: "Configure Route Trigger",
        width: 480,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    var p = (pathInput.val() || "").trim();
                    if (!p) p = "/";
                    if (p.charAt(0) !== "/") p = "/" + p;
                    node.path = p;
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

            // Path pattern row
            var pathRow = window.$("<div>").css({ "margin-bottom": "14px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Route Path Pattern").appendTo(pathRow);
            pathInput = window.$("<input>", { type: "text", placeholder: "/app, /devices/:id, /dashboard" }).css({ width: "100%", "box-sizing": "border-box" })
                .val(node.path || "/").appendTo(pathRow);
            window.$("<div>").css({ "font-size": "11px", color: "#94a3b8", "margin-top": "3px" })
                .text("Supports parameter tokens like :id (emitted onto msg.params.id)").appendTo(pathRow);

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
