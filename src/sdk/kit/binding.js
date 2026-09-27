// --- nx-binding: where a prop's value comes from (the ⛓ editor) -----------------
// The value stays one string — the syntax every renderer already understands:
//   Variable    {speed}  {motor.speed}          nearest declaration: frame -> screen -> app
//   Tag         {sparkplug:G::N::D::Speed}       a live value (OPC UA, … later)
//   Message     {msg.payload.speed}              the last message a Logic flow sent to
//                                                the component ("Update Component" node)
//   Expression  "Line {line}: {sparkplug:G::N::D::Speed} rpm, order {msg.payload.id}"
//               text mixing any of the three
// The source is read back from the value. Switching the source commits
// nothing until the new source's field is applied (Enter / pick / blur).
// Host: getHost().listVariables() -> [{ name, value, owner }] (the kit-inspector).
import { html, nothing } from "lit";
import { KitElement, str, getHost, lookupBinding } from "./base.js";

var WHOLE_PATH = /^\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*)\}$/;
var ANY_BINDING = /\{[^{}]+\}/;
var SOURCES = [
    { value: "var", label: "Variable", icon: "fa fa-cube" },
    { value: "tag", label: "Tag", icon: "fa fa-bolt" },
    { value: "msg", label: "Message", icon: "fa fa-envelope-o" },
    { value: "expr", label: "Expression", icon: "fa fa-font" }
];

function sdk() { return window.NexaSDK || null; }

/** Which source a binding string is. */
export function bindingSource(v) {
    v = str(v).trim();
    if (!v) return null;
    var S = sdk();
    var t = S ? S.parseTag(v) : null;
    if (t && t.valid) return "tag";
    var m = WHOLE_PATH.exec(v);
    if (m) return /^msg(\.|\[|$)/.test(m[1]) ? "msg" : "var";
    return ANY_BINDING.test(v) ? "expr" : null;
}

function variables() {
    var h = getHost();
    try { return typeof h.listVariables === "function" ? (h.listVariables() || []) : []; } catch (e) { return []; }
}
function knownTags() {
    var S = sdk();
    if (!S) return [];
    var out = [];
    S.listTagProviders().forEach(function (p) {
        if (typeof p.list !== "function") return;
        (p.list() || []).forEach(function (t) { out.push({ value: S.makeTag(p.name, t.address), label: t.label || t.address, detail: p.label || p.name }); });
    });
    return out;
}

// Write targets: a variable / parameter member or {$route.query.x} (never {msg…} or the rest of $route)
var WRITABLE_VAR = /^\{(?!msg\b)(?!\$route\.(?:params|path|hash)\b)(\$route\.query\.[A-Za-z_$][\w$]*|[A-Za-z_][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\}$/;

export class NxBinding extends KitElement {
    // access: "read" (the default) offers every source; "write" only what can be
    // written — a tag or a variable (a Write Tag of a field / button)
    static properties = { providers: { attribute: false }, access: { type: String }, defaultSource: { type: String, attribute: "default-source" }, _source: { state: true } };

    constructor() { super(); this._source = null; }

    get sources() { return this.access === "write" ? SOURCES.filter(function (s) { return s.value === "var" || s.value === "tag"; }) : SOURCES; }

    get source() {
        var s = this._source || bindingSource(this.value) || this.defaultSource || "var";
        return this.sources.some(function (x) { return x.value === s; }) ? s : this.sources[0].value;
    }

    _emit(v) { this._source = null; this.change(v); }

    _pick(source) { this._source = source; }

    // a binding typed into the expression is inserted where the caret was
    _insert(text) {
        var ta = this.querySelector(".nx-binding-expr textarea");
        var cur = ta ? ta.value : str(this.value);
        var at = ta && typeof this._caret === "number" ? this._caret : cur.length;
        var next = cur.slice(0, at) + text + cur.slice(at);
        this._source = "expr";
        this._emit(next);
    }

    _preview(v) {
        if (!v) return nothing;
        var vars = variables();
        var missing = [];
        var S = sdk();
        var text = String(v).replace(/\{([^{}]+)\}/g, function (whole, inner) {
            if (S) { var t = S.parseTag(whole); if (t && t.valid) return "‹" + (t.display || inner) + "›"; }
            if (/^msg(\.|\[|$)/.test(inner)) return "‹" + inner + "›";
            if (/^asset:/.test(inner)) return "‹image " + inner.slice(6) + "›";
            var hit = lookupBinding(vars, inner);
            if (!hit) { missing.push(inner); return whole; }
            // the current value when known exactly; a placeholder for a path inside something (a URL part, a member)
            var val = str(hit.entry.value);
            return hit.exact && !/^\(/.test(val) ? val : "‹" + inner + "›";
        });
        return missing.length
            ? html`<div class="nx-tag-status nx-bad"><i class="fa fa-exclamation-triangle"></i><span>not declared around this node: ${missing.join(", ")}</span></div>`
            : html`<div class="nx-tag-status nx-ok"><i class="fa fa-eye"></i><span>${text}</span></div>`;
    }

    _field() {
        var v = str(this.value);
        var src = this.source;
        var mine = bindingSource(v) === src;   // the current value belongs to this source
        if (src === "var") {
            var write = this.access === "write";
            var opts = variables().filter(function (x) { return x.owner && x.owner.kind !== "route" || /^\$route/.test(x.name); })
                .filter(function (x) { return !write || WRITABLE_VAR.test("{" + x.name + "}"); })
                .map(function (x) { return { value: "{" + x.name + "}", label: "{" + x.name + "}", detail: (x.owner ? x.owner.name : "") + " = " + str(x.value) }; });
            return html`<nx-combobox mono .free="${true}" .options="${opts}" .value="${mine ? v : ""}" placeholder="{name}"
                @nx-change="${(e) => { e.stopPropagation(); var x = str(e.detail.value).trim(); if (x && x.charAt(0) !== "{") x = "{" + x + "}"; this._emit(x); }}"></nx-combobox>`;
        }
        if (src === "tag") {
            return html`<nx-tag tags-only .value="${mine ? v : ""}" .providers="${this.providers || null}" .access="${this.access === "write" ? "write" : ""}" @nx-change="${(e) => { e.stopPropagation(); this._emit(e.detail.value); }}"></nx-tag>`;
        }
        if (src === "msg") {
            var path = mine ? v.slice(1, -1).replace(/^msg\.?/, "") : "";
            return html`<nx-text mono addon-before="msg." .value="${path}" placeholder="payload.speed"
                @nx-change="${(e) => { e.stopPropagation(); var p = str(e.detail.value).trim().replace(/^msg\.?/, ""); this._emit(p ? "{msg." + p + "}" : ""); }}"></nx-text>
                <div class="nx-help">Set by the Logic flow: an "Update Component" node sends a message to this component; this prop takes msg.${path || "…"} from it.</div>`;
        }
        // expression: free text with bindings of every kind
        var inserts = variables().map(function (x) { return { value: "{" + x.name + "}", label: "{" + x.name + "}  · " + (x.owner ? x.owner.name : "") }; })
            .concat([{ value: "{msg.payload}", label: "{msg.payload}  · message" }])
            .concat(knownTags().slice(0, 200).map(function (t) { return { value: t.value, label: t.label + "  · " + t.detail }; }));
        return html`<div class="nx-binding-expr">
            <textarea class="nx-control nx-mono" rows="2" spellcheck="false" .value="${v}" placeholder="Line {line}: {sparkplug:G::N::D::Speed} rpm"
                @keyup="${(e) => { this._caret = e.target.selectionStart; }}" @click="${(e) => { this._caret = e.target.selectionStart; }}"
                @keydown="${(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this._emit(e.target.value); } }}"
                @change="${(e) => this._emit(e.target.value)}"></textarea>
            <nx-select .options="${[{ value: "", label: "Insert a binding…" }].concat(inserts)}" .value="${""}"
                @nx-change="${(e) => { e.stopPropagation(); var sel = e.target.querySelector("select"); if (sel) sel.selectedIndex = 0; if (e.detail.value) this._insert(e.detail.value); }}"></nx-select>
        </div>`;
    }

    render() {
        // no this.frame(): it lives inside another widget's field (see KitElement.frame)
        var v = str(this.value).trim();
        // a write target that cannot be written (kept from before, or typed in)
        var bad = this.access === "write" && v && bindingSource(v) !== "tag" && !WRITABLE_VAR.test(v);
        return html`<div class="nx-binding">
            <nx-segmented class="nx-binding-source" .options="${this.sources}" .value="${this.source}"
                @nx-change="${(e) => { e.stopPropagation(); this._pick(e.detail.value); }}"></nx-segmented>
            ${this._field()}
            ${bad ? html`<div class="nx-tag-status nx-bad"><i class="fa fa-exclamation-triangle"></i><span>read-only — write to a tag, a variable or {$route.query.name}</span></div>`
                : this.source !== "tag" && bindingSource(this.value) ? this._preview(this.value) : nothing}
        </div>`;
    }
}
