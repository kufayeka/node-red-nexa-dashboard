// --- The inspector's look: a property tree over one editor pane --------------------
// The search and the tree on top (rows show simple values only, never a control);
// below, the editor of the ONE node picked in the tree:
//   a prop        its widget (the same bound widget as everywhere: ⛓ binding, 📱 per
//                 breakpoint, reset, validation), or its plugin's own editor (prop.editor)
//   a list        its items (each is also a tree row): add, remove, move, duplicate
//   a list item   its fields;  an item's field: that field alone
//   a group       its props with their values, to jump to one
// The selection is state: a re-render (any edit, a breakpoint switch, undo) keeps it;
// when its node is gone (the item removed, visibleWhen) it goes to the nearest one.
// What is selected / open / searched is remembered per component type (persistKey).
// The pane is keyed by the selection: a widget never carries one prop's draft to another.
import { html, nothing, keyed, live } from "lit";
import { buildTree, indexTree, ancestorIds, nearestId, firstLeafId, visibleRows, summary, emptyText, editorKind, listOp, itemSchema, itemNoun, itemLabel } from "./model.js";
import { editorClass } from "./editors.js";
import { str } from "../base.js";

var MEMORY = {};
var HEIGHT_KEY = "nexa-inspector-tree-height";
var seq = 0;

function memoryFor(key) {
    return MEMORY[key] || (MEMORY[key] = { sel: null, open: {}, q: "", max: false, top: 0 });
}

function storedHeight() {
    try { var v = Number(window.localStorage.getItem(HEIGHT_KEY)); return v >= 80 && v <= 2000 ? v : 260; } catch (e) { return 260; }
}

function clone(v) {
    return v === null || v === undefined || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v));
}

function same(a, b) {
    return str(a) === str(b);
}

// an item field's schema, normalized enough for a summary
function fieldProp(f) {
    var p = Object.assign({ type: "string" }, f);
    if (p.type === "enum" && Array.isArray(p.options)) {
        p.options = p.options.map(function (o) { return o !== null && typeof o === "object" ? o : { value: o, label: String(o) }; });
    }
    return p;
}

function marks(text, q) {
    text = String(text);
    if (!q) return text;
    var out = [], low = text.toLowerCase(), i = 0, j;
    while ((j = low.indexOf(q, i)) !== -1) { out.push(text.slice(i, j), html`<mark>${text.slice(j, j + q.length)}</mark>`); i = j + q.length; }
    out.push(text.slice(i));
    return out;
}

var CARET = html`<svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.5 7 5 3.5 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * A: what the inspector gives the view
 *   meta, props(), set(key, v), preview(key, v), persist, responsive, update()
 *   field(key)                  the bound widget of a prop (a template)
 *   decorate(el, key)           binds an element (a plugin's editor) to a prop like bind() does
 *   itemWidget(schema, v, set)  a list item's widgets;  plainWidget(field, v, onChange)
 *   validate(prop, v, p)        the message or null;  state()  the preview state
 *   stateSwitcher()             the preview-state chips (a template or nothing)
 *   openDialog({ title, content, buttons })
 */
export function createTreeView(A) {
    var mem = memoryFor(A.persist);
    var uid = "nx-pt" + (++seq);
    var height = storedHeight();
    var root = null;            // the .nx-pt element, once rendered
    var pending = null;         // after the next render: { scroll, focus }
    var first = true;           // the first render: the tree's scroll as it was (a rebuilt panel)
    var editors = new Map();    // node id -> a plugin editor element (kept while it is shown)
    var map = new Map(), roots = [], rows = [];

    function p() { return A.props(); }
    function valueOf(key) { var v = p()[key]; return v === undefined ? A.meta.props[key].default : v; }
    function items(key) { var v = valueOf(key); return Array.isArray(v) ? v : []; }

    function isOpen(id) {
        if (id in mem.open) return mem.open[id];
        var n = map.get(id);
        return !!n && n.kind !== "item";       // groups, sections and lists start open
    }
    function openAncestors(id) {
        ancestorIds(map, id).forEach(function (a) { mem.open[a] = true; });
    }
    function toggle(id) {
        mem.open[id] = !isOpen(id);
        A.update();
    }

    // the field being typed in is applied first, to the node it was typed for
    function commitPending() {
        var a = document.activeElement;
        var pane = root && root.querySelector(".nx-pt-pane");
        if (a && pane && pane.contains(a) && typeof a.blur === "function") a.blur();
    }

    function select(id, o) {
        o = o || {};
        if (mem.sel === id) {
            if (o.focus) { pending = Object.assign(pending || {}, { focus: true }); A.update(); }
            return;
        }
        commitPending();
        mem.sel = id;
        openAncestors(id);
        pending = Object.assign(pending || {}, { scroll: true, focus: !!o.focus });
        A.update();
    }

    // ---- what a row shows -------------------------------------------------------------------
    function summaryOf(n) {
        var P = p();
        if (n.kind === "group" || n.kind === "section") return { text: String(n.children.length), count: true };
        if (n.kind === "prop") {
            if (n.prop.type === "action") {
                var s0 = typeof n.prop.summary === "function" ? n.prop.summary(P) : "";
                return { text: s0 ? String(s0) : "", action: true };
            }
            var K = editorClass(n.prop);
            return summary(n.prop, P[n.key], P, K && typeof K.summary === "function" ? K.summary : null);
        }
        var it = items(n.key)[n.index];
        if (n.kind === "item") {
            var sch = itemSchema(n.prop);
            return sch.fields ? { text: "" } : summary(fieldProp(sch), it, P);
        }
        return summary(fieldProp(n.field), it && typeof it === "object" ? it[n.fieldKey] : undefined, P);
    }
    function textOf(n) { return summaryOf(n).text; }

    function rowMarks(n) {
        if (n.kind !== "prop") return nothing;
        var P = p(), prop = n.prop, v = valueOf(n.key), out = [];
        var R = A.responsive;
        if (R && !prop.noResponsive && R.canVary(n.key) && R.list().some(function (b) { return R.has(n.key, b.id); })) {
            out.push(html`<i class="fa fa-mobile nx-pt-mark" title="Set per breakpoint"></i>`);
        }
        if (!prop.noReset && !same(v, prop.default)) out.push(html`<span class="nx-dot" title="Changed from the default"></span>`);
        var msg = A.validate(prop, v, P);
        if (msg) out.push(html`<i class="fa fa-exclamation-circle nx-pt-bad" title="${msg}"></i>`);
        else if (warnOf(prop)) out.push(html`<i class="fa fa-exclamation-triangle nx-pt-warn" title="${warnOf(prop)}"></i>`);
        return out;
    }

    // prop.warn(value, props) -> a warning that does not block the value ("Very large scale")
    function warnOf(prop) {
        if (typeof prop.warn !== "function") return "";
        try { return String(prop.warn(valueOf(prop.key), p()) || ""); } catch (e) { return ""; }
    }
    function warnTpl(prop) {
        var w = warnOf(prop);
        return w ? html`<nx-alert tone="warn" text=${w}></nx-alert>` : nothing;
    }

    function valueCell(n, q) {
        var s = summaryOf(n);
        if (s.count) return html`<span class="nx-pt-val nx-pt-count">${s.text}</span>`;
        var parts = [];
        if (s.swatch) parts.push(html`<span class="nx-pt-swatch" style="background:${s.swatch}"></span>`);
        if (s.check !== undefined) return html`<span class="nx-pt-val" title=${s.text}><span class="nx-pt-check ${s.check ? "nx-on" : ""}"></span></span>`;
        if (s.bound) parts.push(html`<i class="fa fa-link nx-pt-mark" title="Bound"></i>`);
        if (s.token) parts.push(html`<i class="fa fa-diamond nx-pt-mark" title="A theme token"></i>`);
        if (s.action && !s.text) return html`<span class="nx-pt-val"><i class="fa fa-hand-pointer-o nx-pt-mark" title="Actions"></i></span>`;
        if (s.empty || s.text === "") {
            if (n.kind === "prop" || n.kind === "itemField") parts.push(html`<span class="nx-pt-t nx-pt-none">${n.kind === "prop" ? emptyText(n.prop) : "not set"}</span>`);
        } else parts.push(html`<span class="nx-pt-t">${marks(s.text, q)}</span>`);
        return html`<span class="nx-pt-val" title="${s.text}">${parts}</span>`;
    }

    function rowId(id) { return uid + "-" + String(id).replace(/[^\w-]/g, "_"); }

    function rowTpl(r, q) {
        var n = r.node, on = n.id === mem.sel;
        var cls = "nx-pt-row nx-pt-" + n.kind + (on ? " nx-on" : "");
        return html`<div class=${cls} id=${rowId(n.id)} role="treeitem" aria-level=${n.depth + 1} aria-selected=${on ? "true" : "false"}
                aria-expanded=${r.hasKids ? (r.open ? "true" : "false") : nothing} data-id=${n.id} style=${"--d:" + n.depth}
                @click=${function () { select(n.id); }}
                @dblclick=${function () { if (r.hasKids && !q) toggle(n.id); else select(n.id, { focus: true }); }}>
            ${r.hasKids ? html`<button type="button" class="nx-pt-caret ${r.open ? "nx-open" : ""}" tabindex="-1" aria-label=${r.open ? "Collapse" : "Expand"}
                @click=${function (e) { e.stopPropagation(); if (!q) toggle(n.id); }}>${CARET}</button>` : html`<span></span>`}
            <span class="nx-pt-label" title=${n.label}><span class="nx-pt-t">${marks(n.label, q)}</span>${rowMarks(n)}</span>
            ${valueCell(n, q)}
        </div>`;
    }

    // ---- keyboard: the tree is one tab stop; arrows move the selection ---------------------
    function onTreeKey(e) {
        var ids = rows.map(function (r) { return r.node.id; });
        var i = ids.indexOf(mem.sel), n = map.get(mem.sel);
        var go = function (j) { if (ids[j] !== undefined) select(ids[j]); };
        var has = n && n.children.length > 0;
        if (e.key === "ArrowDown") go(i < 0 ? 0 : i + 1);
        else if (e.key === "ArrowUp") go(Math.max(0, i - 1));
        else if (e.key === "Home") go(0);
        else if (e.key === "End") go(ids.length - 1);
        else if (e.key === "ArrowRight" && n) { if (has && !isOpen(n.id) && !mem.q) toggle(n.id); else if (has) go(i + 1); }
        else if (e.key === "ArrowLeft" && n) { if (has && isOpen(n.id) && !mem.q) toggle(n.id); else if (n.parentId) select(n.parentId); }
        else if (e.key === "Enter" && n) select(n.id, { focus: true });
        else return;
        e.preventDefault();
        e.stopPropagation();
    }

    function onSearch(e) {
        mem.q = e.target.value;
        A.update();
    }
    function onSearchKey(e) {
        if (e.key === "Escape" && mem.q) { e.preventDefault(); e.stopPropagation(); mem.q = ""; e.target.value = ""; A.update(); }
        else if (e.key === "ArrowDown" || e.key === "Enter") {
            e.preventDefault();
            var first = rows.filter(function (r) { return r.node.kind !== "group" && r.node.kind !== "section"; })[0];
            if (first) select(first.node.id);
            var t = root && root.querySelector(".nx-pt-tree");
            if (t) t.focus();
        }
    }

    function onSplit(e) {
        var tree = root && root.querySelector(".nx-pt-tree");
        if (!tree) return;
        e.preventDefault();
        var y0 = e.clientY, h0 = tree.getBoundingClientRect().height;
        mem.max = false;
        root.classList.remove("nx-pt-max");
        var move = function (ev) { height = Math.max(80, Math.min(1200, Math.round(h0 + ev.clientY - y0))); root.style.setProperty("--nx-pt-h", height + "px"); };
        var up = function () {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            try { window.localStorage.setItem(HEIGHT_KEY, String(height)); } catch (err) { /* storage blocked */ }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }

    // ---- the editor pane --------------------------------------------------------------------
    function crumbs(n) {
        var list = ancestorIds(map, n.id).map(function (id) { return map.get(id).label; });
        return list.length ? html`<div class="nx-pt-crumb">${list.map(function (c) { return html`<span>${c}</span>`; })}</div>` : nothing;
    }

    function expandButton() {
        return html`<button type="button" class="nx-icon-btn nx-pt-expand ${mem.max ? "nx-on" : ""}" title=${mem.max ? "Show the tree again" : "More room for the editor"}
            @click=${function () { mem.max = !mem.max; A.update(); }}><i class="fa ${mem.max ? "fa-compress" : "fa-expand"}"></i></button>`;
    }

    function overviewPane(n) {
        return html`${crumbs(n)}<div class="nx-pt-title">${n.label}</div>
            <div class="nx-pt-items">${n.children.map(function (c) {
                return html`<div class="nx-pt-item"><button type="button" class="nx-pt-go" @click=${function () { select(c.id, { focus: c.kind === "prop" }); }}>${c.label}</button>${valueCell(c, "")}</div>`;
            })}</div>`;
    }

    function newItem(prop) {
        var sch = itemSchema(prop);
        if (sch.default !== undefined) return clone(sch.default);
        if (sch.fields) {
            var o = {};
            Object.keys(sch.fields).forEach(function (k) { o[k] = clone(sch.fields[k].default !== undefined ? sch.fields[k].default : ""); });
            return o;
        }
        return "";
    }

    function listDo(n, op, i) {
        var r = listOp(items(n.key), op, i, function () { return newItem(n.prop); });
        commitPending();
        mem.sel = r.index >= 0 ? n.key + "#" + r.index : n.key;
        mem.open[n.key] = true;
        pending = Object.assign(pending || {}, { scroll: true });
        A.set(n.key, r.next);
    }

    function setItem(n, v) {
        var next = items(n.key).slice();
        next[n.index] = typeof v === "function" ? v(next[n.index]) : v;
        A.set(n.key, next);
    }

    function listPane(n) {
        var prop = n.prop, list = items(n.key), noun = itemNoun(prop);
        var canAdd = !prop.readonly && !(prop.max > 0 && list.length >= prop.max);
        var canRemove = !prop.readonly && !(prop.min > 0 && list.length <= prop.min);
        var msg = A.validate(prop, list, p());
        return html`${crumbs(n)}<div class="nx-pt-title">${prop.label}${prop.required ? html`<span class="nx-req">*</span>` : nothing}</div>
            ${prop.help ? html`<div class="nx-help">${prop.help}</div>` : nothing}
            ${list.length ? html`<div class="nx-pt-items">${list.map(function (it, i) {
                return html`<div class="nx-pt-item">
                    <button type="button" class="nx-pt-go" @click=${function () { select(n.key + "#" + i, { focus: true }); }}>${itemLabel(prop, it, i)}</button>
                    <span class="nx-pt-tools">
                        <button type="button" class="nx-icon-btn" title="Move up" ?disabled=${i === 0} @click=${function () { listDo(n, "up", i); }}><i class="fa fa-arrow-up"></i></button>
                        <button type="button" class="nx-icon-btn" title="Move down" ?disabled=${i === list.length - 1} @click=${function () { listDo(n, "down", i); }}><i class="fa fa-arrow-down"></i></button>
                        <button type="button" class="nx-icon-btn" title="Remove" ?disabled=${!canRemove} @click=${function () { listDo(n, "remove", i); }}><i class="fa fa-trash-o"></i></button>
                    </span></div>`;
            })}</div>` : html`<div class="nx-list-empty">No ${noun}s yet.</div>`}
            <div class="nx-pt-bar"><button type="button" class="nx-btn nx-pt-add" ?disabled=${!canAdd} @click=${function () { listDo(n, "add"); }}><i class="fa fa-plus"></i> Add ${noun}</button>
                <span class="nx-badge">${list.length}</span></div>
            ${msg ? html`<div class="nx-message">${msg}</div>` : nothing}
            <div class="nx-help">Each ${noun} is also a row in the tree: pick it there to edit it.</div>`;
    }

    function itemPane(n) {
        var prop = n.prop, list = items(n.key), i = n.index, sch = itemSchema(prop);
        var canRemove = !prop.readonly && !(prop.min > 0 && list.length <= prop.min);
        var canAdd = !prop.readonly && !(prop.max > 0 && list.length >= prop.max);
        var list0 = map.get(n.key);
        return html`${crumbs(n)}<div class="nx-pt-title">${n.label}</div>
            <div class="nx-pt-bar">
                <button type="button" class="nx-btn" ?disabled=${i === 0} @click=${function () { listDo(list0, "up", i); }}><i class="fa fa-arrow-up"></i> Up</button>
                <button type="button" class="nx-btn" ?disabled=${i === list.length - 1} @click=${function () { listDo(list0, "down", i); }}><i class="fa fa-arrow-down"></i> Down</button>
                <button type="button" class="nx-btn" ?disabled=${!canAdd} @click=${function () { listDo(list0, "duplicate", i); }}><i class="fa fa-clone"></i> Duplicate</button>
                <button type="button" class="nx-btn nx-pt-danger" ?disabled=${!canRemove} @click=${function () { listDo(list0, "remove", i); }}><i class="fa fa-trash-o"></i> Remove</button>
            </div>
            <div class="nx-pt-form">${A.itemWidget(sch, list[i], function (v) { setItem(n, v); })}</div>`;
    }

    function itemFieldPane(n) {
        var it = items(n.key)[n.index];
        var v = it && typeof it === "object" && it[n.fieldKey] !== undefined ? it[n.fieldKey] : n.field.default;
        return html`${crumbs(n)}${A.plainWidget(fieldProp(n.field), v, function (nv) {
            setItem(n, function (cur) { var o = Object.assign({}, cur || {}); o[n.fieldKey] = nv; return o; });
        })}`;
    }

    // a plugin's own editor: kept while its node is shown; bound like bind() binds a widget
    function customEditor(n) {
        var K = editorClass(n.prop);
        var el = editors.get(n.id);
        if (!el || el.localName !== n.prop.editor) { el = document.createElement(n.prop.editor); editors.set(n.id, el); }
        el.prop = n.prop;
        el.props = p();
        A.decorate(el, n.key);
        if (!el._nxPreviewWired) {
            el._nxPreviewWired = true;
            el.addEventListener("nx-preview", function (e) { if (e.target !== el) return; e.stopPropagation(); A.preview(n.key, e.detail.value); });
        }
        return K;
    }

    function dialogEditor(n) {
        var s = summaryOf(n);
        var open = function () {
            var el = document.createElement(n.prop.editor);
            var draft = clone(valueOf(n.key));
            el.prop = n.prop;
            el.props = p();
            el.value = clone(draft);
            el.addEventListener("nx-change", function (e) { if (e.target !== el) return; e.stopPropagation(); draft = e.detail.value; el.value = draft; });
            el.addEventListener("nx-preview", function (e) { e.stopPropagation(); });
            A.openDialog({ title: n.prop.label, content: el, buttons: [{ label: "Cancel", value: null }, { label: "Apply", primary: true, value: function () { return { v: draft }; } }] })
                .then(function (r) { if (r && !same(r.v, valueOf(n.key))) A.set(n.key, r.v); });
        };
        return html`<div class="nx-field"><div class="nx-field-head"><label class="nx-label"><span>${n.prop.label}</span></label></div>
            <div class="nx-pt-dialogrow"><span class="nx-pt-t ${s.text ? "" : "nx-pt-none"}">${s.text || emptyText(n.prop)}</span>
                <button type="button" class="nx-btn nx-primary nx-pt-open" ?disabled=${n.prop.readonly} @click=${open}><i class="fa fa-pencil"></i> Edit…</button></div>
            ${n.prop.help ? html`<div class="nx-help">${n.prop.help}</div>` : nothing}</div>`;
    }

    // type "action": buttons [{ label, icon, title, run(props), disabled(props), on(props) }], no value
    function actionPane(n) {
        var prop = n.prop, P = p();
        var buttons = (typeof prop.buttons === "function" ? prop.buttons(P) : prop.buttons) || [];
        var info = typeof prop.info === "function" ? prop.info(P) : prop.info;
        return html`${crumbs(n)}<div class="nx-pt-title">${prop.label}</div>
            ${info ? html`<div class="nx-pt-info">${info}</div>` : nothing}
            ${buttons.length ? html`<div class="nx-pt-bar">${buttons.map(function (b) {
                var off = typeof b.disabled === "function" ? b.disabled(P) : !!b.disabled;
                var on = typeof b.on === "function" ? b.on(P) : !!b.on;
                return html`<button type="button" class="nx-btn nx-pt-action ${on ? "nx-on" : ""}" title=${b.title || b.label} ?disabled=${off}
                    @click=${function () { commitPending(); b.run(p()); A.update(); }}>${b.icon ? html`<i class=${b.icon}></i>` : nothing} ${b.label}</button>`;
            })}</div>` : nothing}
            ${prop.help ? html`<div class="nx-help">${prop.help}</div>` : nothing}`;
    }

    function propPane(n) {
        var kind = editorKind(n.prop);
        if (kind === "action") return actionPane(n);
        if (kind === "list") return listPane(n);
        if (kind === "custom") {
            var K = editorClass(n.prop);
            if (!K) {
                return html`${crumbs(n)}<nx-alert tone="warn" text=${"The editor \"" + n.prop.editor + "\" is not loaded (is its plugin installed?). Showing a plain field."}></nx-alert>${A.field(n.key)}`;
            }
            if (K.kind === "dialog") return html`${crumbs(n)}${dialogEditor(n)}${warnTpl(n.prop)}`;
            customEditor(n);
            return html`<div class="nx-pt-panehead">${crumbs(n)}${K.kind === "large" ? expandButton() : nothing}</div>${editors.get(n.id)}${warnTpl(n.prop)}`;
        }
        if (kind === "large") return html`<div class="nx-pt-panehead">${crumbs(n)}${expandButton()}</div>${A.field(n.key)}${warnTpl(n.prop)}`;
        return html`${crumbs(n)}${A.field(n.key)}${warnTpl(n.prop)}`;
    }

    function paneTpl(n) {
        if (!n) return html`<div class="nx-pt-empty">${roots.length ? "Pick a property in the tree." : "Nothing to set here."}</div>`;
        if (n.kind === "group" || n.kind === "section") return overviewPane(n);
        if (n.kind === "item") return itemPane(n);
        if (n.kind === "itemField") return itemFieldPane(n);
        return propPane(n);
    }

    // ---- the whole view ---------------------------------------------------------------------
    function view() {
        roots = buildTree(A.meta, p(), { state: A.state(), groupOrder: A.meta.groupOrder || null });
        map = indexTree(roots);
        if (mem.sel && !map.has(mem.sel)) mem.sel = nearestId(map, mem.sel, roots);
        if (!mem.sel) mem.sel = firstLeafId(roots);
        if (mem.sel) openAncestors(mem.sel);
        // editors of nodes no longer shown are dropped
        editors.forEach(function (_el, id) { if (id !== mem.sel) editors.delete(id); });
        var q = mem.q.trim().toLowerCase();
        var vr = visibleRows(roots, q, isOpen, textOf);
        rows = vr.rows;
        var sel = map.get(mem.sel);
        return html`<div class="nx-pt ${mem.max ? "nx-pt-max" : ""}" style=${"--nx-pt-h:" + height + "px"}>
            <div class="nx-pt-head">
                ${A.stateSwitcher()}
                <label class="nx-pt-search"><i class="fa fa-search" aria-hidden="true"></i>
                    <input type="search" class="nx-pt-q" placeholder="Search properties and values" aria-label="Search properties" autocomplete="off" spellcheck="false"
                        .value=${live(mem.q)} @input=${onSearch} @keydown=${onSearchKey}>
                    ${q ? html`<span class="nx-pt-hits">${vr.hits} ${vr.hits === 1 ? "match" : "matches"}</span>` : nothing}</label>
            </div>
            <div class="nx-pt-tree" role="tree" tabindex="0" aria-label="Properties" aria-activedescendant=${sel ? rowId(sel.id) : nothing} @keydown=${onTreeKey}
                @scroll=${function (e) { mem.top = e.target.scrollTop; }}>
                ${rows.map(function (r) { return rowTpl(r, q); })}
                ${!rows.length ? html`<div class="nx-pt-empty">${q ? "Nothing matches “" + mem.q.trim() + "”." : "No properties."}</div>` : nothing}
            </div>
            <div class="nx-pt-split" role="separator" aria-orientation="horizontal" title="Drag to resize" @pointerdown=${onSplit}></div>
            <div class="nx-pt-pane" data-node=${mem.sel || ""}>${keyed(mem.sel || "", paneTpl(sel))}</div>
        </div>`;
    }

    // The tree's height: the one the user dragged (stored), but at most about half of what
    // the panel shows (a short sidebar: the pane below stays in view, no scroll in a scroll)
    function fitHeight() {
        var el = root && root.parentNode;
        while (el && el !== document.body) {
            var oy = window.getComputedStyle(el).overflowY;
            if ((oy === "auto" || oy === "scroll") && el.clientHeight > 0) break;
            el = el.parentNode;
        }
        var avail = el && el !== document.body ? el.clientHeight : window.innerHeight;
        var h = mem.max ? height : Math.max(96, Math.min(height, Math.round(avail * 0.55)));
        root.style.setProperty("--nx-pt-h", h + "px");
    }

    // after each render: bring the selected row into view, move the focus into the pane
    function afterRender(container) {
        root = container.querySelector(".nx-pt");
        if (root) fitHeight();
        var todo = pending;
        pending = null;
        if (root && first) {
            first = false;
            var t = root.querySelector(".nx-pt-tree");
            if (t) t.scrollTop = mem.top || 0;
            todo = Object.assign({ scroll: true }, todo || {});
        }
        if (!root || !todo) return;
        if (todo.scroll) {
            var row = root.querySelector(".nx-pt-row.nx-on");
            if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
        }
        if (todo.focus) {
            // the widgets render in their own update: after that
            setTimeout(function () {
                var pane = root && root.querySelector(".nx-pt-pane");
                var el = pane && pane.querySelector("input:not([type=hidden]):not([disabled]),textarea:not([disabled]),select:not([disabled]),button.nx-btn:not([disabled]),[tabindex='0']");
                if (el) el.focus();
            }, 0);
        }
    }

    return {
        view: view,
        afterRender: afterRender,
        select: function (id, o) { select(id, o); },
        selected: function () { return mem.sel; },
        search: function (q) { mem.q = q || ""; A.update(); },
        destroy: function () { editors.clear(); }
    };
}
