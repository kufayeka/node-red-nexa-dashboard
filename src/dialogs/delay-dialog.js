import { markDirty } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

export function openDelayNodeEditor(node) {
    var delayInput, unitSelect;
    window.RED.tray.show({
        id: "nexa-logic-delay-editor",
        title: "Configure Delay Node",
        width: 400,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    var val = parseInt(delayInput.val(), 10);
                    node.delay = isNaN(val) || val < 0 ? 500 : val;
                    node.unit = unitSelect.val() || "ms";
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "14px" });
            window.$("<div>").css({ "font-size": "12px", color: "var(--red-ui-secondary-text-color, #64748b)", "margin-bottom": "12px" })
                .text("Pauses message execution for the specified duration before forwarding to the next node.")
                .appendTo(body);

            var row = window.$("<div>").css({ display: "flex", gap: "8px", "align-items": "flex-end", "margin-bottom": "12px" }).appendTo(body);

            var delayCol = window.$("<div>").css({ flex: "1 1 auto" }).appendTo(row);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Delay Time").appendTo(delayCol);
            delayInput = window.$("<input>", { type: "number", min: 0 }).css({ width: "100%", "box-sizing": "border-box" })
                .val(node.delay != null ? node.delay : 500).appendTo(delayCol);

            var unitCol = window.$("<div>").css({ flex: "0 0 120px" }).appendTo(row);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Unit").appendTo(unitCol);
            unitSelect = window.$("<select>").css({ width: "100%" }).appendTo(unitCol);
            [
                ["ms", "Milliseconds (ms)"],
                ["s", "Seconds (s)"]
            ].forEach(function (opt) {
                window.$("<option>", { value: opt[0] }).text(opt[1])
                    .prop("selected", (node.unit || "ms") === opt[0])
                    .appendTo(unitSelect);
            });
        }
    });
}
