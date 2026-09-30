const fs = require('fs');
const assert = require('assert');

// 1. Check generated nexa-plugin.html content
const pluginHtml = fs.readFileSync('lib/nexa-plugin.html', 'utf8');

// Check that per-variable chip loop is removed from Variables section
assert(!pluginHtml.includes('"Set " + d.scopeName + "." + d.variable.name'), 'Old per-variable chips should not exist');
assert(pluginHtml.includes('sectionHeader(state.eventsPane, "Variables")'), 'Variables section exists');
assert(pluginHtml.includes('chip(state.eventsPane, "Watch Variable"'), 'Watch Variable chip exists');
assert(pluginHtml.includes('chip(state.eventsPane, "Set Variable"'), 'Set Variable chip exists');
assert(pluginHtml.includes('chip(state.eventsPane, "Get Variable"'), 'Get Variable chip exists');

// Check that logic-nodes label uses Watch (dep1, dep2)
assert(pluginHtml.includes('Watch (" + deps.join(", ") + ")'), 'Watch label with multi-dep formatting exists');

// Check syncComponentFromLogicSelection
assert(pluginHtml.includes('syncComponentFromLogicSelection'), 'syncComponentFromLogicSelection exists in bundle');

// 2. Check runtime client notifyWatchers
const runtimeClient = fs.readFileSync('lib/nexa-runtime-client.js', 'utf8');
assert(runtimeClient.includes('Array.isArray(n.variables)'), 'notifyWatchers checks n.variables');

console.log('ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!');
