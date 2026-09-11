import { markDirty } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

export function openInjectNodeEditor(node) {
    var intervalInput, payloadTypeSelect, payloadInput, onceInput;
    window.RED.tray.show({
        id: "nexa-logic-inject-editor",
        title: "Configure Inject Node",
        width: 450,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.intervalMs = Math.max(0, parseInt(intervalInput.val(), 10) || 0);
                    node.payloadType = payloadTypeSelect.val();
                    node.payload = payloadInput.val();
                    node.once = onceInput.is(":checked");
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("Fires on the deployed page — can emit a string, JSON object (e.g. { \"text\": \"Hello\" }), number, or timestamp.")
                .appendTo(body);

            var typeRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888" }).text("Payload Type").appendTo(typeRow);
            payloadTypeSelect = window.$("<select>").css({ width: "100%" }).appendTo(typeRow);
            [
                ["json", "JSON Object (e.g. {\"text\": \"Hello\"})"],
                ["str", "String (Text)"],
                ["num", "Number"],
                ["date", "Timestamp (Date.now())"]
            ].forEach(function (opt) {
                window.$("<option>", { value: opt[0] }).text(opt[1])
                    .prop("selected", (node.payloadType || "json") === opt[0])
                    .appendTo(payloadTypeSelect);
            });

            var valRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888" }).text("Payload").appendTo(valRow);
            payloadInput = window.$("<textarea>")
                .css({ width: "100%", height: "60px", "box-sizing": "border-box", "font-family": "monospace", "font-size": "12px" })
                .val(node.payload !== undefined ? node.payload : '{"text": "Hello World"}')
                .appendTo(valRow);

            function updatePayloadUi() {
                var t = payloadTypeSelect.val();
                if (t === "date") {
                    valRow.hide();
                } else {
                    valRow.show();
                }
            }
            payloadTypeSelect.on("change", updatePayloadUi);
            updatePayloadUi();

            var intervalRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888" }).text("Repeat every (ms, 0 to disable repeat)").appendTo(intervalRow);
            intervalInput = window.$("<input>", { type: "number" }).css({ width: "100%", "box-sizing": "border-box" }).val(node.intervalMs !== undefined ? node.intervalMs : 5000).appendTo(intervalRow);

            var onceRow = window.$("<div>").css({ "margin-top": "10px" }).appendTo(body);
            onceInput = window.$("<input>", { type: "checkbox" }).prop("checked", !!node.once).css({ "margin-right": "6px" });
            onceRow.append(onceInput).append(window.$("<label>").css({ "font-size": "11px", color: "#555" }).text("Fire once on startup"));
        }
    });
}
