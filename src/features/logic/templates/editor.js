// Template and list nodes in the editor.
import { defineLogicEditors } from "../registry.js";
import { getActiveScreen, findComponent, findTemplate, Tree } from "../../../state.js";
import { openPopulateNodeEditor, openLayoutNodeEditor } from "./populate-dialog.js";
import { openTemplateOutputNodeEditor } from "./template-output-dialog.js";

const POPULATE_WORDS = { append: "Append ", prepend: "Prepend ", upsert: "Update ", remove: "Remove ", clear: "Clear " };
const POPULATE_INTO = { append: "Append to ", prepend: "Prepend to ", upsert: "Update ", remove: "Remove from ", clear: "Clear " };

function instanceName(instanceId, fallback) {
    const comp = findComponent(instanceId);
    if (comp && comp.name) return comp.name;
    const tpl = comp && findTemplate(comp.templateId);
    return (fallback || (tpl ? tpl.name : "Instance")) + " #" + (comp ? comp.id.slice(-4) : "?");
}

defineLogicEditors({
    "template-output": {
        label: function (node) { return "Send to Host" + (node.output && node.output !== "out" ? " (" + node.output + ")" : ""); },
        edit: openTemplateOutputNodeEditor,
        hint: "Double-click to configure"
    },
    "template-event": {
        label: function (node) { return instanceName(node.instanceId) + " on " + (node.output || "any output"); },
        edit: openTemplateOutputNodeEditor,
        hint: "Double-click to configure"
    },
    "set-template-param": {
        label: function (node) {
            const comp = findComponent(node.instanceId);
            const tpl = comp && findTemplate(comp.templateId);
            const param = tpl && (tpl.params || []).find(function (p) { return p.name === node.paramName; });
            return instanceName(node.instanceId, "Instance") + " → Set " + (param ? param.label : node.paramName);
        }
    },
    "populate": {
        label: function (node) {
            const tpl = node.template ? findTemplate(node.template) : null;
            const noItems = node.mode === "clear" || node.mode === "remove";
            if (!node.container) {
                return (POPULATE_WORDS[node.mode] || "Populate ") + (noItems ? "items" : (tpl ? tpl.name : "?") + (node.itemParam ? " → " + node.itemParam : "")) + " → layout";
            }
            const screen = getActiveScreen();
            const target = screen ? Tree.find(screen, node.container) : null;
            return (POPULATE_INTO[node.mode] || "Populate ") + (target ? (target.name || "Frame") : "?") +
                (noItems ? "" : " × " + (tpl ? tpl.name : "?") + (node.itemParam ? " → " + node.itemParam : ""));
        },
        edit: openPopulateNodeEditor,
        hint: "Double-click to configure"
    },
    "layout": {
        label: function (node) {
            const screen = getActiveScreen();
            const frame = node.container && screen ? Tree.find(screen, node.container) : null;
            return frame ? (frame.name || ("Frame #" + frame.id.slice(-4))) : "Layout (missing frame)";
        },
        edit: openLayoutNodeEditor,
        hint: "Double-click to choose the frame. Its output: what its copies send (Send to Host)."
    }
});
