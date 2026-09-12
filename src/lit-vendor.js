// Ships Lit as a runtime GLOBAL (window.NEXA_LIT), not an ES import, because
// the "@lit-component" feature lets a user type raw JS class-body text into
// the Properties panel (see component-renderer.js's compileLitComponentClass)
// which is evaluated at edit/mount time via `new Function(...)` — there is no
// bundler available at THAT point, in either the editor or a deployed public
// page, so user-authored code can only ever reference a pre-loaded global,
// never `import ... from "lit"`.
//
// Deliberately NOT imported from src/index.js: Lit's own module-level code
// runs real browser feature-detection unconditionally at import time
// (document.createTreeWalker, CSSStyleSheet.prototype.replace, etc.) — fine
// in an actual browser, but folding it into dist/nexa-editor.bundle.js would
// mean paying that cost (and needing those globals to exist) the moment the
// EDITOR bundle loads, whether or not any screen even uses a Lit Component.
// Instead build.js bundles this file into its OWN standalone
// dist/nexa-lit-vendor.bundle.js, loaded as a plain <script src> — once by
// the editor (RED.httpAdmin, see lib/nexa-plugin.js) and once by each
// deployed public page (RED.httpNode, under /nexa/_lit-vendor.js) — the same
// pattern @kufayeka/nexa-component-basic-shapes already uses for its own
// vendor bundle.
import { LitElement, html, css, nothing } from "lit";

window.NEXA_LIT = { LitElement: LitElement, html: html, css: css, nothing: nothing };
