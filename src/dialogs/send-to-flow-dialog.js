import { markDirty } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

export function openSendToFlowNodeEditor(node) {
    var actionInput;
    window.RED.tray.show({
        id: "nexa-logic-send-to-flow-editor",
        title: "Configure Send to Flow",
        width: 440,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.action = (actionInput.val() || "").trim();
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "14px" });
            window.$("<div>").css({
                "font-size": "12px",
                color: "var(--red-ui-secondary-text-color, #64748b)",
                "margin-bottom": "14px",
                "line-height": "1.5"
            }).html("Dispatches a message from this screen back to the host <strong>Render Screen</strong> node in the active Flow logic canvas.<br>The host node emits this message out of its output port.").appendTo(body);

            var actionRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
            window.$("<label>").css({
                display: "block",
                "font-size": "11px",
                "font-weight": "600",
                "margin-bottom": "6px",
                color: "var(--red-ui-secondary-text-color, #475569)"
            }).text("Action / Event Name (Optional)").appendTo(actionRow);

            actionInput = window.$("<input>", {
                type: "text",
                placeholder: "e.g. submit, cancel, next, login"
            }).css({ width: "100%", "box-sizing": "border-box", padding: "6px" })
                .val(node.action || "")
                .appendTo(actionRow);

            window.$("<div>").css({
                "font-size": "11px",
                color: "#64748b",
                "margin-top": "4px"
            }).text("If specified, this is attached as msg.action so the flow can switch or branch.").appendTo(actionRow);
        }
    });
}
