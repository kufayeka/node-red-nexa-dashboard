import { state, markDirty } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";

export function openNavigateNodeEditor(node) {
    var modeSelect, screenSelect, urlInput, historySelect, forwardPayloadCheck;
    window.RED.tray.show({
        id: "nexa-logic-navigate-editor",
        title: "Configure Goto Screen (SPA)",
        width: 480,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.mode = modeSelect.val();
                    node.screenId = screenSelect.val();
                    node.url = urlInput.val();
                    node.historyAction = historySelect.val();
                    node.forwardPayload = forwardPayloadCheck.is(":checked");
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "14px" });
            window.$("<div>").css({ "font-size": "12px", color: "var(--red-ui-secondary-text-color, #64748b)", "margin-bottom": "12px" })
                .text("Navigates to another screen seamlessly in SPA mode, preserving active WebSocket & Sparkplug connections.")
                .appendTo(body);

            // Mode row
            var modeRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Navigation Mode").appendTo(modeRow);
            modeSelect = window.$("<select>").css({ width: "100%" }).appendTo(modeRow);
            [
                ["screen", "Named Screen (from Project)"],
                ["url", "Dynamic Route / Path (Expression / Payload)"],
                ["history", "Browser History (Back / Forward)"]
            ].forEach(function (opt) {
                window.$("<option>", { value: opt[0] }).text(opt[1])
                    .prop("selected", (node.mode || "screen") === opt[0])
                    .appendTo(modeSelect);
            });

            // Container for mode-specific fields
            var screenRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Target Screen").appendTo(screenRow);
            screenSelect = window.$("<select>").css({ width: "100%" }).appendTo(screenRow);
            var screens = state.screens || [];
            if (!screens.length) {
                window.$("<option>", { value: "" }).text("(No screens available)").appendTo(screenSelect);
            } else {
                screens.forEach(function (s) {
                    window.$("<option>", { value: s.id }).text(s.name + " (" + s.id + ")")
                        .prop("selected", (node.screenId || (screens[0] && screens[0].id)) === s.id)
                        .appendTo(screenSelect);
                });
            }

            var urlRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Route Template / Sub-path").appendTo(urlRow);
            urlInput = window.$("<input>", { type: "text", placeholder: "/devices/{msg.params.id} or screen2" }).css({ width: "100%", "box-sizing": "border-box" })
                .val(node.url || "").appendTo(urlRow);

            var historyRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("History Action").appendTo(historyRow);
            historySelect = window.$("<select>").css({ width: "100%" }).appendTo(historyRow);
            [
                ["back", "Back (-1)"],
                ["forward", "Forward (+1)"]
            ].forEach(function (opt) {
                window.$("<option>", { value: opt[0] }).text(opt[1])
                    .prop("selected", (node.historyAction || "back") === opt[0])
                    .appendTo(historySelect);
            });

            function updateVisibility() {
                var m = modeSelect.val();
                screenRow.toggle(m === "screen");
                urlRow.toggle(m === "url");
                historyRow.toggle(m === "history");
            }
            modeSelect.on("change", updateVisibility);
            updateVisibility();

            // Forward payload option
            var payloadRow = window.$("<label>").css({ "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)", "margin-top": "8px", display: "flex", "align-items": "center", cursor: "pointer" }).appendTo(body);
            forwardPayloadCheck = window.$("<input>", { type: "checkbox" }).prop("checked", node.forwardPayload !== false).css({ "margin-right": "8px" }).appendTo(payloadRow);
            payloadRow.append("Forward current msg.payload into destination screen's On Load");
        }
    });
}
