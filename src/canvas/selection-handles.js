// --- Selection Handles, Resizing, and Rotation ---------------------------
import { state, snap, markDirty, getActiveScreen, findTemplate, Tree, Layout, isNodeLocked, isNodeVisible } from "../state.js";
import { pushHistory, pushTreeChange, treeSnapshot } from "../history.js";
import { setLockedForSelection, selectOnly } from "./selection.js";
import { nodeCss } from "./component-renderer.js";
import { renderActiveScreen } from "./canvas-ui.js";
import { readbackLayout } from "./layout-readback.js";
import { snapshotBoxes, constrainFrameChildren } from "./constraints.js";

// The handles live on the artboard, so they need the node's box in surface
// coordinates (a nested node's x / y are relative to its parent).
function boxOf(comp) {
    var screen = getActiveScreen();
    return (screen && Tree.absBox(screen, comp.id)) || { x: comp.x, y: comp.y, w: comp.w, h: comp.h };
}

// Groups hug their children: resizing / rotating one isn't offered (yet).
// Nothing a parent's auto layout places rotates (src/model/layout.js).
function capabilitiesOf(comp) {
    if (comp.type === "@group") return { resizable: false, rotatable: false, flippable: false, lockable: true };
    var screen = getActiveScreen();
    var parent = screen ? Tree.parentOf(screen, comp.id) : null;
    var caps;
    if (comp.type === "@frame") caps = { resizable: true, rotatable: true, flippable: false, lockable: true };
    else {
        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        caps = (typeDef && typeDef.capabilities) || {};
    }
    if (!Layout.canRotate(comp, parent)) caps = Object.assign({}, caps, { rotatable: false });
    return caps;
}

const HANDLE_SIZE = 8;

export function clearSelectionHandles() {
    if (state.selectionHandlesEl) {
        state.selectionHandlesEl.remove();
        state.selectionHandlesEl = null;
    }
}

export function updateComponentBox(comp) {
    if (!state.artboardEl) return;
    var el = state.artboardEl.find('[data-id="' + comp.id + '"]');
    var screen = getActiveScreen();
    var css = nodeCss(comp, screen ? Tree.parentOf(screen, comp.id) : null);
    if (!isNodeVisible(comp.id)) css.display = "none"; // a hidden node stays hidden
    el.css(css);
    // A "@template" instance's actual content lives in a child wrapper
    // scaled from the template's own intrinsic width/height (see
    // renderTemplateInstance in component-renderer.js) — resizing the OUTER
    // box above doesn't touch that child's transform on its own, so it has
    // to be recomputed here too or dragging a resize handle would leave the
    // instance's contents the wrong size relative to its own selection box.
    if (comp.type === "@template") {
        var template = findTemplate(comp.templateId);
        if (template) {
            var scaleX = template.width ? (comp.w / template.width) : 1;
            var scaleY = template.height ? (comp.h / template.height) : 1;
            el.find(".nexa-template-instance-inner").css("transform", "scale(" + scaleX + "," + scaleY + ")");
        }
    }
    if (state.selectionHandlesEl && state.selectedIds.length === 1 && state.selectedIds[0] === comp.id) {
        var b = boxOf(comp);
        state.selectionHandlesEl.css({
            left: b.x + "px", top: b.y + "px",
            width: b.w + "px", height: b.h + "px",
            transform: "rotate(" + (comp.rotation || 0) + "deg)"
        });
    }
}

export function wireResizeHandle(handle, comp, handleName) {
    handle.get(0).addEventListener("mousedown", function (e) {
        e.stopPropagation();
        e.preventDefault();
        var screen = getActiveScreen();
        var minSize = 20;
        var start = { x: e.clientX, y: e.clientY };
        var orig = { x: comp.x, y: comp.y, w: comp.w, h: comp.h };
        var origKids = comp.type === "@frame" ? snapshotBoxes(comp) : null;
        var before = screen ? treeSnapshot(screen) : null;
        var inGroup = screen && Tree.ancestors(screen, comp.id).some(function (a) { return a.type === "@group"; });
        // A frame, or a node its parent's auto layout places: resizing an axis
        // makes it Fixed on that axis (Figma), and the browser re-flows the
        // rest live; the boxes are read back at the end (layout-readback.js).
        var parent = screen ? Tree.parentOf(screen, comp.id) : null;
        var layoutAware = comp.type === "@frame" || Layout.hasAutoLayout(parent);
        if (layoutAware) {
            var axisW = /[ew]/.test(handleName), axisH = /[ns]/.test(handleName);
            if (Layout.isInFlow(comp, parent)) {
                var lc = Object.assign({}, comp.layoutChild || {});
                if (axisW && lc.w && lc.w !== "fixed") lc.w = "fixed";
                if (axisH && lc.h && lc.h !== "fixed") lc.h = "fixed";
                comp.layoutChild = lc;
            }
            if (comp.type === "@frame" && comp.layout) {
                comp.layout = Object.assign({}, comp.layout);
                if (axisW && comp.layout.sizeW === "hug") comp.layout.sizeW = "fixed";
                if (axisH && comp.layout.sizeH === "hug") comp.layout.sizeH = "fixed";
            }
        }
        var rad = (comp.rotation || 0) * Math.PI / 180;
        var cos = Math.cos(rad), sin = Math.sin(rad);

        function onMove(ev) {
            var dxScreen = (ev.clientX - start.x) / state.zoomLevel;
            var dyScreen = (ev.clientY - start.y) / state.zoomLevel;
            var dx = dxScreen * cos + dyScreen * sin;
            var dy = -dxScreen * sin + dyScreen * cos;
            var nx = orig.x, ny = orig.y, nw = orig.w, nh = orig.h;
            if (handleName.indexOf("e") !== -1) nw = Math.max(minSize, orig.w + dx);
            if (handleName.indexOf("s") !== -1) nh = Math.max(minSize, orig.h + dy);
            if (handleName.indexOf("w") !== -1) { nw = Math.max(minSize, orig.w - dx); nx = orig.x + (orig.w - nw); }
            if (handleName.indexOf("n") !== -1) { nh = Math.max(minSize, orig.h - dy); ny = orig.y + (orig.h - nh); }
            if (screen && screen.snap) {
                nx = snap(nx, screen.gridSize);
                ny = snap(ny, screen.gridSize);
                nw = snap(nw, screen.gridSize);
                nh = snap(nh, screen.gridSize);
            }
            comp.x = nx; comp.y = ny;
            comp.w = Math.max(minSize, nw); comp.h = Math.max(minSize, nh);
            updateComponentBox(comp);
            // a frame's children keep to its edges (constraints)
            if (origKids) {
                Object.keys(origKids).forEach(function (id) { var n = Tree.find(screen, id); if (n) { n.x = origKids[id].x; n.y = origKids[id].y; n.w = origKids[id].w; n.h = origKids[id].h; } });
                constrainFrameChildren(comp, orig, origKids).forEach(function (id) { var n = Tree.find(screen, id); if (n) updateComponentBox(n); });
            }
        }
        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            if (orig.x !== comp.x || orig.y !== comp.y || orig.w !== comp.w || orig.h !== comp.h) {
                if (layoutAware) {
                    // sizing modes may have changed and the siblings moved: one tree step
                    readbackLayout(screen);
                    Tree.refitGroupsUp(screen, comp.id);
                    pushTreeChange(screen, before);
                    renderActiveScreen();
                    selectOnly(comp.id);
                } else if (inGroup) {
                    // its groups hug again (shifting coordinates): one tree step
                    Tree.refitGroupsUp(screen, comp.id);
                    pushTreeChange(screen, before);
                    renderActiveScreen();
                    selectOnly(comp.id);
                } else {
                    pushHistory({
                        t: "resize", screenId: screen ? screen.id : "", id: comp.id,
                        from: orig, to: { x: comp.x, y: comp.y, w: comp.w, h: comp.h }
                    });
                }
                markDirty();
            }
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
}

export function wireRotateHandle(handle, comp) {
    handle.get(0).addEventListener("mousedown", function (e) {
        e.stopPropagation();
        e.preventDefault();
        var screen = getActiveScreen();
        var origRotation = comp.rotation || 0;
        var artboardOffset = state.artboardEl.offset();
        var b = boxOf(comp);
        var centerX = artboardOffset.left + (b.x + b.w / 2) * state.zoomLevel;
        var centerY = artboardOffset.top + (b.y + b.h / 2) * state.zoomLevel;
        var startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI;

        function onMove(ev) {
            var angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX) * 180 / Math.PI;
            var next = origRotation + (angle - startAngle);
            if (ev.shiftKey) next = Math.round(next / 15) * 15;
            comp.rotation = Math.round(next);
            updateComponentBox(comp);
        }
        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            if (comp.rotation !== origRotation) {
                pushHistory({ t: "rotate", screenId: screen ? screen.id : "", id: comp.id, from: origRotation, to: comp.rotation });
                markDirty();
            }
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
}

// A selected frame with an auto layout shows its padding and the gaps between
// its children (Figma's pink bands), inside the selection box.
function renderLayoutOverlay(comp, box) {
    if (!Layout.hasAutoLayout(comp)) return;
    var screen = getActiveScreen();
    if (!screen) return;
    var l = Layout.layoutOf(comp), bw = Number(Layout.styleOf(comp).strokeWidth) > 0 && Layout.styleOf(comp).stroke ? Number(Layout.styleOf(comp).strokeWidth) : 0;
    var band = function (x, y, w, h, cls) {
        if (w <= 0 || h <= 0) return;
        $("<div>", { "class": "nexa-layout-band " + cls }).css({
            position: "absolute", left: x + "px", top: y + "px", width: w + "px", height: h + "px",
            background: "rgba(255, 64, 129, 0.18)", "pointer-events": "none"
        }).appendTo(state.selectionHandlesEl);
    };
    var inner = { x: bw, y: bw, w: box.w - 2 * bw, h: box.h - 2 * bw };
    var p = l.padding;
    band(inner.x, inner.y, inner.w, p.t, "nexa-pad-t");
    band(inner.x, inner.y + inner.h - p.b, inner.w, p.b, "nexa-pad-b");
    band(inner.x, inner.y + p.t, p.l, inner.h - p.t - p.b, "nexa-pad-l");
    band(inner.x + inner.w - p.r, inner.y + p.t, p.r, inner.h - p.t - p.b, "nexa-pad-r");
    if (l.mode === "grid" || (l.mode === "horizontal" && l.wrap)) return;
    var kids = Tree.kids(comp).filter(function (c) { return Layout.isInFlow(c, comp); }).map(function (c) {
        var b = Tree.absBox(screen, c.id);
        return { x: b.x - box.x, y: b.y - box.y, w: b.w, h: b.h };
    });
    for (var i = 1; i < kids.length; i++) {
        var a = kids[i - 1], b = kids[i];
        if (l.mode === "horizontal") band(a.x + a.w, inner.y + p.t, b.x - a.x - a.w, inner.h - p.t - p.b, "nexa-gap");
        else band(inner.x + p.l, a.y + a.h, inner.w - p.l - p.r, b.y - a.y - a.h, "nexa-gap");
    }
}

export function renderSelectionHandles(comp) {
    clearSelectionHandles();
    var caps = capabilitiesOf(comp);
    var box = boxOf(comp);
    var locked = isNodeLocked(comp.id);

    state.selectionHandlesEl = $("<div>", { "class": "nexa-selection-handles" }).css({
        position: "absolute",
        left: box.x + "px", top: box.y + "px",
        width: box.w + "px", height: box.h + "px",
        "pointer-events": "none",
        transform: "rotate(" + (comp.rotation || 0) + "deg)"
    }).appendTo(state.artboardEl);
    renderLayoutOverlay(comp, box);

    if (!locked) {
        if (caps.resizable) {
            [
                { n: "nw", x: 0, y: 0, cursor: "nwse-resize" },
                { n: "n", x: 0.5, y: 0, cursor: "ns-resize" },
                { n: "ne", x: 1, y: 0, cursor: "nesw-resize" },
                { n: "e", x: 1, y: 0.5, cursor: "ew-resize" },
                { n: "se", x: 1, y: 1, cursor: "nwse-resize" },
                { n: "s", x: 0.5, y: 1, cursor: "ns-resize" },
                { n: "sw", x: 0, y: 1, cursor: "nesw-resize" },
                { n: "w", x: 0, y: 0.5, cursor: "ew-resize" }
            ].forEach(function (p) {
                var handle = $("<div>", { "class": "nexa-resize-handle" }).css({
                    position: "absolute",
                    left: (p.x * 100) + "%", top: (p.y * 100) + "%",
                    width: HANDLE_SIZE + "px", height: HANDLE_SIZE + "px",
                    margin: (-HANDLE_SIZE / 2) + "px 0 0 " + (-HANDLE_SIZE / 2) + "px",
                    background: "#fff", border: "1px solid #ff5722", "box-sizing": "border-box",
                    cursor: p.cursor, "pointer-events": "auto",
                    transform: "scale(" + (1 / state.zoomLevel) + ")"
                }).appendTo(state.selectionHandlesEl);
                wireResizeHandle(handle, comp, p.n);
            });
        }
        if (caps.rotatable) {
            $("<div>").css({
                position: "absolute", left: "50%", top: (-24 / state.zoomLevel) + "px",
                width: "1px", height: (24 / state.zoomLevel) + "px", background: "#ff5722", "pointer-events": "none"
            }).appendTo(state.selectionHandlesEl);
            var rotHandle = $("<div>", { "class": "nexa-rotate-handle" }).css({
                position: "absolute",
                left: "50%", top: (-24 / state.zoomLevel) + "px",
                width: HANDLE_SIZE + "px", height: HANDLE_SIZE + "px",
                margin: (-HANDLE_SIZE / 2) + "px 0 0 " + (-HANDLE_SIZE / 2) + "px",
                background: "#fff", border: "1px solid #ff5722", "border-radius": "50%",
                cursor: "grab", "pointer-events": "auto",
                transform: "scale(" + (1 / state.zoomLevel) + ")"
            }).appendTo(state.selectionHandlesEl);
            wireRotateHandle(rotHandle, comp);
        }
    }

    if (caps.lockable !== false) {
        var lockIcon = $("<div>", { "class": "nexa-lock-handle" }).css({
            position: "absolute", right: (-22 / state.zoomLevel) + "px", top: (-22 / state.zoomLevel) + "px",
            width: "16px", height: "16px", background: "#fff", border: "1px solid #999",
            "border-radius": "3px", cursor: "pointer", "pointer-events": "auto",
            "font-size": "10px", "text-align": "center", "line-height": "15px", color: "#666",
            transform: "scale(" + (1 / state.zoomLevel) + ")"
        }).html(comp.locked ? '<i class="fa fa-lock"></i>' : '<i class="fa fa-unlock-alt"></i>').appendTo(state.selectionHandlesEl);
        lockIcon.on("click", function (e) {
            e.stopPropagation();
            setLockedForSelection(!comp.locked, [comp.id]);
        });
    }
}
