// The SDK's defineLogicNode (src/sdk/logic-node.js), without a browser: what it registers,
// and what it refuses. Run standalone: node test/sdk-logic-node.test.js
await import("../src/features/logic/meta.js"); // the built-in types (a plugin can't take theirs)
const { defineLogicNode } = await import("../src/sdk/logic-node.js");
const R = await import("../src/features/logic/registry.js");

let failures = 0;
function check(label, ok, actual) {
    if (!ok) failures++;
    console.log(label + "?", !!ok, "(actual: " + JSON.stringify(actual) + ")");
}
function throws(fn, re) { try { fn(); return false; } catch (e) { return re.test(e.message); } }

const run = (node, msg) => msg;
const m = defineLogicNode({
    type: "acme-read", label: "Read", help: "Reads it.",
    palette: { section: "Acme", icon: "fa-plug" },
    outputs: 2, outputLabels: ["value", "error"],
    properties: { address: { type: "number", default: 40001 }, unit: { default: "{msg.payload.unit}" } },
    nodeLabel: (node) => "Read " + node.props.address,
    run
});
check("meta: a plugin node, its ports, its palette section", m.plugin && m.outputs === 2 && m.inputs === 1 && m.palette.section === "Acme" && m.palette.label === "Read", { plugin: m.plugin, outputs: m.outputs, palette: m.palette });
check("fields normalized like a component's (type inferred, label humanized)", m.fields.props.unit.type === "string" && m.fields.props.address.label === "Address", Object.keys(m.fields.props));
check("defaults: the palette chip's starting props", JSON.stringify(m.defaults) === '{"address":40001,"unit":"{msg.payload.unit}"}', m.defaults);
check("editor half: the canvas label from nodeLabel", R.logicEditor("acme-read").label({ props: { address: 7 } }) === "Read 7", null);
check("page half: run", R.logicRuntime("acme-read").run === run, null);
check("logicOutputCount sees it", R.logicOutputCount({ type: "acme-read", props: {} }) === 2, null);
check("defaults: 1 input, 1 output, section Plugins", (function () {
    const d = defineLogicNode({ type: "acme-ping", run });
    return d.inputs === 1 && d.outputs === 1 && d.palette.section === "Plugins" && d.label === "acme-ping";
})(), null);

check("refused: a type without a prefix", throws(() => defineLogicNode({ type: "scale", run }), /prefix/), null);
check("refused: upper case", throws(() => defineLogicNode({ type: "Acme-Scale", run }), /lower-case/), null);
check("refused: a built-in type", throws(() => defineLogicNode({ type: "http-request", run }), /built-in/), null);
check("refused: no run()", throws(() => defineLogicNode({ type: "acme-x" }), /run/), null);
check("refused: nodeLabel that isn't a function", throws(() => defineLogicNode({ type: "acme-y", run, nodeLabel: "x" }), /nodeLabel/), null);
check("a plugin may define its own type again (a reload)", !throws(() => defineLogicNode({ type: "acme-read", run }), /./), null);

if (!failures) console.log("ALL OK");
process.exit(failures ? 1 : 0);
