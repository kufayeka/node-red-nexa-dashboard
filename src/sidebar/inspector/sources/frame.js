// --- Source: a frame (@frame) -------------------------------------------------------
// Its box, how it shows (in place / dialog / drawer), its auto layout (mode, sizing,
// alignment, gap, padding, wrap, grid tracks, carousel), fill & stroke, zoom & pan.
// The kit edits a flat view of the frame; each change is written back into the node
// (src/model/layout.js) as one undo step, then the screen re-renders (the browser re-flows
// the layout, see canvas/layout-readback.js). See ../compose.js for what a source is.
import { state, Layout, Theme } from "../../../state.js";
import { renderActiveScreen } from "../../../canvas/canvas-ui.js";
import { constrainFrameChildren } from "../../../canvas/constraints.js";

var SIZING_FRAME = [{ value: "fixed", label: "Fixed" }, { value: "hug", label: "Hug" }];
var TRACK = { row: true, noun: "track", fields: { size: { type: "number", default: 1, min: 0 }, unit: { type: "enum", default: "fr", options: [{ value: "fr", label: "fr" }, { value: "px", label: "px" }, { value: "auto", label: "auto" }] } } };

function zoomSettings(frame) { return Object.assign({}, Layout.ZOOM_DEFAULT, frame.zoom || {}); }

export function frameView(frame) {
    var l = Layout.layoutOf(frame), s = Layout.styleOf(frame);
    var ov = Layout.overlayOf(frame), ovs = ov || Layout.OVERLAY_DEFAULT;
    var z = zoomSettings(frame);
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
        zEnabled: !!(frame.zoom && frame.zoom.enabled), zMin: Math.round(z.min * 100), zMax: Math.round(z.max * 100),
        zStart: z.start, zWheel: z.wheel === "always", zControls: !!z.controls, zDbl: z.dblclick !== false,
        iPadX: l.items.padX, iPadY: l.items.padY, iAlign: { x: l.items.alignX, y: l.items.alignY },
        oKind: ov ? ov.kind : "none", oPreview: !!state.overlayPreview[frame.id],
        oSide: ovs.side, oAlign: { x: ovs.alignX, y: ovs.alignY }, oMargin: ovs.margin, oBackdrop: ovs.backdrop,
        oOpacity: Math.round(ovs.backdropOpacity * 100), oModal: !!ovs.modal, oCloseBackdrop: !!ovs.closeOnBackdrop, oCloseEsc: !!ovs.closeOnEsc,
        oAutoClose: ovs.autoClose, oDraggable: !!ovs.draggable, oDragWithin: ovs.dragWithin, oAnimation: (frame.overlay && frame.overlay.animation) || "auto",
        oDuration: ovs.duration, oStartOpen: !!ovs.startOpen
    };
}

export function writeFrame(frame, key, v) {
    if (/^o[A-Z]/.test(key)) { writeOverlay(frame, key, v); return; }
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
        case "gap": layout.gap = Theme.isTokenRef(v) ? v : Number(v) || 0; break;
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

// frame.overlay from the inspector's o* keys
function writeOverlay(frame, key, v) {
    if (key === "oPreview") return;   // editor state, not the frame
    if (key === "oKind") {
        if (v === "none") { delete frame.overlay; return; }
        frame.overlay = Object.assign({}, frame.overlay || {}, { kind: v });
        return;
    }
    if (!frame.overlay) return;
    var o = Object.assign({}, frame.overlay);
    switch (key) {
        case "oSide": {
            // the drawer's thickness moves to the other axis when it changes sides that way
            var was = Layout.overlayOf(frame).side, hz = function (s) { return s === "left" || s === "right"; };
            if (hz(was) !== hz(v)) { var t = hz(was) ? frame.w : frame.h; if (hz(v)) frame.w = t; else frame.h = t; }
            o.side = v;
            break;
        }
        case "oAlign": o.alignX = v.x; o.alignY = v.y; break;
        case "oMargin": o.margin = Math.max(0, Number(v) || 0); break;
        case "oBackdrop": o.backdrop = v; break;
        case "oOpacity": o.backdropOpacity = Math.min(100, Math.max(0, Number(v) || 0)) / 100; break;
        case "oModal": o.modal = !!v; break;
        case "oCloseBackdrop": o.closeOnBackdrop = !!v; break;
        case "oCloseEsc": o.closeOnEsc = !!v; break;
        case "oAutoClose": o.autoClose = Math.max(0, Number(v) || 0); break;
        case "oDraggable": o.draggable = !!v; break;
        case "oDragWithin": o.dragWithin = v; break;
        case "oAnimation": o.animation = v; break;
        case "oDuration": o.duration = Math.max(0, Number(v) || 0); break;
        case "oStartOpen": o.startOpen = !!v; break;
    }
    frame.overlay = o;
}

// visibleWhen helpers on the frame's view
var auto = function (v) { return v.mode !== "none"; };
var is = function (mode) { return function (v) { return v.mode === mode; }; };
var overlay = function (v) { return v.oKind !== "none"; };
var notFade = function (v) { return v.mode === "carousel" && v.cTransition !== "fade"; };

function frameProps(ctx) {
    var slot = Layout.inSlot(ctx.node);
    var box = function () { return !slot; };
    var P = function (group, type, label, extra) { return Object.assign({ group: group, type: type, label: label }, extra || {}); };
    var G = "Position & Size", O = "Overlay", A = "Auto layout", S = "Slides", F = "Fill & stroke", Z = "Zoom & pan";
    return {
        x: P(G, "number", "X", { unit: "px", visibleWhen: box }),
        y: P(G, "number", "Y", { unit: "px", visibleWhen: box }),
        w: P(G, "number", "Width", { unit: "px", min: 1, visibleWhen: box, enabledWhen: function (v) { return !(auto(v) && v.sizeW === "hug"); } }),
        h: P(G, "number", "Height", { unit: "px", min: 1, visibleWhen: box, enabledWhen: function (v) { return !(auto(v) && v.sizeH === "hug"); } }),
        oKind: P(O, "enum", "Show as", { style: "segmented", visibleWhen: box, options: [
            { value: "none", label: "In place", icon: "fa fa-square-o" }, { value: "dialog", label: "Dialog", icon: "fa fa-window-maximize" },
            { value: "drawer", label: "Drawer", icon: "fa fa-columns" }],
            help: "A Dialog or a Drawer opens over its scope (the page, or the frame it is in) when a Logic \"Open\" node runs, and closes by its backdrop, Esc, a timer or a \"Close\" node. Its output fires when it closes: msg.payload = the result, msg.closedBy = backdrop / esc / timer / node. Its size: W × H (a drawer: its width, or height for Top / Bottom)." }),
        oPreview: P(O, "boolean", "Preview on the canvas (the editor only)", { visibleWhen: overlay }),
        oSide: P(O, "enum", "Side", { visibleWhen: function (v) { return v.oKind === "drawer"; },
            options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }, { value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }] }),
        oAlign: P(O, "align", "Where it opens", { visibleWhen: function (v) { return v.oKind === "dialog"; } }),
        oMargin: P(O, "number", "Margin from the edges", { min: 0, unit: "px", visibleWhen: function (v) { return v.oKind === "dialog"; } }),
        oBackdrop: P(O, "enum", "Backdrop", { visibleWhen: overlay, options: [{ value: "dim", label: "Dim" }, { value: "blur", label: "Blur" }, { value: "none", label: "None" }] }),
        oOpacity: P(O, "number", "Backdrop darkness", { min: 0, max: 100, step: 5, unit: "%", visibleWhen: function (v) { return overlay(v) && v.oBackdrop !== "none"; } }),
        oModal: P(O, "boolean", "Modal: what is behind it cannot be used", { visibleWhen: overlay }),
        oCloseBackdrop: P(O, "boolean", "Close on a click on the backdrop", { visibleWhen: overlay }),
        oCloseEsc: P(O, "boolean", "Close on Esc", { visibleWhen: overlay }),
        oAutoClose: P(O, "number", "Close by itself after", { min: 0, step: 500, unit: "ms", help: "0 = stays open", visibleWhen: overlay }),
        oDraggable: P(O, "boolean", "Draggable", { visibleWhen: overlay }),
        oDragWithin: P(O, "enum", "Drag", { visibleWhen: function (v) { return overlay(v) && v.oDraggable; }, options: [{ value: "scope", label: "Inside its scope" }, { value: "page", label: "Anywhere" }] }),
        oAnimation: P(O, "enum", "Animation", { visibleWhen: overlay, options: [{ value: "auto", label: "Auto" }, { value: "scale", label: "Scale" }, { value: "fade", label: "Fade" }, { value: "slide", label: "Slide (Auto)" }, { value: "slide-left", label: "Slide Left" }, { value: "slide-right", label: "Slide Right" }, { value: "slide-top", label: "Slide Top" }, { value: "slide-bottom", label: "Slide Bottom" }, { value: "none", label: "None" }] }),
        oDuration: P(O, "number", "Duration", { min: 0, step: 50, unit: "ms", visibleWhen: overlay }),
        oStartOpen: P(O, "boolean", "Open when the page opens", { visibleWhen: overlay }),
        mode: P(A, "enum", "Auto layout", { style: "segmented", iconsOnly: true, options: [
            { value: "none", label: "None", icon: "fa fa-ban" }, { value: "horizontal", label: "Row", icon: "fa fa-long-arrow-right" },
            { value: "vertical", label: "Column", icon: "fa fa-long-arrow-down" }, { value: "grid", label: "Grid", icon: "fa fa-th" },
            { value: "carousel", label: "Carousel", icon: "fa fa-film" }],
            help: slot ? "A slot of its component (a tab's panel): what you drop in it shows there. The component sets its place and size; here its layout, padding and fill." : "" }),
        sizeW: P(A, "enum", "Width", { style: "segmented", options: SIZING_FRAME, visibleWhen: function (v) { return auto(v) && !slot; } }),
        sizeH: P(A, "enum", "Height", { style: "segmented", options: SIZING_FRAME, visibleWhen: function (v) { return auto(v) && !slot; } }),
        align: P(A, "align", "Alignment", { visibleWhen: auto }),
        gap: P(A, "number", "Gap", { min: 0, unit: "px", tokens: "spacing", visibleWhen: auto, enabledWhen: function (v) { return !v.gapAuto; } }),
        gapAuto: P(A, "boolean", "Space between", { visibleWhen: function (v) { return auto(v) && v.mode !== "grid"; } }),
        padding: P(A, "spacing", "Padding", { visibleWhen: auto }),
        wrap: P(A, "boolean", "Wrap", { visibleWhen: is("horizontal") }),
        rowGap: P(A, "number", "Row gap", { min: 0, unit: "px", placeholder: "= gap", visibleWhen: function (v) { return (v.mode === "horizontal" && v.wrap) || v.mode === "grid"; } }),
        columns: P(A, "list", "Columns", { item: TRACK, noun: "column", visibleWhen: is("grid") }),
        rows: P(A, "list", "Rows (empty = as needed)", { item: TRACK, noun: "row", visibleWhen: is("grid") }),
        cTransition: P(A, "enum", "Transition", { style: "segmented", visibleWhen: is("carousel"), options: [{ value: "slide", label: "Slide" }, { value: "fade", label: "Fade" }] }),
        cDirection: P(A, "enum", "Direction", { style: "segmented", visibleWhen: notFade, options: [{ value: "horizontal", label: "Across" }, { value: "vertical", label: "Down" }] }),
        cPerView: P(A, "number", "Slides in view", { min: 0.1, step: 0.1, help: "1.2: the next slide peeks in", visibleWhen: notFade }),
        cArrows: P(A, "boolean", "Arrows", { visibleWhen: is("carousel") }),
        cDots: P(A, "boolean", "Dots", { visibleWhen: is("carousel") }),
        cLoop: P(A, "boolean", "Loop (after the last, the first)", { visibleWhen: is("carousel") }),
        cSwipe: P(A, "boolean", "Swipe / drag", { visibleWhen: is("carousel") }),
        cAutoplay: P(A, "number", "Autoplay every", { min: 0, step: 500, unit: "ms", help: "0 = off", visibleWhen: is("carousel") }),
        cPauseOnHover: P(A, "boolean", "Pause while the pointer is over it", { visibleWhen: function (v) { return v.mode === "carousel" && Number(v.cAutoplay) > 0; } }),
        cIndex: P(A, "string", "Current slide → variable", { placeholder: "e.g. slide", visibleWhen: is("carousel"),
            help: "A declared variable: it holds the slide shown (0, 1, …); set it (Set Variable) to go to a slide. Slides: this frame's children, or the copies a Populate puts in it (wire it to this frame's Layout node)." }),
        iPadX: P(S, "number", "Padding ↔", { min: 0, unit: "px", visibleWhen: is("carousel"),
            help: "Each slide is a cell: padding inside it, and a template of a fixed size aligned in it. Fixed or filling is the template's own setting (Templates → On the live page)." }),
        iPadY: P(S, "number", "Padding ↕", { min: 0, unit: "px", visibleWhen: is("carousel") }),
        iAlign: P(S, "align", "Align in the slide", { visibleWhen: is("carousel") }),
        fill: P(F, "color", "Fill"),
        radius: P(F, "number", "Corner radius", { min: 0, unit: "px", tokens: "radii" }),
        stroke: P(F, "color", "Stroke"),
        strokeWidth: P(F, "number", "Stroke width", { min: 0, unit: "px" }),
        clip: P(F, "boolean", "Clip content", { enabledWhen: function (v) { return !v.zEnabled; } }),
        scroll: P(F, "enum", "Scroll (live page)", { enabledWhen: function (v) { return !v.zEnabled; }, options: [
            { value: "none", label: "No scrolling" }, { value: "vertical", label: "Vertical" },
            { value: "horizontal", label: "Horizontal" }, { value: "both", label: "Both directions" }],
            warn: function (value, v) { return v.zEnabled ? "Zoomable: it always clips and scrolls both ways." : ""; } }),
        scrollbarHidden: P(F, "boolean", "Hide the scrollbar (it still scrolls)", { visibleWhen: function (v) { return v.scroll !== "none" || v.zEnabled; } }),
        zEnabled: P(Z, "boolean", "Zoomable: its content zooms and pans (live page)", { visibleWhen: function (v) { return v.mode !== "carousel"; },
            help: "Like the editor's canvas, on the live page: the frame clips and scrolls both ways; only its content zooms (Ctrl + wheel, a pinch, at the pointer) and pans (the wheel, a drag on the background). The rest of the screen keeps its size." }),
        zMin: P(Z, "number", "Min zoom", { min: 5, max: 100, step: 5, unit: "%", visibleWhen: function (v) { return v.zEnabled && v.mode !== "carousel"; } }),
        zMax: P(Z, "number", "Max zoom", { min: 100, max: 2000, step: 50, unit: "%", visibleWhen: function (v) { return v.zEnabled && v.mode !== "carousel"; } }),
        zStart: P(Z, "enum", "Starts", { style: "segmented", visibleWhen: function (v) { return v.zEnabled && v.mode !== "carousel"; }, options: [{ value: "fit", label: "Fit" }, { value: "100", label: "100 %" }] }),
        zDbl: P(Z, "boolean", "Double-click / double-tap: back to the start", { visibleWhen: function (v) { return v.zEnabled && v.mode !== "carousel"; } }),
        zWheel: P(Z, "boolean", "The mouse wheel zooms without Ctrl", { visibleWhen: function (v) { return v.zEnabled && v.mode !== "carousel"; } }),
        zControls: P(Z, "boolean", "Show the zoom toolbar (− 100% ○ + ⤢)", { visibleWhen: function (v) { return v.zEnabled && v.mode !== "carousel"; } })
    };
}

export var frame = {
    id: "frame", prefix: "fr$",
    applies: function (ctx) { return ctx.node.type === "@frame"; },
    props: frameProps,
    view: function (node) { return frameView(node); },
    write: writeFrame,
    set: function (key, v, ctx) {
        var node = ctx.node;
        // the canvas preview is the editor's, not the frame's; a new overlay starts shown
        if (key === "oPreview" || (key === "oKind" && v !== "none")) state.overlayPreview[node.id] = key === "oPreview" ? !!v : true;
        if (key === "oPreview") { renderActiveScreen({ keepPanel: true }); ctx.update(); return; }
        ctx.commit(function () { writeFrame(node, key, v); });
        ctx.update();
    },
    // what a breakpoint may change (src/model/breakpoints.js OVERRIDABLE): not the zoom, not
    // the variable a carousel's slide goes to, not the editor's preview
    canVary: function (key) { return !/^z[A-Z]/.test(key) && key !== "cIndex" && key !== "oPreview"; }
};
