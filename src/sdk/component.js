// --- defineComponent({...}): the one way to write a Nexa component ----------
//   import { defineComponent, NexaElement, html, css, bind } from "../../nexa-sdk/nexa-component-sdk.js";
//   export default defineComponent({
//       id, label, category, icon, size, capabilities, version, migrate,
//       properties: { key: { type, default, label, help, ... } },   // what the user configures
//       inputs:     { name: { label, type, multiple, throttle, providers, prop } },  // tags read
//       outputs:    { name: { label, fallback, providers, prop } },  // tags written
//       events:     { name: { label, payload } },                   // fired to Logic
//       actions:    { name: { label, params } },                    // called from Logic
//       states, parts, css,                                          // per-state / per-part CSS + preview
//       state:      { key: initial },                               // internal, reactive, not saved
//       preview, editor: { interactive: [selectors] }, assets: { base, scripts, styles },
//       inspector:  ({ p, ui }) => html`...<nx-*> ${bind("key")}...`,  // optional: auto from properties
//       view:       class extends NexaElement { render() { ... } }
//   });
// It registers an ordinary registry def, so the editor and the runtime
// treat it like any component; def.nexa carries the normalized metadata.
import { buildMeta, legacyDefaults, migrateProps } from "./schema.js";
import { NexaElement } from "./element.js";

function tagFor(id) {
    var base = "nx-c-" + String(id).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    var tag = base, n = 1;
    while (customElements.get(tag)) tag = base + "-" + (++n);
    return tag;
}

function mount(el, tag) {
    var wc = el.__nexaEl;
    if (!wc || wc.parentNode !== el || wc.localName !== tag) {
        wc = el.querySelector(tag);
        if (!wc) {
            wc = document.createElement(tag);
            el.appendChild(wc);
        }
        el.__nexaEl = wc;
    }
    return wc;
}

export function defineComponent(def) {
    var meta = buildMeta(def);
    var View = def.view;
    if (typeof View !== "function" || !(View.prototype instanceof NexaElement)) {
        throw new Error("[nexa] defineComponent(\"" + meta.id + "\"): `view` must be a class extending NexaElement");
    }
    // A fresh subclass: one custom element per component, even if two
    // components share a view class. Internal `state` becomes Lit reactive state.
    var Klass = class extends View {};
    var stateProps = {};
    Object.keys(meta.state).forEach(function (k) { stateProps[k] = { state: true }; });
    Klass.properties = Object.assign({}, View.properties || {}, stateProps);
    Klass.__nexaMeta = meta;
    var tag = tagFor(meta.id);
    customElements.define(tag, Klass);

    var compiled = {
        category: meta.category,
        label: meta.label,
        icon: meta.icon,
        defaultSize: meta.size,
        capabilities: meta.capabilities,
        hideSparkplugWatch: meta.hideSparkplugWatch,
        defaults: legacyDefaults(meta),
        bindable: Object.keys(meta.props).filter(function (k) { return meta.props[k].bindable; }).map(function (k) { return "props." + k; }),
        events: meta.eventList.map(function (e) { return { name: e.name, label: e.label }; }),
        actions: meta.actionList.map(function (a) { return { name: a.name, label: a.label }; }),
        version: meta.version,
        nexa: meta,
        tag: tag,
        /** Props saved by an older version, brought up to date (the editor persists the result). */
        migrateProps: function (props) { return migrateProps(meta, props || {}); },
        render: function (el, props, ctx) {
            mount(el, tag)._nexaRender(props, ctx);
        },
        onBind: function (el, target, value) {
            var wc = el.__nexaEl;
            if (!wc || !target || target.indexOf("props.") !== 0) return;
            wc._nexaBind(target.slice(6), value);
        },
        /** Logic "call action": runs the view's method of that name. */
        invoke: function (el, name, params) {
            var wc = el.__nexaEl;
            if (!wc) return undefined;
            if (!meta.actionList.some(function (a) { return a.name === name; })) throw new Error("[nexa] " + meta.id + " has no action \"" + name + "\"");
            if (typeof wc[name] !== "function") throw new Error("[nexa] " + meta.id + ": action \"" + name + "\" has no method on the view");
            return wc[name](params);
        }
    };
    window.NEXA.registerComponent(meta.id, compiled);
    return compiled;
}

// Custom inspector widgets: defineInspectorWidget("acme-curve", ({ KitElement, html }) => class extends KitElement {...}).
// The property kit is editor-only, so they are queued until it loads (and never defined on a deployed page).
export function defineInspectorWidget(tag, factory) {
    if (window.NexaKit && typeof window.NexaKit.defineWidget === "function") return window.NexaKit.defineWidget(tag, factory);
    (window.__nexaInspectorWidgets = window.__nexaInspectorWidgets || []).push([tag, factory]);
    return undefined;
}
