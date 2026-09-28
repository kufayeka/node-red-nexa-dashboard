// --- The editor's breakpoints (src/model/breakpoints.js): edit a screen per width --
// Desktop is the design. Picking Tablet / Phone shows the screen at that width with
// the breakpoint's overrides applied; whatever is changed there is kept as that
// breakpoint's override (what the node now differs from what it inherits), the
// desktop values untouched. The project always stores the desktop design + the
// overrides, never what a breakpoint shows (publishBase), and Desktop brings the
// design back.
//
// Root nodes follow their constraints to the narrower width (like the page's CSS);
// a box changed there is kept in design coordinates, so the page draws it the same.
import { state, getActiveScreen, Layout } from "../state.js";
import * as BP from "../model/breakpoints.js";

var session = null; // { screenId, id, chain, design: {w, h}, preview: {w, h} }

export function activeBreakpointId() { return session ? session.id : "desktop"; }
export function breakpointList(screen) { return BP.breakpointsOf(screen); }
/** The width the canvas shows the screen at. */
export function previewWidth(screen) { return session && screen && session.screenId === screen.id ? session.preview.w : (screen ? screen.width : 0); }

function each(list, parent, fn) {
    (list || []).forEach(function (n) { fn(n, parent); if (n.children) each(n.children, n, fn); });
}
function box(n) { return { x: n.x, y: n.y, w: n.w, h: n.h }; }
function setBox(n, b) { n.x = b.x; n.y = b.y; n.w = b.w; n.h = b.h; }
// a root node: design coordinates <-> the breakpoint's width (its constraints)
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

/** Show `screen` at breakpoint `id` ("desktop" = the design). */
export function enterBreakpoint(screen, id) {
    leaveBreakpoint();
    if (!screen || !id || id === "desktop" || state.editingMode === "template") return;
    var bp = BP.breakpointsOf(screen).filter(function (b) { return b.id === id; })[0];
    if (!bp) return;
    session = {
        screenId: screen.id, id: id, chain: BP.chainFor(screen, id),
        design: { w: screen.width, h: screen.height },
        preview: { w: Math.min(screen.width, Number(bp.preview || bp.max) || screen.width), h: screen.height }
    };
    each(screen.components, null, function (n, p) {
        setBase(n, BP.baseOf(n));
        BP.applyOverrides(n, n.__bpBase, session.chain);
        toPreview(n, p);
    });
    publishBase();
}

/** Back to the design (the desktop): what was changed is kept as overrides. */
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

/** What each node now differs from what it inherits at this breakpoint -> node.overrides[bp]. */
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
        if (!Object.keys(n.overrides).length) delete n.overrides;
    });
}

/** The project stores the design (+ the overrides): a copy of the screens with the desktop values. */
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

/** The fields of `node` overridden at the current breakpoint. */
export function overriddenKeys(node) {
    return session && node && node.overrides && node.overrides[session.id] ? Object.keys(node.overrides[session.id]) : [];
}

/** Drop the node's override at the current breakpoint: it inherits again. */
export function resetOverride(node, parent) {
    if (!session || !node || !node.overrides) return;
    delete node.overrides[session.id];
    if (!Object.keys(node.overrides).length) delete node.overrides;
    BP.applyOverrides(node, node.__bpBase || BP.baseOf(node), session.chain);
    toPreview(node, parent);
}

/** The session belongs to one screen: another screen (or a template) goes back to the design. */
export function checkSession(screen) {
    if (session && (!screen || screen.id !== session.screenId || state.editingMode === "template")) leaveBreakpoint();
}

// markDirty (state.js) tells us; kept as a hook to avoid an import cycle
state.onBreakpointDirty = onDirty;
