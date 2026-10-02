import { state, markDirty } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";

export function openRenderScreenNodeEditor(node) {
    var screenSelect, forwardPayloadCheck;
    window.RED.tray.show({
        id: "nexa-logic-render-screen-editor",
        title: "Configure Render Screen",
        width: 460,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.screenId = screenSelect.val();
                    node.forwardPayload = forwardPayloadCheck.is(":checked");
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
            }).html("Serves and renders a screen view in the browser when triggered by the flow.<br>When components inside the screen call <strong>Send to Flow</strong>, this node emits the message downstream.").appendTo(body);

            // Screen Selector
            var screenRow = window.$("<div>").css({ "margin-bottom": "14px" }).appendTo(body);
            window.$("<label>").css({
                display: "block",
                "font-size": "11px",
                "font-weight": "600",
                "margin-bottom": "6px",
                color: "var(--red-ui-secondary-text-color, #475569)"
            }).text("Screen View to Render").appendTo(screenRow);

            screenSelect = window.$("<select>").css({ width: "100%", padding: "6px" }).appendTo(screenRow);
            var screens = state.screens || [];
            if (!screens.length) {
                window.$("<option>", { value: "" }).text("(No screens available in project)").appendTo(screenSelect);
            } else {
                screens.forEach(function (s) {
                    window.$("<option>", { value: s.id })
                        .text(s.name + " (" + (s.path || "/" + s.id) + ")")
                        .prop("selected", (node.screenId || (screens[0] && screens[0].id)) === s.id)
                        .appendTo(screenSelect);
                });
            }

            // Forward payload option
            var payloadRow = window.$("<label>").css({
                "font-size": "12px",
                color: "var(--red-ui-primary-text-color, #333)",
                "margin-top": "12px",
                display: "flex",
                "align-items": "center",
                cursor: "pointer"
            }).appendTo(body);
            forwardPayloadCheck = window.$("<input>", { type: "checkbox" })
                .prop("checked", node.forwardPayload !== false)
                .css({ "margin-right": "8px" })
                .appendTo(payloadRow);
            payloadRow.append("Forward current msg.payload into screen's On Load lifecycle");
        }
    });
}
