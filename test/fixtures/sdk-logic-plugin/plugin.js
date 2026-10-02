// FIXTURE for test/runtime-logic-plugin-browser.test.js (and the shape of a real plugin):
// a Logic node from the SDK, nothing else. It loads as an ES module, so on the page it
// registers after the runtime started.
import { defineLogicNode } from "../../nexa-sdk/nexa-component-sdk.js";

export const scale = defineLogicNode({
    type: "acme-scale",
    label: "Scale",
    help: "Multiplies a field of msg.payload. Output 2: the field isn't a number.",
    palette: { section: "Acme", icon: "fa-calculator", color: "#2f6f8f", chipColor: "#d9e8f0" },
    inputs: 1,
    outputs: 2,
    outputLabels: ["scaled", "error"],
    exclusivePorts: true,
    properties: {
        field: { type: "string", default: "v", label: "Field of msg.payload" },
        factor: { type: "string", default: "2", label: "Factor (a number or a binding, e.g. {msg.payload.k})" }
    },
    nodeLabel: (node) => "Scale " + node.props.field + " × " + node.props.factor,
    run(node, msg, ctx) {
        const factor = Number(ctx.resolve(node.props.factor, msg));
        const v = msg && msg.payload ? msg.payload[node.props.field] : undefined;
        if (typeof v !== "number" || !isFinite(factor)) {
            ctx.nextPort(1, Object.assign({}, msg, { error: node.props.field + " is not a number" }));
            return;
        }
        // async on purpose: ctx.nextPort later
        setTimeout(() => ctx.nextPort(0, Object.assign({}, msg, { payload: v * factor })), 10);
    }
});
