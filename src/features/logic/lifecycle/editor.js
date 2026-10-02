// Lifecycle sources in the editor.
import { defineLogicEditors } from "../registry.js";
import { openInjectNodeEditor } from "./inject-dialog.js";

defineLogicEditors({
    "inject": {
        label: function (node) {
            const p = node.props.payloadType === "json" ? "JSON" : node.props.payloadType === "str" ? (node.props.payload || "str") : (node.props.payloadType || "date");
            return "Inject (" + p + ")";
        },
        edit: openInjectNodeEditor,
        hint: "Double-click to configure"
    }
});
