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
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { selectOnly } from "../canvas/selection.js";
import { constrainFrameChildren } from "../canvas/constraints.js";

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
            { value: "grid", label: "Grid", icon: "fa fa-th" }] }),
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
        clip: prop("clip", "boolean", "Clip content")
    }
};

var CHILD_META = {
    id: "@layout-child",
    stateList: [], inputs: [], outputs: [],
    props: {
        childW: prop("childW", "enum", "Width", { options: SIZING_CHILD }),
        childH: prop("childH", "enum", "Height", { options: SIZING_CHILD }),
        absolute: prop("absolute", "boolean", "Absolute position (out of the layout)"),
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
        fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, radius: s.radius, clip: !!s.clip
    };
}

function writeFrame(frame, key, v) {
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
            // a new auto layout starts with some breathing room
            if (v !== "none" && !frame.layout) { layout.padding = { t: 8, r: 8, b: 8, l: 8 }; layout.gap = 8; }
            break;
        case "fill": case "stroke": case "strokeWidth": case "radius": case "clip": style[key] = v; break;
        default: layout[key] = v;
    }
    frame.layout = layout;
    frame.style = style;
}

function childView(node) {
    var lc = node.layoutChild || {};
    return {
        childW: lc.w || "fixed", childH: lc.h || "fixed", absolute: !!lc.absolute,
        col: lc.col || 0, row: lc.row || 0, colSpan: lc.colSpan || 1, rowSpan: lc.rowSpan || 1,
        minW: node.minW || 0, maxW: node.maxW || 0, minH: node.minH || 0, maxH: node.maxH || 0
    };
}

function writeChild(node, key, v) {
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

// One edit = one undo step, then the layout re-flows.
function commit(node, fn) {
    var screen = getActiveScreen();
    if (!screen || isNodeLocked(node.id)) return;
    var before = treeSnapshot(screen);
    fn();
    Tree.refitGroupsUp(screen, node.id);
    renderActiveScreen();   // re-flow (and read the boxes back)
    pushTreeChange(screen, before);
    markDirty();
    selectOnly(node.id);
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
                        ${p.mode === "grid" ? html`<nx-list ${bind("columns")}></nx-list><nx-list ${bind("rows")}></nx-list><nx-number ${bind("rowGap")}></nx-number>` : nothing}
                    ` : nothing}
                </nx-section>
                <nx-section heading="Fill & stroke" persist-key="nexa-frame:style">
                    <nx-row><nx-color ${bind("fill")}></nx-color><nx-number ${bind("radius")}></nx-number></nx-row>
                    <nx-row><nx-color ${bind("stroke")}></nx-color><nx-number ${bind("strokeWidth")}></nx-number></nx-row>
                    <nx-checkbox ${bind("clip")}></nx-checkbox>
                </nx-section>`;
        }
    });
    window.NexaKit.renderInspector(container.jquery ? container.get(0) : container, {
        meta: meta,
        props: frameView(frame),
        persistKey: "nexa-frame",
        set: function (key, v) { commit(frame, function () { writeFrame(frame, key, v); }); }
    });
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
                        <nx-row><nx-number ${bind("minH")}></nx-number><nx-number ${bind("maxH")}></nx-number></nx-row>`}
                </nx-section>`;
        }
    });
    window.NexaKit.renderInspector(container.jquery ? container.get(0) : container, {
        meta: meta,
        props: childView(node),
        persistKey: "nexa-layout-child",
        set: function (key, v) { commit(node, function () { writeChild(node, key, v); }); }
    });
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
            { value: "center", label: "Center" }, { value: "scale", label: "Scale" }] })
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
            </nx-section>`;
        }
    });
    window.NexaKit.renderInspector(container.jquery ? container.get(0) : container, {
        meta: meta,
        props: Layout.constraintsOf(node),
        persistKey: "nexa-constraints",
        set: function (key, v) {
            commit(node, function () {
                var c = Object.assign({}, Layout.constraintsOf(node));
                c[key] = v;
                if (c.h === "left" && c.v === "top") delete node.constraints; else node.constraints = c;
            });
        }
    });
    return true;
}
