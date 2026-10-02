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
        label: function (node) { return "Send to Host" + (node.props.output && node.props.output !== "out" ? " (" + node.props.output + ")" : ""); },
        edit: openTemplateOutputNodeEditor,
        hint: "Double-click to configure"
    },
    "template-event": {
        label: function (node) { return instanceName(node.props.instanceId) + " on " + (node.props.output || "any output"); },
        edit: openTemplateOutputNodeEditor,
        hint: "Double-click to configure"
    },
    "set-template-param": {
        label: function (node) {
            const comp = findComponent(node.props.instanceId);
            const tpl = comp && findTemplate(comp.templateId);
            const param = tpl && (tpl.params || []).find(function (p) { return p.name === node.props.paramName; });
            return instanceName(node.props.instanceId, "Instance") + " → Set " + (param ? param.label : node.props.paramName);
        }
    },
    "populate": {
        label: function (node) {
            const tpl = node.props.template ? findTemplate(node.props.template) : null;
            const noItems = node.props.mode === "clear" || node.props.mode === "remove";
            if (!node.props.container) {
                return (POPULATE_WORDS[node.props.mode] || "Populate ") + (noItems ? "items" : (tpl ? tpl.name : "?") + (node.props.itemParam ? " → " + node.props.itemParam : "")) + " → layout";
            }
            const screen = getActiveScreen();
            const target = screen ? Tree.find(screen, node.props.container) : null;
            return (POPULATE_INTO[node.props.mode] || "Populate ") + (target ? (target.name || "Frame") : "?") +
                (noItems ? "" : " × " + (tpl ? tpl.name : "?") + (node.props.itemParam ? " → " + node.props.itemParam : ""));
        },
        edit: openPopulateNodeEditor,
        hint: "Double-click to configure"
    },
    "layout": {
        label: function (node) {
            const screen = getActiveScreen();
            const frame = node.props.container && screen ? Tree.find(screen, node.props.container) : null;
            return frame ? (frame.name || ("Frame #" + frame.id.slice(-4))) : "Layout (missing frame)";
        },
        edit: openLayoutNodeEditor,
        hint: "Double-click to choose the frame. Its output: what its copies send (Send to Host)."
    }
});
