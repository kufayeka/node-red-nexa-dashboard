// Verifies the NEW this.mountTemplate(hostEl, templateIdOrName, paramValues,
// opts) capability on a "@lit-component" instance's own class body — lets
// Lit code embed an already-authored Screen Template into a container
// inside its own shadow DOM, visual-only (no Logic-graph folding — see the
// big comment above getNexaLitBase's mountTemplate method). Runtime-only
// test (this is where mountAndFlatten/effectiveScreen bookkeeping lives);
// the editor's identical method (component-renderer.js) shares the same
// design and is exercised implicitly by the editor mock suite's general
// @lit-component coverage not throwing.
const elements = [];
function makeEl(tag) {
    const el = {
        tag: tag, tagName: tag.toUpperCase(), style: {}, children: [], attrs: {}, _text: "",
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild(child) { this.children.push(child); },
        querySelector(sel) {
            var m = /^\[data-id="([^"]+)"\]$/.exec(sel);
            if (m) return findByDataId(this, m[1]);
            return this.children.find(c => c.tag === sel) || null;
        },
        get firstElementChild() { return this.children[0] || null; },
        set innerHTML(v) { this.children = []; },
        get innerHTML() { return ""; },
        set textContent(v) { this._text = v; },
        get textContent() { return this._text; }
    };
    elements.push(el);
    return el;
}
function findByDataId(root, id) {
    if (root.attrs && root.attrs["data-id"] === id) return root;
    for (var i = 0; i < root.children.length; i++) {
        var found = findByDataId(root.children[i], id);
        if (found) return found;
    }
    return null;
}
const artboard = makeEl("div");
artboard.id = "nexa-runtime-artboard";
global.document = {
    // IMPORTANT: a registered custom element tag must construct a REAL
    // instance of its compiled class (so mountTemplate/emit, inherited via
    // the NexaLitBase prototype chain, actually exist on it) — a real
    // browser's document.createElement does this automatically once
    // customElements.define() has run; this mock has to do it explicitly.
    createElement(tag) {
        var Klass = global.customElements.get(tag);
        if (Klass) {
            var instance = new Klass();
            instance.tag = tag;
            instance.tagName = tag.toUpperCase();
            elements.push(instance);
            return instance;
        }
        return makeEl(tag);
    },
    getElementById(id) { return id === "nexa-runtime-artboard" ? artboard : null; },
    querySelector(sel) {
        const m = /\[data-id="([^"]+)"\]/.exec(sel);
        return m ? findByDataId(artboard, m[1]) : null;
    }
};
global.window = global;
global.console = console;
global.window.addEventListener = function () {};

// A minimal stand-in for the real LitElement base — provides just enough
// plain-DOM-node plumbing (children/attrs/appendChild/textContent) for the
// surrounding mount code to treat a compiled Lit instance as a normal
// element, since real LitElement instances get this from HTMLElement.
class FakeLitElement {
    constructor() {
        this.children = [];
        this.attrs = {};
        this._text = "";
    }
    setAttribute(k, v) { this.attrs[k] = v; }
    appendChild(child) { this.children.push(child); }
    get firstElementChild() { return this.children[0] || null; }
    set innerHTML(v) { this.children = []; }
    get innerHTML() { return ""; }
    set textContent(v) { this._text = v; }
    get textContent() { return this._text; }
    connectedCallback() {}
}
global.window.NEXA_LIT = {
    LitElement: FakeLitElement,
    html: function (strings) { return strings.join(""); },
    css: function (strings) { return strings.join(""); },
    nothing: undefined
};
global.customElements = {
    _registry: {},
    define(name, Klass) { this._registry[name] = Klass; },
    get(name) { return this._registry[name]; }
};

const fs = require("fs");
eval(fs.readFileSync(process.argv[2], "utf8")); // nexa-registry-client.js

const tick = () => new Promise(r => setTimeout(r, 30));

// The Template being embedded ("Card"): one text label showing {label}, one
// nested "Badge" template showing {status} — proves the embedded template's
// OWN nesting/param-interpolation machinery still works when reached via
// mountTemplate, not just when dropped normally via the palette.
const tBadge = {
    id: "tBadge", name: "Badge", width: 80, height: 30,
    layers: [{ id: "default", name: "Default", parentId: null, visible: true }],
    components: [{ id: "badgeTxt", type: "mock-text", x: 0, y: 0, w: 80, h: 30, rotation: 0, locked: false, layerId: "default", props: { text: "[{status}]" } }],
    logic: { nodes: [], wires: [] },
    params: [{ id: "bp1", name: "status", label: "Status", type: "string", defaultValue: "?" }]
};
const tCard = {
    id: "tCard", name: "Card", identifier: "monitor-card", width: 200, height: 100,
    layers: [{ id: "default", name: "Default", parentId: null, visible: true }],
    components: [
        { id: "cardTxt", type: "mock-text", x: 0, y: 0, w: 200, h: 30, rotation: 0, locked: false, layerId: "default", props: { text: "Card: {label}" } },
        { id: "cardBadge", type: "@template", templateId: "tBadge", x: 0, y: 40, w: 80, h: 30, rotation: 0, locked: false, layerId: "default", props: {}, paramValues: { status: "{status}" } }
    ],
    logic: { nodes: [], wires: [] },
    params: [
        { id: "cp1", name: "label", label: "Label", type: "string", defaultValue: "default-label" },
        { id: "cp2", name: "status", label: "Status", type: "string", defaultValue: "unknown" }
    ]
};

NEXA.registerComponent("mock-text", {
    render: function (el, props) { el.textContent = props.text || ""; }
});

const screen = {
    width: 600, height: 400,
    layers: [{ id: "default", name: "Default", parentId: null, visible: true }],
    components: [{
        id: "litHost", type: "@lit-component", x: 0, y: 0, w: 400, h: 200, rotation: 0, locked: false, layerId: "default",
        props: { items: [{ id: "a1", label: "Motor 1", status: "OK" }, { id: "a2", label: "Motor 2", status: "WARN" }] },
        litCode:
            "render() { return html`<div id=\"slot\"></div>`; }\n" +
            "updated() {\n" +
            "  var slot = this.shadowRoot ? this.shadowRoot.getElementById('slot') : null;\n" +
            "  if (!slot) return;\n" +
            "  var items = this.items || [];\n" +
            "  slot.innerHTML = '';\n" +
            "  var self = this;\n" +
            "  items.forEach(function (item, i) {\n" +
            "    var container = document.createElement('div');\n" +
            "    slot.appendChild(container);\n" +
            "    self.mountTemplate(container, 'monitor-card', { label: item.label, status: item.status }, { key: item.id });\n" +
            "  });\n" +
            "}",
        litStyles: "",
        litBindable: [{ name: "items", type: "array", defaultValue: [] }],
        litEvents: []
    }],
    logic: { nodes: [], wires: [] }
};

// FakeLitElement doesn't have a real Lit update cycle (no scheduling), so
// this test calls `updated()` manually right after mount to simulate what a
// real Lit element would do automatically on first render — this is testing
// mountTemplate's own logic, not Lit's scheduler.
global.window.__NEXA_SCREEN__ = screen;
global.window.__NEXA_TEMPLATES__ = [tCard, tBadge];
eval(fs.readFileSync(process.argv[3], "utf8")); // nexa-runtime-client.js

(async function () {
    await tick();
    const hostEl = document.querySelector('[data-id="litHost"]');
    const litInstance = hostEl.firstElementChild;
    console.log("Lit host instance mounted?", !!litInstance);
    console.log("mountTemplate method exists on the instance (inherited from NexaLitBase)?", typeof litInstance.mountTemplate === "function");

    // Manually invoke updated() to simulate Lit's own render cycle calling it
    // — our FAKE html/css tag functions just join strings (no real lit-html
    // templating engine here, see the conversation notes on why), so
    // render()'s return value isn't used to build real DOM; build the
    // <div id="slot"> updated() expects to find, exactly like real Lit would
    // have produced from `render() { return html\`<div id="slot"></div>\`; }`.
    var slotDiv = document.createElement("div");
    slotDiv.setAttribute("id", "slot");
    litInstance.children = [slotDiv];
    litInstance.shadowRoot = { getElementById: function (id) { return id === "slot" ? slotDiv : null; } };
    litInstance.updated();

    console.log("--- two embedded Card instances were mounted, one per array item, each with correct params ---");
    const card1Text = document.querySelector('[data-id="litHost::embed::a1::cardTxt"]');
    const card2Text = document.querySelector('[data-id="litHost::embed::a2::cardTxt"]');
    console.log("first embedded card shows its own item's label (\"Card: Motor 1\")?", !!card1Text && card1Text.textContent === "Card: Motor 1");
    console.log("second embedded card shows ITS OWN item's label (\"Card: Motor 2\"), not the first's?", !!card2Text && card2Text.textContent === "Card: Motor 2");

    console.log("--- the embedded template's OWN nested template (Badge) still resolves correctly through mountTemplate ---");
    const badge1 = document.querySelector('[data-id="litHost::embed::a1::cardBadge::badgeTxt"]');
    const badge2 = document.querySelector('[data-id="litHost::embed::a2::cardBadge::badgeTxt"]');
    console.log("first card's nested badge shows its own status (\"[OK]\")?", !!badge1 && badge1.textContent === "[OK]");
    console.log("second card's nested badge shows ITS OWN status (\"[WARN]\")?", !!badge2 && badge2.textContent === "[WARN]");

    console.log("--- mountTemplate looked the template up by its `identifier` field (\"monitor-card\"), not just by opaque id ---");
    console.log("(implicit — the calls above used 'monitor-card' as templateIdOrName and it worked)");

    console.log("--- mountTemplate with an unknown template name fails gracefully, not with a crash ---");
    var scratch = document.createElement("div");
    litInstance.mountTemplate(scratch, "does-not-exist", {}, {});
    console.log("shows a clear inline error instead of throwing?", scratch.textContent.indexOf("unknown template") !== -1);

    console.log("ALL OK");
    process.exit(0);
})();
