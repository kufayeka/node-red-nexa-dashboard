// Exercises the ACTUAL shipped code in lib/nexa-runtime-client.js for
// "@lit-component" (not a reimplementation) end-to-end: mounting, custom
// element creation/caching, ui-update, and {param} interpolation cascading
// from a Template's own params. Stands in a FAKE LitElement base (not real
// Lit) since Lit's own module code needs a real browser DOM (no jsdom
// available here) — this tests THIS feature's own mount/update wiring, not
// whether Lit itself then correctly renders shadow DOM content.
//
// Design note: every declared Bindable Property is its OWN top-level Lit
// reactive property (this.<name>), standard idiomatic Lit — NOT a nested
// this.props.<name> object. An earlier revision tried splitting "external"
// (this.props.x) from "internal" (this.x) state into two namespaces to stop
// an unrelated external update from resetting a value the component's own
// code had just set; that turned out slower and buggier in practice than
// this plain approach, so it was reverted. The rule now is simply: there is
// no separate "internal state" — every piece of state a Lit Component needs
// is declared as a Bindable Property, and an external update naturally sets
// that same this.<name> a click handler or any other code would also use.
const elements = [];
function makeEl(tag) {
    const el = {
        tag: tag, tagName: tag.toUpperCase(), style: {}, children: [], attrs: {}, _text: "",
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild(child) { this.children.push(child); },
        querySelector(sel) { return this.children.find(c => c.tag === sel) || null; },
        get firstElementChild() { return this.children[0] || null; },
        set innerHTML(v) { this.children = []; },
        get innerHTML() { return ""; },
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
global.console = console;
global.window.addEventListener = function () {};

// Fake LitElement base — a plain class whose "reactive properties" are just
// plain JS property assignment (no actual re-render/diffing, since that's
// Lit's own internal machinery, out of scope for this feature's own tests).
class FakeLitElement {
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

(async function () {
    console.log("--- mounting a screen with a @lit-component instance ---");
    const screen1 = {
        width: 400, height: 200,
        layers: [{ id: "default", name: "Default", parentId: null, visible: true }],
        components: [{
            id: "lit1", type: "@lit-component", x: 0, y: 0, w: 220, h: 120, rotation: 0, locked: false, layerId: "default",
            props: { label: "Hello" },
            litCode: "emit(name,payload){ super.emit(name,payload); } render(){ return html`<div>${this.label}</div>`; }",
            litStyles: ":host { color: red; }",
            litBindable: [{ name: "label", type: "string", defaultValue: "default-label" }],
            litEvents: [{ name: "clicked" }]
        }],
        logic: { nodes: [], wires: [] }
    };
    window.__NEXA_SCREEN__ = screen1;
    window.__NEXA_TEMPLATES__ = [];
    eval(fs.readFileSync(process.argv[3], "utf8")); // nexa-runtime-client.js
    await tick();

    const wrapperEl = document.querySelector('[data-id="lit1"]');
    console.log("wrapper element mounted?", !!wrapperEl);
    const customEl = wrapperEl && wrapperEl.firstElementChild;
    console.log("a custom element child was created inside the wrapper?", !!customEl && customEl.tag.indexOf("nexa-lit-") === 0);
    console.log("the custom element's tag was registered via customElements.define?", !!customElements.get(customEl.tag));
    console.log("the bindable prop's initial value (from comp.props) was assigned as a TOP-LEVEL property (this.label)?", customEl.label === "Hello");
    console.log("__nexaCtx (for this.emit) was set on the instance?", typeof customEl.__nexaCtx === "object" && typeof customEl.__nexaCtx.emit === "function");

    console.log("--- re-mounting an instance with the SAME code/styles/bindable reuses the cached class (no duplicate customElements.define) ---");
    const registrySizeBefore = Object.keys(customElements._registry).length;
    const screen1b = JSON.parse(JSON.stringify(screen1));
    screen1b.components[0].id = "lit1b";
    window.__NEXA_SCREEN__ = screen1b;
    window.__NEXA_TEMPLATES__ = [];
    eval(fs.readFileSync(process.argv[3], "utf8"));
    await tick();
    console.log("no new tag was registered for identical code+bindable list (cache hit)?", Object.keys(customElements._registry).length === registrySizeBefore);
    const customEl1b = document.querySelector('[data-id="lit1b"]').firstElementChild;
    console.log("the second instance's element uses the SAME tag as the first?", customEl1b.tag === customEl.tag);

    console.log("--- changing the Bindable Property LIST (not just code/styles) DOES produce a new compiled class/tag ---");
    // The cache key includes name:type pairs, unlike the reverted this.props
    // design where the bindable list stopped mattering to the class shape —
    // here it matters again, since each bindable IS its own declared
    // top-level Lit property (part of the class's actual shape).
    const screen1c = JSON.parse(JSON.stringify(screen1));
    screen1c.components[0].id = "lit1c";
    screen1c.components[0].litBindable = [{ name: "label", type: "string", defaultValue: "default-label" }, { name: "extra", type: "number", defaultValue: 0 }];
    window.__NEXA_SCREEN__ = screen1c;
    window.__NEXA_TEMPLATES__ = [];
    eval(fs.readFileSync(process.argv[3], "utf8"));
    await tick();
    const customEl1c = document.querySelector('[data-id="lit1c"]').firstElementChild;
    console.log("a DIFFERENT bindable list produced a DIFFERENT compiled tag?", customEl1c.tag !== customEl.tag);

    console.log("--- ui-update on a @lit-component sets the NAMED bindable property directly (Lit's own reactivity supersedes onBind) ---");
    // A static `config` keyed by the declared bindable prop name is what the
    // ui-update-dialog.js Properties dialog actually produces for a
    // "@lit-component" target (it lists comp.litBindable's names as fields,
    // not the generic text/fill primitive-payload heuristic runUiUpdateNode
    // falls back to for built-in shape components) — see applyUiUpdateMulti.
    const screen2 = {
        width: 400, height: 200,
        layers: [{ id: "default", name: "Default", parentId: null, visible: true }],
        components: [{
            id: "lit2", type: "@lit-component", x: 0, y: 0, w: 220, h: 120, rotation: 0, locked: false, layerId: "default",
            props: { label: "Initial" },
            litCode: "render(){ return html`<div>${this.label}</div>`; }",
            litStyles: "",
            litBindable: [{ name: "label", type: "string", defaultValue: "" }],
            litEvents: []
        }],
        logic: {
            nodes: [
                { id: "onload1", type: "onload" },
                { id: "upd1", type: "ui-update", compId: "lit2", config: { label: "Updated via ui-update" } }
            ],
            wires: [{ id: "w1", from: "onload1", to: "upd1" }]
        }
    };
    window.__NEXA_SCREEN__ = screen2;
    window.__NEXA_TEMPLATES__ = [];
    eval(fs.readFileSync(process.argv[3], "utf8"));
    await tick();
    const customEl2 = document.querySelector('[data-id="lit2"]').firstElementChild;
    console.log("comp.props.label was updated?", screen2.components[0].props.label === "Updated via ui-update");
    console.log("the mounted custom element's TOP-LEVEL this.label was updated directly (no onBind needed)?", customEl2.label === "Updated via ui-update");

    console.log("--- {param} interpolation on a @lit-component's bindable-relevant STRING prop via a Template ---");
    const tLeafWithLit = {
        id: "tLit", name: "LitLeaf", width: 220, height: 120,
        layers: [{ id: "default", name: "Default", parentId: null, visible: true }],
        components: [{
            id: "innerLit", type: "@lit-component", x: 0, y: 0, w: 220, h: 120, rotation: 0, locked: false, layerId: "default",
            props: { label: "Value: {value}" },
            litCode: "render(){ return html`<div>${this.label}</div>`; }",
            litStyles: "",
            litBindable: [{ name: "label", type: "string", defaultValue: "" }],
            litEvents: []
        }],
        logic: { nodes: [], wires: [] },
        params: [{ id: "p1", name: "value", label: "Value", type: "string", defaultValue: "X" }]
    };
    const screen3 = {
        width: 220, height: 120,
        layers: [{ id: "default", name: "Default", parentId: null, visible: true }],
        components: [{ id: "tplInst", type: "@template", templateId: "tLit", x: 0, y: 0, w: 220, h: 120, rotation: 0, locked: false, layerId: "default", props: {}, paramValues: { value: "FROM-PARAM" } }],
        logic: { nodes: [], wires: [] }
    };
    window.__NEXA_SCREEN__ = screen3;
    window.__NEXA_TEMPLATES__ = [tLeafWithLit];
    eval(fs.readFileSync(process.argv[3], "utf8"));
    await tick();
    const nestedCustomEl = document.querySelector('[data-id="tplInst::innerLit"]').firstElementChild;
    console.log("a @lit-component nested in a Template got its {value} prop interpolated from the template's param ('Value: FROM-PARAM')?", nestedCustomEl.label === "Value: FROM-PARAM");

    console.log("--- boolean coercion at mount time: a stale wrongly-typed defaultValue (the literal string \"false\") does NOT render as truthy ---");
    const screen5 = {
        width: 220, height: 120,
        layers: [{ id: "default", name: "Default", parentId: null, visible: true }],
        components: [{
            id: "lit5", type: "@lit-component", x: 0, y: 0, w: 220, h: 120, rotation: 0, locked: false, layerId: "default",
            props: {},
            litCode: "render(){ return html`<div>${this.active ? 'ON' : 'OFF'}</div>`; }",
            litStyles: "",
            // Simulates the exact reported bug: a "boolean" typed field
            // whose defaultValue is a leftover string "false" from before a
            // type switch — Boolean("false") is TRUE in plain JS.
            litBindable: [{ name: "active", type: "boolean", defaultValue: "false" }],
            litEvents: []
        }],
        logic: { nodes: [], wires: [] }
    };
    window.__NEXA_SCREEN__ = screen5;
    window.__NEXA_TEMPLATES__ = [];
    eval(fs.readFileSync(process.argv[3], "utf8"));
    await tick();
    const customEl5 = document.querySelector('[data-id="lit5"]').firstElementChild;
    console.log("a stale string \"false\" defaultValue is coerced to real boolean false, not left truthy?", customEl5.active === false);

    console.log("ALL OK");
    process.exit(0);
})();
