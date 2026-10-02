// Flow control in the editor: labels and dialogs.
import { defineLogicEditors } from "../registry.js";
import { openFunctionNodeEditor } from "./function-dialog.js";
import { openSwitchNodeEditor } from "./switch-dialog.js";
import { openDelayNodeEditor } from "./delay-dialog.js";
import { openJoinNodeEditor } from "./join-dialog.js";

const JOIN_MODES = { "wait-all": "Wait All", "combine-latest": "Combine Latest" };

defineLogicEditors({
    "function": { edit: openFunctionNodeEditor, hint: "Double-click to edit code" },
    "switch": {
        label: function (node) {
            const prop = (node.props.propertyType === "var" ? "$" : node.props.propertyType === "tag" ? "" : "msg.") + (node.props.property || "payload");
            return (node.props.name || "Switch") + " [" + prop + " : " + (node.props.rules || []).length + "]";
        },
        edit: openSwitchNodeEditor,
        hint: "Double-click to configure switch rules",
        portTitle: function (node, i) {
            const rules = node.props.rules && node.props.rules.length ? node.props.rules : [{ t: "eq" }];
            return rules[i] ? (rules[i].t || "rule") : "";
        }
    },
    "delay": {
        label: function (node) { return "Delay (" + (node.props.delay != null ? node.props.delay : 500) + (node.props.unit || "ms") + ")"; },
        edit: openDelayNodeEditor,
        hint: "Double-click to configure delay"
    },
    "join": {
        label: function (node) {
            const mode = node.props.mode || "wait-all";
            const word = mode === "sequence-n" ? "Seq " + (node.props.count || 2) : (JOIN_MODES[mode] || "Join");
            const n = (node.props.slots || []).length;
            return "Join [" + word + (n ? ": " + n : "") + "]";
        },
        edit: openJoinNodeEditor,
        hint: "Double-click to configure join mode and slots"
    }
});
