// Web and browser-data nodes in the editor (one dialog for the three).
import { defineLogicEditors } from "../registry.js";
import { openWebIoNodeEditor } from "./web-io-dialog.js";

const ACTION = { set: "Set ", remove: "Remove " };

defineLogicEditors({
    "http-request": {
        label: function (node) {
            const u = node.props.url || "";
            return (node.props.method || "GET") + " " + (u ? (u.length > 50 ? u.slice(0, 49) + "…" : u) : "(no URL)");
        },
        edit: openWebIoNodeEditor,
        hint: "Double-click to configure"
    },
    "storage": {
        label: function (node) { return (ACTION[node.props.action] || "Get ") + (node.props.store === "session" ? "session" : "local") + " " + (node.props.key || "?"); },
        edit: openWebIoNodeEditor,
        hint: "Double-click to configure"
    },
    "cookie": {
        label: function (node) { return (ACTION[node.props.action] || "Get ") + "cookie " + (node.props.name || "?"); },
        edit: openWebIoNodeEditor,
        hint: "Double-click to configure"
    }
});
