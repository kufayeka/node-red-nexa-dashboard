// Runs every mock test in this folder as its own child process (matching
// how they were run by hand throughout development) and reports a single
// pass/fail summary. Each test is plain hand-written Node.js against a
// minimal DOM/jQuery shim (no jsdom in this environment) — see the comment
// at the top of each file for exactly what it does and doesn't verify.
//
// IMPORTANT: this always extracts a FRESH copy of the editor's bundled
// <script> from lib/nexa-plugin.html before running the editor-side tests —
// running against a stale extraction after a src/ change is a real mistake
// this project's own history has hit more than once.
//
// Usage:
//   node test/run-all.js          # build + run everything
//   npm test                      # same, via package.json
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EXTRACTED_EDITOR = path.join(__dirname, ".extracted-editor.js");
const REGISTRY_CLIENT = path.join(ROOT, "lib", "nexa-registry-client.js");
const RUNTIME_CLIENT = path.join(ROOT, "lib", "nexa-runtime-client.js");

// Editor-side tests: take one arg (the extracted editor script).
const EDITOR_TESTS = [
    "mock-registry.js", "mock-resize.js", "mock-multiselect.js", "mock-group.js",
    "mock-clipboard.js", "mock-layers.js", "mock-zoom.js", "mock-logic.js",
    "mock-templates-editor.js"
];
// Runtime-side tests: take two args (registry client, runtime client).
const RUNTIME_TESTS = [
    "mock-runtime-client.js", "mock-templates-runtime.js",
    "mock-lit-runtime.js", "mock-lit-mount-template.js",
    "mock-sparkplug-render-perf.js", "mock-sparkplug-template-param-regression.js"
];
// Standalone: no args, no DOM at all.
const STANDALONE_TESTS = ["mock-lit-compile.js", "mock-sparkplug-tree.js", "mock-sparkplug-rebirth.js", "mock-nexa-sparkplug-node.js"];

function runBuild() {
    console.log("[test] Building editor bundle (npm run build)...");
    const result = spawnSync(process.execPath, [path.join(ROOT, "build.js")], { cwd: ROOT, encoding: "utf8" });
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    if (result.status !== 0) {
        console.error("[test] Build failed — aborting test run.");
        process.exit(1);
    }
}

function extractEditorScript() {
    const html = fs.readFileSync(path.join(ROOT, "lib", "nexa-plugin.html"), "utf8");
    const m = /<script type="text\/javascript">([\s\S]*)<\/script>/.exec(html);
    if (!m) {
        console.error("[test] Could not find the built <script> block in lib/nexa-plugin.html.");
        process.exit(1);
    }
    fs.writeFileSync(EXTRACTED_EDITOR, m[1], "utf8");
}

function runOne(file, args) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { encoding: "utf8" });
    const output = (result.stdout || "") + (result.stderr || "");
    const crashed = result.status !== 0 && !/ALL OK/.test(output);
    const hasAllOk = /ALL OK/.test(output);
    const falseAssertions = (output.match(/\?\s*false\b/g) || []).length;
    const ok = hasAllOk && falseAssertions === 0 && !crashed;
    return { file, ok, crashed, falseAssertions, output };
}

function main() {
    runBuild();
    extractEditorScript();

    const results = [];
    EDITOR_TESTS.forEach(f => results.push(runOne(f, [EXTRACTED_EDITOR])));
    RUNTIME_TESTS.forEach(f => results.push(runOne(f, [REGISTRY_CLIENT, RUNTIME_CLIENT])));
    STANDALONE_TESTS.forEach(f => results.push(runOne(f, [])));

    console.log("");
    console.log("=".repeat(60));
    let anyFailed = false;
    results.forEach(r => {
        if (r.ok) {
            console.log(`PASS  ${r.file}`);
        } else {
            anyFailed = true;
            console.log(`FAIL  ${r.file}${r.crashed ? " (crashed)" : ""}${r.falseAssertions ? ` (${r.falseAssertions} failed assertion(s))` : ""}`);
            console.log("------ output ------");
            console.log(r.output);
            console.log("--------------------");
        }
    });
    console.log("=".repeat(60));
    console.log(anyFailed ? "RESULT: FAILED" : "RESULT: ALL PASSED");
    process.exit(anyFailed ? 1 : 0);
}

main();
