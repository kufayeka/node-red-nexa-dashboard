// Sparkplug write nodes in the editor.
import { defineLogicEditors } from "../registry.js";
import { openSparkplugWriteNodeEditor } from "./sparkplug-write-dialog.js";
import { openSparkplugWriteMultiNodeEditor } from "./sparkplug-write-multi-dialog.js";

defineLogicEditors({
    "sparkplug-write": {
        label: function (node) {
            const ref = node.props.tag && node.props.tag.replace(/^\{sparkplug:/, "").replace(/\}$/, "");
            return "Sparkplug Write" + (ref ? " (" + ref + ")" : "");
        },
        edit: openSparkplugWriteNodeEditor,
        hint: "Double-click to configure"
    },
    "sparkplug-write-multi": { edit: openSparkplugWriteMultiNodeEditor, hint: "Double-click for usage" }
});
