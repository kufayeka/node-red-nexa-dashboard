import { markDirty } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

export function openOpenUrlNodeEditor(node) {
    var modeSelect, urlInput, newTabInput;
    window.RED.tray.show({
        id: "nexa-logic-openurl-editor",
        title: "Configure Open URL Node",
        width: 450,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.mode = modeSelect.val();
                    node.url = urlInput.val();
                    node.newTab = newTabInput.is(":checked");
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("Configure how the deployed page navigates. Can be overridden at runtime via msg.payload.")
                .appendTo(body);

            var modeRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888" }).text("Navigation Mode").appendTo(modeRow);
            modeSelect = window.$("<select>").css({ width: "100%" }).appendTo(modeRow);
            [
                ["replace", "Replace Whole URL (e.g. https://... or /full/path)"],
                ["endpoint", "Endpoint / Sub-path only (e.g. /screen2 or screen2)"]
            ].forEach(function (opt) {
                window.$("<option>", { value: opt[0] }).text(opt[1])
                    .prop("selected", (node.mode || "replace") === opt[0])
                    .appendTo(modeSelect);
            });

            var row = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(body);
            var urlLabel = window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888" }).text("URL or Endpoint").appendTo(row);
            urlInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(node.url || "").appendTo(row);

            function updateUrlPlaceholder() {
                if (modeSelect.val() === "endpoint") {
                    urlLabel.text("Endpoint / Screen Sub-path (e.g. /screen2)");
                    urlInput.attr("placeholder", "/screen2 or screen2");
                } else {
                    urlLabel.text("Full URL (e.g. https://example.com or /nexa/screen2)");
                    urlInput.attr("placeholder", "https://example.com or /nexa/screen2");
                }
            }
            modeSelect.on("change", updateUrlPlaceholder);
            updateUrlPlaceholder();

            var tabRow = window.$("<label>").css({ "font-size": "11px", color: "#888", "margin-top": "6px", display: "block" }).appendTo(body);
            newTabInput = window.$("<input>", { type: "checkbox" }).prop("checked", !!node.newTab).css({ "margin-right": "6px" }).appendTo(tabRow);
            tabRow.append("Open in a new tab");
        }
    });
}
