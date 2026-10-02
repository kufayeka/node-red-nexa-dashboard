// The Logic node registry (src/features/logic/): every type is complete, and the rest
// of the code doesn't switch on Logic node types again (docs/ARCHITECTURE.md).
// Run standalone: node test/logic-registry.test.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.window = globalThis.window || { NEXA: { getComponent: function () { return null; } } };
const R = await import("../src/features/logic/registry.js");
await import("../src/features/logic/runtime.js");
await import("../src/features/logic/editor.js");

let failures = 0;
function check(label, ok, actual) {
    if (!ok) failures++;
    console.log(label + "?", !!ok, "(actual: " + JSON.stringify(actual) + ")");
}

const types = R.logicTypes();
check("about 40 node types registered", types.length >= 40, types.length);

const noRuntime = types.filter((t) => !R.logicRuntime(t));
check("every type has a runtime half (page)", noRuntime.length === 0, noRuntime);

const badMeta = types.filter((t) => {
    const m = R.logicMeta(t);
    return !m.color || !m.icon || !m.chipColor || (m.inputs !== 0 && m.inputs !== 1) || !(m.outputs >= 0);
});
check("every meta has colour, icon, chip colour, inputs 0/1, outputs >= 0", badMeta.length === 0, badMeta);

const noLabel = types.filter((t) => {
    const ed = R.logicEditor(t);
    let label;
    try { label = ed && ed.label ? ed.label({ id: "n1", type: t, props: {} }) : R.logicMeta(t).label; } catch (e) { return true; }
    return !label || typeof label !== "string";
});
check("every type gets a label in the editor, even unconfigured", noLabel.length === 0, noLabel);

check("Switch: one port per rule", R.logicOutputCount({ type: "switch", props: { rules: [{}, {}, {}] } }) === 3, R.logicOutputCount({ type: "switch", props: { rules: [{}, {}, {}] } }));
check("Request: 2 ports (answer, error)", R.logicOutputCount({ type: "link-request" }) === 2 && R.logicMeta("link-request").outputLabels[1] === "error", null);
check("a sink has 0 output ports", R.logicOutputCount({ type: "debug" }) === 0, R.logicOutputCount({ type: "debug" }));
check("an unknown type falls back (1 in, 1 out)", R.logicOutputCount({ type: "nope" }) === 1 && R.logicMeta("nope").inputs === 1, null);

// the rule: Logic node types are switched on only inside src/features/logic/
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const logicTypeRe = new RegExp("\\.type\\s*===\\s*\"(" + types.map((t) => t.replace(/[-]/g, "\\-")).join("|") + ")\"");
const offenders = [];
(function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) { if (p !== path.join(SRC, "features", "logic")) walk(p); return; }
        if (!d.name.endsWith(".js")) return;
        fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
            if (/\bnode\.type\s*===/.test(line) && logicTypeRe.test(line)) offenders.push(path.relative(SRC, p) + ":" + (i + 1));
        });
    });
})(SRC);
check("no `node.type === \"<logic type>\"` outside src/features/logic/", offenders.length === 0, offenders);

if (!failures) console.log("ALL OK");
process.exit(failures ? 1 : 0);
