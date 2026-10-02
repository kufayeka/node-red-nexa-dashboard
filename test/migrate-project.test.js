// scripts/migrate-project.js on a copy of an old flows file (in the temp folder).
// Run standalone: node test/migrate-project.test.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

let failures = 0;
function check(label, ok, actual) {
    if (!ok) failures++;
    console.log(label + "?", !!ok, "(actual: " + JSON.stringify(actual) + ")");
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexa-migrate-"));
const file = path.join(dir, "flows.json");
const old = [
    { id: "tab1", type: "tab", label: "T" },
    { id: "inj", type: "inject", z: "tab1", repeat: "5" }, // a Node-RED node: not touched
    { id: "proj", type: "kufayeka-nexa-project", name: "Old", screens: [{ id: "s1", name: "S", treeVersion: 1, components: [],
        logic: { nodes: [{ id: "a", type: "http-request", x: 10, y: 20, method: "GET", url: "https://x/y" }, { id: "b", type: "debug", x: 200, y: 20 }], wires: [{ from: "a", to: "b" }] } }],
    templates: [{ id: "t1", name: "T", treeVersion: 1, components: [], logic: { nodes: [{ id: "c", type: "set-variable", x: 0, y: 0, name: "n", op: "set" }], wires: [] } }],
    flows: [{ id: "f1", name: "F", endpoint: "/f", logic: { nodes: [{ id: "r", type: "render-screen", x: 0, y: 0, screenId: "s1" }], wires: [] } }] }
];
fs.writeFileSync(file, JSON.stringify(old));
const run = (args) => spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "migrate-project.js")].concat(args), { encoding: "utf8" });

const dry = run([file, "--dry-run"]);
check("--dry-run counts 4 nodes and writes nothing", /4 Logic node/.test(dry.stdout) && fs.readFileSync(file, "utf8") === JSON.stringify(old), dry.stdout.trim());

const r = run([file]);
const out = JSON.parse(fs.readFileSync(file, "utf8"));
const proj = out.find((n) => n.type === "kufayeka-nexa-project");
const a = proj.screens[0].logic.nodes[0];
check("the config is in node.props; id / type / x / y stay on the node", a.props.url === "https://x/y" && a.props.method === "GET" && a.url === undefined && a.x === 10 && a.type === "http-request", a);
check("templates and flows too", proj.templates[0].logic.nodes[0].props.name === "n" && proj.flows[0].logic.nodes[0].props.screenId === "s1", null);
check("wires untouched", JSON.stringify(proj.screens[0].logic.wires) === '[{"from":"a","to":"b"}]', proj.screens[0].logic.wires);
check("other Node-RED nodes untouched", JSON.stringify(out[1]) === JSON.stringify(old[1]), out[1]);
check("a backup of the original is next to it", fs.readdirSync(dir).some((f) => /^flows\.json\.bak-/.test(f) && fs.readFileSync(path.join(dir, f), "utf8") === JSON.stringify(old)), fs.readdirSync(dir));
const again = run([file]);
check("running it again: already up to date", /already up to date/.test(again.stdout), again.stdout.trim());

fs.rmSync(dir, { recursive: true, force: true });
if (!failures) console.log("ALL OK");
process.exit(failures ? 1 : 0);
