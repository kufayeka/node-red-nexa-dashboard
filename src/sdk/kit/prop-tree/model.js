// --- The property tree's model (pure: no DOM, no Lit) -----------------------------
// The inspector shows a component's props as a tree:
//   group (prop.group)  >  section (prop.section, optional)  >  prop  >  list item  >  item field
// and ONE editor pane for the node picked in the tree. This file builds the nodes,
// says what a row shows (summary), filters them for the search, and finds where a
// selection goes when its node disappears. Node ids are stable paths:
//   "@Style"  "@Style/Text"   a group, a section
//   "label"                   a prop (its key: the same wherever its group is)
//   "tabs#2"  "tabs#2.label"  the 3rd item of the list prop "tabs", that item's field "label"

function isEmpty(v) {
    return v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
}

// "{provider:address}" / "{name}" as the value, or inside a text ({asset:…} / {token:…} are values)
export function isBinding(v) {
    return typeof v === "string" && /\{[^{}]+\}/.test(v) && !/^\{(asset|token):[^{}]+\}$/.test(v.trim());
}

function firstLine(s) {
    var lines = String(s).replace(/\s+$/, "").split("\n");
    var first = lines.filter(function (l) { return l.trim(); })[0] || "";
    return { first: first.trim(), count: lines.length };
}

function optionLabel(prop, v) {
    // options given by a function (loaded later) have no label here: the value itself
    var o = (Array.isArray(prop.options) ? prop.options : []).filter(function (x) { return x && x.value === v; })[0];
    return o ? String(o.label) : String(v);
}

/** The singular noun of a list's items ("tab"), for "[3 tabs]" and "Add tab". */
export function itemNoun(prop) {
    return prop.noun || (prop.item && prop.item.noun) || "item";
}

function plural(n, noun) {
    return n + " " + noun + (n === 1 ? "" : "s");
}

/**
 * What a tree row shows for a value: { text, empty, swatch, check, bound, token }.
 * Simple values only — a text's first line, a number with its unit, a colour swatch,
 * a check, "[3 tabs]", "4 lines · color: red". `summarize` (a custom editor's summary)
 * or prop.summary(value, props) replace the text.
 */
export function summary(prop, value, props, summarize) {
    var v = value === undefined ? prop.default : value;
    var custom = typeof summarize === "function" ? summarize : typeof prop.summary === "function" ? prop.summary : null;
    if (custom) {
        var t;
        try { t = custom(v, props || {}); } catch (e) { t = ""; }
        return { text: t === undefined || t === null ? "" : String(t), empty: isEmpty(t) };
    }
    if (prop.bindable && isBinding(v)) return { text: v, bound: true };
    var tok = typeof v === "string" && /^\{token:([^{}]+)\}$/.exec(v.trim());
    if (tok) return { text: tok[1], token: true };
    switch (prop.type) {
        case "boolean": return { text: v ? "on" : "off", check: !!v };
        case "number": case "range":
            return isEmpty(v) ? { text: "", empty: true } : { text: String(v) + (prop.unit ? " " + prop.unit : "") };
        case "enum": return isEmpty(v) ? { text: "", empty: true } : { text: optionLabel(prop, v) };
        case "color": return isEmpty(v) ? { text: "", empty: true } : { text: String(v), swatch: String(v) };
        case "css": case "code": case "text": {
            if (isEmpty(v) || !String(v).trim()) return { text: "", empty: true };
            var fl = firstLine(v);
            return { text: fl.count > 1 ? fl.count + " lines · " + fl.first : fl.first };
        }
        case "json": {
            if (isEmpty(v)) return { text: "", empty: true };
            var s = typeof v === "string" ? v : JSON.stringify(v);
            return { text: s.length > 60 ? s.slice(0, 59) + "…" : s };
        }
        case "list": {
            var n = Array.isArray(v) ? v.length : 0;
            return { text: "[" + plural(n, itemNoun(prop)) + "]", empty: !n };
        }
        case "asset": return isEmpty(v) ? { text: "", empty: true } : { text: String(v).replace(/^\{asset:([^{}]+)\}$/, "$1") };
        case "align": return v && typeof v === "object" ? { text: (v.y || "start") + " / " + (v.x || "start") } : { text: "", empty: true };
        case "spacing": {
            if (!v || typeof v !== "object") return { text: "0" };
            var t = Number(v.t) || 0, r = Number(v.r) || 0, b = Number(v.b) || 0, l = Number(v.l) || 0;
            return { text: t === r && r === b && b === l ? String(t) : t === b && l === r ? t + " " + r : [t, r, b, l].join(" ") };
        }
        case "action": return { text: "" };
        default:
            if (isEmpty(v)) return { text: "", empty: true };
            if (typeof v === "object") { var j = JSON.stringify(v); return { text: j.length > 60 ? j.slice(0, 59) + "…" : j }; }
            return { text: firstLine(v).first };
    }
}

/** What a row says when there is no value. */
export function emptyText(prop) {
    if (prop.type === "tag") return "not bound";
    if (prop.type === "css" || prop.type === "code") return "empty";
    if (prop.type === "list") return "none";
    return "not set";
}

/** An item's schema: { fields } (a row of fields) or a single widget's prop. */
export function itemSchema(prop) {
    return prop.item || { type: "string" };
}

/** A list item's row label: prop.itemLabel (a field key or fn(item, i)), its first text field, or "Tab 3". */
export function itemLabel(prop, item, i) {
    var sch = itemSchema(prop);
    var noun = itemNoun(prop);
    var fallback = noun.charAt(0).toUpperCase() + noun.slice(1) + " " + (i + 1);
    if (typeof prop.itemLabel === "function") {
        try { var l = prop.itemLabel(item, i); if (!isEmpty(l)) return String(l); } catch (e) { /* the fallback */ }
        return fallback;
    }
    if (sch.fields && item && typeof item === "object") {
        var key = prop.itemLabel || Object.keys(sch.fields).filter(function (k) {
            var t = sch.fields[k].type || "string";
            return t === "string" || t === "text";
        })[0];
        if (key && !isEmpty(item[key])) return String(item[key]);
        return fallback;
    }
    if (!isEmpty(item) && typeof item !== "object") return String(item);
    return fallback;
}

/** Whether the inspector shows a prop now (hidden / visibleWhen / perState). */
export function isShown(prop, p, state) {
    if (!prop || prop.hidden || prop.key === "__previewState" || prop.key === "__fallback") return false;
    if (typeof prop.visibleWhen === "function") {
        try { if (!prop.visibleWhen(p || {})) return false; } catch (e) { return false; }
    }
    if (prop.perState && state !== undefined && prop.perState !== state) return false;
    return true;
}

/**
 * The tree of a component's props.
 *   meta   { props: { key: normalized prop } }   (prop.group / prop.section order the tree:
 *          first appearance, or opts.groupOrder)
 *   p      the current props
 *   opts   { state, groupOrder: ["General", …] }
 * -> [group node]; every node: { id, kind, label, depth, children, parentId,
 *     key (prop / item / itemField), prop, index (item / itemField), field (itemField's schema) }
 */
export function buildTree(meta, p, opts) {
    opts = opts || {};
    p = p || {};
    var groups = [], byGroup = {};
    Object.keys(meta.props || {}).forEach(function (key) {
        var prop = meta.props[key];
        if (!isShown(prop, p, opts.state)) return;
        var gName = prop.group || "General";
        var g = byGroup[gName];
        if (!g) {
            g = byGroup[gName] = { id: "@" + gName, kind: "group", label: gName, depth: 0, children: [], parentId: null, sections: {} };
            groups.push(g);
        }
        var parent = g;
        if (prop.section) {
            parent = g.sections[prop.section];
            if (!parent) {
                parent = g.sections[prop.section] = { id: g.id + "/" + prop.section, kind: "section", label: prop.section, depth: 1, children: [], parentId: g.id };
                g.children.push(parent);
            }
        }
        var node = { id: key, kind: "prop", label: prop.label || key, key: key, prop: prop, depth: parent.depth + 1, children: [], parentId: parent.id };
        if (prop.type === "list") {
            var items = Array.isArray(p[key]) ? p[key] : Array.isArray(prop.default) && p[key] === undefined ? prop.default : [];
            var sch = itemSchema(prop);
            items.forEach(function (item, i) {
                var it = { id: key + "#" + i, kind: "item", label: itemLabel(prop, item, i), key: key, prop: prop, index: i, depth: node.depth + 1, children: [], parentId: node.id };
                if (sch.fields) {
                    Object.keys(sch.fields).forEach(function (fk) {
                        var f = Object.assign({ label: fk, key: fk }, sch.fields[fk]);
                        it.children.push({ id: it.id + "." + fk, kind: "itemField", label: f.label, key: key, prop: prop, index: i, field: f, fieldKey: fk, depth: it.depth + 1, children: [], parentId: it.id });
                    });
                }
                node.children.push(it);
            });
        }
        parent.children.push(node);
    });
    if (opts.groupOrder) {
        var order = opts.groupOrder;
        groups.sort(function (a, b) {
            var ia = order.indexOf(a.label), ib = order.indexOf(b.label);
            return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
        });
    }
    groups.forEach(function (g) { delete g.sections; });
    return groups;
}

/** id -> node, for every node of the tree. */
export function indexTree(roots) {
    var map = new Map();
    (function walk(list) { list.forEach(function (n) { map.set(n.id, n); walk(n.children); }); })(roots);
    return map;
}

/** The node's ancestors' ids, the root first. */
export function ancestorIds(map, id) {
    var out = [], n = map.get(id);
    while (n && n.parentId) { out.unshift(n.parentId); n = map.get(n.parentId); }
    return out;
}

/**
 * Where a selection goes when its node is gone (the item removed, the prop hidden by
 * visibleWhen): the item ("tabs#2.label" -> "tabs#2"), the item before it, the list, …
 * then the first prop of the tree. null for an empty tree.
 */
export function nearestId(map, id, roots) {
    var cur = id;
    while (cur && !map.has(cur)) {
        var m;
        if ((m = /^(.*#\d+)\.[^.#]+$/.exec(cur))) cur = m[1];
        else if ((m = /^(.*)#(\d+)$/.exec(cur))) cur = Number(m[2]) > 0 ? m[1] + "#" + (Number(m[2]) - 1) : m[1];
        else if ((m = /^(@.*)\/[^/]+$/.exec(cur))) cur = m[1];
        else cur = null;
    }
    if (cur) return cur;
    return firstLeafId(roots);
}

export function firstLeafId(roots) {
    var found = null;
    (function walk(list) {
        for (var i = 0; i < list.length && !found; i++) {
            if (list[i].kind === "prop") { found = list[i].id; return; }
            walk(list[i].children);
        }
    })(roots || []);
    return found;
}

/**
 * The rows the tree shows.
 *   isOpen(id)   whether a node is expanded (no search)
 *   q            the search (lower case; label or summary text)
 *   textOf(node) the row's value text (for the search)
 * -> { rows: [{ node, open, hasKids }], hits }. Searching: a match and its ancestors,
 * a matching node's children only where they match too.
 */
export function visibleRows(roots, q, isOpen, textOf) {
    var rows = [], hits = 0;
    q = (q || "").trim().toLowerCase();
    if (!q) {
        (function walk(list) {
            list.forEach(function (n) {
                var has = n.children.length > 0, open = has && isOpen(n.id);
                rows.push({ node: n, open: open, hasKids: has });
                if (open) walk(n.children);
            });
        })(roots);
        return { rows: rows, hits: 0 };
    }
    var match = function (n) {
        if (String(n.label).toLowerCase().indexOf(q) !== -1) return true;
        if (n.key && n.kind === "prop" && String(n.key).toLowerCase().indexOf(q) !== -1) return true;
        var t = textOf ? textOf(n) : "";
        return !!t && String(t).toLowerCase().indexOf(q) !== -1;
    };
    var collect = function (n) {
        var self = match(n);
        var kids = n.children.map(collect).filter(Boolean);
        if (self) hits++;
        return self || kids.length ? { n: n, kids: kids } : null;
    };
    (function flat(list) {
        list.forEach(function (r) { rows.push({ node: r.n, open: r.kids.length > 0, hasKids: r.n.children.length > 0 }); flat(r.kids); });
    })(roots.map(collect).filter(Boolean));
    return { rows: rows, hits: hits };
}

/**
 * How the editor pane edits a prop:
 *   "inline"  the widget in the pane                 (text, number, choice, colour, tag, …)
 *   "large"   needs room: the pane can grow          (code, CSS, JSON, long text)
 *   "list"    a list: its items are the tree's children
 *   "custom"  a plugin's own editor (prop.editor)
 *   "action"  no stored value: buttons that do something (prop.buttons), and text (prop.info)
 */
export function editorKind(prop) {
    if (prop.type === "action") return "action";
    if (prop.editor) return "custom";
    if (prop.type === "list") return "list";
    if (prop.type === "css" || prop.type === "code" || prop.type === "json" || prop.type === "text") return "large";
    return "inline";
}

/** A list op on a copy of the array: { next, index } (index: where the item is now, for the selection). */
export function listOp(items, op, i, make) {
    var next = (Array.isArray(items) ? items : []).slice();
    var copy = function (v) { return v === undefined || v === null || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v)); };
    if (op === "add") { next.push(make ? make() : ""); return { next: next, index: next.length - 1 }; }
    if (op === "remove") { next.splice(i, 1); return { next: next, index: next.length ? Math.min(i, next.length - 1) : -1 }; }
    if (op === "up" && i > 0) { var a = next[i - 1]; next[i - 1] = next[i]; next[i] = a; return { next: next, index: i - 1 }; }
    if (op === "down" && i < next.length - 1) { var b = next[i + 1]; next[i + 1] = next[i]; next[i] = b; return { next: next, index: i + 1 }; }
    if (op === "duplicate") { next.splice(i + 1, 0, copy(next[i])); return { next: next, index: i + 1 }; }
    return { next: next, index: i };
}
