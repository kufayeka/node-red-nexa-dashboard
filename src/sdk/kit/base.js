// --- KitElement: the contract every nx-* widget shares ---------------------
//   .value                 the value (any JSON type)
//   nx-change              the one event: detail.value = the new value (bubbles, composed)
//   label / help / icon / placeholder / badge
//   disabled / readonly / required / invalid + message
//   modified               the value differs from the default (a dot next to the label)
//   .actions               extra header buttons (a Lit template; the inspector puts reset / bind here)
// Widgets render in light DOM (see styles.js) and carry the .nx-kit class
// themselves, so they are styled wherever they are used.
import { LitElement, html, nothing } from "lit";
import { ensureStyles } from "./styles.js";

var seq = 0;

// Set by the host (the editor, a test harness): code editor, tag list, ...
var host = {};
export function setHost(h) { host = Object.assign({}, host, h || {}); }
export function getHost() { return host; }

/**
 * What a binding path means, against the host's list of visible variables
 * ([{ name, value, owner }]): an exact entry, or a path INSIDE a known one
 * ({$route.query.a} in $route.query, {M101.Speed}, {cfg.limit}). $route.* is
 * always the page URL. -> { entry, exact } or null (not declared around the node).
 */
export function lookupBinding(vars, path) {
    var exact = (vars || []).filter(function (x) { return x.name === path; })[0];
    if (exact) return { entry: exact, exact: true };
    var best = null;
    (vars || []).forEach(function (x) {
        if ((path.indexOf(x.name + ".") === 0 || path.indexOf(x.name + "[") === 0) && (!best || x.name.length > best.name.length)) best = x;
    });
    if (best) return { entry: best, exact: false };
    if (/^\$route(\.|$)/.test(path)) return { entry: { name: path, value: "(from the URL)", owner: { name: "the URL", kind: "route" } }, exact: false };
    return null;
}

export function str(v) {
    if (v === undefined || v === null) return "";
    if (typeof v === "object") { try { return JSON.stringify(v); } catch (e) { return ""; } }
    return String(v);
}

export function icon(cls) {
    return cls ? html`<i class="${cls}" aria-hidden="true"></i>` : nothing;
}

export class KitElement extends LitElement {
    static properties = {
        value: { attribute: false },
        label: { type: String },
        help: { type: String },
        icon: { type: String },
        placeholder: { type: String },
        badge: { type: String },
        disabled: { type: Boolean },
        readonly: { type: Boolean },
        required: { type: Boolean },
        invalid: { type: Boolean },
        message: { type: String },
        modified: { type: Boolean },
        actions: { attribute: false },
        // A tag / template-parameter binding instead of a static value: the
        // widget then shows a tag picker in place of its own control.
        binding: { attribute: false }
    };

    constructor() {
        super();
        this.value = undefined;
        this._uid = "nx-" + (++seq);
    }

    createRenderRoot() {
        ensureStyles(this.ownerDocument);
        return this;
    }

    connectedCallback() {
        super.connectedCallback();
        this.classList.add("nx-kit");
    }

    /** Set the value and tell the world. */
    change(value) {
        this.value = value;
        this.dispatchEvent(new CustomEvent("nx-change", { detail: { value: value }, bubbles: true, composed: true }));
    }

    get controlId() {
        return this._uid + "-c";
    }

    _head() {
        if (!this.label && !this.actions && !this.badge) return nothing;
        return html`<div class="nx-field-head">
            <label class="nx-label" for="${this.controlId}">${icon(this.icon)}<span>${this.label || ""}</span>${this.required ? html`<span class="nx-req">*</span>` : nothing}${this.badge ? html`<span class="nx-badge">${this.badge}</span>` : nothing}</label>
            ${this.modified ? html`<span class="nx-dot" title="Changed from the default"></span>` : nothing}
            ${this.actions || nothing}
        </div>`;
    }

    _foot() {
        return html`${this.invalid && this.message ? html`<div class="nx-message">${this.message}</div>` : nothing}${this.help ? html`<div class="nx-help">${this.help}</div>` : nothing}`;
    }

    /** Label on top, the control (or, bound, the binding editor: nx-binding), then the message / help. */
    frame(control) {
        if (this.binding !== undefined && this.binding !== null) {
            control = html`<nx-binding .value="${this.binding}" @nx-change="${(e) => { e.stopPropagation(); this.change(e.detail.value); }}"></nx-binding>`;
        }
        return html`<div class="nx-field ${this.invalid ? "nx-invalid" : ""}">${this._head()}${control}${this._foot()}</div>`;
    }
}
