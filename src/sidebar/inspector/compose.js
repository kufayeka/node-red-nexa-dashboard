// --- One inspector from several sources --------------------------------------------
// The properties panel shows ONE property tree for the selected node (the kit's
// renderInspector): its name and lock, its place and size, the layout around it, a frame's
// auto layout, its variables, a template's parameters, the component's own props... Each of
// those is a SOURCE (src/sidebar/inspector/sources/*.js):
//
//   {
//     id, prefix,                       prefix: its keys in the tree ("pos$place"); "" = the component's own props
//     applies(ctx) -> bool              for this node at all (the node's kind; what changes with an edit
//                                       is a prop's visibleWhen instead: nothing is rebuilt)
//     props(ctx)   -> { key: prop }     kit props (src/sdk/schema.js) + group / section; their functions
//                                       get the SOURCE's view: visibleWhen(v, ctx), enabledWhen(v, ctx),
//                                       validate / warn(value, v), summary(value, v); an action's
//                                       buttons run(v) / disabled(v) / on(v), its summary(v) / info(v)
//     view(node, ctx) -> { key: value }
//     write(node, key, value, ctx)      changes the node (also per breakpoint, through `responsive`)
//     set(key, value, ctx)?             a whole edit of its own; default: ctx.commit(write)
//     canVary(key)?                     a value per breakpoint (📱); default none
//   }
//
// ctx = { node, screen, parent, typeDef, template, update(), commit(fn), commitPlain(fn) }.
// An edit is one undo step (a tree snapshot), then only the canvas is redrawn: the tree
// stays, and re-renders itself with the new values.
import { state, getActiveScreen, markDirty, Tree, isNodeLocked } from "../../state.js";
import { pushTreeChange, treeSnapshot } from "../../history.js";
import { redrawCanvas } from "../../canvas/canvas-ui.js";
import { responsiveHost } from "../../canvas/breakpoints-ui.js";

function wrapProp(src, prop, viewOf, ctx) {
    var pr = Object.assign({}, prop);
    if (!src.prefix) return pr;          // the component's own props: the kit calls them with its props
    var call = function (fn) { return function () { return fn.call(null, viewOf(), ctx); }; };
    if (typeof pr.visibleWhen === "function") pr.visibleWhen = call(pr.visibleWhen);
    if (typeof pr.enabledWhen === "function") pr.enabledWhen = call(pr.enabledWhen);
    if (typeof pr.options === "function") { var of = pr.options; pr.options = function () { return of(viewOf(), ctx); }; }
    ["validate", "warn"].forEach(function (k) {
        if (typeof pr[k] === "function") { var f = pr[k]; pr[k] = function (value) { return f(value, viewOf(), ctx); }; }
    });
    if (pr.type === "action") {
        ["summary", "info"].forEach(function (k) { if (typeof pr[k] === "function") pr[k] = call(pr[k]); });
        var buttons = pr.buttons;
        pr.buttons = function () {
            var list = typeof buttons === "function" ? buttons(viewOf(), ctx) : buttons || [];
            return list.map(function (b) {
                return Object.assign({}, b, {
                    run: function () { b.run(viewOf(), ctx); },
                    disabled: typeof b.disabled === "function" ? function () { return b.disabled(viewOf(), ctx); } : b.disabled,
                    on: typeof b.on === "function" ? function () { return b.on(viewOf(), ctx); } : b.on
                });
            });
        };
    } else if (typeof pr.summary === "function") {
        var sf = pr.summary;
        pr.summary = function (value) { return sf(value, viewOf(), ctx); };
    }
    return pr;
}

/**
 * Renders the merged inspector of `node` into `container`.
 *   opts = { sources, ctx (extra fields), persistKey, meta (the component's: states, parts,
 *            inputs / outputs, groupOrder), groupOrder (where the sources' groups go) }
 * -> the kit's handle ({ update, destroy, select, … })
 */
export function renderComposed(container, node, opts) {
    var screen = getActiveScreen();
    var ctx = Object.assign({ node: node, screen: screen, parent: screen && node && node.id ? Tree.parentOf(screen, node.id) : null }, opts.ctx || {});
    var handle = null;
    var cache = null;
    ctx.update = function () { cache = null; if (handle) handle.update(); };
    // an edit of the node: one undo step, the canvas redrawn, the tree updated
    ctx.commit = function (fn) {
        var scr = getActiveScreen();
        if (!scr || (node.id && isNodeLocked(node.id))) return false;
        var before = treeSnapshot(scr);
        fn();
        if (node.id) Tree.refitGroupsUp(scr, node.id);
        pushTreeChange(scr, before);
        markDirty();
        cache = null;
        redrawCanvas();
        return true;
    };

    var sources = opts.sources.filter(function (s) { return !s.applies || s.applies(ctx); });
    var views = {};
    function viewOf(src) {
        if (!cache) cache = {};
        if (!(src.id in cache)) cache[src.id] = src.view(node, ctx) || {};
        return cache[src.id];
    }

    var base = opts.meta || {};
    var meta = {
        id: base.id || (node && node.type) || "@node",
        label: base.label, stateList: base.stateList || [], partList: base.partList || [],
        inputs: base.inputs || [], outputs: base.outputs || [], eventList: base.eventList || [], actionList: base.actionList || [],
        props: {}, groupOrder: opts.groupOrder || null
    };
    var owner = {};       // full key -> { src, key }
    sources.forEach(function (src) {
        views[src.id] = function () { return viewOf(src); };
        var ps = src.props(ctx) || {};
        Object.keys(ps).forEach(function (k) {
            var full = (src.prefix || "") + k;
            var pr = wrapProp(src, ps[k], views[src.id], ctx);
            if (src.prefix) {
                pr = Object.assign({ label: k, default: undefined, noReset: true, bindable: false }, pr);
                if (pr.type === "enum" && Array.isArray(pr.options)) {
                    pr.options = pr.options.map(function (o) { return o !== null && typeof o === "object" ? o : { value: o, label: String(o) }; });
                }
            }
            pr.key = full;
            meta.props[full] = pr;
            owner[full] = { src: src, key: k };
        });
    });

    function props() {
        var out = {};
        sources.forEach(function (src) {
            var v = viewOf(src);
            if (src.prefix) Object.keys(v).forEach(function (k) { out[src.prefix + k] = v[k]; });
            else Object.assign(out, v);
        });
        // the component's own: the kit writes __previewState / __fallback there
        return out;
    }

    function route(full) {
        if (owner[full]) return owner[full];
        var plain = sources.filter(function (s) { return !s.prefix; })[0];
        return plain ? { src: plain, key: full } : null;
    }

    // a value per breakpoint: each source's own host, routed by key
    var hosts = {};
    sources.forEach(function (src) {
        if (typeof src.canVary !== "function" || !screen || !node || !node.id) return;
        hosts[src.id] = responsiveHost(node, ctx.parent,
            function (n) { return src.view(n, ctx) || {}; },
            function (n, k, v) { src.write(n, k, v, ctx); },
            src.canVary,
            function (fn) { if (src.commitResponsive) src.commitResponsive(fn, ctx); else ctx.commit(fn); });
    });
    var anyHost = Object.keys(hosts).map(function (k) { return hosts[k]; }).filter(Boolean)[0] || null;
    var responsive = {
        begin: function () { cache = null; Object.keys(hosts).forEach(function (k) { if (hosts[k]) hosts[k].begin(); }); },
        list: function () { return anyHost ? anyHost.list() : []; },
        active: function () { return anyHost ? anyHost.active() : null; },
        canVary: function (full) { var r = route(full); var h = r && hosts[r.src.id]; return !!h && h.canVary(r.key); },
        valueAt: function (full, id) { var r = route(full); return hosts[r.src.id].valueAt(r.key, id); },
        has: function (full, id) { var r = route(full); var h = r && hosts[r.src.id]; return !!h && h.has(r.key, id); },
        setAt: function (full, id, v) { var r = route(full); hosts[r.src.id].setAt(r.key, id, v); cache = null; },
        clearAt: function (full, id) { var r = route(full); hosts[r.src.id].clearAt(r.key, id); cache = null; }
    };

    handle = window.NexaKit.renderInspector(container.jquery ? container.get(0) : container, {
        meta: meta,
        props: props,
        persistKey: opts.persistKey || meta.id,
        responsive: responsive,
        set: function (full, v) {
            var r = route(full);
            if (!r) return;
            cache = null;
            if (typeof r.src.set === "function") r.src.set(r.key, v, ctx);
            else ctx.commit(function () { r.src.write(node, r.key, v, ctx); });
            cache = null;
        },
        preview: function (full, v) {
            var r = route(full);
            if (r && typeof r.src.preview === "function") r.src.preview(r.key, v, ctx);
            cache = null;
        }
    });
    return handle;
}

/** Whether the panel has a node being typed in (state.propertiesPane): the caller's business. */
export function inspectorReady() {
    return !!(window.NexaKit && window.NEXA_LIT && state);
}
