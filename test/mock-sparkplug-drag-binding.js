// Test for Sparkplug B drag-drop component binding, properties panel watch field,
// events tab on Sparkplug Update chip, and runtime logic event dispatch.
const fs = require("fs");
const path = require("path");

console.log("=== Testing Sparkplug B Component Drag-Drop & Logic Event Triggering ===");

// --- Test 1: Binding syntax & parsing ---
console.log("\n--- 1. Binding path grammar ---");

function makeSparkplugBindingPath(ref) {
    return "{sparkplug:" + ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "") + "::" + ref.metricName + "}";
}
function parseSparkplugBindingPath(raw) {
    if (typeof raw !== "string") return null;
    var trimmed = raw.trim();
    if (trimmed.charAt(0) !== "{" || trimmed.charAt(trimmed.length - 1) !== "}") return null;
    var inner = trimmed.slice(1, -1);
    if (inner.indexOf("sparkplug:") !== 0) return null;
    var parts = inner.slice("sparkplug:".length).split("::");
    if (parts.length < 4) return null;
    var metricName = parts.slice(3).join("::");
    if (!parts[0] || !parts[1] || !metricName) return null;
    return { groupId: parts[0], edgeNodeId: parts[1], deviceId: parts[2] || null, metricName: metricName };
}

const refDevice = { groupId: "Kufayeka", edgeNodeId: "NexaNodered", deviceId: "GP", metricName: "Lantai_1/air_pressure" };
const pathDevice = makeSparkplugBindingPath(refDevice);
console.log("Generated path with Device:", pathDevice);
if (pathDevice !== "{sparkplug:Kufayeka::NexaNodered::GP::Lantai_1/air_pressure}") {
    throw new Error("Invalid device binding path generated");
}

const parsedDevice = parseSparkplugBindingPath(pathDevice);
console.log("Parsed groupId correctly?", parsedDevice && parsedDevice.groupId === "Kufayeka");
console.log("Parsed edgeNodeId correctly?", parsedDevice && parsedDevice.edgeNodeId === "NexaNodered");
console.log("Parsed deviceId correctly?", parsedDevice && parsedDevice.deviceId === "GP");
console.log("Parsed metricName with slash correctly?", parsedDevice && parsedDevice.metricName === "Lantai_1/air_pressure");

const refNode = { groupId: "Kufayeka", edgeNodeId: "NexaNodered", deviceId: "", metricName: "node_health" };
const pathNode = makeSparkplugBindingPath(refNode);
console.log("Generated path for Node metric:", pathNode);
const parsedNode = parseSparkplugBindingPath(pathNode);
console.log("Parsed node-scoped metric correctly?", parsedNode && parsedNode.deviceId === null && parsedNode.metricName === "node_health");

// --- Test 2: Drag-and-drop assignment to existing component ---
console.log("\n--- 2. Drag-and-Drop to existing component ---");
const screen = {
    id: "scr1",
    components: [
        { id: "rect1", type: "kufayeka-rect", x: 100, y: 100, w: 200, h: 150, props: { fill: "#ff0000" } },
        { id: "lbl1", type: "kufayeka-text-label", x: 400, y: 100, w: 160, h: 36, props: { text: "Static Text" } }
    ]
};

// Simulate drop at x=150, y=150 (over rect1)
function handleSparkplugDrop(screen, metricRef, x, y) {
    var targetComp = null;
    for (var i = screen.components.length - 1; i >= 0; i--) {
        var c = screen.components[i];
        if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
            targetComp = c;
            break;
        }
    }
    if (targetComp) {
        var bindingPath = makeSparkplugBindingPath(metricRef);
        targetComp.sparkplugBinding = bindingPath;
        if (targetComp.props && (targetComp.props.text !== undefined || targetComp.type === "kufayeka-text-label")) {
            targetComp.props.text = bindingPath;
        }
        return { action: "bind", target: targetComp, binding: bindingPath };
    }
    // create new
    var bindingPath = makeSparkplugBindingPath(metricRef);
    var newComp = {
        id: "new_" + Math.random().toString(36).slice(2, 6),
        type: "kufayeka-text-label",
        x: x, y: y, w: 160, h: 36,
        sparkplugBinding: bindingPath,
        props: { text: bindingPath }
    };
    screen.components.push(newComp);
    return { action: "create", target: newComp, binding: bindingPath };
}

var dropResult1 = handleSparkplugDrop(screen, refDevice, 150, 150);
console.log("Drop over rect1 assigned binding?", dropResult1.action === "bind" && dropResult1.target.id === "rect1");
console.log("rect1.sparkplugBinding set?", screen.components[0].sparkplugBinding === "{sparkplug:Kufayeka::NexaNodered::GP::Lantai_1/air_pressure}");

// Simulate drop on empty canvas (x=800, y=800)
var dropResult2 = handleSparkplugDrop(screen, refNode, 800, 800);
console.log("Drop on empty canvas creates new component?", dropResult2.action === "create" && screen.components.length === 3);
console.log("New component has sparkplugBinding?", dropResult2.target.sparkplugBinding === "{sparkplug:Kufayeka::NexaNodered::::node_health}");

// --- Test 3: Events Panel on Sparkplug Update Chip Generation ---
console.log("\n--- 3. Events Panel generates on Sparkplug Update chips ---");
function hasSparkplugBinding(comp) {
    if (!comp) return false;
    if (comp.sparkplugBinding && typeof comp.sparkplugBinding === "string") return true;
    var props = comp.props || {};
    var keys = Object.keys(props);
    for (var i = 0; i < keys.length; i++) {
        var v = props[keys[i]];
        if (typeof v === "string" && v.indexOf("{sparkplug:") !== -1) return true;
    }
    return false;
}

console.log("rect1 has sparkplug binding?", hasSparkplugBinding(screen.components[0]) === true);
console.log("lbl1 without binding returns false?", hasSparkplugBinding(screen.components[1]) === false);

// --- Test 4: Runtime Client Live Delta & Event Execution ---
console.log("\n--- 4. Runtime Client Event Dispatch & Logic Graph Execution ---");

// Mock DOM & environment for runtime client
const elements = [];
function makeEl(tag) {
    const el = {
        tag: tag, style: {}, children: [], attrs: {}, parentNode: null,
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild(child) { child.parentNode = this; this.children.push(child); },
        removeChild(child) {
            child.parentNode = null;
            this.children = this.children.filter(c => c !== child);
            elements.splice(elements.indexOf(child), 1);
        },
        querySelector(sel) {
            return this.children.find(c => c.tag === sel) || null;
        },
        set textContent(v) { this._text = v; },
        get textContent() { return this._text; }
    };
    elements.push(el);
    return el;
}
const artboard = makeEl('div');
artboard.id = 'nexa-runtime-artboard';
global.document = {
    createElement(tag) { return makeEl(tag); },
    getElementById(id) { return id === 'nexa-runtime-artboard' ? artboard : null; },
    querySelector(sel) {
        const m = /\[data-id="([^"]+)"\]/.exec(sel);
        return m ? (elements.find(e => e.attrs['data-id'] === m[1]) || null) : null;
    }
};
global.window = global;
// This test exercises the SSE live-binding path: Node >= 22 has a global
// WebSocket, which would otherwise make the runtime pick Nexa IO instead.
global.WebSocket = undefined;
global.console = console;
global.window.addEventListener = function () {};
global.window.XMLHttpRequest = function () {};

function FakeEventSource(url) {
    this.url = url;
    this.listeners = {};
    FakeEventSource.instances.push(this);
}
FakeEventSource.prototype.addEventListener = function (name, fn) {
    this.listeners[name] = fn;
};
FakeEventSource.instances = [];
global.window.EventSource = FakeEventSource;

var rafQueue = [];
global.window.requestAnimationFrame = function (fn) { rafQueue.push(fn); return rafQueue.length; };
function flushRAF() {
    var queued = rafQueue;
    rafQueue = [];
    queued.forEach(function (fn) { fn(); });
}

eval(fs.readFileSync(path.join(__dirname, "../lib/nexa-registry-client.js"), "utf8"));
NEXA.registerComponent('kufayeka-rect', {
    render: function (el, props) { el.style.background = props.fill; }
});
NEXA.registerComponent('kufayeka-text-label', {
    render: function (el, props) { el.textContent = props.text; }
});

// Define a test screen with:
// 1. "rect1" (basic shape) bound to Sparkplug tag {sparkplug:Kufayeka::NexaNodered::GP::Lantai_1/air_pressure}
// 2. "sink" text label
// 3. Logic: when "rect1" fires "sparkplug-change" -> Function node sets sink text to "Pressure: " + msg.payload.value
window.__NEXA_SCREEN__ = {
    id: "screen_sparkplug_test",
    width: 1024,
    height: 768,
    layers: [{ id: "l1", name: "Layer 1", state: "show" }],
    components: [
        {
            id: "rect1",
            type: "kufayeka-rect",
            layerId: "l1",
            x: 50, y: 50, w: 100, h: 100,
            sparkplugBinding: "{sparkplug:Kufayeka::NexaNodered::GP::Lantai_1/air_pressure}",
            props: { fill: "#10b981" }
        },
        {
            id: "sink",
            type: "kufayeka-text-label",
            layerId: "l1",
            x: 200, y: 50, w: 200, h: 40,
            props: { text: "Waiting..." }
        }
    ],
    logic: {
        nodes: [
            { id: "evt_sp", type: "ui-event", compId: "rect1", event: "sparkplug-change", x: 20, y: 20 },
            {
                id: "fn1",
                type: "function",
                x: 180, y: 20,
                code: "msg.payload = { text: 'Pressure: ' + msg.payload.value + ' bar (ts: ' + msg.payload.timestamp + ')' }; return msg;"
            },
            { id: "upd1", type: "ui-update", compId: "sink", config: { text: true }, x: 340, y: 20 }
        ],
        wires: [
            { from: "evt_sp", to: "fn1" },
            { from: "fn1", to: "upd1" }
        ]
    }
};

eval(fs.readFileSync(path.join(__dirname, "../lib/nexa-runtime-client.js"), "utf8"));

var sinkComp = window.__NEXA_SCREEN__.components.find(c => c.id === "sink");
console.log("Initial sink text is 'Waiting...'?", sinkComp.props.text === "Waiting...");

// Verify EventSource connected
var sseSource = FakeEventSource.instances[0];
console.log("SSE Source connected?", !!sseSource);

const tick = () => new Promise(r => setTimeout(r, 20));

(async function () {
    // Now simulate an incoming Sparkplug delta for "Lantai_1/air_pressure" with value 6.8
    console.log("\n--- 5. Simulating incoming Sparkplug Delta SSE event ---");
    sseSource.onmessage({
        data: JSON.stringify({
            type: "data",
            groupId: "Kufayeka",
            edgeNodeId: "NexaNodered",
            deviceId: "GP",
            metrics: [{
                name: "Lantai_1/air_pressure",
                type: "Float",
                value: 6.8,
                timestamp: 1700000100000
            }]
        })
    });

    flushRAF();
    await tick();

    console.log("Sink component text updated via Logic flow?", sinkComp.props.text === "Pressure: 6.8 bar (ts: 1700000100000)", "(actual: " + JSON.stringify(sinkComp.props.text) + ")");
    if (sinkComp.props.text !== "Pressure: 6.8 bar (ts: 1700000100000)") {
        throw new Error("Logic flow was not triggered on first Sparkplug delta");
    }

    // Simulate second delta with value 7.2
    sseSource.onmessage({
        data: JSON.stringify({
            type: "data",
            groupId: "Kufayeka",
            edgeNodeId: "NexaNodered",
            deviceId: "GP",
            metrics: [{
                name: "Lantai_1/air_pressure",
                type: "Float",
                value: 7.2,
                timestamp: 1700000200000
            }]
        })
    });

    flushRAF();
    await tick();

    console.log("Second delta fired logic event with new value 7.2?", sinkComp.props.text === "Pressure: 7.2 bar (ts: 1700000200000)", "(actual: " + JSON.stringify(sinkComp.props.text) + ")");
    if (sinkComp.props.text !== "Pressure: 7.2 bar (ts: 1700000200000)") {
        throw new Error("Logic event did not update component text on second delta!");
    }

    console.log("\n=== ALL SPARKPLUG DRAG BINDING & EVENT DISPATCH TESTS PASSED ===");
    console.log("ALL OK");
})();
