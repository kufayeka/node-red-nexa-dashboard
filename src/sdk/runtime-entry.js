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
import { ensureRegistry } from "./registry.js";
import { defineComponent, defineInspectorWidget } from "./component.js";
import { NexaElement, isUnknown } from "./element.js";
import { FieldController } from "./field/controller.js";
import { defineCodec, getCodec } from "./field/codecs.js";
import { bind, withInspector } from "./bind.js";
import { defineTagProvider, extendTagProvider, getTagProvider, listTagProviders, parseTag, makeTag, isTag } from "./tags.js";
import F from "./format.js";

export var SDK_VERSION = "1.0.0";

if (!window.NexaSDK) {
    window.NEXA_LIT = { LitElement: LitElement, html: html, css: css, nothing: nothing, svg: svg, unsafeCSS: unsafeCSS, render: render, noChange: noChange, directive: directive, Directive: Directive, PartType: PartType };
    window.NexaFieldFormat = window.NexaFieldFormat || F; // pre-SDK field plugins
    window.NexaSDK = {
        version: SDK_VERSION,
        // components
        defineComponent: defineComponent,
        NexaElement: NexaElement,
        FieldController: FieldController,
        // Lit
        LitElement: LitElement, html: html, css: css, svg: svg, nothing: nothing, unsafeCSS: unsafeCSS,
        // inspector
        bind: bind,
        defineInspectorWidget: defineInspectorWidget,
        _withInspector: withInspector,
        // tags
        defineTagProvider: defineTagProvider, extendTagProvider: extendTagProvider, getTagProvider: getTagProvider,
        listTagProviders: listTagProviders, parseTag: parseTag, makeTag: makeTag, isTag: isTag,
        // values
        defineCodec: defineCodec, getCodec: getCodec, format: F, isUnknown: isUnknown
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
