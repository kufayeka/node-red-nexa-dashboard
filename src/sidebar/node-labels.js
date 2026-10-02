// How a node of the screen tree is named and drawn in a tree list (Hierarchy tab,
// Screens & Flows tab): its own name, else what it is.
import { Tree, findTemplate } from "../state.js";

function componentDef(type) {
    return window.NEXA && typeof window.NEXA.getComponent === "function" ? window.NEXA.getComponent(type) : null;
}

export function nodeLabel(node) {
    // a component's slot (a tab's panel): its slot's label
    if (Tree.isSlotFrame(node)) return (node.name || node.slotLabel || node.inSlot) + (node.slotUnused ? " (not used)" : "");
    if (node.name) return node.name;
    if (node.type === "@group") return "Group";
    if (node.type === "@frame") return "Frame";
    if (node.type === "@template") {
        const t = findTemplate(node.templateId);
        return (t ? t.name : "Template") + " (instance)";
    }
    if (node.type === "@lit-component") return "Lit Component";
    const def = componentDef(node.type);
    return (def && def.label) || node.type;
}

export function nodeIcon(node) {
    if (node.type === "@group") return "fa fa-object-group";
    if (node.type === "@frame" && node.overlay && node.overlay.kind === "dialog") return "fa fa-window-maximize";
    if (node.type === "@frame" && node.overlay && node.overlay.kind === "drawer") return "fa fa-columns";
    if (Tree.isSlotFrame(node)) return "fa fa-window-maximize fa-rotate-180";
    if (node.type === "@frame") return "fa fa-square-o";
    if (node.type === "@template") {
        const t = findTemplate(node.templateId);
        return (t && t.kind === "component") ? "fa fa-puzzle-piece" : "fa fa-clone";
    }
    if (node.type === "@lit-component") return "fa fa-code";
    const def = componentDef(node.type);
    return (def && def.icon) || "fa fa-cube";
}
