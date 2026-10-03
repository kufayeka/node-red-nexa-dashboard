// --- A plugin's own property editor -------------------------------------------------
// A prop names it:   properties: { curve: { type: "json", editor: "acme-curve-editor" } }
// and the plugin defines it (the SDK queues the factory until the kit loads; never on a page):
//
//   definePropertyEditor("acme-curve-editor", ({ PropertyEditor, html }) => class extends PropertyEditor {
//       static kind = "dialog";                           // "inline" (default) | "large" | "dialog"
//       static summary(value, props) { return value ? value.points.length + " points" : ""; }
//       render() {
//           return this.frame(html`<canvas …></canvas>
//               <button @click=${() => this.commit(this.draft)}>Apply</button>`);
//       }
//       async load() { this.list = await this.api.get("/curves", { q: "pump" }); }   // the plugin's own routes
//   });
//
// The editor is a KitElement: .value in, commit(value) out (nx-change), frame() for the label,
// help, reset / bind / breakpoint buttons the inspector puts on it. preview(value) shows a value
// on the canvas without an undo step (a colour being dragged). `this.prop` = the prop's schema,
// `this.props` = the component's props, `this.api` = its plugin's admin routes (sdk/package
// adminApi), when the editor's `static plugin = "<name>"` is set.
import { KitElement } from "../base.js";

export class PropertyEditor extends KitElement {
    static properties = { prop: { attribute: false }, props: { attribute: false } };
    /** How the inspector shows it: "inline" | "large" (the pane can grow) | "dialog" (summary + Edit…). */
    static kind = "inline";
    /** The plugin name its `api` talks to (sdk/package's `name`). */
    static plugin = "";

    /** The value is final: one undo step. */
    commit(value) { this.change(value); }
    /** Show a value on the canvas while it is being picked: no undo step, not saved. */
    preview(value) {
        this.dispatchEvent(new CustomEvent("nx-preview", { detail: { value: value }, bubbles: true, composed: true }));
    }
    get api() { return adminApi(this.constructor.plugin); }
}

/**
 * The admin routes a plugin added with sdk/package's `adminApi`, from the editor:
 *   adminApi("acme-gauges").get("/curves", { q }) -> JSON   (also post / put / del (path, body))
 * Same-origin, relative to the editor (like Node-RED's own calls), with the editor's login.
 */
export function adminApi(plugin) {
    var base = String(plugin || "").replace(/^\/+|\/+$/g, "");
    var call = function (method, path, query, body) {
        if (!base) return Promise.reject(new Error("[nexa] this editor has no `static plugin` (its plugin's name): no api"));
        var qs = query && Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "";
        var headers = { Accept: "application/json" };
        try {
            var tok = JSON.parse(window.localStorage.getItem("auth-tokens") || "null");
            if (tok && tok.access_token) headers.Authorization = "Bearer " + tok.access_token;
        } catch (e) { /* no login */ }
        if (body !== undefined) headers["Content-Type"] = "application/json";
        return fetch(base + "/api/" + String(path || "").replace(/^\/+/, "") + qs, {
            method: method, headers: headers, credentials: "same-origin",
            body: body === undefined ? undefined : JSON.stringify(body)
        }).then(function (r) {
            return r.text().then(function (t) {
                var data;
                try { data = t ? JSON.parse(t) : null; } catch (e) { data = t; }
                if (!r.ok) {
                    var err = new Error((data && data.error) || (method + " " + path + ": " + r.status));
                    err.status = r.status;
                    throw err;
                }
                return data;
            });
        });
    };
    return {
        get: function (path, query) { return call("GET", path, query); },
        post: function (path, body) { return call("POST", path, null, body); },
        put: function (path, body) { return call("PUT", path, null, body); },
        del: function (path, query) { return call("DELETE", path, query); }
    };
}

/** definePropertyEditor(tag, factory): factory({ PropertyEditor, KitElement, html, css, nothing, … }) -> class. */
export function definePropertyEditor(tag, factory, kitApi) {
    if (customElements.get(tag)) return customElements.get(tag);
    var Klass = factory(Object.assign({ PropertyEditor: PropertyEditor }, kitApi || {}));
    if (typeof Klass !== "function" || !(Klass.prototype instanceof PropertyEditor)) {
        throw new Error("[nexa] definePropertyEditor(\"" + tag + "\"): the factory must return a class extending PropertyEditor");
    }
    customElements.define(tag, Klass);
    return Klass;
}

/** The editor class a prop names (prop.editor), when it is defined. */
export function editorClass(prop) {
    return prop && prop.editor ? customElements.get(prop.editor) || null : null;
}
