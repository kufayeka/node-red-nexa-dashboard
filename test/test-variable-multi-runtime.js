// Unit test for set-variable-multi and get-variable-multi runtime execution
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const elements = [];
function makeEl(tag) {
  const el = {
    tag: tag, style: {}, children: [], attrs: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    insertBefore(child, ref) { child.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, child); },
    removeChild(child) {
      child.parentNode = null;
      this.children = this.children.filter(c => c !== child);
      elements.splice(elements.indexOf(child), 1);
    },
    querySelector(sel) { return this.children.find(c => c.tag === sel) || null; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; }
  };
  elements.push(el);
  return el;
}
const artboard = makeEl("div");
artboard.id = "nexa-runtime-artboard";
global.document = {
  createElement(tag) { return makeEl(tag); },
  getElementById(id) { return id === "nexa-runtime-artboard" ? artboard : null; },
  querySelector(sel) {
    const m = /\[data-id="([^"]+)"\]/.exec(sel);
    return m ? (elements.find(e => e.attrs["data-id"] === m[1]) || null) : null;
  }
};
global.window = global;
global.window.addEventListener = function () {};
global.console = console;

// Load registry
const registrySrc = fs.readFileSync(path.join(__dirname, "../dist/nexa-registry-client.js"), "utf8");
eval(registrySrc);

let lastCtx = null;
NEXA.registerComponent("test-btn", {
  render: function (el, props, ctx) { lastCtx = ctx; }
});

// Configure Screen with variables
window.__NEXA_SCREEN__ = {
  id: "screen-multi",
  width: 800,
  height: 600,
  variables: [
    { name: "numVar", defaultValue: 0, type: "number" },
    { name: "strVar", defaultValue: "init", type: "string" },
    { name: "boolVar", defaultValue: false, type: "boolean" },
    { name: "listVar", defaultValue: [], type: "array" },
    { name: "objVar", defaultValue: {}, type: "object" }
  ],
  components: [
    { id: "btn", type: "test-btn", x: 0, y: 0, w: 100, h: 40, props: {} }
  ],
  logic: {
    nodes: [
      { id: "evtSet", type: "ui-event", compId: "btn", event: "doSet" },
      {
        id: "multiSet",
        type: "set-variable-multi",
        assignments: [
          { scope: "", name: "numVar", op: "set", valueSource: "static", value: 42 },
          { scope: "", name: "strVar", op: "set", valueSource: "msg", msgPath: "payload.title" },
          { scope: "", name: "boolVar", op: "toggle" },
          { scope: "", name: "listVar", op: "append", valueSource: "msg", msgPath: "msg.item" },
          { scope: "", name: "objVar", op: "merge", valueSource: "static", value: { updated: true } }
        ]
      },
      { id: "evtGet", type: "ui-event", compId: "btn", event: "doGet" },
      {
        id: "multiGet",
        type: "get-variable-multi",
        reads: [
          { scope: "", name: "numVar", target: "payload.count" },
          { scope: "", name: "strVar", target: "payload.heading" },
          { scope: "", name: "boolVar", target: "msg.status.active" },
          { scope: "", name: "listVar", target: "items" }
        ]
      },
      {
        id: "afterGet",
        type: "function",
        code: "window.__lastGetMsg = msg; return msg;"
      }
    ],
    wires: [
      { id: "w1", from: "evtSet", to: "multiSet" },
      { id: "w2", from: "evtGet", to: "multiGet" },
      { id: "w3", from: "multiGet", to: "afterGet" }
    ]
  }
};

const runtimeSrc = fs.readFileSync(path.join(__dirname, "../dist/nexa-runtime.bundle.js"), "utf8");
eval(runtimeSrc);

console.log("=== Testing set-variable-multi ===");
// Trigger doSet
lastCtx.emit("doSet", {
  title: "Hello Multi Set",
  item: "apple"
});

// Check screen variables in the active scope
const screenScope = lastCtx.screen.__scopes[""];
assert.equal(screenScope.numVar, 42, "numVar should be 42");
assert.equal(screenScope.strVar, "Hello Multi Set", "strVar should be 'Hello Multi Set'");
assert.equal(screenScope.boolVar, true, "boolVar should have toggled to true");
assert.deepEqual(screenScope.listVar, ["apple"], "listVar should have appended 'apple'");
assert.deepEqual(screenScope.objVar, { updated: true }, "objVar should be merged with { updated: true }");
console.log("✔ set-variable-multi all 5 assignments succeeded!");

console.log("=== Testing get-variable-multi ===");
// Trigger doGet with initial msg
lastCtx.emit("doGet", { initialProp: 123 });

setTimeout(() => {
  const resultMsg = window.__lastGetMsg;
  assert.ok(resultMsg, "resultMsg should exist");
  assert.equal(resultMsg.event, "doGet", "message event should be 'doGet'");
  assert.equal(resultMsg.payload.initialProp, 123, "payload.initialProp should be preserved");
  assert.equal(resultMsg.payload.count, 42, "payload.count should be 42");
  assert.equal(resultMsg.payload.heading, "Hello Multi Set", "payload.heading should be 'Hello Multi Set'");
  assert.equal(resultMsg.status.active, true, "status.active should be true (cleaned msg.status.active)");
  assert.deepEqual(resultMsg.items, ["apple"], "items should be ['apple']");
  console.log("✔ get-variable-multi all 4 reads injected correctly into target paths!");
  console.log("ALL TESTS PASSED!");
  process.exit(0);
}, 50);
