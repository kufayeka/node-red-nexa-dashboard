// --- nx-tree: a hierarchy tree (the look of the MQTT Sparkplug explorer) --------
//   .nodes     [{ id, label, icon, badge, muted, children, container, actions: [{ id, icon, title, on }],
//                 value, title, cls, collapsed, draggable }]
//              label / value may be Lit templates (title: the plain text for the tooltip); value
//              shows right-aligned (a property's value); cls: extra row classes; collapsed: the
//              row starts collapsed (until the user opens it); draggable: false = not draggable
//   .selected  [ids]
//   persist-key   remembers which rows are open / collapsed (rows start expanded)
//   expand-all    every row open, whatever was collapsed (a search showing its matches)
//   droppable-root   whether dropping at the top level is allowed (default true)
// Events (bubbling):
//   nx-tree-select   { id, additive }        click (Shift / Ctrl / Cmd = additive)
//   nx-tree-open     { id }                  double click on the icon
//   nx-tree-action   { id, action }          a row's action button
//   nx-tree-rename   { id, name }            double click on the label, Enter
//   nx-tree-move     { id, targetId, position: "before" | "after" | "inside" }   drag & drop
// A node can't be dropped into itself or a descendant; "inside" only onto a
// `container`. What a move MEANS (e.g. display order vs stacking order) is
// the listener's business.
import { html, nothing } from "lit";
import { KitElement, icon } from "./base.js";

function store(key, value) {
    try {
        if (value === undefined) return window.localStorage.getItem(key);
        window.localStorage.setItem(key, value);
    } catch (e) { /* storage blocked */ }
    return null;
}

export class NxTree extends KitElement {
    static properties = {
        nodes: { attribute: false },
        selected: { attribute: false },
        persistKey: { type: String, attribute: "persist-key" },
        emptyText: { type: String, attribute: "empty-text" },
        renamable: { type: Boolean },
        expandAll: { type: Boolean, attribute: "expand-all" },
        _collapsed: { state: true },
        _renaming: { state: true },
        _drop: { state: true }
    };

    constructor() {
        super();
        this.nodes = [];
        this.selected = [];
        this.renamable = true;
        this._collapsed = {};
        this._renaming = null;
        this._drop = null;
        this._dragId = null;
    }

    connectedCallback() {
        super.connectedCallback();
        if (this.persistKey) {
            try { this._collapsed = JSON.parse(store("nexa-kit:tree:" + this.persistKey) || "{}") || {}; } catch (e) { this._collapsed = {}; }
        }
    }

    _saveCollapsed() {
        if (this.persistKey) store("nexa-kit:tree:" + this.persistKey, JSON.stringify(this._collapsed));
    }

    /** Whether a row is collapsed now: what the user chose, else the node's own `collapsed`. */
    isCollapsed(id, node) {
        if (this.expandAll) return false;
        if (id in this._collapsed) return !!this._collapsed[id];
        if (!node) (function search(list) { (list || []).forEach(function (n) { if (n.id === id) node = n; else if (!node) search(n.children); }); })(this.nodes);
        return !!(node && node.collapsed);
    }

    toggle(id) {
        var next = Object.assign({}, this._collapsed);
        next[id] = !this.isCollapsed(id);
        this._collapsed = next;
        this._saveCollapsed();
    }

    setAllCollapsed(collapsed) {
        var next = {};
        (function walk(list) { (list || []).forEach(function (n) { if (n.children && n.children.length) { next[n.id] = !!collapsed; walk(n.children); } }); })(this.nodes);
        this._collapsed = next;
        this._saveCollapsed();
    }

    /** Expands every ancestor of `id` so it is visible. */
    reveal(id) {
        var path = [];
        var found = (function search(list, trail) {
            for (var i = 0; i < (list || []).length; i++) {
                var n = list[i];
                if (n.id === id) { path = trail; return true; }
                if (search(n.children, trail.concat([n.id]))) return true;
            }
            return false;
        })(this.nodes, []);
        if (!found || !path.some((p) => this.isCollapsed(p))) return;
        var next = Object.assign({}, this._collapsed);
        path.forEach(function (p) { next[p] = false; });
        this._collapsed = next;
        this._saveCollapsed();
    }

    _fire(name, detail) {
        this.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true, composed: true }));
    }

    _isInside(id, maybeDescendantId) {
        var node = null;
        (function search(list) { (list || []).forEach(function (n) { if (n.id === id) node = n; else if (!node) search(n.children); }); })(this.nodes);
        var inside = false;
        (function walk(list) { (list || []).forEach(function (n) { if (n.id === maybeDescendantId) inside = true; walk(n.children); }); })(node ? node.children : []);
        return inside;
    }

    _dropPosition(e, node) {
        var r = e.currentTarget.getBoundingClientRect();
        var y = (e.clientY - r.top) / Math.max(1, r.height);
        if (node.container) return y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
        return y < 0.5 ? "before" : "after";
    }

    _row(node, depth) {
        var hasKids = node.children && node.children.length;
        var collapsed = this.isCollapsed(node.id, node);
        var selected = (this.selected || []).indexOf(node.id) !== -1;
        var drop = this._drop && this._drop.targetId === node.id ? this._drop.position : "";
        var renaming = this._renaming === node.id;
        return html`
            <div class="nx-tree-row ${selected ? "nx-on" : ""} ${node.muted ? "nx-muted" : ""} ${drop ? "nx-drop-" + drop : ""} ${node.cls || ""}"
                data-id="${node.id}" draggable="${renaming || node.draggable === false ? "false" : "true"}" role="treeitem" aria-selected="${selected}" aria-expanded="${hasKids ? String(!collapsed) : nothing}"
                @click="${(e) => {
                    var additive = e.shiftKey || e.ctrlKey || e.metaKey;
                    if (additive) {
                        var cur = (this.selected || []).slice();
                        var idx = cur.indexOf(node.id);
                        if (idx !== -1) cur.splice(idx, 1);
                        else cur.push(node.id);
                        this.selected = cur;
                    } else {
                        this.selected = [node.id];
                    }
                    this._fire("nx-tree-select", { id: node.id, additive: additive });
                }}"
                @dblclick="${(e) => {
                    if (this.renamable === false || this.hasAttribute("no-rename") || node.renamable === false) {
                        e.stopPropagation();
                        this._fire("nx-tree-open", { id: node.id });
                    }
                }}"
                @dragstart="${(e) => { if (node.draggable === false) { e.preventDefault(); return; } this._dragId = node.id; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", node.id); } catch (err) { /* ok */ } }}"
                @dragend="${() => { this._dragId = null; this._drop = null; }}"
                @dragover="${(e) => {
                    if (!this._dragId || this._dragId === node.id || this._isInside(this._dragId, node.id)) return;
                    e.preventDefault();
                    var pos = this._dropPosition(e, node);
                    if (!this._drop || this._drop.targetId !== node.id || this._drop.position !== pos) this._drop = { targetId: node.id, position: pos };
                }}"
                @dragleave="${(e) => { if (this._drop && this._drop.targetId === node.id && !e.currentTarget.contains(e.relatedTarget)) this._drop = null; }}"
                @drop="${(e) => {
                    e.preventDefault();
                    var d = this._drop, id = this._dragId;
                    this._drop = null; this._dragId = null;
                    if (d && id && d.targetId === node.id) this._fire("nx-tree-move", { id: id, targetId: node.id, position: d.position });
                }}">
                <span class="nx-tree-indent" style="width:${depth * 14}px"></span>
                <span class="nx-tree-caret" @click="${(e) => { e.stopPropagation(); if (hasKids) this.toggle(node.id); }}">${hasKids ? html`<i class="fa ${collapsed ? "fa-caret-right" : "fa-caret-down"}"></i>` : nothing}</span>
                <span class="nx-tree-icon" @dblclick="${(e) => { e.stopPropagation(); this._fire("nx-tree-open", { id: node.id }); }}">${icon(node.icon || "fa fa-square-o")}</span>
                ${renaming
                    ? html`<input class="nx-control nx-tree-rename" .value="${node.label || ""}" @click="${(e) => e.stopPropagation()}"
                        @keydown="${(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") { this._renaming = null; this._fire("nx-tree-rename", { id: node.id, name: e.target.value.trim() }); }
                            if (e.key === "Escape") this._renaming = null;
                        }}" @blur="${(e) => { if (this._renaming === node.id) { this._renaming = null; this._fire("nx-tree-rename", { id: node.id, name: e.target.value.trim() }); } }}">`
                    : html`<span class="nx-tree-label" title="${node.title || (typeof node.label === "string" ? node.label : "")}" @dblclick="${(e) => {
                        e.stopPropagation();
                        if (this.renamable !== false && !this.hasAttribute("no-rename") && node.renamable !== false) {
                            this._renaming = node.id;
                        } else {
                            this._fire("nx-tree-open", { id: node.id });
                        }
                    }}">${node.label}</span>`}
                ${node.value !== undefined && node.value !== null && node.value !== "" ? html`<span class="nx-tree-value">${node.value}</span>` : nothing}
                ${node.badge !== undefined && node.badge !== "" ? html`<span class="nx-badge">${node.badge}</span>` : nothing}
                ${node.actions && node.actions.length ? html`
                    <span class="nx-tree-actions">${(node.actions || []).map((a) => html`<button type="button" class="nx-icon-btn ${a.on ? "nx-on" : ""}" title="${a.title || a.id}"
                        @click="${(e) => { e.stopPropagation(); this._fire("nx-tree-action", { id: node.id, action: a.id }); }}"><i class="${a.icon}"></i></button>`)}</span>
                ` : nothing}
            </div>
            ${hasKids && !collapsed ? html`<div class="nx-tree-children" role="group">${node.children.map((c) => this._row(c, depth + 1))}</div>` : nothing}`;
    }

    updated(changed) {
        if (changed.has("_renaming") && this._renaming) {
            var input = this.querySelector(".nx-tree-rename");
            if (input) { input.focus(); input.select(); }
        }
    }

    render() {
        var nodes = this.nodes || [];
        return html`<div class="nx-tree" role="tree">
            ${nodes.length ? nodes.map((n) => this._row(n, 0)) : html`<div class="nx-tree-empty">${this.emptyText || "Empty"}</div>`}
        </div>`;
    }
}
