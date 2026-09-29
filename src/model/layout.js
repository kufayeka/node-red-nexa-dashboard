import { mentionsToken, tokenCss } from "./theme.js";
// --- Frames and auto layout (Figma-style) -------------------------------------
// An "@frame" is a container with a box of its own (fill, stroke, radius,
// clip) and an optional auto layout that places its children:
//   frame.layout = {
//     mode:    "none" | "horizontal" | "vertical" | "grid"
//     padding: { t, r, b, l }
//     gap:     px between children ("auto" = space between, flex modes)
//     rowGap:  px between rows (wrap, grid); unset = the gap
//     alignX / alignY: "start" | "center" | "end"   (the 3×3 alignment)
//     wrap:    horizontal only: children flow onto new rows
//     columns / rows: grid tracks [{ size, unit: "px" | "fr" | "auto" }]
//     sizeW / sizeH: "fixed" | "hug"  (hug = the frame fits its content)
//   }
//   frame.style = { fill, stroke, strokeWidth, radius, clip }
// A child of a frame with a layout ("in flow") sizes per axis with
//   child.layoutChild = { w: "fixed" | "fill" | "hug", h: ..., absolute,
//                         col, row, colSpan, rowSpan }   (grid placement, 1-based)
// "absolute" takes a child out of the flow: it keeps its own x / y.
// min / max sizes: node.minW / maxW / minH / maxH.
//
// The layout itself is plain CSS flexbox / grid, computed here once for the
// editor AND the deployed page (lib/nexa-model-client.js), as { property:
// value } maps in kebab-case (fit for jQuery .css() and style.setProperty).
// The editor reads the resulting boxes back into x / y / w / h (see
// src/canvas/layout-readback.js) so selection, handles and snapping work on
// them like on any other node.

export var LAYOUT_MODES = ["none", "horizontal", "vertical", "grid", "carousel"];

// A carousel: its children (or the copies a Populate puts in it) are slides, `perView`
// at a time (1.2 lets the next one peek in), scrolled (snapping) or faded one by one.
// `index` names a variable that holds the current slide (two-way: set it to go there).
export var CAROUSEL_DEFAULT = {
    direction: "horizontal",   // "horizontal" | "vertical"
    perView: 1,
    transition: "slide",       // "slide" | "fade"
    loop: false,
    autoplay: 0,               // ms between slides, 0 = off
    pauseOnHover: true,
    arrows: true,
    dots: true,
    swipe: true,
    index: ""                  // a variable name: the current slide (0-based)
};

var DEFAULT_LAYOUT = {
    mode: "none",
    padding: { t: 0, r: 0, b: 0, l: 0 },
    gap: 0,
    rowGap: undefined,   // unset: the same as gap
    alignX: "start",
    alignY: "start",
    wrap: false,
    columns: [{ size: 1, unit: "fr" }, { size: 1, unit: "fr" }],
    rows: [],
    sizeW: "fixed",
    sizeH: "fixed",
    carousel: null,
    items: null
};

// A carousel's slide is a cell: `padX` / `padY` inside it, and a template of a fixed
// size aligned in it (alignX / alignY: start | center | end). How big the template
// is — fixed or filling — is the template's own setting (templateLiveOf).
export var ITEMS_DEFAULT = { padX: 0, padY: 0, alignX: "center", alignY: "center" };

// A template on the live page, per axis: "fixed" (its design size) or "fill" (the
// space its host gives it: a list row, a grid cell, a slide), with an optional min / max.
// `content`: what its content does when its box is not its design size (it fills, or an
// instance was resized):
//   "constraints"  like a frame: each node follows its constraints (Left & Right, Scale…)
//   "scale"        the whole design scaled to fit, proportions kept, centred
//   "stretch"      scaled to the box on each axis (text and shapes are distorted)
export var TEMPLATE_LIVE_DEFAULT = { w: "fixed", h: "fixed", minW: "", maxW: "", minH: "", maxH: "", content: "constraints" };
export var TEMPLATE_CONTENT_MODES = ["constraints", "scale", "stretch"];
export function templateLiveOf(template) {
    var live = Object.assign({}, TEMPLATE_LIVE_DEFAULT, (template && template.live) || {});
    if (TEMPLATE_CONTENT_MODES.indexOf(live.content) === -1) live.content = "constraints";
    return live;
}

/** What a template's content does in its box: the instance's own choice, else the template's. */
export function templateContentOf(template, instance) {
    var own = instance && instance.content;
    return TEMPLATE_CONTENT_MODES.indexOf(own) !== -1 ? own : templateLiveOf(template).content;
}

/**
 * Where a template's design goes in a box of `bw` × `bh` (scale / stretch): the
 * transform and offset of a layer of its design size. null for "constraints" (the
 * design is laid out at the box's size instead).
 */
export function templateContentFit(template, bw, bh, instance) {
    var mode = templateContentOf(template, instance);
    if (mode === "constraints") return null;
    var tw = Number(template && template.width) || 1, th = Number(template && template.height) || 1;
    var sx = bw / tw, sy = bh / th;
    if (!(sx > 0) || !(sy > 0)) return { transform: "", left: 0, top: 0 };
    if (mode === "stretch") return { transform: "scale(" + sx + "," + sy + ")", left: 0, top: 0 };
    var s = Math.min(sx, sy);
    return { transform: "scale(" + s + ")", left: (bw - tw * s) / 2, top: (bh - th * s) / 2 };
}

/**
 * Constraints guessed from where a node sits in a `pw` × `ph` parent: most of the
 * width (over a third) -> Left & Right, about centred -> Center, nearer the right edge -> Right; the
 * same vertically. (The Templates tab's "Auto constraints": a start, to adjust.)
 */
export function guessConstraints(node, pw, ph) {
    function axis(pos, size, total, a, b, both) {
        var near = pos, far = total - pos - size;
        // a big one (the background, an image area) stretches with the parent, so what is
        // pinned to the far edge does not run into it when the parent shrinks
        if (size >= total * 0.35) return both;
        if (Math.abs(near - far) <= total * 0.06) return "center";
        return far < near ? b : a;
    }
    return {
        h: axis(num(node.x), num(node.w), pw, "left", "right", "leftRight"),
        v: axis(num(node.y), num(node.h), ph, "top", "bottom", "topBottom")
    };
}

// scroll: "none" | "vertical" | "horizontal" | "both" — on the deployed page
// (the editor shows the frame per `clip`, so what's outside stays editable)
var DEFAULT_STYLE = { fill: "", stroke: "", strokeWidth: 0, radius: 0, clip: false, scroll: "none", scrollbar: "auto" };
var SCROLL_AXES = { vertical: ["hidden", "auto"], horizontal: ["auto", "hidden"], both: ["auto", "auto"] };

function num(v, d) {
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : (d || 0);
}
// a CSS length / colour that may be a theme token ({token:spacing.4} -> var(--nexa-spacing-4))
function pxCss(v) { return mentionsToken(v) ? tokenCss(v) : num(v) + "px"; }
function has(v) { return mentionsToken(v) || num(v) > 0; }

/** A frame's layout with every field filled in. */
export function layoutOf(frame) {
    var l = (frame && frame.layout) || {};
    var out = {};
    Object.keys(DEFAULT_LAYOUT).forEach(function (k) { out[k] = l[k] !== undefined ? l[k] : DEFAULT_LAYOUT[k]; });
    var p = out.padding || {};
    out.padding = { t: num(p.t), r: num(p.r), b: num(p.b), l: num(p.l) };
    if (LAYOUT_MODES.indexOf(out.mode) === -1) out.mode = "none";
    if (!Array.isArray(out.columns)) out.columns = DEFAULT_LAYOUT.columns;
    if (!Array.isArray(out.rows)) out.rows = [];
    out.carousel = Object.assign({}, CAROUSEL_DEFAULT, l.carousel || {});
    out.items = Object.assign({}, ITEMS_DEFAULT, l.items || {});
    var pv = num(out.carousel.perView, 1);
    out.carousel.perView = pv > 0 ? pv : 1;
    return out;
}

// A zoomable frame (frame.zoom): on the live page, exactly the editor's canvas — the frame
// clips and scrolls both ways (always: it cannot be turned off), its scrollbars stay as
// they are and their length follows the zoom; only the content zooms (Ctrl + wheel / a
// pinch at the pointer) and pans (scrolling, a drag on the background). dblclick: a double
// click / tap goes back to the start (Fit / 100 %); controls: the editor's zoom toolbar.
// ---- Overlays: a frame shown on top of its scope, opened / closed by Logic ---------------
// frame.overlay = { kind, … }: the frame is a dialog (placed in its scope by alignX /
// alignY, `margin` from the edges) or a drawer (along one `side`, filling the other
// axis). Its scope is its parent: the page (a root node) or the frame it is in — the
// backdrop, the placement and the drag limits are that box. Hidden until opened
// (Logic: Open / Close; startOpen), closed by the backdrop, Esc, a timer or Logic.
export var OVERLAY_KINDS = ["dialog", "drawer"];
export var OVERLAY_DEFAULT = {
    kind: "dialog", alignX: "center", alignY: "center", margin: 16, side: "right",
    backdrop: "dim", backdropOpacity: 0.4, modal: true,
    closeOnBackdrop: true, closeOnEsc: true, autoClose: 0,
    draggable: false, dragWithin: "scope",
    animation: "auto", duration: 200, startOpen: false
};
export function overlayOf(node) {
    if (!node || node.type !== "@frame" || !node.overlay || OVERLAY_KINDS.indexOf(node.overlay.kind) === -1) return null;
    var o = Object.assign({}, OVERLAY_DEFAULT, node.overlay);
    o.margin = Math.max(0, num(o.margin, 16));
    o.duration = Math.max(0, num(o.duration, 200));
    o.autoClose = Math.max(0, num(o.autoClose, 0));
    o.backdropOpacity = Math.min(1, Math.max(0, num(o.backdropOpacity, 0.4)));
    if (["left", "right", "top", "bottom"].indexOf(o.side) === -1) o.side = "right";
    if (o.animation === "auto") o.animation = o.kind === "drawer" ? "slide" : "scale";
    return o;
}
/** Where an overlay sits in a scope of `pw` × `ph` (the editor draws it there): { x, y, w, h }. */
export function overlayBox(node, pw, ph) {
    var o = overlayOf(node);
    var w = num(node.w), h = num(node.h);
    if (!o) return { x: num(node.x), y: num(node.y), w: w, h: h };
    if (o.kind === "drawer") {
        if (o.side === "left") return { x: 0, y: 0, w: Math.min(w, pw), h: ph };
        if (o.side === "right") return { x: Math.max(0, pw - w), y: 0, w: Math.min(w, pw), h: ph };
        if (o.side === "top") return { x: 0, y: 0, w: pw, h: Math.min(h, ph) };
        return { x: 0, y: Math.max(0, ph - h), w: pw, h: Math.min(h, ph) };
    }
    var m = o.margin;
    var cw = Math.min(w, Math.max(0, pw - 2 * m)), ch = Math.min(h, Math.max(0, ph - 2 * m));
    return { x: m + (pw - 2 * m - cw) * alignFraction(o.alignX), y: m + (ph - 2 * m - ch) * alignFraction(o.alignY), w: cw, h: ch };
}

export var ZOOM_DEFAULT = { enabled: false, min: 0.25, max: 4, wheel: "ctrl", controls: true, start: "fit", dblclick: true };
export function zoomOf(frame) {
    if (!frame || frame.type !== "@frame" || !frame.zoom || !frame.zoom.enabled) return null;
    if (layoutOf(frame).mode === "carousel") return null;   // a carousel scrolls its slides instead
    var z = Object.assign({}, ZOOM_DEFAULT, frame.zoom);
    z.min = Math.max(0.05, num(z.min, 0.25));
    z.max = Math.max(z.min, num(z.max, 4));
    return z;
}

/** A carousel frame's settings (defaults filled in), or null for any other node. */
export function carouselOf(frame) {
    return frame && frame.type === "@frame" && layoutOf(frame).mode === "carousel" ? layoutOf(frame).carousel : null;
}

/** 0 / 0.5 / 1 for start / center / end (an alignment as a fraction of the free space). */
export function alignFraction(a) { return a === "center" ? 0.5 : a === "end" ? 1 : 0; }

/** The axis a frame's children flow along: "horizontal" | "vertical" | "grid" | "none" (a carousel: its direction). */
export function flowAxis(frame) {
    var l = layoutOf(frame);
    if (l.mode === "carousel") return l.carousel.direction === "vertical" ? "vertical" : "horizontal";
    return l.mode;
}

export function styleOf(frame) {
    var s = (frame && frame.style) || {};
    var out = {};
    Object.keys(DEFAULT_STYLE).forEach(function (k) { out[k] = s[k] !== undefined ? s[k] : DEFAULT_STYLE[k]; });
    return out;
}

export function hasAutoLayout(node) {
    return !!node && node.type === "@frame" && layoutOf(node).mode !== "none";
}

/** Whether `child` is placed by its parent's auto layout (not by its own x / y). */
/** A component's slot frame (Tree.isSlotFrame): the component places it, filling its slot. */
export function inSlot(node) {
    return !!(node && node.type === "@frame" && typeof node.inSlot === "string" && node.inSlot !== "");
}

export function isInFlow(child, parent) {
    // an overlay is on top of its scope, never in its flow
    return hasAutoLayout(parent) && !(child && child.layoutChild && child.layoutChild.absolute) && !overlayOf(child) && !placedOut(child);
}

// ---- where a node is placed ------------------------------------------------------------
// "flow"   its parent's auto layout places it (the default there)
// "free"   free in its parent: its own x / y (the default in a frame without auto layout,
//          and on the screen; in an auto layout: layoutChild.absolute)
// "screen" its x / y are the SCREEN's, wherever it is in the tree (out of a clipped card);
//          its Logic, variables and params stay those of its place in the tree
// "dock"   docked to an edge or a corner of its parent (node.dock, the 3x3 pad), off by its
//          margin; on the live page it stays there while the parent scrolls
export var PLACES = ["flow", "free", "screen", "dock"];
function placedOut(node) { return !!node && (node.place === "screen" || node.place === "dock") && !inSlot(node); }

export function placeOf(node, parent) {
    if (!node) return "free";
    if (placedOut(node) && !overlayOf(node)) return node.place;
    if (hasAutoLayout(parent) && !(node.layoutChild && node.layoutChild.absolute) && !overlayOf(node) && !inSlot(node)) return "flow";
    return "free";
}

/** A docked node's corner / edge: { x, y: "start" | "center" | "end", stretch } (stretch: along its edge). */
export function dockOf(node) {
    var d = (node && node.dock) || {};
    var v = function (s, def) { return s === "start" || s === "center" || s === "end" ? s : def; };
    return { x: v(d.x, "start"), y: v(d.y, "start"), stretch: !!d.stretch };
}

function sides(v) {
    if (v === undefined || v === null || v === "") return { t: 0, r: 0, b: 0, l: 0 };
    if (typeof v === "number") return { t: v, r: v, b: v, l: v };
    return { t: num(v.t), r: num(v.r), b: num(v.b), l: num(v.l) };
}
/** Space around a node: { t, r, b, l } px (0 when unset). */
export function marginOf(node) { return sides(node && node.margin); }
/** Space inside a component's box, around what it draws: { t, r, b, l } px. Frames: layout.padding. */
export function paddingOf(node) { return sides(node && node.padding); }
/** Whether a node takes node.padding (a component; a frame has its layout's, a group / template none). */
export function takesPadding(node) { return !!node && ["@frame", "@group", "@template"].indexOf(node.type) === -1; }
/** Its stacking order among its siblings (higher = on top; 0 / unset = the Hierarchy order). */
export function zOf(node) { var z = Number(node && node.z); return isFinite(z) ? Math.round(z) : 0; }
function pxSides(s) { return s.t + "px " + s.r + "px " + s.b + "px " + s.l + "px"; }
function hasSides(s) { return !!(s.t || s.r || s.b || s.l); }

/** The CSS of a docked node: anchored to its parent's box (the live page: its visible box). */
function dockCss(node, css) {
    var d = dockOf(node), m = marginOf(node);
    var w = num(node.w), h = num(node.h);
    css.position = "absolute";
    css.margin = "0px";
    css.left = css.right = css.top = css.bottom = "";
    var stretchX = d.stretch && d.x === "center" && d.y !== "center";
    var stretchY = d.stretch && d.y === "center" && d.x !== "center";
    if (stretchX) { css.left = m.l + "px"; css.right = m.r + "px"; css.width = "auto"; }
    else if (d.x === "start") css.left = m.l + "px";
    else if (d.x === "end") { css.left = "auto"; css.right = m.r + "px"; }
    else css.left = "calc(50% - " + (w / 2) + "px + " + ((m.l - m.r) / 2) + "px)";
    if (stretchY) { css.top = m.t + "px"; css.bottom = m.b + "px"; css.height = "auto"; }
    else if (d.y === "start") css.top = m.t + "px";
    else if (d.y === "end") { css.top = "auto"; css.bottom = m.b + "px"; }
    else css.top = "calc(50% - " + (h / 2) + "px + " + ((m.t - m.b) / 2) + "px)";
    return css;
}

/** A child's sizing on one axis ("w" | "h") inside an auto layout. */
export function childSizing(child, axis) {
    var lc = (child && child.layoutChild) || {};
    var v = lc[axis];
    if (v === "fill") return "fill";
    // only a frame that lays out its own children has a content size to hug
    if (v === "hug" && hasAutoLayout(child)) return "hug";
    return "fixed";
}

/** Whether a frame's own size follows its content on one axis. */
export function frameHugs(frame, axis) {
    if (!hasAutoLayout(frame) || inSlot(frame)) return false;
    var l = layoutOf(frame);
    return (axis === "w" ? l.sizeW : l.sizeH) === "hug";
}

var FLEX_ALIGN = { start: "flex-start", center: "center", end: "flex-end" };

function track(t) {
    if (!t) return "1fr";
    if (t.unit === "auto") return "auto";
    var size = num(t.size, 1);
    return t.unit === "px" ? size + "px" : size + "fr";
}

/** Grid tracks as CSS ("120px 1fr auto"). */
export function tracksCss(list) {
    return (list || []).map(track).join(" ");
}

/**
 * The CSS of a frame's own element, on top of the usual node box (position,
 * left / top / width / height): its style, and the display that lays out its
 * children. `inFlow` = the frame itself is a child in its parent's flow.
 */
export function frameCss(frame, opts) {
    var l = layoutOf(frame);
    var s = styleOf(frame);
    var css = {
        background: tokenCss(s.fill) || "",
        border: has(s.strokeWidth) && s.stroke ? pxCss(s.strokeWidth) + " solid " + tokenCss(s.stroke) : "",
        "border-radius": has(s.radius) ? pxCss(s.radius) : "",
        overflow: s.clip ? "hidden" : "",
        "overflow-x": "",
        "overflow-y": "",
        "box-sizing": "border-box"
    };
    // opts.scroll (the deployed page): a scrolling frame scrolls its overflow
    var axes = opts && opts.scroll && SCROLL_AXES[s.scroll];
    if (axes) {
        css.overflow = "";
        css["overflow-x"] = axes[0];
        css["overflow-y"] = axes[1];
    }
    // it still scrolls (wheel, touch, keys), without the bar (WebKit: the page's .nexa-no-scrollbar)
    css["scrollbar-width"] = opts && opts.scroll && s.scrollbar === "hidden" ? "none" : "";
    if (l.mode === "none") {
        css.display = "";
        css.padding = "";
        return css;
    }
    css.padding = l.padding.t + "px " + l.padding.r + "px " + l.padding.b + "px " + l.padding.l + "px";
    if (l.mode === "carousel") return Object.assign(css, carouselTrackCss(frame, opts && opts.scroll));
    if (l.mode === "grid") {
        css.display = "grid";
        css["grid-template-columns"] = tracksCss(l.columns) || "1fr";
        css["grid-template-rows"] = tracksCss(l.rows);
        css["grid-auto-rows"] = "auto";
        css["column-gap"] = pxCss(l.gap);
        css["row-gap"] = pxCss(l.rowGap !== undefined && l.rowGap !== "" ? l.rowGap : l.gap);
        css["justify-items"] = l.alignX;
        css["align-items"] = l.alignY;
        css["align-content"] = l.alignY;
        css["justify-content"] = l.alignX;
    } else {
        var horizontal = l.mode === "horizontal";
        var main = horizontal ? l.alignX : l.alignY;
        var cross = horizontal ? l.alignY : l.alignX;
        css.display = "flex";
        css["flex-direction"] = horizontal ? "row" : "column";
        css["flex-wrap"] = horizontal && l.wrap ? "wrap" : "nowrap";
        css["justify-content"] = l.gap === "auto" ? "space-between" : FLEX_ALIGN[main] || "flex-start";
        css["align-items"] = FLEX_ALIGN[cross] || "flex-start";
        css["align-content"] = FLEX_ALIGN[horizontal ? l.alignY : l.alignX] || "flex-start";
        css[horizontal ? "column-gap" : "row-gap"] = l.gap === "auto" ? "0px" : pxCss(l.gap);
        css[horizontal ? "row-gap" : "column-gap"] = horizontal && l.wrap ? pxCss(l.rowGap !== undefined && l.rowGap !== "" ? l.rowGap : l.gap) : "0px";
    }
    return css;
}

/**
 * The slides' track: a row (or column) of slides that scrolls and snaps on a
 * deployed page (live: true), clipped in the editor; a fade: one grid cell.
 */
export function carouselTrackCss(frame, live) {
    var l = layoutOf(frame), c = l.carousel;
    var horizontal = c.direction !== "vertical";
    var gap = l.gap === "auto" ? 0 : num(l.gap);
    var css = { "flex-wrap": "nowrap", "justify-content": "flex-start", "align-items": "stretch", "align-content": "",
        "column-gap": "0px", "row-gap": "0px", "grid-template-columns": "", "grid-template-rows": "", "scroll-snap-type": "", "overscroll-behavior": "", "scrollbar-width": "" };
    if (c.transition === "fade") {
        css.display = "grid";
        css["grid-template-columns"] = "100%";
        css["grid-template-rows"] = "100%";
        css.overflow = "hidden";
        css["overflow-x"] = ""; css["overflow-y"] = "";
        return css;
    }
    css.display = "flex";
    css["flex-direction"] = horizontal ? "row" : "column";
    css[horizontal ? "column-gap" : "row-gap"] = gap + "px";
    if (live) {
        css.overflow = "";
        css["overflow-x"] = horizontal ? "auto" : "hidden";
        css["overflow-y"] = horizontal ? "hidden" : "auto";
        css["scroll-snap-type"] = (horizontal ? "x" : "y") + " mandatory";
        css["overscroll-behavior"] = "contain";
        css["scrollbar-width"] = "none";
    } else {
        css.overflow = "hidden";
        css["overflow-x"] = ""; css["overflow-y"] = "";
    }
    return css;
}

/** A slide's size along the track: perView of them (and the gaps between) fill it. */
export function carouselSlideSize(frame) {
    var l = layoutOf(frame), n = l.carousel.perView;
    var gap = l.gap === "auto" ? 0 : num(l.gap);
    return gap && n !== 1 ? "calc((100% - " + (gap * (n - 1)) + "px) / " + n + ")" : (100 / n) + "%";
}

// ---- constraints (Figma) ----------------------------------------------------------
// A node its parent's layout does NOT place (the root's children, a plain
// frame's, an "absolute" one) keeps to its parent's edges when the parent's
// size changes:  node.constraints = { h: "left" | "right" | "leftRight" |
// "center" | "scale", v: "top" | "bottom" | "topBottom" | "center" | "scale" }.
// On a deployed page that's CSS (a frame that fills / hugs is a different size
// there than its design w / h); in the editor, resizing a frame moves the
// children (resizeWithConstraints).

export var H_CONSTRAINTS = ["left", "right", "leftRight", "center", "scale"];
export var V_CONSTRAINTS = ["top", "bottom", "topBottom", "center", "scale"];

export function constraintsOf(node) {
    var c = (node && node.constraints) || {};
    return { h: H_CONSTRAINTS.indexOf(c.h) === -1 ? "left" : c.h, v: V_CONSTRAINTS.indexOf(c.v) === -1 ? "top" : c.v };
}

/** Whether a node's constraints apply (a frame's or the root's child, not placed by a layout). */
export function hasConstraints(node, parent) {
    if (node && placeOf(node, parent) === "dock") return false;
    if (parent && parent.zoom && parent.zoom.enabled) return false;
    return !inSlot(node) && (!parent || parent.type === "@frame") && !isInFlow(node, parent) && !overlayOf(node);
}

/** The box children are positioned in: a frame without its border (the root: the screen). */
export function innerSize(frame) {
    var s = styleOf(frame);
    var bw = num(s.strokeWidth) > 0 && s.stroke ? num(s.strokeWidth) : 0;
    var w = num(frame && (frame.w != null ? frame.w : frame.width), 0);
    var h = num(frame && (frame.h != null ? frame.h : frame.height), 0);
    return { w: w ? w - 2 * bw : 0, h: h ? h - 2 * bw : 0 };
}

function axisCss(mode, pos, size, parentSize, startProp, endProp, sizeProp) {
    var css = {};
    var end = parentSize - pos - size;
    css[startProp] = pos + "px"; css[endProp] = ""; css[sizeProp] = size + "px";
    if (mode === "right" || mode === "bottom") { css[startProp] = "auto"; css[endProp] = Math.max(0, end) + "px"; }
    else if (mode === "leftRight" || mode === "topBottom") { css[endProp] = Math.max(0, end) + "px"; css[sizeProp] = "auto"; }
    else if (mode === "center") css[startProp] = "calc(50% + " + (pos - parentSize / 2) + "px)";
    else if (mode === "scale" && parentSize > 0) {
        css[startProp] = (pos / parentSize * 100) + "%";
        css[sizeProp] = (size / parentSize * 100) + "%";
    }
    return css;
}

/** The CSS that keeps a node to its parent's edges (parentSize: the parent's inner size at design time). */
export function constraintCss(node, parentSize, explicitConstraints) {
    var c = explicitConstraints || constraintsOf(node);
    var h = axisCss(c.h, num(node.x), num(node.w), parentSize.w, "left", "right", "width");
    var v = axisCss(c.v, num(node.y), num(node.h), parentSize.h, "top", "bottom", "height");
    return Object.assign(h, v);
}

function axisResize(mode, pos, size, oldP, newP) {
    var d = newP - oldP;
    if (mode === "right" || mode === "bottom") return [pos + d, size];
    if (mode === "leftRight" || mode === "topBottom") return [pos, Math.max(1, size + d)];
    if (mode === "center") return [pos + d / 2, size];
    if (mode === "scale" && oldP > 0) return [pos * newP / oldP, Math.max(1, size * newP / oldP)];
    return [pos, size];
}

/** A node's box after its parent's inner size went from oldP to newP ({ w, h }). */
export function resizeWithConstraints(box, constraints, oldP, newP) {
    var c = constraints || { h: "left", v: "top" };
    var h = axisResize(c.h, box.x, box.w, oldP.w, newP.w);
    var v = axisResize(c.v, box.y, box.h, oldP.h, newP.h);
    return { x: Math.round(h[0]), y: Math.round(v[0]), w: Math.round(h[1]), h: Math.round(v[1]) };
}

/**
 * Infers edge anchoring for nodes without explicit constraints.
 * If closer to the far edge than the near edge (and the axis is not scrollable),
 * anchors to the right / bottom edge so it stays in the corner on responsive screens.
 */
export function inferNodeConstraints(node, parent, ps) {
    if (node && node.constraints && (node.constraints.h || node.constraints.v)) {
        return constraintsOf(node);
    }
    if (!ps || ps.w <= 0 || ps.h <= 0) return constraintsOf(node);
    if (parent && parent.zoom && parent.zoom.enabled) return constraintsOf(node);
    var pStyle = (parent && styleOf(parent)) || {};
    var pScroll = pStyle.scroll || "none";
    var nearX = num(node.x), farX = ps.w - nearX - num(node.w);
    var nearY = num(node.y), farY = ps.h - nearY - num(node.h);
    var h = (pScroll !== "horizontal" && pScroll !== "both" && farX >= 0 && farX < nearX) ? "right" : "left";
    var v = (pScroll !== "vertical" && pScroll !== "both" && farY >= 0 && farY < nearY) ? "bottom" : "top";
    return { h: h, v: v };
}

/**
 * The box CSS of a node — replaces the plain absolute box (left / top /
 * width / height) where the parent's layout or the node's own hug decides.
 * opts.constraints (the deployed page): a node's constraints become CSS;
 * opts.parentSize = the screen's size for a root node.
 */
export function boxCss(node, parent, opts) {
    // a slot frame fills its slot (the component's box for it: position: relative)
    if (inSlot(node)) {
        return { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", right: "", bottom: "", flex: "", "align-self": "", "justify-self": "",
            "grid-column": "", "grid-row": "", "min-width": "", "max-width": "", "min-height": "", "max-height": "", "scroll-snap-align": "", "z-index": "" };
    }
    var css = {
        position: "absolute",
        left: num(node.x) + "px",
        top: num(node.y) + "px",
        width: num(node.w) + "px",
        height: num(node.h) + "px",
        right: "",
        bottom: "",
        flex: "",
        "align-self": "",
        "justify-self": "",
        "grid-column": "",
        "grid-row": "",
        "min-width": node.minW ? num(node.minW) + "px" : "",
        "max-width": node.maxW ? num(node.maxW) + "px" : "",
        "min-height": node.minH ? num(node.minH) + "px" : "",
        "max-height": node.maxH ? num(node.maxH) + "px" : "",
        "scroll-snap-align": "",
        "z-index": ""
    };
    if (opts && opts.constraints && hasConstraints(node, parent)) {
        var ps = parent ? innerSize(parent) : opts.parentSize;
        var c = inferNodeConstraints(node, parent, ps);
        if (ps && (c.h !== "left" || c.v !== "top")) Object.assign(css, constraintCss(node, ps, c));
    }
    // a frame that hugs its content has no fixed size on that axis
    if (frameHugs(node, "w")) css.width = "max-content";
    if (frameHugs(node, "h")) css.height = "max-content";
    // margin (space around it), padding (a component's space inside), its layer (z)
    // (margin: in a layout the space around it, docked its distance from the edges; a free
    // node's own x / y say where it is)
    var mg = marginOf(node), pd = paddingOf(node), place = placeOf(node, parent);
    css.margin = place === "flow" && hasSides(mg) ? pxSides(mg) : "";
    if (takesPadding(node)) css.padding = hasSides(pd) ? pxSides(pd) : "";
    if (zOf(node)) css["z-index"] = String(zOf(node));
    if (place === "dock") return dockCss(node, css);
    if (!isInFlow(node, parent)) return css;

    var mode = layoutOf(parent).mode;
    var sw = childSizing(node, "w"), sh = childSizing(node, "h");
    css.position = "relative";
    css.left = "auto";
    css.top = "auto";
    css.right = "";
    css.bottom = "";
    // sticky while its frame scrolls (a header in a scrolling column): it stays at the edge
    if (node.scrollBehavior === "sticky") {
        css.position = "sticky";
        css[flowAxis(parent) === "horizontal" ? "left" : "top"] = "0px";
        css["z-index"] = zOf(node) ? String(zOf(node)) : "2";
    }
    if (mode === "carousel") {
        // a slide: perView of them fill the track; the other axis is the track's
        var c = layoutOf(parent).carousel, alongX = c.direction !== "vertical";
        css.flex = "0 0 auto";
        // (grid-column / grid-row, not the grid-area shorthand: that would reset a grid child's span)
        if (c.transition === "fade") { css["grid-column"] = "1"; css["grid-row"] = "1"; css.width = "100%"; css.height = "100%"; return css; }
        css[alongX ? "width" : "height"] = carouselSlideSize(parent);
        css[alongX ? "height" : "width"] = "auto";
        css["align-self"] = "stretch";
        css[alongX ? "min-width" : "min-height"] = "0px";
        css["scroll-snap-align"] = "start";
        return css;
    }
    if (mode === "grid") {
        var lc = node.layoutChild || {};
        if (lc.col) css["grid-column"] = num(lc.col, 1) + (lc.colSpan > 1 ? " / span " + num(lc.colSpan, 1) : "");
        else if (lc.colSpan > 1) css["grid-column"] = "span " + num(lc.colSpan, 1);
        if (lc.row) css["grid-row"] = num(lc.row, 1) + (lc.rowSpan > 1 ? " / span " + num(lc.rowSpan, 1) : "");
        else if (lc.rowSpan > 1) css["grid-row"] = "span " + num(lc.rowSpan, 1);
        if (sw === "fill") { css.width = "auto"; css["justify-self"] = "stretch"; }
        else if (sw === "hug") css.width = "max-content";
        if (sh === "fill") { css.height = "auto"; css["align-self"] = "stretch"; }
        else if (sh === "hug") css.height = "max-content";
        return css;
    }
    var horizontal = mode === "horizontal";
    var mainSizing = horizontal ? sw : sh, crossSizing = horizontal ? sh : sw;
    var mainProp = horizontal ? "width" : "height", crossProp = horizontal ? "height" : "width";
    if (mainSizing === "fill") {
        css.flex = "1 1 0px";
        css[mainProp] = "auto";
        css[horizontal ? "min-width" : "min-height"] = css[horizontal ? "min-width" : "min-height"] || "0px";
    } else {
        css.flex = "0 0 auto";
        if (mainSizing === "hug") css[mainProp] = "max-content";
    }
    if (crossSizing === "fill") { css["align-self"] = "stretch"; css[crossProp] = "auto"; }
    else if (crossSizing === "hug") css[crossProp] = "max-content";
    return css;
}

/** Whether a node may be rotated (not while its parent's layout places it). */
export function canRotate(node, parent) {
    return !isInFlow(node, parent) && !inSlot(node);
}

/** A new frame (without id / x / y). */
export function makeFrame(mode, w, h) {
    var frame = { type: "@frame", w: w || 240, h: h || 160, children: [], style: { fill: "#ffffff", stroke: "#d0d0d0", strokeWidth: 1, radius: 4, clip: false } };
    if (mode === "carousel") {
        // edge to edge, clipped: the slides are the content
        frame.layout = { mode: "carousel", padding: { t: 0, r: 0, b: 0, l: 0 }, gap: 0, carousel: Object.assign({}, CAROUSEL_DEFAULT) };
        frame.style.clip = true;
        frame.style.stroke = "";
        frame.style.strokeWidth = 0;
    } else if (mode && mode !== "none") {
        frame.layout = { mode: mode, padding: { t: 8, r: 8, b: 8, l: 8 }, gap: 8 };
        if (mode === "grid") frame.layout.columns = [{ size: 1, unit: "fr" }, { size: 1, unit: "fr" }];
    }
    return frame;
}
