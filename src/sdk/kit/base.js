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

    /** Label on top, the control (or the binding's tag picker), then the message / help. */
    frame(control) {
        if (this.binding !== undefined && this.binding !== null) {
            control = html`<nx-tag .value="${this.binding}" placeholder="{provider:address} or {param}" @nx-change="${(e) => { e.stopPropagation(); this.change(e.detail.value); }}"></nx-tag>`;
        }
        return html`<div class="nx-field ${this.invalid ? "nx-invalid" : ""}">${this._head()}${control}${this._foot()}</div>`;
    }
}
