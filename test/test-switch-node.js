import assert from "node:assert/strict";
import { LOGIC_NODE_KINDS, LOGIC_NODE_H, LOGIC_NODE_W } from "../src/state.js";
import { logicNodeLabel, logicNodeHeight } from "../src/logic/logic-nodes.js";
import { logicNodePortPoint } from "../src/logic/logic-wires.js";

console.log("--- 1. LOGIC_NODE_KINDS Switch Definition ---");
const switchKind = LOGIC_NODE_KINDS["switch"];
assert.ok(switchKind, "LOGIC_NODE_KINDS['switch'] must be registered");
assert.equal(switchKind.label, "Switch");
assert.equal(switchKind.hasInput, true);
assert.equal(switchKind.hasOutput, true);
assert.equal(switchKind.color, "#e2d96e");
console.log("LOGIC_NODE_KINDS['switch'] is correctly defined? true");

console.log("--- 2. Logic Node Label Formatting ---");
const mockNode = {
    id: "sw1",
    type: "switch",
    name: "Route By Status",
    property: "status",
    propertyType: "msg",
    rules: [{ t: "eq", v: "active" }, { t: "eq", v: "inactive" }, { t: "else" }]
};
const label = logicNodeLabel(mockNode);
assert.equal(label, "Route By Status [msg.status : 3]");
console.log("logicNodeLabel formats switch correctly?", label);

console.log("--- 3. Dynamic Node Height by Rule Count ---");
const singleRuleHeight = logicNodeHeight({ type: "switch", rules: [{ t: "eq" }] });
assert.equal(singleRuleHeight, LOGIC_NODE_H, "Single rule should default to standard LOGIC_NODE_H");

const multiRuleNode = {
    type: "switch",
    x: 100,
    y: 100,
    rules: [{ t: "1" }, { t: "2" }, { t: "3" }, { t: "4" }]
};
const multiRuleHeight = logicNodeHeight(multiRuleNode);
assert.equal(multiRuleHeight, 4 * 20 + 10, "4 rules should expand height to 90px");
console.log("Dynamic height calculation works? true");

console.log("--- 4. Multi-Port Output Coordinates ---");
const p0 = logicNodePortPoint(multiRuleNode, "output", 0);
const p1 = logicNodePortPoint(multiRuleNode, "output", 1);
const p2 = logicNodePortPoint(multiRuleNode, "output", 2);
const p3 = logicNodePortPoint(multiRuleNode, "output", 3);

assert.ok(p0.y < p1.y && p1.y < p2.y && p2.y < p3.y, "Ports should be spaced vertically in ascending order");
console.log("Output port offsets calculated correctly? true");

console.log("ALL OK - SWITCH NODE VERIFIED!");
