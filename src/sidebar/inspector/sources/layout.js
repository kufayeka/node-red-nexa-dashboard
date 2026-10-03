// --- Sources: where a node sits in its parent ---------------------------------------
//   position      placed by the layout / free / on the screen / docked; margin, padding, layer
//   layoutChild   in its parent's auto layout: sizing per axis, grid cell, min / max, sticky
//   constraints   no layout places it: how it follows its parent's size (Figma)
//   teleport      drawn in another place of the page (src/runtime/ applyTeleports)
//   instanceBox   a template instance: its box, and what the template's content does in it
// What shows depends on the node NOW (its place, its parent's layout): visibleWhen, so an
// edit never rebuilds the panel. See ../compose.js for what a source is.
import { state, Tree, Layout } from "../../../state.js";

var SIZING_CHILD = [{ value: "fixed", label: "Fixed" }, { value: "fill", label: "Fill" }, { value: "hug", label: "Hug" }];
var PLACE_OPTIONS = {
    flow: { value: "flow", label: "In the layout", icon: "fa fa-bars" },
    free: { value: "free", label: "Free", icon: "fa fa-arrows" },
    screen: { value: "screen", label: "On the screen", icon: "fa fa-desktop" },
    dock: { value: "dock", label: "Docked", icon: "fa fa-thumb-tack" }
};

function placeOf(ctx) { return Layout.placeOf(ctx.node, ctx.parent); }

// ---- position ----------------------------------------------------------------------------
function positionView(node, parent) {
    var d = Layout.dockOf(node);
    return { place: Layout.placeOf(node, parent), dockAt: { x: d.x, y: d.y }, dockStretch: d.stretch,
        margin: Layout.marginOf(node), padding: Layout.paddingOf(node), z: Layout.zOf(node), arrange: "" };
}

function writePosition(node, key, v) {
    var sides = function (s) { return s && (s.t || s.r || s.b || s.l) ? { t: Number(s.t) || 0, r: Number(s.r) || 0, b: Number(s.b) || 0, l: Number(s.l) || 0 } : null; };
    if (key === "margin" || key === "padding") { var sv = sides(v); if (sv) node[key] = sv; else delete node[key]; return; }
    if (key === "z") { if (Math.round(Number(v)) || 0) node.z = Math.round(Number(v)); else delete node.z; return; }
    if (key === "dockAt") { node.dock = Object.assign({}, node.dock || {}, { x: v.x, y: v.y }); return; }
    if (key === "dockStretch") { node.dock = Object.assign({}, node.dock || {}, { stretch: !!v }); if (!v) delete node.dock.stretch; }
}

// A new place, keeping the node where it is on screen (its x / y are in another space now)
function changePlace(screen, node, parent, v) {
    var abs = Tree.absBox(screen, node.id);
    var lc = Object.assign({}, node.layoutChild || {});
    delete lc.absolute;
    delete node.place;
    if (v === "free" && Layout.hasAutoLayout(parent)) lc.absolute = true;
    if (v === "screen" || v === "dock") node.place = v;
    if (Object.keys(lc).length) node.layoutChild = lc; else delete node.layoutChild;
    var clampIn = function (w, h, x, y) {
        node.x = Math.max(0, Math.min(x, Math.max(0, w - (node.w || 0))));
        node.y = Math.max(0, Math.min(y, Math.max(0, h - (node.h || 0))));
    };
    if (v === "screen") clampIn(screen.width, screen.height, Math.round(abs.x), Math.round(abs.y));
    else if (v === "free") {
        var o = parent ? Tree.contentOrigin(screen, parent.id) : { x: 0, y: 0 };
        var nx = Math.round(abs.x - o.x), ny = Math.round(abs.y - o.y);
        if (parent) {
            var pw = parent.w != null ? parent.w : (parent.width || screen.width);
            var ph = parent.h != null ? parent.h : (parent.height || screen.height);
            if (parent.type === "@frame" && typeof Layout.innerSize === "function") { var isz = Layout.innerSize(parent); pw = isz.w; ph = isz.h; }
            clampIn(pw, ph, nx, ny);
        } else clampIn(screen.width, screen.height, nx, ny);
    } else if (v === "dock" && !node.dock) {
        // docked where it is closest
        var ps = parent ? Layout.innerSize(parent) : { w: screen.width, h: screen.height };
        var o2 = parent ? Tree.contentOrigin(screen, parent.id) : { x: 0, y: 0 };
        var cx = abs.x - o2.x + abs.w / 2, cy = abs.y - o2.y + abs.h / 2;
        var third = function (c, size) { return c < size / 3 ? "start" : c > size * 2 / 3 ? "end" : "center"; };
        node.dock = { x: third(cx, ps.w), y: third(cy, ps.h) };
        if (node.dock.x === "center" && node.dock.y === "center") node.dock.y = "start";
    }
}

export var position = {
    id: "position", prefix: "pos$",
    applies: function (ctx) { return !Layout.inSlot(ctx.node) && !Layout.overlayOf(ctx.node); },
    props: function (ctx) {
        var node = ctx.node, parent = ctx.parent;
        var options = [];
        if (Layout.hasAutoLayout(parent)) options.push(PLACE_OPTIONS.flow);
        options.push(PLACE_OPTIONS.free);
        if (parent) options.push(PLACE_OPTIONS.screen);
        options.push(PLACE_OPTIONS.dock);
        var where = parent ? (parent.name || "its frame") : "the screen";
        var edge = function (v) { return v.place === "dock" && ((v.dockAt.x === "center") !== (v.dockAt.y === "center")); };
        var arrange = function (to) {
            // on top of (below) every sibling: a Z one past theirs
            var sibs = (parent ? Tree.kids(parent) : ctx.screen.components).filter(function (s) { return s !== node; }).map(Layout.zOf);
            var z = to === "front" ? Math.max.apply(null, sibs.concat([0])) + 1 : Math.min.apply(null, sibs.concat([0])) - 1;
            ctx.commit(function () { writePosition(node, "z", z); });
            ctx.update();
        };
        return {
            place: { type: "enum", group: "Position", label: "Position", options: options, style: "segmented",
                help: "In the layout: its frame's auto layout places it. Free: its own X / Y in its parent. On the screen: its X / Y are the screen's (out of a clipped card); its Logic and variables stay those of its place. Docked: at an edge or a corner of its parent, and it stays there while that scrolls." },
            dockAt: { type: "align", group: "Position", label: "Docked at", visibleWhen: function (v) { return v.place === "dock"; },
                help: "It stays at this edge or corner of " + where + " while it scrolls; Margin = its distance from the edges." },
            dockStretch: { type: "boolean", group: "Position", label: "Stretch along the edge (a header, a side bar)", visibleWhen: edge },
            margin: { type: "spacing", group: "Position", label: "Margin", min: -500, visibleWhen: function (v) { return v.place === "flow" || v.place === "dock"; },
                help: "In a layout: the space around it. Docked: its distance from the edges." },
            padding: { type: "spacing", group: "Position", label: "Padding", visibleWhen: function () { return Layout.takesPadding(node); },
                help: "The space inside its box, around what it draws." },
            z: { type: "number", group: "Position", label: "Layer (Z)", min: -999, max: 999, step: 1,
                help: "Higher = on top of its siblings. The same Z: the Hierarchy's order (top of the list = on top)." },
            arrange: { type: "action", group: "Position", label: "Arrange", summary: function (v) { return "Z " + v.z; },
                buttons: [{ label: "Front", icon: "fa fa-level-up", title: "On top of its siblings", run: function () { arrange("front"); } },
                    { label: "Back", icon: "fa fa-level-down", title: "Below its siblings", run: function () { arrange("back"); } }] }
        };
    },
    view: function (node, ctx) { return positionView(node, ctx.parent); },
    write: writePosition,
    set: function (key, v, ctx) {
        if (key === "place") {
            if (v === placeOf(ctx)) return;
            ctx.commit(function () { changePlace(ctx.screen, ctx.node, ctx.parent, v); });
            ctx.update();
            return;
        }
        ctx.commit(function () { writePosition(ctx.node, key, v); });
    },
    canVary: function (key) { return key !== "place" && key !== "arrange"; }
};

// ---- the node in its parent's auto layout ----------------------------------------------------
function childView(node) {
    var lc = node.layoutChild || {};
    return {
        childW: lc.w || "fixed", childH: lc.h || "fixed", sticky: node.scrollBehavior === "sticky",
        col: lc.col || 0, row: lc.row || 0, colSpan: lc.colSpan || 1, rowSpan: lc.rowSpan || 1,
        minW: node.minW || 0, maxW: node.maxW || 0, minH: node.minH || 0, maxH: node.maxH || 0
    };
}

function writeChild(node, key, v) {
    if (key === "sticky") { if (v) node.scrollBehavior = "sticky"; else delete node.scrollBehavior; return; }
    if (/^(min|max)[WH]$/.test(key)) {
        if (Number(v) > 0) node[key] = Number(v); else delete node[key];
        return;
    }
    var lc = Object.assign({}, node.layoutChild || {});
    var k = { childW: "w", childH: "h" }[key] || key;
    if (v === "fixed" || v === false || v === 0 || (k.indexOf("Span") !== -1 && Number(v) <= 1)) delete lc[k];
    else lc[k] = typeof v === "string" || typeof v === "boolean" ? v : Number(v);
    if (Object.keys(lc).length) node.layoutChild = lc; else delete node.layoutChild;
}

export var layoutChild = {
    id: "layoutChild", prefix: "lc$",
    applies: function (ctx) { return !!ctx.parent && !Layout.inSlot(ctx.node); },
    props: function (ctx) {
        var node = ctx.node, parent = ctx.parent;
        var inFlow = function () { return Layout.hasAutoLayout(parent) && placeOf(ctx) === "flow"; };
        var grid = function () { return inFlow() && Layout.layoutOf(parent).mode === "grid"; };
        var sizing = function () { return Layout.hasAutoLayout(node) ? SIZING_CHILD : SIZING_CHILD.filter(function (o) { return o.value !== "hug"; }); };
        var group = "Layout", section = "In " + (parent.name || "its frame");
        var p = function (o) { return Object.assign({ group: group, section: section, visibleWhen: inFlow }, o); };
        return {
            childW: p({ type: "enum", label: "Width", style: "segmented", options: sizing() }),
            childH: p({ type: "enum", label: "Height", style: "segmented", options: sizing() }),
            col: p({ type: "number", label: "Column", min: 0, help: "0 = next free cell", visibleWhen: grid }),
            row: p({ type: "number", label: "Row", min: 0, visibleWhen: grid }),
            colSpan: p({ type: "number", label: "Column span", min: 1, visibleWhen: grid }),
            rowSpan: p({ type: "number", label: "Row span", min: 1, visibleWhen: grid }),
            minW: p({ type: "number", label: "Min W", min: 0, unit: "px" }), maxW: p({ type: "number", label: "Max W", min: 0, unit: "px" }),
            minH: p({ type: "number", label: "Min H", min: 0, unit: "px" }), maxH: p({ type: "number", label: "Max H", min: 0, unit: "px" }),
            sticky: p({ type: "boolean", label: "Sticky while the frame scrolls (stays at its edge)" })
        };
    },
    view: function (node) { return childView(node); },
    write: writeChild,
    canVary: function () { return true; }
};

// ---- constraints -------------------------------------------------------------------------------
function constraintView(node) {
    var c = Layout.constraintsOf(node);   // none saved: left & right, top & bottom
    return { h: c.h, v: c.v, scrollBehavior: node.scrollBehavior || "scrolls" };
}

function writeConstraint(node, key, v) {
    if (key === "scrollBehavior") { if (v === "scrolls") delete node.scrollBehavior; else node.scrollBehavior = v; return; }
    var c = constraintView(node);
    c[key] = v;
    node.constraints = { h: c.h, v: c.v };
}

export var constraints = {
    id: "constraints", prefix: "cons$",
    props: function (ctx) {
        var node = ctx.node, parent = ctx.parent;
        var shown = function () { return Layout.hasConstraints(node, parent) && placeOf(ctx) !== "dock"; };
        var g = { group: "Constraints", visibleWhen: shown };
        return {
            h: Object.assign({ type: "enum", label: "Horizontal", options: [
                { value: "left", label: "Left" }, { value: "right", label: "Right" }, { value: "leftRight", label: "Left & right" },
                { value: "center", label: "Center" }, { value: "scale", label: "Scale" }],
                help: "How it follows when " + (parent ? (parent.name || "its frame") : "the screen") + " changes size." }, g),
            v: Object.assign({ type: "enum", label: "Vertical", options: [
                { value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }, { value: "topBottom", label: "Top & bottom" },
                { value: "center", label: "Center" }, { value: "scale", label: "Scale" }] }, g),
            scrollBehavior: Object.assign({ type: "enum", label: "When scrolling (live page)", options: [
                { value: "scrolls", label: "Scrolls with the content" },
                { value: "fixed", label: "Fixed (stays in view: a header / footer)" },
                { value: "sticky", label: "Sticky (scrolls, then stays at the edge)" }],
                warn: function (value) { return value === "fixed" ? "It stays where it is on the view while " + (parent ? "this frame" : "the page") + " scrolls. With the Bottom (Right) constraint: that far from the bottom (right) edge — a footer." : ""; } }, g)
        };
    },
    view: function (node) { return constraintView(node); },
    write: writeConstraint,
    canVary: function () { return true; }
};

// ---- teleport --------------------------------------------------------------------------------
function teleportTargets() {
    var names = {};
    function walk(list) { (list || []).forEach(function (n) { if (typeof n.slot === "string" && n.slot.trim()) names[n.slot.trim()] = true; walk(n.children); }); }
    (state.screens || []).concat(state.templates || []).forEach(function (s) { walk(s.components); });
    return Object.keys(names).sort();
}

export var teleport = {
    id: "teleport", prefix: "tp$",
    props: function (ctx) {
        var node = ctx.node;
        var options = function () {
            return [{ value: "", label: "Nowhere else (where it is)" }, { value: "@page", label: "The page (above every frame, out of any clip)" }]
                .concat(teleportTargets().filter(function (n) { return n !== node.slot; }).map(function (n) { return { value: n, label: n }; }));
        };
        var out = {
            teleport: { type: "enum", group: "Teleport", label: "Teleport to", style: "combobox", free: true, placeholder: "a target's name", options: options,
                help: "Drawn in another place of the page: its Logic, params and variables stay those of where it is here. Or move any node with a Logic Teleport node (Events → Teleport)." },
            teleportOn: { type: "enum", group: "Teleport", label: "When", visibleWhen: function (v) { return !!v.teleport; },
                options: [{ value: "load", label: "When the page opens" }, { value: "logic", label: "When a Logic Teleport node runs" }],
                help: "On the page itself (@page): at its X / Y. A frame's name: inside that frame (its layout places it). \"When a Logic Teleport node runs\": it stays here until one sends it; another one sends it home." }
        };
        if (node.type === "@frame") out.slot = { type: "string", group: "Teleport", label: "This frame is a teleport target named", placeholder: "e.g. header-actions",
            help: "What is teleported to this name (from this screen, a template, a Populate's copies) is drawn in this frame." };
        return out;
    },
    view: function (node) { return { teleport: node.teleport || "", teleportOn: node.teleportOn || "load", slot: node.slot || "" }; },
    write: function (node, key, v) {
        var t = String(v || "").trim();
        if (key === "teleportOn") { if (t === "logic") node.teleportOn = "logic"; else delete node.teleportOn; return; }
        if (t) node[key] = t; else delete node[key];
    }
};

// ---- a template instance's box ---------------------------------------------------------------
export var instanceBox = {
    id: "instanceBox", prefix: "box$",
    applies: function (ctx) { return ctx.node.type === "@template" && !!ctx.template; },
    props: function (ctx) {
        var node = ctx.node, t = ctx.template;
        var inFlow = function () { return Layout.isInFlow(node, ctx.parent && ctx.parent.type ? ctx.parent : null); };
        var lc = function () { return node.layoutChild || {}; };
        var g = "Position & Size";
        return {
            x: { type: "number", group: g, label: "X", unit: "px", visibleWhen: function () { return !inFlow(); } },
            y: { type: "number", group: g, label: "Y", unit: "px", visibleWhen: function () { return !inFlow(); } },
            w: { type: "number", group: g, label: "Width", unit: "px", min: 1, enabledWhen: function () { return !(inFlow() && lc().w === "fill"); } },
            h: { type: "number", group: g, label: "Height", unit: "px", min: 1, enabledWhen: function () { return !(inFlow() && lc().h === "fill"); } },
            content: { type: "enum", group: g, label: "Content in this box", options: [
                { value: "", label: "As the template says" }, { value: "constraints", label: "Follow constraints (like a frame)" },
                { value: "scale", label: "Scale to fit (keep proportions)" }, { value: "stretch", label: "Stretch (distorts)" }],
                help: (t.name || "The template") + " is designed " + t.width + " × " + t.height + ". Drag its handles to resize it; the content follows its constraints, or scales: set per template (Templates → On the live page) or here." }
        };
    },
    view: function (n) { return { x: n.x, y: n.y, w: n.w, h: n.h, content: n.content || "" }; },
    write: function (n, key, v) {
        if (key === "content") { if (v) n.content = v; else delete n.content; return; }
        n[key] = key === "w" || key === "h" ? Math.max(1, Number(v) || 0) : Number(v) || 0;
    },
    canVary: function (k) { return k !== "content"; }
};
