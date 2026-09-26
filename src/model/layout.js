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

export var LAYOUT_MODES = ["none", "horizontal", "vertical", "grid"];

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
    sizeH: "fixed"
};

var DEFAULT_STYLE = { fill: "", stroke: "", strokeWidth: 0, radius: 0, clip: false };

function num(v, d) {
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : (d || 0);
}

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
    return out;
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
export function isInFlow(child, parent) {
    return hasAutoLayout(parent) && !(child && child.layoutChild && child.layoutChild.absolute);
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
    if (!hasAutoLayout(frame)) return false;
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
export function frameCss(frame) {
    var l = layoutOf(frame);
    var s = styleOf(frame);
    var css = {
        background: s.fill || "",
        border: num(s.strokeWidth) > 0 && s.stroke ? num(s.strokeWidth) + "px solid " + s.stroke : "",
        "border-radius": num(s.radius) ? num(s.radius) + "px" : "",
        overflow: s.clip ? "hidden" : "",
        "box-sizing": "border-box"
    };
    if (l.mode === "none") {
        css.display = "";
        css.padding = "";
        return css;
    }
    css.padding = l.padding.t + "px " + l.padding.r + "px " + l.padding.b + "px " + l.padding.l + "px";
    if (l.mode === "grid") {
        css.display = "grid";
        css["grid-template-columns"] = tracksCss(l.columns) || "1fr";
        css["grid-template-rows"] = tracksCss(l.rows);
        css["grid-auto-rows"] = "auto";
        css["column-gap"] = num(l.gap) + "px";
        css["row-gap"] = num(l.rowGap !== undefined && l.rowGap !== "" ? l.rowGap : l.gap) + "px";
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
        var gap = l.gap === "auto" ? 0 : num(l.gap);
        css[horizontal ? "column-gap" : "row-gap"] = gap + "px";
        css[horizontal ? "row-gap" : "column-gap"] = (horizontal && l.wrap ? num(l.rowGap !== undefined && l.rowGap !== "" ? l.rowGap : l.gap) : 0) + "px";
    }
    return css;
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
    return (!parent || parent.type === "@frame") && !isInFlow(node, parent);
}

/** The box children are positioned in: a frame without its border (the root: the screen). */
export function innerSize(frame) {
    var s = styleOf(frame);
    var bw = num(s.strokeWidth) > 0 && s.stroke ? num(s.strokeWidth) : 0;
    return { w: num(frame.w) - 2 * bw, h: num(frame.h) - 2 * bw };
}

function axisCss(mode, pos, size, parentSize, startProp, endProp, sizeProp) {
    var css = {};
    var end = parentSize - pos - size;
    css[startProp] = pos + "px"; css[endProp] = ""; css[sizeProp] = size + "px";
    if (mode === "right" || mode === "bottom") { css[startProp] = "auto"; css[endProp] = end + "px"; }
    else if (mode === "leftRight" || mode === "topBottom") { css[endProp] = end + "px"; css[sizeProp] = "auto"; }
    else if (mode === "center") css[startProp] = "calc(50% + " + (pos - parentSize / 2) + "px)";
    else if (mode === "scale" && parentSize > 0) {
        css[startProp] = (pos / parentSize * 100) + "%";
        css[sizeProp] = (size / parentSize * 100) + "%";
    }
    return css;
}

/** The CSS that keeps a node to its parent's edges (parentSize: the parent's inner size at design time). */
export function constraintCss(node, parentSize) {
    var c = constraintsOf(node);
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
 * The box CSS of a node — replaces the plain absolute box (left / top /
 * width / height) where the parent's layout or the node's own hug decides.
 * opts.constraints (the deployed page): a node's constraints become CSS;
 * opts.parentSize = the screen's size for a root node.
 */
export function boxCss(node, parent, opts) {
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
        "max-height": node.maxH ? num(node.maxH) + "px" : ""
    };
    if (opts && opts.constraints && hasConstraints(node, parent)) {
        var ps = parent ? innerSize(parent) : opts.parentSize;
        var c = constraintsOf(node);
        if (ps && (c.h !== "left" || c.v !== "top")) Object.assign(css, constraintCss(node, ps));
    }
    // a frame that hugs its content has no fixed size on that axis
    if (frameHugs(node, "w")) css.width = "max-content";
    if (frameHugs(node, "h")) css.height = "max-content";
    if (!isInFlow(node, parent)) return css;

    var mode = layoutOf(parent).mode;
    var sw = childSizing(node, "w"), sh = childSizing(node, "h");
    css.position = "relative";
    css.left = "auto";
    css.top = "auto";
    css.right = "";
    css.bottom = "";
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
    return !isInFlow(node, parent);
}

/** A new frame (without id / x / y). */
export function makeFrame(mode, w, h) {
    var frame = { type: "@frame", w: w || 240, h: h || 160, children: [], style: { fill: "#ffffff", stroke: "#d0d0d0", strokeWidth: 1, radius: 4, clip: false } };
    if (mode && mode !== "none") {
        frame.layout = { mode: mode, padding: { t: 8, r: 8, b: 8, l: 8 }, gap: 8 };
        if (mode === "grid") frame.layout.columns = [{ size: 1, unit: "fr" }, { size: 1, unit: "fr" }];
    }
    return frame;
}
