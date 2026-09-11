import { markDirty } from "../state.js";

export function openFunctionNodeEditor(node) {
    var codeEditor = null;
    window.RED.tray.show({
        id: "nexa-logic-function-editor",
        title: "Edit Function",
        width: 700,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Done", "class": "primary",
                click: function () {
                    if (codeEditor) node.code = codeEditor.getValue();
                    markDirty();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "0" });
            window.$("<div>").css({ padding: "8px 12px", "font-size": "12px", color: "#888" })
                .text("Receives msg (e.g. msg.payload from the node before this one). Return a new msg object to pass along the wire, or null to stop here.")
                .appendTo(body);
            window.$("<div>", { id: "nexa-logic-function-code" }).css({ height: "320px" }).appendTo(body);
            codeEditor = window.RED.editor.createEditor({
                id: "nexa-logic-function-code",
                mode: "ace/mode/javascript",
                value: node.code || "return msg;"
            });
        },
        close: function () {
            if (codeEditor && codeEditor.destroy) codeEditor.destroy();
        }
    });
}
