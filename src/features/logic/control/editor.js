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
            const prop = (node.propertyType === "var" ? "$" : node.propertyType === "tag" ? "" : "msg.") + (node.property || "payload");
            return (node.name || "Switch") + " [" + prop + " : " + (node.rules || []).length + "]";
        },
        edit: openSwitchNodeEditor,
        hint: "Double-click to configure switch rules",
        portTitle: function (node, i) {
            const rules = node.rules && node.rules.length ? node.rules : [{ t: "eq" }];
            return rules[i] ? (rules[i].t || "rule") : "";
        }
    },
    "delay": {
        label: function (node) { return "Delay (" + (node.delay != null ? node.delay : 500) + (node.unit || "ms") + ")"; },
        edit: openDelayNodeEditor,
        hint: "Double-click to configure delay"
    },
    "join": {
        label: function (node) {
            const mode = node.mode || "wait-all";
            const word = mode === "sequence-n" ? "Seq " + (node.count || 2) : (JOIN_MODES[mode] || "Join");
            const n = (node.slots || []).length;
            return "Join [" + word + (n ? ": " + n : "") + "]";
        },
        edit: openJoinNodeEditor,
        hint: "Double-click to configure join mode and slots"
    }
});
