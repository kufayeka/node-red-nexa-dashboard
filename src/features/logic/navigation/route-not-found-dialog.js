import { markDirty, getActiveScreen } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";

export function openRouteNotFoundNodeEditor(node) {
    var cookiesInput, includeDeviceCheck;
    var flow = getActiveScreen();
    var flowEp = (flow && flow.endpoint) || "/flow";

    window.RED.tray.show({
        id: "nexa-logic-route-not-found-editor",
        title: "Configure Route Not Found (404)",
        width: 480,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
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
                .text("Triggered when an incoming route under this Flow does not match any valid screen (404 catch-all). Emits route path, query, selective cookies, and error payload.")
                .appendTo(body);

            // Flow Info Banner
            var endpointBanner = window.$("<div>").css({
                padding: "10px 12px",
                background: "#fff1f2",
                border: "1px solid #fecdd3",
                "border-radius": "6px",
                "margin-bottom": "14px",
                "font-size": "12px",
                color: "#9f1239"
            }).appendTo(body);
            window.$("<div>").css({ "font-weight": "600", "margin-bottom": "4px" })
                .html('<i class="fa fa-exclamation-triangle" style="color: #e11d48;"></i> Flow Catch-All: <code>/nexa' + flowEp + '/*</code>')
                .appendTo(endpointBanner);
            window.$("<div>").css({ "font-size": "11px", color: "#881337" })
                .text("Connect this node's output to a Render Screen (e.g. custom 404 page) or navigation logic to handle unmatched routes gracefully.")
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
