// --- Breakpoints: one design, adjusted per window width (desktop-first) ----------
// The app's breakpoints (project.breakpoints; empty = DEFAULT_BREAKPOINTS) split the
// widths into bands, the Tailwind way: a breakpoint starts at its `min`, up to the
// next one.  xs 0 | sm 640 | md 768 | lg 1024 | xl 1280 | 2xl 1536 | 3xl 1920
//
// A screen is designed in the band of its own width (a 1920 screen: 3xl) — the
// design. Every other band can override some of a node's fields:
//
//   node.overrides = { md: { layout: { mode: "vertical" } }, sm: { visibility: "hide" } }
//
// Desktop-first, they cascade AWAY from the design: narrower bands inherit from the
// next wider one (xl -> lg -> md -> sm -> xs), a band wider than the design from the
// next narrower one. So md's override also holds at sm and xs, unless they change it.
// An object field (layout, layoutChild, style, constraints, props) is merged key by
// key; any other field (x, y, w, h, visibility…) is replaced.

export var DEFAULT_BREAKPOINTS = [
    { id: "xs", name: "xs", min: 0, preview: 390, device: "Phone" },
    { id: "sm", name: "sm", min: 640, preview: 640, device: "Large phone" },
    { id: "md", name: "md", min: 768, preview: 820, device: "Tablet" },
    { id: "lg", name: "lg", min: 1024, preview: 1024, device: "Tablet landscape / small laptop" },
    { id: "xl", name: "xl", min: 1280, preview: 1366, device: "Laptop" },
    { id: "2xl", name: "2xl", min: 1536, preview: 1600, device: "Desktop" },
    { id: "3xl", name: "3xl", min: 1920, preview: 1920, device: "Full HD and up" }
];

/** Device sizes to preview a breakpoint at (the Breakpoints tab offers them). */
export var DEVICE_PRESETS = [
    { name: "iPhone SE", w: 375, h: 667 },
    { name: "iPhone 15", w: 393, h: 852 },
    { name: "Android phone", w: 412, h: 915 },
    { name: "Phone landscape", w: 740, h: 360 },
    { name: "HMI 7\" (800 × 480)", w: 800, h: 480 },
    { name: "iPad mini", w: 768, h: 1024 },
    { name: "iPad Air", w: 820, h: 1180 },
    { name: "HMI 10\" (1024 × 600)", w: 1024, h: 600 },
    { name: "iPad Pro landscape", w: 1366, h: 1024 },
    { name: "HMI 15\" (1280 × 800)", w: 1280, h: 800 },
    { name: "Laptop (1366 × 768)", w: 1366, h: 768 },
    { name: "Laptop (1440 × 900)", w: 1440, h: 900 },
    { name: "Desktop (1600 × 900)", w: 1600, h: 900 },
    { name: "Full HD (1920 × 1080)", w: 1920, h: 1080 },
    { name: "QHD (2560 × 1440)", w: 2560, h: 1440 },
    { name: "4K (3840 × 2160)", w: 3840, h: 2160 }
];

// saved before the Tailwind bands: Tablet (< 1024) is md, Phone (< 768) is sm
var LEGACY = { md: "tablet", sm: "phone" };

/** What a breakpoint may change on a node. */
export var OVERRIDABLE = ["x", "y", "w", "h", "visibility", "layout", "layoutChild", "style", "constraints", "props",
    "minW", "maxW", "minH", "maxH", "scrollBehavior", "overlay"];
var MERGED = { layout: true, layoutChild: true, style: true, constraints: true, props: true, overlay: true };

function clone(v) { return v === undefined || v === null || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v)); }
function isPlain(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function merge(into, patch) {
    var out = isPlain(into) ? clone(into) : {};
    Object.keys(patch || {}).forEach(function (k) {
        out[k] = isPlain(patch[k]) && isPlain(out[k]) ? merge(out[k], patch[k]) : clone(patch[k]);
    });
    return out;
}

/** The app's breakpoints, the narrowest first; the first one starts at 0. */
export function breakpointsOf(app) {
    var src = app && Array.isArray(app.breakpoints) && app.breakpoints.length ? app.breakpoints : DEFAULT_BREAKPOINTS;
    var seen = {};
    var list = src.filter(function (b) {
        if (!b || !b.id || seen[b.id] || !isFinite(Number(b.min))) return false;
        seen[b.id] = true;
        return true;
    }).map(function (b) { return Object.assign({}, b, { min: Math.max(0, Number(b.min)), name: b.name || b.id }); })
        .sort(function (a, b) { return a.min - b.min; });
    if (!list.length) return breakpointsOf(null);
    list[0].min = 0;
    return list;
}

/** The band of a width: the widest breakpoint it reaches. */
export function bandOf(app, width) {
    var list = breakpointsOf(app), id = list[0].id;
    list.forEach(function (b) { if (Number(width) >= b.min) id = b.id; });
    return id;
}

/** The band a surface is designed in (its own width). */
export function designBreakpoint(app, surface) {
    return bandOf(app, surface && surface.width ? surface.width : 1920);
}

/** The breakpoint a window width falls in (the design's band = the design itself). */
export function activeBreakpoint(app, surface, width) {
    return bandOf(app, width);
}

/** The bands applied, in order, to get from the design to `id` (the cascade); the design -> []. */
export function chainFor(app, surface, id) {
    var list = breakpointsOf(app).map(function (b) { return b.id; });
    var d = list.indexOf(designBreakpoint(app, surface)), t = list.indexOf(id);
    if (t === -1 || d === -1 || t === d) return [];
    var out = [];
    if (t < d) for (var i = d - 1; i >= t; i--) out.push(list[i]);
    else for (var j = d + 1; j <= t; j++) out.push(list[j]);
    return out;
}

/** "768 – 1023 px" / "1920 px and up". */
export function rangeOf(app, id) {
    var list = breakpointsOf(app);
    for (var i = 0; i < list.length; i++) {
        if (list[i].id !== id) continue;
        var next = list[i + 1];
        return next ? list[i].min + " – " + (next.min - 1) + " px" : list[i].min + " px and up";
    }
    return "";
}

/** The width the editor shows a breakpoint at: its preview, kept inside the band. */
export function previewWidthOf(app, id) {
    var list = breakpointsOf(app);
    for (var i = 0; i < list.length; i++) {
        if (list[i].id !== id) continue;
        var next = list[i + 1], w = Number(list[i].preview) || list[i].min || 360;
        return Math.max(list[i].min, next ? Math.min(w, next.min - 1) : w);
    }
    return 0;
}

/** A node's override for a breakpoint (read from its legacy name when saved before the bands). */
export function overrideOf(node, id) {
    var o = node && node.overrides;
    if (!o) return null;
    return o[id] || (LEGACY[id] && o[LEGACY[id]]) || null;
}

/** Legacy override names (tablet / phone) -> the bands, in place, for a tree. */
export function migrateOverrideKeys(nodes) {
    (nodes || []).forEach(function (n) {
        if (n.overrides) Object.keys(LEGACY).forEach(function (id) {
            var old = LEGACY[id];
            if (!n.overrides[old]) return;
            if (!n.overrides[id]) n.overrides[id] = n.overrides[old];
            delete n.overrides[old];
        });
        migrateOverrideKeys(n.children);
    });
}

/** The node's overridable fields as they are (its design values), to go back to. */
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
        var o = overrideOf(node, id);
        if (!o) return;
        Object.keys(o).forEach(function (k) {
            if (OVERRIDABLE.indexOf(k) === -1) return;
            node[k] = MERGED[k] && isPlain(o[k]) ? merge(node[k], o[k]) : clone(o[k]);
        });
    });
    return node;
}

/** A copy of `node` as it is at the end of `chain` (no mutation); `base` defaults to its fields. */
export function resolveNode(node, chain, base) {
    var copy = Object.assign({}, node);
    return applyOverrides(copy, base || baseOf(node), chain);
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

// ---- Fallbacks: what a bound prop shows while its binding has no value ----------------
// props.__fallback = { key: value }: used when the binding resolves to nothing — no tag
// value yet / offline ("???"), null, undefined, no message yet, a variable not declared.
// An expression falls back when any binding inside it has no value.
export function isNoValue(v) {
    return v === undefined || v === null || v === "???";
}
/**
 * `resolved` with each bound prop that came out without a value replaced by its
 * fallback (the same object when nothing falls back). `raw` = the props as stored.
 */
export function applyFallbacks(raw, resolved) {
    var fb = raw && raw.__fallback;
    if (!fb || typeof fb !== "object") return resolved;
    var out = null;
    Object.keys(fb).forEach(function (k) {
        var r = raw[k];
        if (typeof r !== "string" || !/\{[^{}]+\}/.test(r) || fb[k] === undefined) return;
        var v = resolved[k];
        var whole = /^\{[^{}]+\}$/.test(r.trim());
        var empty = isNoValue(v) || v === r
            || (whole && v === "" && /^\{msg\b/.test(r.trim()))
            || (!whole && typeof v === "string" && (/\?\?\?/.test(v) || /\{[^{}]+\}/.test(v)));
        if (!empty) return;
        if (!out) out = Object.assign({}, resolved);
        out[k] = clone(fb[k]);
    });
    return out || resolved;
}
