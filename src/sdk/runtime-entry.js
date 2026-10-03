// Entry of dist/nexa-sdk.bundle.js — Lit + the Nexa component SDK, loaded as
// a plain <script> by the editor (nexa-plugin.html) and by every deployed page
// (/nexa/_sdk.js, before the component plugins). Plugins don't touch these
// globals: they import sdk/nexa-component-sdk.js (an ES module that waits for
// this bundle and re-exports window.NexaSDK).
//
// Lit ships as a runtime GLOBAL (window.NEXA_LIT) rather than an ES import
// because the "@lit-component" node evaluates user-typed class bodies with
// `new Function(...)` — no bundler exists at that point. It is kept out of
// the editor bundle because Lit runs browser feature detection at import time.
import { LitElement, html, css, nothing, svg, unsafeCSS, render, noChange } from "lit";
import { directive, Directive, PartType } from "lit/directive.js";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { live } from "lit/directives/live.js";
import { ensureRegistry } from "./registry.js";
import { defineComponent, defineInspectorWidget, definePropertyEditor } from "./component.js";
import { NexaElement, isUnknown } from "./element.js";
import { FieldController } from "./field/controller.js";
import { cssFields } from "./schema.js";
import { defineLogicNode } from "./logic-node.js";
import { defineCodec, getCodec } from "./field/codecs.js";
import { bind, withInspector } from "./bind.js";
import { defineTagProvider, extendTagProvider, getTagProvider, listTagProviders, parseTag, makeTag, isTag } from "./tags.js";
import F from "./format.js";
import { setAssets, listAssets, getAsset, onAssetsChange, assetRef, resolveAsset, assetUrl } from "./assets.js";
import { theme, setTheme } from "./theme.js";
import { zag } from "./zag.js";
import { toBindingList, isBindingList, isBoundValue, resolveBindingProps, sourceKind, evaluateExpression, parseExpression } from "../model/binding.js";
import { formatValue, formatParts, splitSiUnit, NUMBER_FORMAT_FIELDS } from "../model/numformat.js";

// A value as a binding priority list ({ $bind, static }): a list as it is, a legacy binding
// string ("{sparkplug:…}", "{msg.x}", "{name}") converted, anything else static. For a
// plugin's migrate() (a binding moved into a list item's field) and its own checks.
function asBinding(value, staticValue) {
    var b = toBindingList(value, staticValue);
    var out = { $bind: b.sources };
    if (b.static !== undefined) out.static = b.static;
    return out;
}

export var SDK_VERSION = "1.0.0";

if (!window.NexaSDK) {
    window.NEXA_LIT = { LitElement: LitElement, html: html, css: css, nothing: nothing, svg: svg, unsafeCSS: unsafeCSS, render: render, noChange: noChange, directive: directive, Directive: Directive, PartType: PartType,
        keyed: keyed, repeat: repeat, live: live };
    window.NexaFieldFormat = window.NexaFieldFormat || F; // pre-SDK field plugins
    window.NexaSDK = {
        version: SDK_VERSION,
        // components
        defineComponent: defineComponent,
        NexaElement: NexaElement,
        FieldController: FieldController,
        // Custom CSS fields a component offers in its inspector (none are added on their own)
        cssFields: cssFields,
        // Logic nodes (the Events palette, run on the page)
        defineLogicNode: defineLogicNode,
        // Lit
        LitElement: LitElement, html: html, css: css, svg: svg, nothing: nothing, unsafeCSS: unsafeCSS,
        // inspector & kit
        bind: bind,
        defineInspectorWidget: defineInspectorWidget,
        // a prop's own editor in the inspector (prop.editor), and its plugin's admin routes
        definePropertyEditor: definePropertyEditor,
        adminApi: function (plugin) { return window.NexaKit ? window.NexaKit.adminApi(plugin) : null; },
        _withInspector: withInspector,
        get kit() { return window.NexaKit; },
        get NexaKit() { return window.NexaKit; },
        get KitElement() { return window.NexaKit && window.NexaKit.KitElement; },
        // tags
        asBinding: asBinding, isBindingList: isBindingList, isBound: isBoundValue,
        // one number format everywhere (axes, tooltips, legends); expressions without eval
        formatValue: formatValue, formatParts: formatParts, splitSiUnit: splitSiUnit, NUMBER_FORMAT_FIELDS: NUMBER_FORMAT_FIELDS,
        evaluateExpression: evaluateExpression, parseExpression: parseExpression,
        // the testkit resolves binding lists like the page does (not for plugins)
        _bindings: { resolveProps: resolveBindingProps, kind: sourceKind },
        defineTagProvider: defineTagProvider, extendTagProvider: extendTagProvider, getTagProvider: getTagProvider,
        listTagProviders: listTagProviders, parseTag: parseTag, makeTag: makeTag, isTag: isTag,
        // values
        defineCodec: defineCodec, getCodec: getCodec, format: F, isUnknown: isUnknown,
        // image assets (the Assets tab): {asset:name} or a name -> a URL
        assetUrl: assetUrl, resolveAsset: resolveAsset, assetRef: assetRef, listAssets: listAssets, getAsset: getAsset,
        onAssetsChange: onAssetsChange, setAssets: setAssets,
        // the app's theme: design tokens in the current mode (token / cssVar / mode / list / onChange)
        theme: theme, setTheme: setTheme,
        // zag.js (keyboard / focus / ARIA state machines) + a Lit controller and spread()
        zag: zag
    };
    var NEXA = ensureRegistry();
    NEXA.sdk = window.NexaSDK;
    NEXA._installComponentCompiler(defineComponent);
    // Scripts that loaded before the SDK and need it (the property kit, the
    // ES-module facade) queued a callback here; from now on a push runs at once.
    var waiting = Array.isArray(window.__nexaSdkReady) ? window.__nexaSdkReady : [];
    window.__nexaSdkReady = { push: function (fn) { fn(); } };
    waiting.forEach(function (fn) {
        try { fn(); } catch (e) { console.error("[nexa] SDK-ready callback failed:", e); }
    });
}
