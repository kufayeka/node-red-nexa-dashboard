import { markDirty } from "../state.js";
import { createCM6Editor } from "../editor/cm6-code-editor.js";
import { sparkplugBindingCompletionSource } from "../editor/nexa-completions.js";

// CodeMirror 6 — deliberately NOT RED.editor.createEditor (ace/monaco). See
// lit-code-dialog.js's own header comment for the full incident history:
// two targeted Monaco fixes both failed to stop a severe, reported browser
// freeze on Ctrl+A -> Ctrl+C -> Ctrl+V (reproducible even with short code),
// which led to a plain <textarea> guaranteed-safe fallback, and now to CM6
// for syntax highlighting/autocomplete without Monaco's architecture.
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
            var body = tray.find(".red-ui-tray-body").css({ padding: "8px 12px", height: "100%", display: "flex", "flex-direction": "column", "box-sizing": "border-box" });
            window.$("<div>").css({ padding: "0 0 8px 0", "font-size": "12px", color: "#888", "flex-shrink": "0" })
                .text("Receives msg (e.g. msg.payload from the node before this one). Return a new msg object to pass along the wire, or null to stop here.")
                .appendTo(body);
            var editorContainer = window.$("<div>", { id: "nexa-logic-function-editor-mount" }).css({ flex: "1 1 auto", "min-height": "0" }).appendTo(body);
            codeEditor = createCM6Editor({
                parent: editorContainer.get(0),
                value: node.code || "return msg;",
                language: "javascript",
                completionSource: sparkplugBindingCompletionSource
            });
            codeEditor.focus();
        },
        close: function () {
            if (codeEditor) codeEditor.destroy();
        }
    });
}
