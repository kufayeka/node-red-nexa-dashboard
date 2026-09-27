// --- Breakpoints: one design, adjusted per screen width (desktop-first) ----------
// A surface (a screen) is designed for the desktop. Its breakpoints are narrower
// widths — by default Tablet (< 1024 px) and Phone (< 768 px) — and a node can
// override some of its fields at each:
//
//   node.overrides = { tablet: { layout: { mode: "vertical" } }, phone: { visibility: "hide" } }
//
// They cascade down: Desktop -> Tablet -> Phone, so Phone starts from what Tablet
// made of the node and changes only what it overrides. An object field (layout,
// layoutChild, style, constraints, props) is merged key by key; any other field
// (x, y, w, h, visibility…) is replaced.

export var DEFAULT_BREAKPOINTS = [
    { id: "tablet", name: "Tablet", max: 1023, preview: 820 },
    { id: "phone", name: "Phone", max: 767, preview: 390 }
];
export var BASE_BREAKPOINT = { id: "desktop", name: "Desktop" };

/** What a breakpoint may change on a node. */
export var OVERRIDABLE = ["x", "y", "w", "h", "visibility", "layout", "layoutChild", "style", "constraints", "props",
    "minW", "maxW", "minH", "maxH", "scrollBehavior"];
var MERGED = { layout: true, layoutChild: true, style: true, constraints: true, props: true };

function clone(v) { return v === undefined || v === null || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v)); }
function isPlain(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function merge(into, patch) {
    var out = isPlain(into) ? clone(into) : {};
    Object.keys(patch || {}).forEach(function (k) {
        out[k] = isPlain(patch[k]) && isPlain(out[k]) ? merge(out[k], patch[k]) : clone(patch[k]);
    });
    return out;
}

/** A surface's breakpoints, the widest first (the desktop is not one: it is the base). */
export function breakpointsOf(surface) {
    var list = surface && Array.isArray(surface.breakpoints) ? surface.breakpoints : DEFAULT_BREAKPOINTS;
    return list.filter(function (b) { return b && b.id && b.id !== BASE_BREAKPOINT.id && isFinite(Number(b.max)); })
        .slice().sort(function (a, b) { return Number(b.max) - Number(a.max); });
}

/** The breakpoint a width falls in: the narrowest whose max it is within, else "desktop". */
export function activeBreakpoint(surface, width) {
    var id = BASE_BREAKPOINT.id;
    breakpointsOf(surface).forEach(function (b) { if (width <= Number(b.max)) id = b.id; });
    return id;
}

/** The breakpoints applied, in order, for `id` (the cascade): phone -> ["tablet", "phone"]; desktop -> []. */
export function chainFor(surface, id) {
    var out = [];
    var list = breakpointsOf(surface);
    for (var i = 0; i < list.length; i++) {
        out.push(list[i].id);
        if (list[i].id === id) return out;
    }
    return [];
}

/** The node's overridable fields as they are (its desktop values), to go back to. */
export function baseOf(node) {
    var b = {};
    OVERRIDABLE.forEach(function (k) { if (node && node[k] !== undefined) b[k] = clone(node[k]); });
    return b;
}

/** Set `node`'s overridable fields to `base`, then apply its overrides along `chain`. Mutates node. */
export function applyOverrides(node, base, chain) {
    OVERRIDABLE.forEach(function (k) {
        if (base[k] === undefined) delete node[k]; else node[k] = clone(base[k]);
    });
    (chain || []).forEach(function (id) {
        var o = node.overrides && node.overrides[id];
        if (!o) return;
        Object.keys(o).forEach(function (k) {
            if (OVERRIDABLE.indexOf(k) === -1) return;
            node[k] = MERGED[k] && isPlain(o[k]) ? merge(node[k], o[k]) : clone(o[k]);
        });
    });
    return node;
}

/** A copy of `node` as it is at the end of `chain` (no mutation). */
export function resolveNode(node, chain) {
    var copy = Object.assign({}, node);
    return applyOverrides(copy, baseOf(node), chain);
}

/** Whether any node of the tree has an override for a breakpoint. */
export function hasOverrides(nodes) {
    return (nodes || []).some(function (n) {
        return (n.overrides && Object.keys(n.overrides).some(function (k) { return n.overrides[k] && Object.keys(n.overrides[k]).length; })) || hasOverrides(n.children);
    });
}

/** The difference that makes `inherited` into `current` (for the fields a breakpoint may change); {} = none. */
export function overrideDiff(inherited, current) {
    var out = {};
    OVERRIDABLE.forEach(function (k) {
        var a = inherited[k], b = current[k];
        if (JSON.stringify(a) === JSON.stringify(b)) return;
        if (MERGED[k] && isPlain(a) && isPlain(b)) {
            var d = {};
            Object.keys(b).forEach(function (kk) { if (JSON.stringify(a[kk]) !== JSON.stringify(b[kk])) d[kk] = clone(b[kk]); });
            if (Object.keys(d).length) out[k] = d;
            return;
        }
        if (b !== undefined) out[k] = clone(b);
    });
    return out;
}
