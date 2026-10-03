// --- The inspector of the selected node: every source, one property tree ---------------
// The order of the tree's groups: what it is, then where it is and how it is sized, then the
// component's own groups (in its `groups` order), then a frame's layout and look, its
// variables, teleport. A group several sources share (a component's "General") is one group.
import { renderComposed } from "./compose.js";
import { general, geometry, groupBox } from "./sources/node.js";
import { position, layoutChild, constraints, teleport, instanceBox } from "./sources/layout.js";
import { frame } from "./sources/frame.js";
import { variablesSource } from "./sources/variables.js";
import { params, lit, legacy } from "./sources/template.js";
import { componentSource } from "../kit-inspector.js";

var BEFORE = ["General", "Position & Size", "Position", "Layout", "Constraints"];
var AFTER = ["Parameters", "Lit Code", "Properties", "Overlay", "Auto layout", "Slides", "Fill & stroke", "Zoom & pan", "Teleport"];

var SOURCES = [general, instanceBox, geometry, groupBox, frame, position, layoutChild, constraints,
    componentSource, params, lit, legacy, teleport];

/** The component's groups, in its order: `groups`, then the order its props declare them. */
function componentGroups(typeDef) {
    var meta = typeDef && typeDef.nexa;
    if (!meta) return [];
    var out = (meta.groupOrder || []).slice();
    Object.keys(meta.props).forEach(function (k) {
        var g = meta.props[k].group || "General";
        if (out.indexOf(g) === -1) out.push(g);
    });
    return out.filter(function (g) { return BEFORE.indexOf(g) === -1 && AFTER.indexOf(g) === -1; });
}

/**
 * The selected node's inspector.
 *   extras = { typeDef, template, refreshHierarchy }
 * -> the kit's handle
 */
export function renderNodeInspector(container, node, extras) {
    extras = extras || {};
    var persist = node.type === "@template" ? "@template:" + node.templateId : node.type;
    return renderComposed(container, node, {
        sources: SOURCES,
        ctx: { typeDef: extras.typeDef || null, template: extras.template || null, refreshHierarchy: extras.refreshHierarchy || null },
        meta: extras.typeDef && extras.typeDef.nexa ? extras.typeDef.nexa : null,
        persistKey: "node:" + persist,
        groupOrder: BEFORE.concat(componentGroups(extras.typeDef), AFTER)
    });
}

/**
 * The variables of a surface on their own (the screen: "screen", a template: "template", the
 * app: "app"), for the panels that show them. `owner` holds `variables`.
 */
export function renderVariablesInspector(container, owner, kind) {
    if (!window.NexaKit || !window.NEXA_LIT) return false;
    return renderComposed(container, {}, {
        sources: [variablesSource(kind)],
        ctx: { owner: owner },
        persistKey: "variables:" + (kind || "node")
    });
}
