// --- defineLogicNode({...}): a Logic node from a plugin, the way defineComponent makes a component.
//   import { defineLogicNode } from "../../nexa-sdk/nexa-component-sdk.js";
//   export default defineLogicNode({
//       type: "acme-modbus-read",                     // unique: a prefix of your own + a name
//       label: "Modbus Read",                         // the palette chip and the default canvas label
//       help: "Reads a holding register.",
//       palette: { section: "Industrial", icon: "fa-plug", color: "#2f6f8f", chipColor: "#d9e8f0" },
//       inputs: 1, outputs: 2, outputLabels: ["value", "error"],
//       properties: { address: { type: "number", default: 40001 } },   // the node's dialog is built from these
//       nodeLabel: (node) => "Read " + node.props.address,              // optional: the label on the canvas
//       run(node, msg, ctx) { … }                                       // on the page
//   });
// The same module loads in the editor and on the page (like a component plugin): the editor uses
// the palette entry, the label and the fields; the page uses run(). The node keeps its settings in
// node.props. Registry: src/features/logic/registry.js (one per page, shared by every bundle).
//
// run(node, msg, ctx): return a msg to pass it on through output 1, or return nothing and call
// ctx.next(msg) / ctx.nextPort(port, msg) later (async). ctx: next, nextPort, resolve(text, msg)
// (the {var} / {msg.x} / {$route…} bindings a field may hold), vars.get / vars.set, log(…).
import { defineLogicNodes, defineLogicEditors, defineLogicRuntimes, hasLogicType, logicMeta } from "../features/logic/registry.js";
import { buildFieldsMeta, defaultValues } from "./schema.js";

const TYPE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

export function defineLogicNode(def) {
    if (!def || typeof def.type !== "string" || !TYPE_RE.test(def.type)) {
        throw new Error("[nexa] defineLogicNode: `type` must be lower-case words joined by \"-\", with a prefix of your own (\"acme-modbus-read\"); got " + JSON.stringify(def && def.type));
    }
    if (hasLogicType(def.type) && !logicMeta(def.type).plugin) {
        throw new Error("[nexa] defineLogicNode(\"" + def.type + "\"): a built-in Logic node already has this type");
    }
    if (typeof def.run !== "function") throw new Error("[nexa] defineLogicNode(\"" + def.type + "\"): `run(node, msg, ctx)` is required");
    if (def.nodeLabel !== undefined && typeof def.nodeLabel !== "function") throw new Error("[nexa] defineLogicNode(\"" + def.type + "\"): `nodeLabel` must be a function (node) -> string");

    const label = typeof def.label === "string" && def.label ? def.label : def.type;
    const palette = def.palette || {};
    const fields = buildFieldsMeta(def.type, def.properties || {});

    defineLogicNodes([{
        type: def.type,
        label: label,
        color: palette.color || "#5b6b8a",
        icon: palette.icon || "fa-cube",
        chipColor: palette.chipColor || "#e5e9f2",
        inputs: def.inputs === 0 ? 0 : 1,
        outputs: def.outputs === undefined ? 1 : Math.max(0, Math.floor(Number(def.outputs) || 0)),
        outputLabels: Array.isArray(def.outputLabels) ? def.outputLabels.slice() : undefined,
        exclusivePorts: !!def.exclusivePorts,
        help: def.help || "",
        // a plugin node: the editor puts it in the palette (its section) and builds its dialog from the fields
        plugin: true,
        palette: { section: palette.section || "Plugins", label: palette.label || label },
        fields: fields,
        defaults: defaultValues(fields)
    }]);
    defineLogicEditors({
        [def.type]: {
            label: def.nodeLabel,
            hint: Object.keys(fields.props).length ? "Double-click to configure" : undefined
        }
    });
    defineLogicRuntimes({ [def.type]: { run: def.run } });
    return logicMeta(def.type);
}
