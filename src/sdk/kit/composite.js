// --- Composite widgets and layout ---------------------------------------------------
// Widgets:  nx-code  nx-tag  nx-list  nx-state-switcher  nx-alert  nx-badge  nx-field
// Layout:   nx-section  nx-tabs + nx-tab  nx-row — containers for children you
//           write yourself in the inspector template:
//               <nx-tabs><nx-tab label="Data" icon="fa fa-exchange">...</nx-tab></nx-tabs>
//               <nx-section heading="Format">...</nx-section>
//               <nx-row>...two widgets side by side...</nx-row>
//           They are plain custom elements (not Lit): the children belong to
//           YOUR template, a container only adds its header / tab bar in front
//           of them and shows / hides them.
import { html, nothing } from "lit";
import { KitElement, str, icon, getHost } from "./base.js";
import { NxCombobox } from "./inputs.js";

function store(key, value) {
    try {
        if (value === undefined) return window.localStorage.getItem(key);
        window.localStorage.setItem(key, value);
    } catch (e) { /* storage blocked: session-only */ }
    return null;
}

function faIcon(cls) {
    var i = document.createElement("i");
    i.className = cls;
    i.setAttribute("aria-hidden", "true");
    return i;
}

// ---- nx-code ---------------------------------------------------------------------
// One-line preview + "Edit…" -> the host's code editor (a tray with CM6 in the
// Nexa editor). Without a host: an inline monospace textarea.
// (`language`, not `lang`: HTMLElement.lang is the element's own language.)
export class NxCode extends KitElement {
    static properties = { language: { type: String }, editorTitle: { type: String, attribute: "editor-title" }, _inline: { state: true } };
    _preview() {
        var v = str(this.value);
        if (!v.trim()) return html`<span class="nx-empty-text">${this.placeholder || "(empty)"}</span>`;
        var first = v.split("\n").find((l) => l.trim()) || "";
        var lines = v.split("\n").length;
        return html`<span>${first.trim()}</span><span style="margin-left:auto;flex:0 0 auto;color:var(--nx-text-faint);">${lines > 1 ? lines + " lines" : v.length + " chars"}</span>`;
    }
    _edit() {
        var h = getHost();
        if (typeof h.openCode !== "function") { this._inline = !this._inline; return; }
        Promise.resolve(h.openCode({ title: this.editorTitle || ("Edit " + (this.label || "code")), value: str(this.value), lang: this.language || "css", help: this.help }))
            .then((v) => { if (typeof v === "string" && v !== str(this.value)) this.change(v); });
    }
    render() {
        return this.frame(html`<div class="nx-code">
                <div class="nx-code-preview" id="${this.controlId}" title="${str(this.value)}">${this._preview()}</div>
                <button type="button" class="nx-btn" ?disabled="${this.disabled || this.readonly}" @click="${this._edit}"><i class="fa fa-code"></i> Edit…</button>
            </div>
            ${this._inline ? html`<textarea class="nx-control nx-mono" rows="8" style="margin-top:4px;" .value="${str(this.value)}"
                @change="${(e) => this.change(e.target.value)}"></textarea>` : nothing}`);
    }
}

// ---- nx-tag ------------------------------------------------------------------------
// A tag reference "{provider:address}" of ANY registered tag provider
// (Sparkplug today; OPC UA / SQL / UDT when they register). Provider chips
// (when more than one is allowed), the address with the provider's
// suggestions, a clear button and a live validity line. `providers` limits
// the choice (an input's `providers`); a template parameter "{name}" is
// accepted too.
function sdkApi() {
    return window.NexaSDK || null;
}

var PARAM_RE = /^\{[A-Za-z_$][\w$]*\}$/;

export class NxTag extends NxCombobox {
    static properties = { access: { type: String }, providers: { attribute: false }, _provider: { state: true } };
    constructor() {
        super();
        this.mono = true;
        this.clearable = true;
        this._provider = null;
        this.source = () => {
            var p = this._currentProvider();
            if (!p || typeof p.list !== "function") return [];
            return (p.list() || []).map((t) => ({ value: this._make(p.name, t.address), label: t.label || t.address, detail: t.detail || t.address }));
        };
    }
    _allowed() {
        var sdk = sdkApi();
        var all = sdk ? sdk.listTagProviders() : [];
        return this.providers && this.providers.length ? all.filter((p) => this.providers.indexOf(p.name) !== -1) : all;
    }
    _make(provider, address) {
        var sdk = sdkApi();
        return sdk ? sdk.makeTag(provider, address) : "{" + provider + ":" + address + "}";
    }
    _currentProvider() {
        var sdk = sdkApi();
        if (!sdk) return null;
        var t = sdk.parseTag(str(this.value));
        var allowed = this._allowed();
        var name = (t && t.known && t.provider) || this._provider || (allowed[0] && allowed[0].name);
        return name ? sdk.getTagProvider(name) : null;
    }
    willUpdate(changed) {
        if (changed.has("access") && !this.badge && this.access) this.badge = this.access === "write" ? "WRITE" : "READ";
        if (!this.placeholder || this._autoPlaceholder) {
            var p = this._currentProvider();
            this.placeholder = p ? "{" + p.name + ":" + (p.placeholder || "address") + "}" : "{provider:address}";
            this._autoPlaceholder = true;
        }
    }
    _status() {
        var v = str(this.value).trim();
        if (!v) return nothing;
        var sdk = sdkApi();
        var t = sdk ? sdk.parseTag(v) : null;
        if (t && t.valid) {
            var p = sdk.getTagProvider(t.provider);
            return html`<div class="nx-tag-status nx-ok"><i class="${(p && p.icon) || "fa fa-check"}"></i><span>${p ? p.label + ": " : ""}${t.display}</span></div>`;
        }
        if (PARAM_RE.test(v)) {
            return html`<div class="nx-tag-status"><i class="fa fa-link"></i><span>template parameter ${v}</span></div>`;
        }
        if (t && !t.known) return html`<div class="nx-tag-status nx-bad"><i class="fa fa-exclamation-triangle"></i><span>unknown tag provider "${t.provider}"</span></div>`;
        return html`<div class="nx-tag-status nx-bad"><i class="fa fa-exclamation-triangle"></i><span>not a valid tag${t ? " for " + t.provider : ""} — {provider:address}</span></div>`;
    }
    _foot() {
        return html`${this._status()}${super._foot()}`;
    }
    render() {
        var allowed = this._allowed();
        var field = super.render();
        if (allowed.length < 2) return field;
        var current = this._currentProvider();
        // provider chips above the address (only when there is a choice)
        return html`<div class="nx-tag-providers">${allowed.map((p) => html`<button type="button" class="nx-state ${current && current.name === p.name ? "nx-on" : ""}"
            title="${p.label}" @click="${() => {
                this._provider = p.name;
                var v = str(this.value);
                if (v && !PARAM_RE.test(v) && !(current && current.name === p.name)) this.change("");
            }}">${icon(p.icon)} ${p.label}</button>`)}</div>${field}`;
    }
}

// ---- nx-list -----------------------------------------------------------------------
// Rows with add / remove / drag-reorder. The row content comes from
// `renderItem(item, index, set(newItem))`; `newItem()` builds a fresh item.
// Value: the array. (Method names avoid add/remove/move: remove() is the
// DOM's own Element.remove(), which Lit calls.)
export class NxList extends KitElement {
    static properties = {
        renderItem: { attribute: false }, newItem: { attribute: false },
        addLabel: { type: String, attribute: "add-label" }, sortable: { type: Boolean },
        min: { type: Number }, max: { type: Number }, emptyText: { type: String, attribute: "empty-text" },
        _drag: { state: true }
    };
    constructor() { super(); this.sortable = true; this._drag = null; }
    get items() { return Array.isArray(this.value) ? this.value : []; }
    _set(index, item) {
        var next = this.items.slice();
        next[index] = item;
        this.change(next);
    }
    addItem() {
        var next = this.items.slice();
        next.push(typeof this.newItem === "function" ? this.newItem() : "");
        this.change(next);
    }
    removeAt(index) {
        var next = this.items.slice();
        next.splice(index, 1);
        this.change(next);
    }
    moveItem(from, to) {
        var items = this.items;
        if (from === to || from < 0 || from >= items.length) return;
        var next = items.slice();
        var it = next.splice(from, 1)[0];
        next.splice(Math.max(0, Math.min(next.length, to > from ? to - 1 : to)), 0, it);
        this.change(next);
    }
    _gripDown(e, index) {
        if (!this.sortable || this.disabled || this.readonly) return;
        e.preventDefault();
        var box = this.querySelector(".nx-list");
        var rows = box ? Array.from(box.children).filter((el) => el.classList.contains("nx-list-row")) : [];
        this._drag = { from: index, to: index };
        var onMove = (ev) => {
            var to = rows.length;
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i].getBoundingClientRect();
                if (ev.clientY < r.top + r.height / 2) { to = i; break; }
            }
            if (!this._drag || this._drag.to !== to) this._drag = { from: index, to: to };
        };
        var onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            var d = this._drag;
            this._drag = null;
            if (d) this.moveItem(d.from, d.to);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }
    render() {
        var items = this.items;
        var d = this._drag;
        var canAdd = !this.disabled && !this.readonly && !(this.max > 0 && items.length >= this.max);
        var canRemove = !this.disabled && !this.readonly && !(this.min > 0 && items.length <= this.min);
        // Row widgets' own nx-change events stop at the row body: the list
        // reports the whole array as ITS nx-change.
        return this.frame(html`<div class="nx-list" id="${this.controlId}">
            ${items.length ? items.map((item, i) => html`<div class="nx-list-row ${d && d.from === i ? "nx-dragging" : ""} ${d && d.to === i && d.from !== i ? "nx-drop-before" : ""}">
                ${this.sortable ? html`<span class="nx-list-grip" title="Drag to reorder" @pointerdown="${(e) => this._gripDown(e, i)}"><i class="fa fa-bars"></i></span>` : nothing}
                <div class="nx-list-body" @nx-change="${(e) => e.stopPropagation()}">${typeof this.renderItem === "function" ? this.renderItem(item, i, (v) => this._set(i, v)) : str(item)}</div>
                <button type="button" class="nx-icon-btn" title="Remove" style="margin-top:4px;" ?disabled="${!canRemove}" @click="${() => this.removeAt(i)}"><i class="fa fa-trash-o"></i></button>
            </div>`) : html`<div class="nx-list-empty">${this.emptyText || "No items"}</div>`}
            <div class="nx-list-foot">
                <button type="button" class="nx-btn" ?disabled="${!canAdd}" @click="${() => this.addItem()}"><i class="fa fa-plus"></i> ${this.addLabel || "Add"}</button>
                <span class="nx-badge">${items.length}</span>
            </div>
        </div>`);
    }
}

// ---- nx-state-switcher -----------------------------------------------------------------
// `.states` = [{ name, label, color }]; the value is the state name.
export class NxStateSwitcher extends KitElement {
    static properties = { states: { attribute: false } };
    constructor() { super(); this.states = []; }
    render() {
        var states = this.states || [];
        var current = states.some((s) => s.name === this.value) ? this.value : (states[0] && states[0].name);
        return this.frame(html`<div class="nx-states" role="radiogroup" id="${this.controlId}">
            ${states.map((s) => html`<button type="button" role="radio" aria-checked="${s.name === current}" class="nx-state ${s.name === current ? "nx-on" : ""}"
                @click="${() => this.change(s.name)}"><span class="nx-state-dot" style="${s.color ? "background:" + s.color : ""}"></span>${s.label}</button>`)}
        </div>`);
    }
}

// ---- nx-alert / nx-badge / nx-field ------------------------------------------------------
var ALERT_ICONS = { info: "fa fa-info-circle", warn: "fa fa-exclamation-triangle", error: "fa fa-times-circle", success: "fa fa-check-circle" };
export class NxAlert extends KitElement {
    static properties = { tone: { type: String }, text: { type: String }, content: { attribute: false } };
    render() {
        var tone = this.tone || "info";
        return html`<div class="nx-alert nx-${tone}" role="${tone === "error" ? "alert" : "note"}">${icon(this.icon || ALERT_ICONS[tone])}<div>${this.content || this.text || ""}</div></div>`;
    }
}

export class NxBadge extends KitElement {
    static properties = { tone: { type: String }, text: { type: String } };
    render() {
        return html`<span class="nx-badge ${this.tone ? "nx-" + this.tone : ""}">${icon(this.icon)}${this.text || ""}</span>`;
    }
}

/** The field frame alone around any `.content` (a custom control in an inspector). */
export class NxField extends KitElement {
    static properties = { content: { attribute: false } };
    render() {
        return this.frame(this.content || nothing);
    }
}

// ---- layout containers (plain custom elements; the children are yours) ------------------------

// <nx-section heading="Format" icon="fa fa-calculator" badge="2" collapsed persist-key="...">children</nx-section>
export class NxSection extends HTMLElement {
    static get observedAttributes() { return ["heading", "icon", "badge", "collapsed"]; }
    connectedCallback() {
        this.classList.add("nx-kit", "nx-section");
        if (!this._head) {
            var key = this.getAttribute("persist-key");
            if (key) {
                var saved = store("nexa-kit:section:" + key);
                if (saved === "1") this.setAttribute("collapsed", "");
                if (saved === "0") this.removeAttribute("collapsed");
            }
            this._head = document.createElement("button");
            this._head.type = "button";
            this._head.className = "nx-section-head";
            this._head.addEventListener("click", () => this.toggle());
            this.insertBefore(this._head, this.firstChild);
        }
        this._paint();
    }
    attributeChangedCallback() { if (this._head) this._paint(); }
    toggle() {
        if (this.hasAttribute("collapsed")) this.removeAttribute("collapsed"); else this.setAttribute("collapsed", "");
        var key = this.getAttribute("persist-key");
        if (key) store("nexa-kit:section:" + key, this.hasAttribute("collapsed") ? "1" : "0");
    }
    _paint() {
        var h = this._head;
        var heading = this.getAttribute("heading") || "";
        h.hidden = !heading;
        h.setAttribute("aria-expanded", String(!this.hasAttribute("collapsed")));
        h.textContent = "";
        h.appendChild(faIcon("fa fa-angle-down nx-chevron"));
        if (this.getAttribute("icon")) h.appendChild(faIcon(this.getAttribute("icon")));
        var t = document.createElement("span");
        t.className = "nx-title";
        t.textContent = heading;
        h.appendChild(t);
        if (this.getAttribute("badge")) {
            var b = document.createElement("span");
            b.className = "nx-badge";
            b.textContent = this.getAttribute("badge");
            h.appendChild(b);
        }
        this.classList.toggle("nx-collapsed", this.hasAttribute("collapsed"));
    }
}

// <nx-tabs persist-key="..."><nx-tab label="Data" icon="fa fa-exchange">children</nx-tab>...</nx-tabs>
export class NxTab extends HTMLElement {
    static get observedAttributes() { return ["label", "icon", "badge"]; }
    connectedCallback() { this.classList.add("nx-tab-panel"); this.setAttribute("role", "tabpanel"); }
    attributeChangedCallback() {
        var tabs = this.parentElement;
        if (tabs && typeof tabs._paint === "function") tabs._paint();
    }
}

export class NxTabs extends HTMLElement {
    static get observedAttributes() { return ["active"]; }
    connectedCallback() {
        this.classList.add("nx-kit", "nx-tabs");
        if (!this._bar) {
            this._bar = document.createElement("div");
            this._bar.className = "nx-tabs-bar";
            this._bar.setAttribute("role", "tablist");
            this.insertBefore(this._bar, this.firstChild);
            var key = this.getAttribute("persist-key");
            if (key && !this.getAttribute("active")) this._active = store("nexa-kit:tab:" + key) || null;
        }
        if (!this._mo) {
            this._mo = new MutationObserver(() => this._paint());
            this._mo.observe(this, { childList: true });
        }
        this._paint();
    }
    disconnectedCallback() {
        if (this._mo) { this._mo.disconnect(); this._mo = null; }
    }
    attributeChangedCallback() { if (this._bar) this._paint(); }
    get tabs() { return Array.from(this.children).filter((c) => c.localName === "nx-tab"); }
    get active() { return this.getAttribute("active") || this._active || null; }
    select(label) {
        this._active = label;
        var key = this.getAttribute("persist-key");
        if (key) store("nexa-kit:tab:" + key, label);
        this._paint();
        this.dispatchEvent(new CustomEvent("nx-tab", { detail: { label: label }, bubbles: true }));
    }
    _paint() {
        if (!this._bar) return;
        var tabs = this.tabs;
        var want = this.active;
        var current = tabs.filter((t) => t.getAttribute("label") === want)[0] || tabs[0];
        this._bar.textContent = "";
        tabs.forEach((t) => {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "nx-tab" + (t === current ? " nx-on" : "");
            b.setAttribute("role", "tab");
            b.setAttribute("aria-selected", String(t === current));
            if (t.getAttribute("icon")) b.appendChild(faIcon(t.getAttribute("icon")));
            var s = document.createElement("span");
            s.textContent = t.getAttribute("label") || "";
            b.appendChild(s);
            if (t.getAttribute("badge")) {
                var bd = document.createElement("span");
                bd.className = "nx-badge";
                bd.textContent = t.getAttribute("badge");
                b.appendChild(bd);
            }
            b.addEventListener("click", () => this.select(t.getAttribute("label")));
            this._bar.appendChild(b);
            t.hidden = t !== current;
        });
    }
}

// <nx-row cols="3">children side by side</nx-row>
export class NxRow extends HTMLElement {
    static get observedAttributes() { return ["cols"]; }
    connectedCallback() { this.classList.add("nx-row"); this._paint(); }
    attributeChangedCallback() { this._paint(); }
    _paint() {
        var n = Number(this.getAttribute("cols"));
        if (n > 0) this.style.setProperty("--nx-cols", String(n));
        else this.style.removeProperty("--nx-cols");
    }
}
