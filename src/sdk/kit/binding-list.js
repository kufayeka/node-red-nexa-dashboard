// --- nx-binding-list: a prop's binding priority (src/model/binding.js) ---------------
// The value: { $bind: [{ src, ref }, …], static }. From the top, the FIRST source that has a
// value wins; one without (null / undefined / an unknown tag "???") falls through to the next;
// the static value (the widget's own control, below this list) is the last.
// A row: [kind ▾][its reference][drag ⋮⋮][×]. The kinds come from the source-kind registry
// (screen, app, shared, param, msg, sparkplug, expr; OPC UA… when registered); each kind has its
// own reference field: a variable picker of that layer, msg.<path>, a tag picker, an expression.
// Every change emits nx-change with the whole list (static kept as it is).
import { html, nothing } from "lit";
import { KitElement, str, getHost } from "./base.js";
import { sourceKinds, sourceKind, parseExpression } from "../../model/binding.js";

// the variable kinds: which owners of the host's listVariables() each one offers
var LAYER_OWNERS = { screen: { container: 1, screen: 1, template: 1 }, param: { template: 1 }, app: { app: 1 }, shared: { shared: 1 } };

function sdk() { return window.NexaSDK || null; }

function variables() {
    var h = getHost();
    try { return typeof h.listVariables === "function" ? (h.listVariables() || []) : []; } catch (e) { return []; }
}

/** The kinds offered (the legacy "var" is read, never offered); a host may narrow them. */
// What an expression can insert: "[screen]{speed}", "[msg]{payload}", "[sparkplug]{G::E::D::M}"
function insertables() {
    var out = [];
    var layerOf = { container: "screen", screen: "screen", template: "screen", app: "app", shared: "shared" };
    variables().forEach(function (x) {
        var kind = x.owner && layerOf[x.owner.kind];
        if (kind) out.push({ value: "[" + kind + "]{" + x.name + "}", label: "[" + kind + "]{" + x.name + "}  · " + (x.owner.name || "") });
    });
    out.push({ value: "[msg]{payload}", label: "[msg]{payload}  · message" });
    var S = sdk();
    if (S) S.listTagProviders().forEach(function (pr) {
        if (typeof pr.list !== "function" || !sourceKind(pr.name)) return;
        (pr.list() || []).slice(0, 200).forEach(function (t) { out.push({ value: "[" + pr.name + "]{" + t.address + "}", label: (t.label || t.address) + "  · " + (pr.label || pr.name) }); });
    });
    return out;
}

export function offeredKinds(access) {
    var allowed = getHost().bindingKinds;
    return sourceKinds().filter(function (k) {
        if (k.legacy) return false;
        if (Array.isArray(allowed) && allowed.indexOf(k.name) === -1) return false;
        if (access === "write") return !!k.tag || (k.variable && k.variable !== "param");
        return true;
    });
}

export class NxBindingList extends KitElement {
    static properties = { access: { type: String }, _drag: { state: true }, _over: { state: true } };

    constructor() { super(); this._drag = -1; this._over = -1; }

    get list() {
        var v = this.value;
        return v && Array.isArray(v.$bind) ? v : { $bind: [], static: undefined };
    }

    _emit(sources) {
        this._bindingChange = true;
        try { this.change({ $bind: sources, static: this.list.static }); } finally { this._bindingChange = false; }
    }

    _setRow(i, patch) {
        var s = this.list.$bind.slice();
        s[i] = Object.assign({}, s[i], patch);
        this._emit(s);
    }

    _add() {
        var kinds = offeredKinds(this.access);
        var used = this.list.$bind.map(function (s) { return s.src; });
        var next = kinds.filter(function (k) { return used.indexOf(k.name) === -1; })[0] || kinds[0];
        this._emit(this.list.$bind.concat([{ src: next ? next.name : "screen", ref: "" }]));
    }

    _remove(i) {
        var s = this.list.$bind.slice();
        s.splice(i, 1);
        this._emit(s);
    }

    _move(from, to) {
        if (from === to || from < 0) return;
        var s = this.list.$bind.slice();
        var item = s.splice(from, 1)[0];
        s.splice(to > from ? to - 1 : to, 0, item);
        this._emit(s);
    }

    _ref(row, i) {
        var k = sourceKind(row.src) || {};
        var ch = (fn) => (e) => { e.stopPropagation(); this._setRow(i, { ref: fn(str(e.detail.value).trim()) }); };
        if (k.variable) {
            var owners = LAYER_OWNERS[row.src];
            var opts = variables().filter(function (x) { return x.owner && (!owners || owners[x.owner.kind]); })
                .map(function (x) { return { value: x.name, label: x.name, detail: (x.owner ? x.owner.name : "") + " = " + str(x.value) }; });
            return html`<nx-combobox class="nx-bl-ref" mono .free="${true}" .options="${opts}" .value="${row.ref || ""}" placeholder="name"
                @nx-change="${ch(function (v) { return v.replace(/^\{|\}$/g, ""); })}"></nx-combobox>`;
        }
        if (k.message) {
            return html`<nx-text class="nx-bl-ref" mono addon-before="msg." .value="${row.ref || ""}" placeholder="payload.speed"
                @nx-change="${ch(function (v) { return v.replace(/^msg\.?/, ""); })}"></nx-text>`;
        }
        if (k.tag) {
            var S = sdk(), provider = k.provider || row.src;
            var tag = row.ref && S ? S.makeTag(provider, row.ref) : "";
            return html`<nx-tag class="nx-bl-ref" tags-only .value="${tag}" .providers="${[provider]}" .access="${this.access === "write" ? "write" : ""}"
                @nx-change="${ch(function (v) { var t = S && S.parseTag(v); return t ? t.address : v; })}"></nx-tag>`;
        }
        if (k.expression) {
            var err = row.ref ? parseExpression(row.ref).error : null;
            return html`<div class="nx-bl-ref nx-binding-expr">
                <textarea class="nx-control nx-mono" rows="2" spellcheck="false" .value="${row.ref || ""}" placeholder='(0.5 * [screen]{speed}) / [app]{ratio} " rpm"'
                    @keydown="${(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this._setRow(i, { ref: e.target.value }); } }}"
                    @keyup="${(e) => { this._caret = e.target.selectionStart; }}" @click="${(e) => { this._caret = e.target.selectionStart; }}"
                    @change="${(e) => this._setRow(i, { ref: e.target.value })}"></textarea>
                <nx-select .options="${[{ value: "", label: "Insert a reference…" }].concat(insertables())}" .value="${""}"
                    @nx-change="${(e) => {
                        e.stopPropagation();
                        var sel = e.target.querySelector("select"); if (sel) sel.selectedIndex = 0;
                        if (!e.detail.value) return;
                        var ta = this.querySelector('.nx-bl-row[data-i="' + i + '"] textarea');
                        var cur = ta ? ta.value : str(row.ref);
                        var at = typeof this._caret === "number" && this._caret <= cur.length ? this._caret : cur.length;
                        this._setRow(i, { ref: cur.slice(0, at) + e.detail.value + cur.slice(at) });
                    }}"></nx-select>
                ${err ? html`<div class="nx-tag-status nx-bad"><i class="fa fa-exclamation-triangle"></i><span>${err}</span></div>` : nothing}
            </div>`;
        }
        return html`<nx-text class="nx-bl-ref" mono .value="${row.ref || ""}" @nx-change="${ch(function (v) { return v; })}"></nx-text>`;
    }

    // one row of the table: [#][kind ▾][its reference][≡ drag][🗑]
    _row(row, i) {
        var kinds = offeredKinds(this.access);
        if (!kinds.some(function (k) { return k.name === row.src; }) && sourceKind(row.src)) kinds = kinds.concat([sourceKind(row.src)]);
        var cls = "nx-bt-row nx-bl-row" + (this._drag === i ? " nx-dragging" : "") + (this._over === i && this._drag !== i ? " nx-drop" : "");
        return html`<div class="${cls}" data-i="${i}"
            @dragover="${(e) => { if (this._drag < 0) return; e.preventDefault(); this._over = i; }}"
            @drop="${(e) => { e.preventDefault(); var from = this._drag; this._drag = -1; this._over = -1; this._move(from, i); }}">
            <span class="nx-bt-n" title="Priority ${i + 1}">${i + 1}</span>
            <div class="nx-bt-kind">
                <select class="nx-control nx-bl-kind" aria-label="Source"
                    @change="${(e) => { e.stopPropagation(); if (e.target.value !== row.src) this._setRow(i, { src: e.target.value, ref: "" }); }}">
                    ${kinds.map(function (k) { return html`<option value="${k.name}" ?selected="${k.name === row.src}">${k.label || k.name}</option>`; })}
                </select>
            </div>
            <div class="nx-bt-ref">${this._ref(row, i)}</div>
            <span class="nx-bt-act">
                <span class="nx-bl-grip" draggable="true" title="Drag to change the priority"
                    @dragstart="${(e) => { this._drag = i; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(i)); } catch (x) { /* ignore */ } }}"
                    @dragend="${() => { this._drag = -1; this._over = -1; }}"><i class="fa fa-bars"></i></span>
                <button type="button" class="nx-icon-btn nx-bl-del" title="Remove this source" @click="${() => this._remove(i)}"><i class="fa fa-trash-o"></i></button>
            </span>
        </div>`;
    }

    render() {
        var rows = this.list.$bind;
        var n = rows.length;
        return html`<div class="nx-bl">
            <div class="nx-bt-head">
                <span class="nx-bt-title">Binding priority</span>
                <button type="button" class="nx-btn nx-bl-add" title="Add a binding source (it goes last, above static)" @click="${() => this._add()}"><i class="fa fa-plus"></i><span>Add binding source</span></button>
            </div>
            <div class="nx-bt-body">
                ${n ? rows.map((r, i) => this._row(r, i)) : html`<div class="nx-bt-empty">No source yet: the static value below is used.</div>`}
                <div class="${"nx-bl-end" + (this._over === n ? " nx-drop" : "")}"
                    @dragover="${(e) => { if (this._drag < 0) return; e.preventDefault(); this._over = n; }}"
                    @drop="${(e) => { e.preventDefault(); var from = this._drag; this._drag = -1; this._over = -1; this._move(from, n); }}"></div>
            </div>
        </div>`;
    }
}
