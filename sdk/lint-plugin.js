#!/usr/bin/env node
// The guard of docs/PLUGIN_RULES.md: what a machine can check in a Nexa component plugin.
//
//   node node_modules/@kufayeka/node-red-nexa-dashboard/sdk/lint-plugin.js [pluginDir]   (default: cwd)
//   require("@kufayeka/node-red-nexa-dashboard/sdk/lint-plugin").lintPlugin(dir) -> [{ rule, file, line, message }]
//
// Exit code 1 when a rule is broken. Each plugin's test runs it, and the dashboard's
// test/plugin-rules.test.js runs it on every plugin next to it.
//
// A justified exception is written where it happens, with a reason (no reason = still an error):
//     fetch(url)   // nexa-lint-allow network: the plugin's own admin route, editor only
// (on the line itself or the line above). Rules: see RULES below.
"use strict";
const fs = require("fs");
const path = require("path");

const SDK_IMPORT = "../../nexa-sdk/nexa-component-sdk.js";

const RULES = {
    "no-inspector": "no hand-written `inspector:` — the inspector is built from the schema (group / section / visibleWhen / editor). PLUGIN_RULES §4",
    "sdk-import-only": "import only the SDK facade (\"" + SDK_IMPORT + "\") or the plugin's own files (\"./x.js\"): no npm packages, no URLs. PLUGIN_RULES §3",
    "no-legacy-register": "no NEXA.registerComponent (the legacy contract): use defineComponent. PLUGIN_RULES §3",
    "no-set-interval": "no setInterval in a view: this.every(ms, fn) stops with the component. PLUGIN_RULES §6",
    "network": "no fetch / XMLHttpRequest / WebSocket / EventSource from a plugin's code: data comes in through inputs and goes out through outputs; the editor talks to its own routes with this.api (adminApi). PLUGIN_RULES §6",
    "storage": "no localStorage / sessionStorage / cookies in a plugin: state is props (saved), variables (the app) or internal `state`. PLUGIN_RULES §6",
    "no-eval": "no eval / new Function. PLUGIN_RULES §6",
    "no-red-global": "no RED.* / window.RED in a plugin's modules: they also run on deployed pages, where there is no Node-RED editor. PLUGIN_RULES §6",
    "no-document-query": "no document.querySelector / getElementById: a view stays inside its own element (this.renderRoot). PLUGIN_RULES §6",
    "package": "package.json needs node-red.plugins and scripts.test, and test/browser.test.js must exist. PLUGIN_RULES §2"
};

// The code without comments (keeps line numbers: they become spaces). blankStrings: string
// contents too (a help text saying "fetch(" is not a call), but not a template literal's
// ${...}, which is code (Lit's @click=${() => ...}).
function stripComments(src, blankStrings) {
    let out = "", i = 0;
    const stack = [];   // what to go back to after a template literal / its ${...}
    let mode = "code", quote = null, depth = 0;
    const put = (ch) => { out += ch === "\n" ? "\n" : (blankStrings ? " " : ch); };
    while (i < src.length) {
        const c = src[i], n = src[i + 1];
        if (mode === "str") {
            if (c === "\\") { put(c); put(n || ""); i += 2; continue; }
            if (c === quote || c === "\n") { mode = "code"; out += c; i++; continue; }
            put(c); i++;
            continue;
        }
        if (mode === "tpl") {
            if (c === "\\") { put(c); put(n || ""); i += 2; continue; }
            if (c === "`") { out += c; i++; const back = stack.pop(); mode = "code"; depth = back ? back.depth : 0; continue; }
            if (c === "$" && n === "{") { stack.push({ kind: "expr", depth: depth }); out += "${"; i += 2; mode = "code"; depth = 0; continue; }
            put(c); i++;
            continue;
        }
        // code
        if (c === '"' || c === "'") { mode = "str"; quote = c; out += c; i++; continue; }
        if (c === "`") { stack.push({ kind: "tpl", depth: depth }); mode = "tpl"; out += c; i++; continue; }
        if (c === "{") { depth++; out += c; i++; continue; }
        if (c === "}") {
            if (depth === 0 && stack.length && stack[stack.length - 1].kind === "expr") { const back = stack.pop(); depth = back.depth; mode = "tpl"; out += c; i++; continue; }
            depth = Math.max(0, depth - 1); out += c; i++; continue;
        }
        if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++; } continue; }
        if (c === "/" && n === "*") {
            i += 2; out += "  ";
            while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
            i += 2; out += "  ";
            continue;
        }
        out += c; i++;
    }
    return out;
}

const CHECKS = [
    { rule: "no-inspector", re: /(^|[,{\s])inspector\s*:/ },
    { rule: "no-legacy-register", re: /\bNEXA\s*\.\s*registerComponent\s*\(/ },
    { rule: "no-set-interval", re: /\bsetInterval\s*\(/ },
    { rule: "network", re: /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b/ },
    { rule: "storage", re: /\b(localStorage|sessionStorage)\b|\bdocument\s*\.\s*cookie\b/ },
    { rule: "no-eval", re: /\beval\s*\(|\bnew\s+Function\s*\(/ },
    { rule: "no-red-global", re: /\bwindow\s*\.\s*RED\b|(^|[^.\w$])RED\s*\./ },
    { rule: "no-document-query", re: /\bdocument\s*\.\s*(querySelector|querySelectorAll|getElementById|getElementsBy\w+)\s*\(/ }
];

function allowed(lines, i, rule) {
    const re = new RegExp("nexa-lint-allow\\s+" + rule + "\\s*:\\s*\\S");
    return re.test(lines[i] || "") || re.test(lines[i - 1] || "");
}

function importsOf(code) {
    const out = [];
    const re = /\bimport\s*(?:[\w$*{}\s,]+\s*from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bexport\s+[\w$*{}\s,]+\s+from\s+["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(code))) out.push({ spec: m[1] || m[2] || m[3], index: m.index });
    return out;
}

function lineAt(code, index) { return code.slice(0, index).split("\n").length; }

/** Problems of the plugin in `dir`: [{ rule, file, line, message }]. */
function lintPlugin(dir) {
    dir = path.resolve(dir || process.cwd());
    const problems = [];
    const add = (rule, file, line, extra) => problems.push({ rule, file: path.relative(dir, file) || file, line, message: RULES[rule] + (extra ? " — " + extra : "") });

    // the package
    const pkgFile = path.join(dir, "package.json");
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8")); } catch (e) { add("package", pkgFile, 0, "no readable package.json"); }
    if (pkg) {
        if (!pkg["node-red"] || !pkg["node-red"].plugins) add("package", pkgFile, 0, "no node-red.plugins");
        if (!pkg.scripts || !pkg.scripts.test) add("package", pkgFile, 0, "no scripts.test");
    }
    if (!fs.existsSync(path.join(dir, "test", "browser.test.js"))) add("package", path.join(dir, "test"), 0, "no test/browser.test.js");

    // the modules the editor and the pages load
    const distDir = path.join(dir, "dist");
    const files = fs.existsSync(distDir) ? fs.readdirSync(distDir).filter((f) => /\.m?js$/.test(f)).map((f) => path.join(distDir, f)) : [];
    files.forEach((file) => {
        const src = fs.readFileSync(file, "utf8");
        const lines = src.split("\n");
        const code = stripComments(src);                         // imports: their strings kept
        const codeLines = stripComments(src, true).split("\n");  // the rules: strings are not code
        importsOf(code).forEach((imp) => {
            const ok = imp.spec === SDK_IMPORT || /^\.\/[\w./-]+\.m?js$/.test(imp.spec);
            const ln = lineAt(code, imp.index);
            if (!ok && !allowed(lines, ln - 1, "sdk-import-only")) add("sdk-import-only", file, ln, "\"" + imp.spec + "\"");
        });
        codeLines.forEach((l, i) => {
            CHECKS.forEach((c) => {
                if (c.re.test(l) && !allowed(lines, i, c.rule)) add(c.rule, file, i + 1, lines[i].trim().slice(0, 100));
            });
        });
    });
    return problems;
}

/** Prints the problems of `dir`; -> the exit code (0 = clean). A plugin's `npm test` runs it first. */
function cli(dir) {
    dir = dir || process.cwd();
    const problems = lintPlugin(dir);
    if (!problems.length) { console.log("nexa-lint: " + path.basename(path.resolve(dir)) + " follows the plugin rules"); return 0; }
    problems.forEach((p) => console.log(p.file + (p.line ? ":" + p.line : "") + "  [" + p.rule + "]  " + p.message));
    console.log("\nnexa-lint: " + problems.length + " problem(s). Fix them, or justify one where it happens: // nexa-lint-allow <rule>: <reason>");
    return 1;
}

module.exports = { lintPlugin, cli, RULES, stripComments };

if (require.main === module) process.exit(cli(process.argv[2]));
