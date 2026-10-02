// Variable nodes in the editor: labels read "Set screen.count = 1", "Watch (App.$breakpoint)".
import { defineLogicEditors } from "../registry.js";
import { state, getActiveScreen, Tree } from "../../../state.js";
import { openSetVariableNodeEditor } from "./set-variable-dialog.js";
import { openSetVariableMultiNodeEditor } from "./set-variable-multi-dialog.js";
import { openGetVariableMultiNodeEditor } from "./get-variable-multi-dialog.js";

const OPS = { merge: "Merge into ", append: "Append to ", remove: "Remove from ", toggle: "Toggle ", increment: "Increment " };

/** "App.x", "<frame name>.x", "screen.x" / "template.x" */
function varRef(scope, name) {
    const screen = getActiveScreen();
    const owner = scope && scope !== "@app" && screen ? Tree.find(screen, scope) : null;
    const where = scope === "@app" ? "App" : scope ? (owner ? (owner.name || owner.type) : "?") : (state.editingMode === "template" ? "template" : "screen");
    return where + "." + name;
}

const varHint = "Double-click to configure";

defineLogicEditors({
    "set-variable": {
        label: function (node) {
            if (!node.props.name) return "Set Variable";
            const value = node.props.valueSource === "static" && node.props.op !== "toggle" ? " = " + JSON.stringify(node.props.value)
                : node.props.valueSource === "msg" ? " ← msg." + node.props.msgPath : "";
            return (OPS[node.props.op] || "Set ") + varRef(node.props.scope, node.props.name) + value;
        },
        edit: openSetVariableNodeEditor,
        hint: varHint
    },
    "get-variable": {
        label: function (node) {
            if (!node.props.name) return "Get Variable";
            return "Get " + varRef(node.props.scope, node.props.name) + (node.props.target && node.props.target !== "payload" ? " → msg." + node.props.target : "");
        },
        edit: openSetVariableNodeEditor,
        hint: varHint
    },
    "on-variable-change": {
        label: function (node) {
            if (Array.isArray(node.props.variables) && node.props.variables.length) {
                return "Watch (" + node.props.variables.map(function (v) { return v ? varRef(v.scope, v.name) : "?"; }).join(", ") + ")";
            }
            return node.props.name ? "Watch " + varRef(node.props.scope, node.props.name) : "Watch Variable";
        },
        edit: openSetVariableNodeEditor,
        hint: varHint
    },
    "set-variable-multi": {
        label: function (node) { const n = (node.props.assignments || []).length; return "Set Variables" + (n ? " (" + n + ")" : ""); },
        edit: openSetVariableMultiNodeEditor,
        hint: "Double-click to configure variable assignments"
    },
    "get-variable-multi": {
        label: function (node) { const n = (node.props.reads || []).length; return "Get Variables" + (n ? " (" + n + ")" : ""); },
        edit: openGetVariableMultiNodeEditor,
        hint: "Double-click to configure variable reads"
    }
});
