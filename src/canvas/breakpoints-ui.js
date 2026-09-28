// --- The editor's breakpoints (src/model/breakpoints.js): edit a screen per width --
// The app's breakpoints (the Breakpoints tab: xs sm md lg xl 2xl 3xl) are bands of
// widths; the screen is designed in the band of its own width (the design). Picking
// another band on the canvas bar shows the screen at that band's preview width with
// its overrides applied; whatever is changed there is kept as that band's override
// (what the node now differs from what it inherits), the design untouched. The
// project always stores the design + the overrides, never what a band shows
// (publishBase), and the design's band brings the design back.
//
// A field's own breakpoint chips (the 📱 of every kit inspector field, see
// responsiveHost) edit one value at any band without switching: editAt().
//
// Root nodes follow their constraints to the band's width (like the page's CSS);
// a box changed there is kept in design coordinates, so the page draws it the same.
import { state, getActiveScreen, getApp, Layout } from "../state.js";
import * as BP from "../model/breakpoints.js";

var session = null; // { screenId, id, chain, design: {w, h}, preview: {w, h} }

function app() { return getApp(); }
/** The app's breakpoints, the widest first (as the bar and the chips show them). */
export function breakpointList() { return BP.breakpointsOf(app()).slice().reverse(); }
/** The band `screen` is designed in. */
export function designId(screen) { return BP.designBreakpoint(app(), screen || getActiveScreen()); }
/** The band being edited (the design's when none is). */
export function activeBreakpointId() { return session ? session.id : designId(); }
export function isDesign(id, screen) { return !id || id === designId(screen); }
export function rangeOf(id) { return BP.rangeOf(app(), id); }
/** The width the canvas shows the screen at. */
export function previewWidth(screen) { return session && screen && session.screenId === screen.id ? session.preview.w : (screen ? screen.width : 0); }
export function bandPreviewWidth(screen, id) { return isDesign(id, screen) ? screen.width : BP.previewWidthOf(app(), id); }
export function chainFor(screen, id) { return BP.chainFor(app(), screen, id); }

function each(list, parent, fn) {
    (list || []).forEach(function (n) { fn(n, parent); if (n.children) each(n.children, n, fn); });
}
function box(n) { return { x: n.x, y: n.y, w: n.w, h: n.h }; }
function setBox(n, b) { n.x = b.x; n.y = b.y; n.w = b.w; n.h = b.h; }
// a root node: design coordinates <-> the band's width (its constraints)
function toPreview(n, parent) {
    if (parent || !session) return;
    setBox(n, Layout.resizeWithConstraints(box(n), Layout.constraintsOf(n), session.design, session.preview));
}
function toDesign(n, parent) {
    if (parent || !session) return box(n);
    return Layout.resizeWithConstraints(box(n), Layout.constraintsOf(n), session.preview, session.design);
}
function screenOf(id) { return (state.screens || []).filter(function (s) { return s.id === id; })[0] || null; }
function setBase(n, base) { Object.defineProperty(n, "__bpBase", { value: base, writable: true, configurable: true }); }
function tidy(n) { if (n.overrides && !Object.keys(n.overrides).length) delete n.overrides; }

/** Show `screen` at band `id` (the design's band = the design). */
export function enterBreakpoint(screen, id) {
    leaveBreakpoint();
    if (!screen || !id || isDesign(id, screen) || state.editingMode === "template") return;
    if (!BP.breakpointsOf(app()).some(function (b) { return b.id === id; })) return;
    BP.migrateOverrideKeys(screen.components);
    session = {
        screenId: screen.id, id: id, chain: chainFor(screen, id),
        design: { w: screen.width, h: screen.height },
        preview: { w: bandPreviewWidth(screen, id), h: screen.height }
    };
    each(screen.components, null, function (n, p) {
        setBase(n, BP.baseOf(n));
        BP.applyOverrides(n, n.__bpBase, session.chain);
        toPreview(n, p);
    });
    publishBase();
}

/** Back to the design: what was changed is kept as overrides. */
export function leaveBreakpoint() {
    if (!session) return;
    var screen = screenOf(session.screenId);
    if (screen) {
        syncBreakpoint();
        each(screen.components, null, function (n) {
            if (n.__bpBase) { BP.applyOverrides(n, n.__bpBase, []); delete n.__bpBase; }
        });
    }
    session = null;
    if (state.projectConfigNode) state.projectConfigNode.screens = state.screens;
}

/** What each node now differs from what it inherits at this band -> node.overrides[band]. */
export function syncBreakpoint() {
    if (!session) return;
    var screen = screenOf(session.screenId);
    if (!screen) return;
    var inheritChain = session.chain.slice(0, -1);
    each(screen.components, null, function (n, p) {
        var live = BP.baseOf(n);
        var d = toDesign(n, p);
        live.x = d.x; live.y = d.y; live.w = d.w; live.h = d.h;
        // a node added here: it exists at every width (its design values are these)
        if (!n.__bpBase) { setBase(n, live); return; }
        var inherited = BP.applyOverrides({ overrides: n.overrides }, n.__bpBase, inheritChain);
        // what its layout decides is not an override: a place in the flow, a filled / hugged size
        var inFlow = p && Layout.isInFlow(n, p);
        if (inFlow) { live.x = inherited.x; live.y = inherited.y; }
        if (inFlow && Layout.childSizing(n, "w") !== "fixed") live.w = inherited.w;
        if (inFlow && Layout.childSizing(n, "h") !== "fixed") live.h = inherited.h;
        if (n.type === "@frame" && Layout.frameHugs && Layout.frameHugs(n, "w")) live.w = inherited.w;
        if (n.type === "@frame" && Layout.frameHugs && Layout.frameHugs(n, "h")) live.h = inherited.h;
        ["x", "y", "w", "h"].forEach(function (k) { if (Math.abs((live[k] || 0) - (inherited[k] || 0)) <= 1) live[k] = inherited[k]; });
        var diff = BP.overrideDiff(inherited, live);
        n.overrides = n.overrides || {};
        if (Object.keys(diff).length) n.overrides[session.id] = diff; else delete n.overrides[session.id];
        tidy(n);
    });
}

/** The project stores the design (+ the overrides): a copy of the screens with the design values. */
export function publishBase() {
    if (!session || !state.projectConfigNode) return;
    var live = screenOf(session.screenId);
    var copy = JSON.parse(JSON.stringify(state.screens));
    var bases = {};
    if (live) each(live.components, null, function (n) { bases[n.id] = n.__bpBase; });
    copy.forEach(function (s) {
        if (s.id !== session.screenId) return;
        each(s.components, null, function (n) {
            var b = bases[n.id];
            if (!b) return;
            BP.OVERRIDABLE.forEach(function (k) { if (b[k] === undefined) delete n[k]; else n[k] = JSON.parse(JSON.stringify(b[k])); });
        });
    });
    state.projectConfigNode.screens = copy;
}

/** After an edit (markDirty): keep it as an override, and what the project stores in step. */
export function onDirty() {
    if (!session) return;
    syncBreakpoint();
    publishBase();
}

/** The fields of `node` overridden at the band being edited. */
export function overriddenKeys(node) {
    var o = session && BP.overrideOf(node, session.id);
    return o ? Object.keys(o) : [];
}

/** Drop the node's override at the band being edited: it inherits again. */
export function resetOverride(node, parent) {
    if (!session || !node || !node.overrides) return;
    delete node.overrides[session.id];
    tidy(node);
    BP.applyOverrides(node, node.__bpBase || BP.baseOf(node), session.chain);
    toPreview(node, parent);
}

/** The session belongs to one screen: another screen (or a template) goes back to the design. */
export function checkSession(screen) {
    if (session && (!screen || screen.id !== session.screenId || state.editingMode === "template")) leaveBreakpoint();
}

// ---- one value at any band (a field's breakpoint chips) ---------------------------------
function baseFor(node) { return node.__bpBase || BP.baseOf(node); }

/** A copy of `node` as it is at band `id` (design values in design coordinates). */
export function resolvedAt(node, id, screen) {
    screen = screen || getActiveScreen();
    var copy = BP.resolveNode(node, isDesign(id, screen) ? [] : chainFor(screen, id), baseFor(node));
    copy.children = [];
    return copy;
}

/**
 * Change `node` at band `id`: fn(copy) edits a copy of it as it is there; the change is
 * kept as that band's override (the design's band: the design). The canvas keeps
 * showing the band being edited.
 */
export function editAt(node, parent, id, fn) {
    var screen = getActiveScreen();
    if (!node || !screen) return;
    if (parent && !parent.type) parent = null;   // the surface itself: a root node
    if (isDesign(id, screen)) {
        if (!session) { fn(node); return; }
        var d = resolvedAt(node, id, screen);
        fn(d);
        setBase(node, BP.baseOf(d));
    } else {
        var chain = chainFor(screen, id);
        var inherited = BP.resolveNode(node, chain.slice(0, -1), baseFor(node));
        var current = resolvedAt(node, id, screen);
        fn(current);
        var diff = BP.overrideDiff(inherited, current);
        node.overrides = node.overrides || {};
        if (node.overrides.tablet || node.overrides.phone) BP.migrateOverrideKeys([node]);
        if (Object.keys(diff).length) node.overrides[id] = diff; else delete node.overrides[id];
        tidy(node);
    }
    // what the canvas shows: the band being edited
    if (session) { BP.applyOverrides(node, baseFor(node), session.chain); toPreview(node, parent); }
}

/**
 * The `responsive` option of NexaKit.renderInspector for a node: its fields' values per
 * band. view(node) -> the flat values the inspector edits; write(node, key, v) -> puts one
 * back; canVary(key) -> whether a band may change it (an overridable field).
 */
export function responsiveHost(node, parent, view, write, canVary, commitFn) {
    var screen = getActiveScreen();
    if (!screen || state.editingMode === "template" || !node || !isOnScreen(screen, node)) return null;
    // one render of the inspector reads each band a few times: resolved once
    var at = {}, inh = {};
    function viewAt(id) { if (!(id in at)) at[id] = view(resolvedAt(node, id, screen)); return at[id]; }
    function inheritedAt(id) {
        if (!(id in inh)) inh[id] = view(BP.resolveNode(node, chainFor(screen, id).slice(0, -1), baseFor(node)));
        return inh[id];
    }
    function forget() { at = {}; inh = {}; }
    return {
        begin: forget,
        list: function () {
            var d = designId(screen);
            return breakpointList().map(function (b) {
                return { id: b.id, name: b.name, design: b.id === d, range: rangeOf(b.id) };
            });
        },
        active: function () { return activeBreakpointId(); },
        canVary: canVary || function () { return true; },
        valueAt: function (key, id) { return viewAt(id)[key]; },
        /** Whether band `id` changes `key` (from what it inherits). */
        has: function (key, id) {
            if (isDesign(id, screen)) return false;
            return JSON.stringify(viewAt(id)[key]) !== JSON.stringify(inheritedAt(id)[key]);
        },
        setAt: function (key, id, v) {
            forget();
            commitFn(function () { editAt(node, parent, id, function (n) { write(n, key, v); }); });
            forget();
        },
        clearAt: function (key, id) {
            if (isDesign(id, screen)) return;
            var inherited = inheritedAt(id)[key];
            forget();
            commitFn(function () { editAt(node, parent, id, function (n) { write(n, key, inherited); }); });
            forget();
        }
    };
}

function isOnScreen(screen, node) {
    var found = false;
    each(screen.components, null, function (n) { if (n === node) found = true; });
    return found;
}

// markDirty (state.js) tells us; kept as a hook to avoid an import cycle
state.onBreakpointDirty = onDirty;
