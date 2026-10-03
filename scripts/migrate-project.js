#!/usr/bin/env node
// Brings the Nexa projects in a Node-RED flows file up to date, on disk:
//   - Logic nodes: their configuration into node.props (src/model/migrate-logic.js)
//   - screens / templates saved before the node tree: into the tree (src/model/migrate.js)
// The editor, the screen worker and the page do the same in memory every time a project
// loads, so a project works without this script; run it to write the new format once
// (for instance before committing flows.json to git, or before reading it with other tools).
// Legacy binding strings ("{speed}" + __fallback) are NOT converted here: which props are
// bindable is known only from the components' plugins, in the editor (Ctrl+Shift+P →
// "Nexa: convert legacy bindings", src/features/bindings/convert.js). They keep working as they are.
//
//   node scripts/migrate-project.js <path/to/flows.json> [--dry-run]
//
// Stop Node-RED first (it would overwrite the file on its next deploy). The original is kept
// next to it as <flows.json>.bak-<time>. Running it again changes nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const model = require("../dist/nexa-model.js");

function migrateFlows(flows) {
    const report = { projects: 0, logicNodes: 0, surfaces: 0 };
    flows.forEach(function (node) {
        if (!node || node.type !== "kufayeka-nexa-project") return;
        report.projects++;
        const surfaces = [].concat(node.screens || [], node.templates || [], node.flows || []);
        surfaces.forEach(function (s) {
            const moved = model.migrateLogic(s.logic);
            if (moved) { report.logicNodes += moved; report.surfaces++; }
        });
        model.migrateProject(node);
    });
    return report;
}

function main(argv) {
    const file = argv.find(function (a) { return !a.startsWith("--"); });
    const dry = argv.indexOf("--dry-run") !== -1;
    if (!file) {
        console.error("usage: node scripts/migrate-project.js <path/to/flows.json> [--dry-run]");
        return 2;
    }
    const abs = path.resolve(file);
    let flows;
    try { flows = JSON.parse(fs.readFileSync(abs, "utf8")); } catch (e) {
        console.error("can't read " + abs + ": " + e.message);
        return 1;
    }
    if (!Array.isArray(flows)) { console.error(abs + " is not a Node-RED flows file (an array of nodes)"); return 1; }
    const report = migrateFlows(flows);
    if (!report.projects) { console.log("no Nexa project in " + abs + ": nothing to do"); return 0; }
    console.log(report.projects + " Nexa project(s): " + report.logicNodes + " Logic node(s) in " + report.surfaces + " screen(s) / template(s) / flow(s) to migrate");
    if (!report.logicNodes) { console.log("already up to date"); return 0; }
    if (dry) { console.log("--dry-run: nothing written"); return 0; }
    const backup = abs + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(abs, backup);
    fs.writeFileSync(abs, JSON.stringify(flows, null, 4));
    console.log("written " + abs + "\nbackup  " + backup);
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { migrateFlows };
