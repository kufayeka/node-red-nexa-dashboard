// --- Frame + auto layout inspector (property kit) -------------------------------
// Two blocks, both rendered by the property kit (NexaKit.renderInspector) from
// a schema, so they look like every component's inspector:
//   renderFrameInspector       an @frame: box, auto layout (mode, sizing,
//                              alignment, gap, padding, wrap, grid tracks), fill & stroke
//   renderLayoutChildInspector a node its parent's auto layout places: sizing
//                              per axis (fixed / fill / hug), absolute, grid cell, min / max
// The kit edits a flat view of the node; each change is written back into the
// node (src/model/layout.js) as one undo step, then the screen re-renders (the
// browser re-flows the layout, see canvas/layout-readback.js).
import { getActiveScreen, markDirty, Tree, Layout, isNodeLocked } from "../state.js";
import { pushTreeChange, treeSnapshot } from "../history.js";
import { renderActiveScreen, redrawCanvas } from "../canvas/canvas-ui.js";
import { selectOnly } from "../canvas/selection.js";
import { constrainFrameChildren } from "../canvas/constraints.js";
import { responsiveHost } from "../canvas/breakpoints-ui.js";

// What a breakpoint may change (src/model/breakpoints.js OVERRIDABLE): not the zoom, not
// the variable a carousel's slide goes to
function framePartVaries(key) { return !/^z[A-Z]/.test(key) && key !== "cIndex"; }

var SIZING_FRAME = [{ value: "fixed", label: "Fixed" }, { value: "hug", label: "Hug" }];
var SIZING_CHILD = [{ value: "fixed", label: "Fixed" }, { value: "fill", label: "Fill" }, { value: "hug", label: "Hug" }];
var TRACK = { row: true, fields: { size: { type: "number", default: 1, min: 0 }, unit: { type: "enum", default: "fr", options: [{ value: "fr", label: "fr" }, { value: "px", label: "px" }, { value: "auto", label: "auto" }] } } };

function prop(key, type, label, extra) {
    return Object.assign({ key: key, type: type, label: label, default: undefined, noReset: true }, extra || {});
}

var FRAME_META = {
    id: "@frame",
    stateList: [], inputs: [], outputs: [],
    props: {
        x: prop("x", "number", "X"), y: prop("y", "number", "Y"),
        w: prop("w", "number", "W", { min: 1 }), h: prop("h", "number", "H", { min: 1 }),
        mode: prop("mode", "enum", "Auto layout", { options: [
            { value: "none", label: "None", icon: "fa fa-ban" },
            { value: "horizontal", label: "Row", icon: "fa fa-long-arrow-right" },
            { value: "vertical", label: "Column", icon: "fa fa-long-arrow-down" },
            { value: "grid", label: "Grid", icon: "fa fa-th" },
            { value: "carousel", label: "Carousel", icon: "fa fa-film" }] }),
        // a carousel's settings (layout.carousel)
        cDirection: prop("cDirection", "enum", "Direction", { options: [{ value: "horizontal", label: "Across" }, { value: "vertical", label: "Down" }] }),
        cPerView: prop("cPerView", "number", "Slides in view", { min: 0.1, step: 0.1, help: "1.2: the next slide peeks in" }),
        cTransition: prop("cTransition", "enum", "Transition", { options: [{ value: "slide", label: "Slide" }, { value: "fade", label: "Fade" }] }),
        cLoop: prop("cLoop", "boolean", "Loop (after the last, the first)"),
        cAutoplay: prop("cAutoplay", "number", "Autoplay every", { min: 0, step: 500, unit: "ms", help: "0 = off" }),
        cPauseOnHover: prop("cPauseOnHover", "boolean", "Pause while the pointer is over it"),
        cArrows: prop("cArrows", "boolean", "Arrows"),
        cDots: prop("cDots", "boolean", "Dots"),
        cSwipe: prop("cSwipe", "boolean", "Swipe / drag"),
        cIndex: prop("cIndex", "string", "Current slide → variable", { placeholder: "e.g. slide", help: "A declared variable: it holds the slide shown (0, 1, …); set it (Set Variable) to go to a slide." }),
        sizeW: prop("sizeW", "enum", "Width", { options: SIZING_FRAME }),
        sizeH: prop("sizeH", "enum", "Height", { options: SIZING_FRAME }),
        align: prop("align", "align", "Alignment"),
        gap: prop("gap", "number", "Gap", { min: 0, unit: "px" }),
        gapAuto: prop("gapAuto", "boolean", "Space between"),
        rowGap: prop("rowGap", "number", "Row gap", { min: 0, unit: "px", placeholder: "= gap" }),
        padding: prop("padding", "spacing", "Padding"),
        wrap: prop("wrap", "boolean", "Wrap"),
        columns: prop("columns", "list", "Columns", { item: TRACK }),
        rows: prop("rows", "list", "Rows (empty = as needed)", { item: TRACK }),
        fill: prop("fill", "color", "Fill"),
        stroke: prop("stroke", "color", "Stroke"),
        strokeWidth: prop("strokeWidth", "number", "Stroke width", { min: 0, unit: "px" }),
        radius: prop("radius", "number", "Corner radius", { min: 0, unit: "px" }),
        clip: prop("clip", "boolean", "Clip content"),
        scrollbarHidden: prop("scrollbarHidden", "boolean", "Hide the scrollbar (it still scrolls)"),
        // zoom & pan of what is inside (live page)
        zEnabled: prop("zEnabled", "boolean", "Zoomable: its content zooms and pans (live page)"),
        zMin: prop("zMin", "number", "Min zoom", { min: 5, max: 100, step: 5, unit: "%" }),
        zMax: prop("zMax", "number", "Max zoom", { min: 100, max: 2000, step: 50, unit: "%" }),
        zStart: prop("zStart", "enum", "Starts", { options: [{ value: "fit", label: "Fit" }, { value: "100", label: "100 %" }] }),
        zWheel: prop("zWheel", "boolean", "The mouse wheel zooms without Ctrl"),
        zControls: prop("zControls", "boolean", "Show the zoom toolbar (− 100% ○ + ⤢)"),
        zDbl: prop("zDbl", "boolean", "Double-click / double-tap: back to the start"),
        // a carousel's slide cell: padding inside it, a fixed-size template aligned in it
        iPadX: prop("iPadX", "number", "Padding ↔", { min: 0, unit: "px" }),
        iPadY: prop("iPadY", "number", "Padding ↕", { min: 0, unit: "px" }),
        iAlign: prop("iAlign", "align", "Align in the slide"),
        scroll: prop("scroll", "enum", "Scroll (live page)", { options: [
            { value: "none", label: "No scrolling" }, { value: "vertical", label: "Vertical" },
            { value: "horizontal", label: "Horizontal" }, { value: "both", label: "Both directions" }] })
    }
};

var CHILD_META = {
    id: "@layout-child",
    stateList: [], inputs: [], outputs: [],
    props: {
        childW: prop("childW", "enum", "Width", { options: SIZING_CHILD }),
        childH: prop("childH", "enum", "Height", { options: SIZING_CHILD }),
        absolute: prop("absolute", "boolean", "Absolute position (out of the layout)"),
        sticky: prop("sticky", "boolean", "Sticky while the frame scrolls (stays at its edge)"),
        col: prop("col", "number", "Column", { min: 0, help: "0 = next free cell" }),
        row: prop("row", "number", "Row", { min: 0 }),
        colSpan: prop("colSpan", "number", "Column span", { min: 1 }),
        rowSpan: prop("rowSpan", "number", "Row span", { min: 1 }),
        minW: prop("minW", "number", "Min W", { min: 0 }), maxW: prop("maxW", "number", "Max W", { min: 0 }),
        minH: prop("minH", "number", "Min H", { min: 0 }), maxH: prop("maxH", "number", "Max H", { min: 0 })
    }
};

function frameView(frame) {
    var l = Layout.layoutOf(frame), s = Layout.styleOf(frame);
    return {
        x: frame.x, y: frame.y, w: frame.w, h: frame.h,
        mode: l.mode, sizeW: l.sizeW, sizeH: l.sizeH,
        align: { x: l.alignX, y: l.alignY },
        gap: l.gap === "auto" ? 0 : l.gap, gapAuto: l.gap === "auto", rowGap: l.rowGap === undefined ? "" : l.rowGap,
        padding: l.padding, wrap: !!l.wrap, columns: l.columns, rows: l.rows,
        fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, radius: s.radius,
        clip: !!s.clip || !!(frame.zoom && frame.zoom.enabled), scroll: frame.zoom && frame.zoom.enabled ? "both" : (s.scroll || "none"),
        cDirection: l.carousel.direction, cPerView: l.carousel.perView, cTransition: l.carousel.transition, cLoop: !!l.carousel.loop,
        cAutoplay: l.carousel.autoplay, cPauseOnHover: !!l.carousel.pauseOnHover, cArrows: !!l.carousel.arrows, cDots: !!l.carousel.dots,
        cSwipe: !!l.carousel.swipe, cIndex: l.carousel.index || "",
        scrollbarHidden: s.scrollbar === "hidden",
        zEnabled: !!(frame.zoom && frame.zoom.enabled), zMin: Math.round(zoomSettings(frame).min * 100), zMax: Math.round(zoomSettings(frame).max * 100),
        zStart: zoomSettings(frame).start, zWheel: zoomSettings(frame).wheel === "always", zControls: !!zoomSettings(frame).controls,
        zDbl: zoomSettings(frame).dblclick !== false,
        iPadX: l.items.padX, iPadY: l.items.padY, iAlign: { x: l.items.alignX, y: l.items.alignY }
    };
}

function zoomSettings(frame) { return Object.assign({}, Layout.ZOOM_DEFAULT, frame.zoom || {}); }

function writeFrame(frame, key, v) {
    if (/^z[A-Z]/.test(key)) {
        var z = zoomSettings(frame);
        if (key === "zEnabled") z.enabled = !!v;
        else if (key === "zMin") z.min = Math.max(0.05, (Number(v) || 25) / 100);
        else if (key === "zMax") z.max = Math.max(1, (Number(v) || 400) / 100);
        else if (key === "zStart") z.start = v;
        else if (key === "zWheel") z.wheel = v ? "always" : "ctrl";
        else if (key === "zControls") z.controls = !!v;
        else if (key === "zDbl") z.dblclick = !!v;
        if (z.enabled) frame.zoom = z; else delete frame.zoom;
        return;
    }
    var layout = Object.assign({}, frame.layout || {});
    var style = Object.assign({}, frame.style || {});
    switch (key) {
        case "x": case "y": frame[key] = Number(v) || 0; return;
        case "w": case "h": {
            var old = { w: frame.w, h: frame.h };
            frame[key] = Math.max(1, Number(v) || 0);
            constrainFrameChildren(frame, old);   // its children keep to its edges
            return;
        }
        case "align": layout.alignX = v.x; layout.alignY = v.y; break;
        case "gapAuto": layout.gap = v ? "auto" : 0; break;
        case "gap": layout.gap = Number(v) || 0; break;
        case "mode":
            layout.mode = v;
            // a new auto layout starts with some breathing room (a carousel: edge to edge, clipped)
            if (v === "carousel") { layout.carousel = Object.assign({}, Layout.CAROUSEL_DEFAULT, layout.carousel || {}); style.clip = true; }
            else if (v !== "none" && !frame.layout) { layout.padding = { t: 8, r: 8, b: 8, l: 8 }; layout.gap = 8; }
            break;
        case "cDirection": case "cPerView": case "cTransition": case "cLoop": case "cAutoplay": case "cPauseOnHover":
        case "cArrows": case "cDots": case "cSwipe": case "cIndex": {
            var ck = key.charAt(1).toLowerCase() + key.slice(2);
            var cv = ck === "perView" ? Math.max(0.1, Number(v) || 1) : ck === "autoplay" ? Math.max(0, Number(v) || 0) : ck === "index" ? String(v || "").trim() : v;
            layout.carousel = Object.assign({}, Layout.CAROUSEL_DEFAULT, layout.carousel || {}, { [ck]: cv });
            break;
        }
        case "fill": case "stroke": case "strokeWidth": case "radius": case "clip": style[key] = v; break;
        case "scroll": if (v === "none") delete style.scroll; else style.scroll = v; break;
        case "scrollbarHidden": if (v) style.scrollbar = "hidden"; else delete style.scrollbar; break;
        case "iPadX": case "iPadY": case "iAlign": {
            var items = Object.assign({}, Layout.ITEMS_DEFAULT, layout.items || {});
            if (key === "iPadX") items.padX = Math.max(0, Number(v) || 0); else if (key === "iPadY") items.padY = Math.max(0, Number(v) || 0);
            else { items.alignX = v.x; items.alignY = v.y; }
            layout.items = items;
            break;
        }
        default: layout[key] = v;
    }
    frame.layout = layout;
    frame.style = style;
}

function childView(node) {
    var lc = node.layoutChild || {};
    return {
        childW: lc.w || "fixed", childH: lc.h || "fixed", absolute: !!lc.absolute, sticky: node.scrollBehavior === "sticky",
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
    var map = { childW: "w", childH: "h" };
    var k = map[key] || key;
    if (v === "fixed" || v === false || v === 0 || (k.indexOf("Span") !== -1 && Number(v) <= 1)) delete lc[k];
    else lc[k] = typeof v === "string" || typeof v === "boolean" ? v : Number(v);
    if (Object.keys(lc).length) node.layoutChild = lc; else delete node.layoutChild;
}

// One edit = one undo step, then the layout re-flows. Only the canvas is
// redrawn: the panel you are typing in stays (a full rebuild would throw you
// out of the field). `rebuild`: the edit changes which blocks the panel shows.
function commit(node, fn, rebuild) {
    var screen = getActiveScreen();
    if (!screen || isNodeLocked(node.id)) return;
    var before = treeSnapshot(screen);
    fn();
    Tree.refitGroupsUp(screen, node.id);
    pushTreeChange(screen, before);
    markDirty();
    if (rebuild) { renderActiveScreen(); selectOnly(node.id); }
    else redrawCanvas();    // re-flow (and read the boxes back); selection and panel stay
}

// A kit inspector over a view of the node, kept in step after every edit.
// `r` = { node, parent, view(n), write(n, key, v), canVary(key) }: its values per breakpoint.
function mountLive(container, meta, persistKey, view, onSet, r) {
    var current = view();
    var refresh = function () {
        Object.keys(current).forEach(function (k) { delete current[k]; });
        Object.assign(current, view());
        handle.update();
    };
    var screen = getActiveScreen();
    var responsive = r && screen ? responsiveHost(r.node, r.parent, r.view, r.write, r.canVary,
        function (fn) { commit(r.node, fn); refresh(); }) : null;
    var handle = window.NexaKit.renderInspector(container.jquery ? container.get(0) : container, {
        meta: meta,
        props: current,
        persistKey: persistKey,
        responsive: responsive,
        set: function (key, v) {
            onSet(key, v);
            refresh();
        }
    });
    return handle;
}

function lit() { return window.NEXA_LIT; }

export function renderFrameInspector(container, frame) {
    if (!window.NexaKit || !lit()) return false;
    var html = lit().html, nothing = lit().nothing;
    var meta = Object.assign({}, FRAME_META, {
        inspector: function (o) {
            var p = o.p, bind = o.bind;
            var auto = p.mode !== "none";
            return html`
                <nx-section heading="Frame" persist-key="nexa-frame:box">
                    <nx-row><nx-number ${bind("x")}></nx-number><nx-number ${bind("y")}></nx-number></nx-row>
                    <nx-row><nx-number ${bind("w")} ?disabled="${auto && p.sizeW === "hug"}"></nx-number><nx-number ${bind("h")} ?disabled="${auto && p.sizeH === "hug"}"></nx-number></nx-row>
                </nx-section>
                <nx-section heading="Auto layout" persist-key="nexa-frame:layout">
                    <nx-segmented ${bind("mode")} icons-only></nx-segmented>
                    ${auto ? html`
                        <nx-row><nx-segmented ${bind("sizeW")}></nx-segmented><nx-segmented ${bind("sizeH")}></nx-segmented></nx-row>
                        <nx-row>
                            <nx-align ${bind("align")}></nx-align>
                            <div>
                                <nx-number ${bind("gap")} ?disabled="${p.gapAuto}"></nx-number>
                                ${p.mode !== "grid" ? html`<nx-checkbox ${bind("gapAuto")}></nx-checkbox>` : nothing}
                            </div>
                        </nx-row>
                        <nx-spacing ${bind("padding")}></nx-spacing>
                        ${p.mode === "horizontal" ? html`<nx-row><nx-checkbox ${bind("wrap")}></nx-checkbox>${p.wrap ? html`<nx-number ${bind("rowGap")}></nx-number>` : nothing}</nx-row>` : nothing}
                        ${p.mode === "carousel" ? html`
                            <nx-row><nx-segmented ${bind("cTransition")}></nx-segmented>${p.cTransition !== "fade" ? html`<nx-segmented ${bind("cDirection")}></nx-segmented>` : nothing}</nx-row>
                            ${p.cTransition !== "fade" ? html`<nx-number ${bind("cPerView")}></nx-number>` : nothing}
                            <nx-row><nx-checkbox ${bind("cArrows")}></nx-checkbox><nx-checkbox ${bind("cDots")}></nx-checkbox></nx-row>
                            <nx-row><nx-checkbox ${bind("cLoop")}></nx-checkbox><nx-checkbox ${bind("cSwipe")}></nx-checkbox></nx-row>
                            <nx-number ${bind("cAutoplay")}></nx-number>
                            ${Number(p.cAutoplay) > 0 ? html`<nx-checkbox ${bind("cPauseOnHover")}></nx-checkbox>` : nothing}
                            <nx-text ${bind("cIndex")}></nx-text>
                            <div class="nx-help">Slides: this frame's children, or the copies a Populate puts in it (wire it to this frame's Layout node).</div>` : nothing}
                        ${p.mode === "grid" ? html`<nx-list ${bind("columns")}></nx-list><nx-list ${bind("rows")}></nx-list><nx-number ${bind("rowGap")}></nx-number>` : nothing}
                    ` : nothing}
                </nx-section>
                ${p.mode === "carousel" ? html`<nx-section heading="Slides" persist-key="nexa-frame:items">
                    <div class="nx-help">Each slide is a cell: padding inside it, and a template of a fixed size aligned in it. Fixed or filling is the template's own setting (Templates → On the live page).</div>
                    <nx-row><nx-number ${bind("iPadX")}></nx-number><nx-number ${bind("iPadY")}></nx-number></nx-row>
                    <nx-align ${bind("iAlign")}></nx-align>
                </nx-section>` : nothing}
                <nx-section heading="Fill & stroke" persist-key="nexa-frame:style">
                    <nx-row><nx-color ${bind("fill")}></nx-color><nx-number ${bind("radius")}></nx-number></nx-row>
                    <nx-row><nx-color ${bind("stroke")}></nx-color><nx-number ${bind("strokeWidth")}></nx-number></nx-row>
                    <nx-checkbox ${bind("clip")} ?disabled="${p.zEnabled}"></nx-checkbox>
                    <nx-select ${bind("scroll")} ?disabled="${p.zEnabled}"></nx-select>
                    ${p.zEnabled ? html`<div class="nx-help">Zoomable: it always clips and scrolls both ways.</div>` : nothing}
                    ${p.scroll !== "none" || p.zEnabled ? html`<nx-checkbox ${bind("scrollbarHidden")}></nx-checkbox>` : nothing}
                </nx-section>
                ${p.mode === "carousel" ? nothing : html`<nx-section heading="Zoom & pan" persist-key="nexa-frame:zoom">
                    <nx-checkbox ${bind("zEnabled")}></nx-checkbox>
                    ${p.zEnabled ? html`
                        <div class="nx-help">Like the editor's canvas, on the live page: the frame clips and scrolls both ways (always, while zoomable); only its content zooms (Ctrl + wheel, a pinch, at the pointer) and pans (the wheel, a drag on the background) — the scrollbars' length follows the zoom. The rest of the screen keeps its size.</div>
                        <nx-row><nx-number ${bind("zMin")}></nx-number><nx-number ${bind("zMax")}></nx-number></nx-row>
                        <nx-segmented ${bind("zStart")}></nx-segmented>
                        <nx-checkbox ${bind("zDbl")}></nx-checkbox>
                        <nx-checkbox ${bind("zWheel")}></nx-checkbox>
                        <nx-checkbox ${bind("zControls")}></nx-checkbox>` : nothing}
                </nx-section>`}`;
        }
    });
    mountLive(container, meta, "nexa-frame", function () { return frameView(frame); },
        function (key, v) { commit(frame, function () { writeFrame(frame, key, v); }); },
        { node: frame, parent: Tree.parentOf(getActiveScreen(), frame.id), view: frameView, write: writeFrame, canVary: framePartVaries });
    return true;
}

export function renderLayoutChildInspector(container, node, parent) {
    if (!window.NexaKit || !lit() || !Layout.hasAutoLayout(parent)) return false;
    var html = lit().html, nothing = lit().nothing;
    var grid = Layout.layoutOf(parent).mode === "grid";
    var canHug = Layout.hasAutoLayout(node);
    var options = canHug ? SIZING_CHILD : SIZING_CHILD.filter(function (o) { return o.value !== "hug"; });
    var meta = Object.assign({}, CHILD_META, {
        props: Object.assign({}, CHILD_META.props, {
            childW: Object.assign({}, CHILD_META.props.childW, { options: options }),
            childH: Object.assign({}, CHILD_META.props.childH, { options: options })
        }),
        inspector: function (o) {
            var p = o.p, bind = o.bind;
            return html`
                <nx-section heading="In ${parent.name || "frame"} (auto layout)" persist-key="nexa-layout-child">
                    <nx-checkbox ${bind("absolute")}></nx-checkbox>
                    ${p.absolute ? nothing : html`
                        <nx-row><nx-segmented ${bind("childW")}></nx-segmented><nx-segmented ${bind("childH")}></nx-segmented></nx-row>
                        ${grid ? html`
                            <nx-row><nx-number ${bind("col")}></nx-number><nx-number ${bind("row")}></nx-number></nx-row>
                            <nx-row><nx-number ${bind("colSpan")}></nx-number><nx-number ${bind("rowSpan")}></nx-number></nx-row>` : nothing}
                        <nx-row><nx-number ${bind("minW")}></nx-number><nx-number ${bind("maxW")}></nx-number></nx-row>
                        <nx-row><nx-number ${bind("minH")}></nx-number><nx-number ${bind("maxH")}></nx-number></nx-row>
                        <nx-checkbox ${bind("sticky")}></nx-checkbox>`}
                </nx-section>`;
        }
    });
    // "absolute" moves the node out of the flow: the Constraints block appears / goes
    mountLive(container, meta, "nexa-layout-child", function () { return childView(node); },
        function (key, v) { commit(node, function () { writeChild(node, key, v); }, key === "absolute"); },
        { node: node, parent: parent, view: childView, write: writeChild });
    return true;
}

var CONSTRAINT_META = {
    id: "@constraints",
    stateList: [], inputs: [], outputs: [],
    props: {
        h: prop("h", "enum", "Horizontal", { options: [
            { value: "left", label: "Left" }, { value: "right", label: "Right" }, { value: "leftRight", label: "Left & right" },
            { value: "center", label: "Center" }, { value: "scale", label: "Scale" }] }),
        v: prop("v", "enum", "Vertical", { options: [
            { value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }, { value: "topBottom", label: "Top & bottom" },
            { value: "center", label: "Center" }, { value: "scale", label: "Scale" }] }),
        scrollBehavior: prop("scrollBehavior", "enum", "When scrolling (live page)", { options: [
            { value: "scrolls", label: "Scrolls with the content" },
            { value: "fixed", label: "Fixed (stays in view: a header / footer)" },
            { value: "sticky", label: "Sticky (scrolls, then stays at the edge)" }] })
    }
};

/**
 * Constraints of a node no auto layout places, in a frame or on the root:
 * how it follows when the parent's size changes (Figma).
 */
export function renderConstraintsInspector(container, node, parent) {
    if (!window.NexaKit || !lit() || !Layout.hasConstraints(node, parent)) return false;
    var html = lit().html;
    var meta = Object.assign({}, CONSTRAINT_META, {
        inspector: function (o) {
            var bind = o.bind;
            return html`<nx-section heading="Constraints (${parent ? (parent.name || "frame") : "screen"})" persist-key="nexa-constraints">
                <nx-row><nx-select ${bind("h")}></nx-select><nx-select ${bind("v")}></nx-select></nx-row>
                <nx-select ${bind("scrollBehavior")}></nx-select>
                ${o.p.scrollBehavior === "fixed" ? html`<div class="nx-help">It stays where it is on the view while ${parent ? "this frame" : "the page"} scrolls. With the Bottom (Right) constraint: that far from the bottom (right) edge — a footer.</div>` : ""}
            </nx-section>`;
        }
    });
    var constraintView = function (n) { return Object.assign({}, Layout.constraintsOf(n), { scrollBehavior: n.scrollBehavior || "scrolls" }); };
    var writeConstraint = function (n, key, v) {
        if (key === "scrollBehavior") { if (v === "scrolls") delete n.scrollBehavior; else n.scrollBehavior = v; return; }
        var c = Object.assign({}, Layout.constraintsOf(n));
        c[key] = v;
        if (c.h === "left" && c.v === "top") delete n.constraints; else n.constraints = c;
    };
    mountLive(container, meta, "nexa-constraints", function () { return constraintView(node); },
        function (key, v) { commit(node, function () { writeConstraint(node, key, v); }); },
        { node: node, parent: parent, view: constraintView, write: writeConstraint });
    return true;
}
