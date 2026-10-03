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
import { buildMeta, legacyDefaults, migrateProps, defaultValues } from "./schema.js";
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
        // lists whose items are Logic targets of their own (see schema.js targetList)
        targets: (meta.targetList || []).map(function (t) {
            return { key: t.key, noun: t.noun, idField: t.idField, label: t.label,
                events: t.eventList.map(function (e) { return { name: e.name, label: e.label }; }),
                actions: t.actionList.map(function (a) { return { name: a.name, label: a.label }; }) };
        }),
        version: meta.version,
        nexa: meta,
        tag: tag,
        /**
         * The items of a target list (a chart's series) in these props: the saved ones, else the
         * schema's default (a component just dropped has its default series, not saved yet).
         */
        targetItems: function (props, key) {
            var v = props && props[key];
            if (Array.isArray(v)) return v;
            var p = meta.props[key];
            return p && Array.isArray(p.default) ? JSON.parse(JSON.stringify(p.default)) : [];
        },
        /** Props saved by an older version, brought up to date (the editor persists the result). */
        migrateProps: function (props) { return migrateProps(meta, props || {}); },
        render: function (el, props, ctx) {
            mount(el, tag)._nexaRender(props, ctx);
        },
        /** A component with slots: the slots its props declare now ([{ name, label, layout }]); null: none. */
        slotsOf: meta.slots ? function (props) { return meta.slots(Object.assign(defaultValues(meta), props || {})); } : null,
        /** Where its slot frames go (light DOM of its element: its <slot>s place them). */
        slotHost: function (el) { return el.__nexaEl || mount(el, tag); },
        /** The editor wants slot `name` seen (a tab switches to it). */
        revealSlot: function (el, name) {
            var wc = el.__nexaEl;
            if (wc && typeof wc.revealSlot === "function") wc.revealSlot(name);
        },
        onBind: function (el, target, value) {
            var wc = el.__nexaEl;
            if (!wc || !target || target.indexOf("props.") !== 0) return;
            wc._nexaBind(target.slice(6), value);
        },
        /**
         * Logic "call action": runs the view's method of that name. With a target ({ list, id, index }):
         * one of that list's item actions, the method gets (params, target).
         */
        invoke: function (el, name, params, target) {
            var wc = el.__nexaEl;
            if (!wc) return undefined;
            var list = meta.actionList;
            if (target && target.list) {
                var t = (meta.targetList || []).filter(function (x) { return x.key === target.list; })[0];
                if (!t) throw new Error("[nexa] " + meta.id + ": \"" + target.list + "\" is not a target list");
                list = t.actionList;
            }
            if (!list.some(function (a) { return a.name === name; })) throw new Error("[nexa] " + meta.id + " has no action \"" + name + "\"" + (target ? " for a " + target.list + " item" : ""));
            if (typeof wc[name] !== "function") throw new Error("[nexa] " + meta.id + ": action \"" + name + "\" has no method on the view");
            return target ? wc[name](params, target) : wc[name](params);
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

// A prop's own editor in the inspector (prop.editor = tag):
//   definePropertyEditor("acme-curve-editor", ({ PropertyEditor, html }) => class extends PropertyEditor {...})
// Queued until the (editor-only) property kit loads, like defineInspectorWidget; a no-op on a page.
export function definePropertyEditor(tag, factory) {
    if (window.NexaKit && typeof window.NexaKit.definePropertyEditor === "function") return window.NexaKit.definePropertyEditor(tag, factory);
    (window.__nexaPropertyEditors = window.__nexaPropertyEditors || []).push([tag, factory]);
    return undefined;
}
