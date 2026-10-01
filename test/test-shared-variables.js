const assert = require("assert");
const { IoHub } = require("../lib/io/ioHub");
const { makeScope, visibleVariables, allDeclarations } = require("../lib/nexa-model");

console.log("=== Testing Shared Variables (Realtime Server Sync) ===");

// 1. Model Scope Verification
console.log("1. Model Scope Inheritance & Resolution");
const project = {
    sharedVariables: [
        { id: "sv1", name: "systemState", type: "string", defaultValue: "IDLE" },
        { id: "sv2", name: "globalCount", type: "number", defaultValue: 0 }
    ],
    variables: [
        { id: "av1", name: "appTheme", type: "string", defaultValue: "dark" }
    ]
};
const surface = { id: "s1", name: "Screen 1", variables: [] };

const decls = allDeclarations(surface, function () {}, project);
const sharedDecl = decls.find(d => d.scopeId === "@shared" && d.variable.name === "systemState");
assert(sharedDecl, "systemState should be visible with scopeId: '@shared'");
console.log("-> @shared declarations exposed in allDeclarations: PASS");

const vis = visibleVariables(surface, [], false, null, project);
const sharedVis = vis.find(v => v.name === "systemState" && v.owner && v.owner.id === "@shared");
assert(sharedVis, "systemState should be visible with owner.id: '@shared'");
console.log("-> @shared variables exposed in visibleVariables: PASS");

// 2. Prototype Chain Inheritance: Root -> Shared -> App -> Screen
const rootScope = Object.create(null);
rootScope.$route = { path: "/dashboard" };
const sharedScope = makeScope(rootScope, project.sharedVariables);
const appScope = makeScope(sharedScope, project.variables);
const screenScope = makeScope(appScope, [{ id: "lv1", name: "localOnly", defaultValue: "screenA" }]);

assert.strictEqual(screenScope.localOnly, "screenA");
assert.strictEqual(screenScope.appTheme, "dark");
assert.strictEqual(screenScope.systemState, "IDLE");
assert.strictEqual(screenScope.globalCount, 0);
assert.strictEqual(screenScope.$route.path, "/dashboard");
console.log("-> Prototype chain inheritance (Local -> App -> Shared -> Root): PASS");

// 3. IoHub Realtime Broadcast Across Multiple Clients
console.log("2. IoHub Server Sync Across Multiple Clients");
const hub = new IoHub();

// Initialize shared variable on server
hub.setSharedVar("systemState", "RUNNING", "string");
assert.strictEqual(hub.getSharedVar("systemState"), "RUNNING");

const clientAFrames = [];
const clientBFrames = [];

const clientA = hub.addClient({
    sendText() {},
    sendBinary(b) { clientAFrames.push(b); },
    bufferedAmount() { return 0; }
});

const clientB = hub.addClient({
    sendText() {},
    sendBinary(b) { clientBFrames.push(b); },
    bufferedAmount() { return 0; }
});

// Both clients open with subscription to shared variable
hub.handleText(clientA, { t: "open", rpi: 20, keys: ["@shared::systemState"] });
hub.handleText(clientB, { t: "open", rpi: 20, keys: ["@shared::systemState"] });

assert(clientAFrames.length >= 1, "Client A received initial full frame");
assert(clientBFrames.length >= 1, "Client B received initial full frame");

// Client A sends a write for shared variable via WebSocket
hub.handleText(clientA, { t: "set-var", name: "systemState", value: "STOPPED" });
assert.strictEqual(hub.getSharedVar("systemState"), "STOPPED");

// On next tick, client B gets updated frame
clientBFrames.length = 0;
hub.tick(clientB);
assert(clientBFrames.length === 1, "Client B received binary frame with updated shared variable");

console.log("-> Client A write broadcasts to Client B in binary IO frame: PASS");

hub.close();
console.log("\nALL SHARED VARIABLES TESTS PASSED SUCCESSFULLY!");
