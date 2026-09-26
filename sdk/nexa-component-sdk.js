// nexa-component-sdk.js — THE module a Nexa component plugin imports.
//
//   import { defineComponent, NexaElement, html, css, bind } from "../../nexa-sdk/nexa-component-sdk.js";
//
// Served by @kufayeka/node-red-nexa-dashboard at <root>/nexa-sdk/ on BOTH the
// editor (httpAdmin) and deployed pages (httpNode), so a plugin whose files
// are served from <root>/<plugin>/vendor/ always reaches it with the same
// relative path. (A plugin that bundles itself can alias the bare name
// "nexa-component-sdk.js" to this file instead.)
//
// This file is only a facade: the implementation is the SDK bundle the host
// page already loads (one copy of Lit, of the registry and of the <nx-*>
// widgets per page). The editor runs plugin scripts in no guaranteed order,
// so the facade waits for that bundle (top-level await) before handing out
// the exports — a plugin's own code always runs with the SDK ready.
const SDK = window.NexaSDK || await new Promise(function (resolve) {
    (window.__nexaSdkReady = window.__nexaSdkReady || []).push(function () { resolve(window.NexaSDK); });
});

export const {
    version,
    defineComponent, NexaElement, FieldController,
    LitElement, html, css, svg, nothing, unsafeCSS,
    bind, defineInspectorWidget,
    defineTagProvider, extendTagProvider, getTagProvider, listTagProviders, parseTag, makeTag, isTag,
    defineCodec, getCodec, format, isUnknown
} = SDK;

export default SDK;
