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
        binding: { attribute: false },
        // bound: its own control below the binding edits the fallback (nx-fallback event)
        fallback: { type: Boolean },
        // a value per breakpoint: { items: [{ id, name, range, design, set, selected, value }], pick(id), clear(id) }
        responsive: { attribute: false },
        // theme tokens it can take ("colors", "fontSizes,spacing"…): a ◆ picker; {token:…} shows as a chip
        tokens: { type: String },
        _tokenOpen: { state: true },
        _tokenFilter: { state: true }
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

    /** Set the value and tell the world (bound: the control's value is the fallback -> nx-fallback). */
    change(value) {
        this.value = value;
        var type = this.fallback && this.binding !== undefined && this.binding !== null && !this._bindingChange ? "nx-fallback" : "nx-change";
        this.dispatchEvent(new CustomEvent(type, { detail: { value: value }, bubbles: true, composed: true }));
    }

    // ---- theme tokens (NexaSDK.theme) ----------------------------------------------------------
    _tokenList() {
        var t = window.NexaSDK && window.NexaSDK.theme;
        if (!t || !this.tokens) return [];
        var cats = String(this.tokens).split(",").map(function (c) { return c.trim(); }).filter(Boolean);
        var f = String(this._tokenFilter || "").toLowerCase();
        var out = [];
        cats.forEach(function (c) { t.list(c).forEach(function (tk) { if (!f || tk.path.toLowerCase().indexOf(f) !== -1) out.push(tk); }); });
        return out.slice(0, 400);
    }
    _tokenValue(path) { var t = window.NexaSDK && window.NexaSDK.theme; return t ? t.token(path) : undefined; }
    _tokenButton() {
        if (!this.tokens || (this.binding !== undefined && this.binding !== null)) return nothing;
        return html`<button type="button" class="nx-icon-btn nx-token-btn ${this._tokenOpen ? "nx-on" : ""}" title="A theme token (${this.tokens})"
            @click="${(e) => { e.stopPropagation(); this._tokenOpen = !this._tokenOpen; }}"><i class="fa fa-diamond"></i></button>`;
    }
    _tokenPanel() {
        if (!this._tokenOpen) return nothing;
        var self = this;
        var list = this._tokenList();
        var colors = /colors/.test(this.tokens);
        return html`<div class="nx-token-panel">
            <input class="nx-control nx-token-filter" type="text" placeholder="Filter: primary, bg, lg…" .value="${this._tokenFilter || ""}"
                @input="${(e) => { e.stopPropagation(); self._tokenFilter = e.target.value; }}" @keydown="${(e) => { if (e.key === "Escape") self._tokenOpen = false; }}">
            <div class="nx-token-list">${list.length ? list.map(function (tk) {
                var v = self._tokenValue(tk.path);
                return html`<button type="button" class="nx-token-item" data-token="${tk.path}" title="${tk.path} = ${v}"
                    @click="${(e) => { e.stopPropagation(); self._tokenOpen = false; self.change("{token:" + tk.path + "}"); }}">
                    ${colors ? html`<span class="nx-token-swatch" style="background:${v}"></span>` : nothing}
                    <span class="nx-token-path">${tk.path.replace(/^[a-zA-Z]+\./, "")}</span><span class="nx-token-val">${v}</span></button>`;
            }) : html`<div class="nx-help">No token.</div>`}</div>
        </div>`;
    }
    _tokenChip(value) {
        var m = /^\{token:([^{}]+)\}$/.exec(String(value || "").trim());
        if (!m) return null;
        var v = this._tokenValue(m[1]);
        return html`<div class="nx-token-chip" title="${m[1]} = ${v}">
            ${/colors/.test(this.tokens || "") ? html`<span class="nx-token-swatch" style="background:${v}"></span>` : html`<i class="fa fa-diamond"></i>`}
            <span class="nx-token-path">${m[1]}</span><span class="nx-token-val">${v === undefined ? "(no such token)" : v}</span>
            <button type="button" class="nx-icon-btn" title="Its value instead of the token" @click="${(e) => { e.stopPropagation(); this.change(v === undefined ? "" : v); }}"><i class="fa fa-times"></i></button>
        </div>`;
    }

    _changeBinding(value) {
        this._bindingChange = true;
        try { this.change(value); } finally { this._bindingChange = false; }
    }

    _chips() {
        var r = this.responsive;
        if (!r || !r.items || !r.items.length) return nothing;
        return html`<div class="nx-bp-strip">${r.items.map(function (it) {
            var cls = "nx-bp-chip" + (it.selected ? " nx-sel" : "") + (it.set ? " nx-set" : "") + (it.design ? " nx-design" : "");
            var tip = it.name + (it.range ? " (" + it.range + ")" : "") + (it.design ? " — the design" : it.set ? " — set here" : " — inherited") + (it.value !== undefined && it.value !== "" ? ": " + it.value : "");
            return html`<button type="button" class="${cls}" data-bp="${it.id}" title="${tip}" @click="${function (e) { e.stopPropagation(); r.pick(it.id); }}">${it.design ? html`<i class="fa fa-star" aria-hidden="true"></i>` : nothing}<span>${it.name}</span>${(it.design || it.set) && it.value !== undefined && it.value !== "" ? html`<span class="nx-bp-val">${it.value}</span>` : nothing}${it.set && it.selected ? html`<i class="fa fa-times nx-bp-x" title="Inherit again" @click="${function (e) { e.stopPropagation(); r.clear(it.id); }}"></i>` : nothing}</button>`;
        })}</div>`;
    }

    get controlId() {
        return this._uid + "-c";
    }

    _head() {
        if (!this.label && !this.actions && !this.badge && !this.tokens) return nothing;
        return html`<div class="nx-field-head">
            <label class="nx-label" for="${this.controlId}">${icon(this.icon)}<span>${this.label || ""}</span>${this.required ? html`<span class="nx-req">*</span>` : nothing}${this.badge ? html`<span class="nx-badge">${this.badge}</span>` : nothing}</label>
            ${this.modified ? html`<span class="nx-dot" title="Changed from the default"></span>` : nothing}
            ${this._tokenButton()}
            ${this.actions || nothing}
        </div>`;
    }

    _foot() {
        return html`${this.invalid && this.message ? html`<div class="nx-message">${this.message}</div>` : nothing}${this.help ? html`<div class="nx-help">${this.help}</div>` : nothing}`;
    }

    /**
     * Label on top (+ the breakpoint chips), the control (or, bound, the binding editor:
     * nx-binding, and the control below it for the fallback), then the message / help.
     */
    frame(control) {
        if (this.binding && typeof this.binding === "object" && Array.isArray(this.binding.$bind)) {
            // a binding priority list: its sources, then the static value (this widget's control), last
            var list = html`<nx-binding-list .value="${this.binding}" .access="${this.access === "write" ? "write" : ""}" @nx-change="${(e) => { e.stopPropagation(); this._changeBinding(e.detail.value); }}"></nx-binding-list>`;
            control = html`${list}<div class="nx-fallback nx-bl-static"><div class="nx-fallback-label"><span class="nx-bl-n">${this.binding.$bind.length + 1}</span>Static — when no source above has a value</div>${control}</div>`;
        } else if (this.binding !== undefined && this.binding !== null) {
            var editor = html`<nx-binding .value="${this.binding}" @nx-change="${(e) => { e.stopPropagation(); this._changeBinding(e.detail.value); }}"></nx-binding>`;
            control = this.fallback
                ? html`${editor}<div class="nx-fallback"><div class="nx-fallback-label">Fallback — shown while the binding has no value (none yet, null, ???)</div>${control}</div>`
                : editor;
        }
        // a theme token: a chip instead of the control
        if (this.tokens && (this.binding === undefined || this.binding === null)) {
            var chip = this._tokenChip(this.value);
            if (chip) control = chip;
        }
        return html`<div class="nx-field ${this.invalid ? "nx-invalid" : ""}">${this._head()}${this._tokenPanel()}${this._chips()}${control}${this._foot()}</div>`;
    }
}
