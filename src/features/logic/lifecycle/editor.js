// Lifecycle sources in the editor.
import { defineLogicEditors } from "../registry.js";
import { openInjectNodeEditor } from "./inject-dialog.js";

defineLogicEditors({
    "inject": {
        label: function (node) {
            const p = node.payloadType === "json" ? "JSON" : node.payloadType === "str" ? (node.payload || "str") : (node.payloadType || "date");
            return "Inject (" + p + ")";
        },
        edit: openInjectNodeEditor,
        hint: "Double-click to configure"
    }
});
