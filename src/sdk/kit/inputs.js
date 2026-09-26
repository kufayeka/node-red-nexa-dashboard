// --- Basic input widgets --------------------------------------------------------
// nx-text  nx-textarea  nx-number  nx-select  nx-combobox  nx-segmented
// nx-checkbox  nx-toggle  nx-slider  nx-color
// All follow KitElement's contract (.value + nx-change, label/help/..., invalid/message).
import { html, nothing } from "lit";
import { KitElement, str, icon } from "./base.js";

// Text typed into a field is applied this long after the last keystroke
// (and immediately on Enter / blur), so the canvas follows while typing
// without one history step per character.
var TYPING_DEBOUNCE_MS = 400;

class TypingElement extends KitElement {
    constructor() {
        super();
        this._timer = null;
    }
    _typed(raw) {
        clearTimeout(this._timer);
        this._pending = raw;
        this._timer = setTimeout(() => this._flush(), TYPING_DEBOUNCE_MS);
    }
    _flush() {
        clearTimeout(this._timer);
        this._timer = null;
        if (this._pending === undefined) return;
        var raw = this._pending;
        this._pending = undefined;
        var v = this.parse(raw);
        if (v !== this.value) this.change(v);
    }
    parse(raw) { return raw; }
    disconnectedCallback() {
        this._flush();
        super.disconnectedCallback();
    }
}

// ---- nx-text -------------------------------------------------------------------
export class NxText extends TypingElement {
    static properties = {
        mono: { type: Boolean },
        // not prefix / suffix: Element.prefix is a DOM property
        addonBefore: { type: String, attribute: "addon-before" },
        addonAfter: { type: String, attribute: "addon-after" },
        maxlength: { type: Number },
        type: { type: String }
    };
    _input() {
        return html`<input id="${this.controlId}" class="nx-control ${this.mono ? "nx-mono" : ""}" type="${this.type === "password" ? "password" : "text"}"
            .value="${str(this.value)}" placeholder="${this.placeholder || ""}" maxlength="${this.maxlength > 0 ? this.maxlength : nothing}"
            ?disabled="${this.disabled}" ?readonly="${this.readonly}" spellcheck="false" autocomplete="off"
            @input="${(e) => this._typed(e.target.value)}" @change="${(e) => { this._pending = e.target.value; this._flush(); }}"
            @keydown="${(e) => { if (e.key === "Enter") { this._pending = e.target.value; this._flush(); } }}">`;
    }
    render() {
        if (!this.addonBefore && !this.addonAfter) return this.frame(this._input());
        return this.frame(html`<div class="nx-group">${this.addonBefore ? html`<span class="nx-addon">${this.addonBefore}</span>` : nothing}${this._input()}${this.addonAfter ? html`<span class="nx-addon">${this.addonAfter}</span>` : nothing}</div>`);
    }
}

// ---- nx-textarea ---------------------------------------------------------------
export class NxTextarea extends TypingElement {
    static properties = { rows: { type: Number }, mono: { type: Boolean } };
    render() {
        return this.frame(html`<textarea id="${this.controlId}" class="nx-control ${this.mono ? "nx-mono" : ""}" rows="${this.rows || 3}"
            .value="${str(this.value)}" placeholder="${this.placeholder || ""}" ?disabled="${this.disabled}" ?readonly="${this.readonly}" spellcheck="false"
            @input="${(e) => this._typed(e.target.value)}" @change="${(e) => { this._pending = e.target.value; this._flush(); }}"></textarea>`);
    }
}

// ---- nx-number -------------------------------------------------------------------
// Value: a number, or "" when empty (0 is a real value, never "empty").
export class NxNumber extends TypingElement {
    static properties = {
        min: { type: Number }, max: { type: Number }, step: { type: Number },
        unit: { type: String }, allowEmpty: { type: Boolean, attribute: "allow-empty" }
    };
    constructor() { super(); this.allowEmpty = true; }
    parse(raw) {
        var t = String(raw).trim().replace(",", ".");
        if (t === "") return this.allowEmpty ? "" : 0;
        var n = Number(t);
        return Number.isFinite(n) ? n : this.value;
    }
    render() {
        var input = html`<input id="${this.controlId}" class="nx-control" type="number" .value="${str(this.value)}"
            min="${this.min ?? nothing}" max="${this.max ?? nothing}" step="${this.step ?? "any"}" placeholder="${this.placeholder || ""}"
            ?disabled="${this.disabled}" ?readonly="${this.readonly}"
            @input="${(e) => this._typed(e.target.value)}" @change="${(e) => { this._pending = e.target.value; this._flush(); }}"
            @keydown="${(e) => { if (e.key === "Enter") { this._pending = e.target.value; this._flush(); } }}">`;
        return this.frame(this.unit ? html`<div class="nx-group">${input}<span class="nx-addon">${this.unit}</span></div>` : input);
    }
}

// Options: [{ value, label, icon }] — values may be any JSON type.
function optionIndex(options, value) {
    for (var i = 0; i < options.length; i++) if (str(options[i].value) === str(value)) return i;
    return -1;
}

// ---- nx-select -----------------------------------------------------------------------
export class NxSelect extends KitElement {
    static properties = { options: { attribute: false } };
    constructor() { super(); this.options = []; }
    render() {
        var opts = this.options || [];
        var at = optionIndex(opts, this.value);
        return this.frame(html`<select id="${this.controlId}" class="nx-control" ?disabled="${this.disabled || this.readonly}"
            @change="${(e) => { var o = opts[Number(e.target.value)]; if (o) this.change(o.value); }}">
            ${at === -1 ? html`<option value="-1" selected>${str(this.value) || "—"}</option>` : nothing}
            ${opts.map((o, i) => html`<option value="${i}" ?selected="${i === at}">${o.label}</option>`)}
        </select>`);
    }
}

// ---- nx-segmented --------------------------------------------------------------------
export class NxSegmented extends KitElement {
    static properties = { options: { attribute: false }, iconsOnly: { type: Boolean, attribute: "icons-only" } };
    constructor() { super(); this.options = []; }
    render() {
        var opts = this.options || [];
        var at = optionIndex(opts, this.value);
        return this.frame(html`<div class="nx-seg" role="radiogroup" id="${this.controlId}">
            ${opts.map((o, i) => html`<button type="button" class="nx-seg-item ${i === at ? "nx-on" : ""}" role="radio" aria-checked="${i === at}"
                title="${o.label}" ?disabled="${this.disabled || this.readonly}" @click="${() => this.change(o.value)}">
                ${icon(o.icon)}${this.iconsOnly && o.icon ? nothing : html`<span>${o.label}</span>`}</button>`)}
        </div>`);
    }
}

// ---- nx-combobox ---------------------------------------------------------------------
// A text input with a filtered suggestion list. `options` ([{ value, label, detail }])
// or `source(query) -> options`. `free` (default true): any typed text is a value.
export class NxCombobox extends KitElement {
    static properties = {
        options: { attribute: false }, source: { attribute: false },
        free: { type: Boolean }, mono: { type: Boolean }, clearable: { type: Boolean },
        _open: { state: true }, _query: { state: true }, _active: { state: true }
    };
    constructor() {
        super();
        this.options = [];
        this.free = true;
        this._open = false;
        this._query = null;
        this._active = -1;
    }
    _all() {
        var list = typeof this.source === "function" ? (this.source(this._query || "") || []) : (this.options || []);
        return list.map((o) => (o !== null && typeof o === "object") ? o : { value: o, label: String(o) });
    }
    _filtered() {
        var q = (this._query || "").toLowerCase();
        var all = this._all();
        if (!q) return all.slice(0, 200);
        return all.filter((o) => String(o.label).toLowerCase().indexOf(q) !== -1 || str(o.value).toLowerCase().indexOf(q) !== -1).slice(0, 200);
    }
    _pick(o) {
        this._open = false;
        this._query = null;
        if (str(o.value) !== str(this.value)) this.change(o.value);
    }
    _commitTyped(text) {
        this._open = false;
        this._query = null;
        if (!this.free) return;
        if (text !== str(this.value)) this.change(text);
    }
    _key(e) {
        var list = this._filtered();
        if (e.key === "ArrowDown") { e.preventDefault(); this._open = true; this._active = Math.min(list.length - 1, this._active + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); this._active = Math.max(0, this._active - 1); }
        else if (e.key === "Enter") {
            e.preventDefault();
            if (this._open && list[this._active]) this._pick(list[this._active]);
            else this._commitTyped(e.target.value);
        } else if (e.key === "Escape") {
            if (this._open) { e.stopPropagation(); this._open = false; }
        }
    }
    render() {
        var list = this._open ? this._filtered() : [];
        var shown = this._query !== null ? this._query : str(this.value);
        return this.frame(html`<div class="nx-combo">
            <div class="nx-group">
                <input id="${this.controlId}" class="nx-control ${this.mono ? "nx-mono" : ""}" .value="${shown}" placeholder="${this.placeholder || ""}"
                    ?disabled="${this.disabled}" ?readonly="${this.readonly}" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="${this._open}"
                    @focus="${() => { this._open = true; this._active = -1; }}"
                    @input="${(e) => { this._query = e.target.value; this._open = true; this._active = -1; }}"
                    @keydown="${this._key}"
                    @blur="${(e) => { var t = e.target.value; setTimeout(() => { if (this._open || this._query !== null) this._commitTyped(t); }, 150); }}">
                ${this.clearable && str(this.value) && !this.disabled && !this.readonly
                    ? html`<button type="button" class="nx-icon-btn" title="Clear" @mousedown="${(e) => e.preventDefault()}" @click="${() => { this._query = null; this.change(""); }}"><i class="fa fa-times"></i></button>`
                    : nothing}
            </div>
            ${this._open ? html`<div class="nx-menu" role="listbox" @mousedown="${(e) => e.preventDefault()}">
                ${list.length ? list.map((o, i) => html`<div class="nx-menu-item ${i === this._active ? "nx-active" : ""}" role="option" @click="${() => this._pick(o)}">
                    <span>${o.label}</span>${o.detail ? html`<small>${o.detail}</small>` : nothing}</div>`)
                    : html`<div class="nx-menu-empty">${this._all().length ? "No match" : "No suggestions"}</div>`}
            </div>` : nothing}
        </div>`);
    }
}

// ---- nx-checkbox / nx-toggle -----------------------------------------------------------
export class NxCheckbox extends KitElement {
    static properties = { indeterminate: { type: Boolean } };
    _control() {
        return html`<input id="${this.controlId}" type="checkbox" .checked="${!!this.value}" .indeterminate="${!!this.indeterminate}"
            ?disabled="${this.disabled || this.readonly}" @change="${(e) => this.change(e.target.checked)}">`;
    }
    render() {
        return html`<div class="nx-field">
            <div class="nx-inline">
                <label class="nx-check ${this.disabled ? "nx-disabled" : ""}" style="flex: 1 1 auto; min-width: 0;">${this._control()}<span>${icon(this.icon)} ${this.label || ""}</span></label>
                ${this.modified ? html`<span class="nx-dot" title="Changed from the default"></span>` : nothing}
                ${this.actions || nothing}
            </div>
            ${this._foot()}
        </div>`;
    }
}

export class NxToggle extends NxCheckbox {
    _control() {
        var on = !!this.value;
        return html`<button type="button" id="${this.controlId}" role="switch" aria-checked="${on}" class="nx-icon-btn" style="width:auto;height:auto;padding:0;background:none;"
            ?disabled="${this.disabled || this.readonly}" @click="${() => this.change(!on)}"><span class="nx-switch ${on ? "nx-on" : ""}"></span></button>`;
    }
}

// ---- nx-slider ------------------------------------------------------------------------------
export class NxSlider extends KitElement {
    static properties = { min: { type: Number }, max: { type: Number }, step: { type: Number }, unit: { type: String } };
    constructor() { super(); this.min = 0; this.max = 100; this.step = 1; }
    render() {
        var v = this.value === "" || this.value === undefined || this.value === null ? this.min : Number(this.value);
        var set = (raw, commit) => {
            var n = Number(raw);
            if (!Number.isFinite(n)) return;
            n = Math.max(this.min, Math.min(this.max, n));
            if (commit || n !== this.value) this.change(n);
        };
        return this.frame(html`<div class="nx-slider">
            <input type="range" min="${this.min}" max="${this.max}" step="${this.step}" .value="${String(v)}" ?disabled="${this.disabled || this.readonly}"
                @input="${(e) => set(e.target.value)}">
            <input id="${this.controlId}" class="nx-control" type="number" min="${this.min}" max="${this.max}" step="${this.step}" .value="${String(v)}"
                ?disabled="${this.disabled}" ?readonly="${this.readonly}" @change="${(e) => set(e.target.value, true)}">
        </div>`);
    }
}

// ---- nx-color ---------------------------------------------------------------------------------
// Any CSS colour as text (hex, rgb(a), named, "transparent"); the swatch opens
// the native picker (hex). "" = none.
var probe = null;
function toHex(color) {
    if (!color) return "#000000";
    if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(color)) return ("#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3]).toLowerCase();
    try {
        probe = probe || document.createElement("canvas").getContext("2d");
        probe.fillStyle = "#000000";
        probe.fillStyle = color;
        var v = probe.fillStyle;
        if (/^#[0-9a-f]{6}$/i.test(v)) return v;
        var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
        if (m) return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    } catch (e) { /* no canvas */ }
    return "#000000";
}

export class NxColor extends KitElement {
    static properties = { clearable: { type: Boolean } };
    constructor() { super(); this.clearable = true; }
    render() {
        var v = str(this.value);
        return this.frame(html`<div class="nx-group">
            <label class="nx-swatch" title="Pick a colour"><span class="nx-swatch-fill" style="background: ${v || "transparent"};"></span>
                <input type="color" .value="${toHex(v)}" ?disabled="${this.disabled || this.readonly}" @input="${(e) => this.change(e.target.value)}"></label>
            <input id="${this.controlId}" class="nx-control nx-mono" .value="${v}" placeholder="${this.placeholder || "none"}" spellcheck="false"
                ?disabled="${this.disabled}" ?readonly="${this.readonly}" @change="${(e) => this.change(e.target.value.trim())}"
                @keydown="${(e) => { if (e.key === "Enter") this.change(e.target.value.trim()); }}">
            ${this.clearable && v && !this.disabled && !this.readonly ? html`<button type="button" class="nx-icon-btn" title="Clear" @click="${() => this.change("")}"><i class="fa fa-times"></i></button>` : nothing}
        </div>`);
    }
}
