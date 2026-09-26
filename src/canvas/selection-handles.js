// --- Selection Handles, Resizing, and Rotation ---------------------------
import { state, snap, markDirty, getActiveScreen, findTemplate, Tree, isNodeLocked } from "../state.js";
import { pushHistory, pushTreeChange, treeSnapshot } from "../history.js";
import { setLockedForSelection, selectOnly } from "./selection.js";
import { getComponentTransform } from "./component-renderer.js";
import { renderActiveScreen } from "./canvas-ui.js";

// The handles live on the artboard, so they need the node's box in surface
// coordinates (a nested node's x / y are relative to its parent).
function boxOf(comp) {
    var screen = getActiveScreen();
    return (screen && Tree.absBox(screen, comp.id)) || { x: comp.x, y: comp.y, w: comp.w, h: comp.h };
}

// Groups hug their children: resizing / rotating one isn't offered (yet).
function capabilitiesOf(comp) {
    if (comp.type === "@group") return { resizable: false, rotatable: false, flippable: false, lockable: true };
    var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
    return (typeDef && typeDef.capabilities) || {};
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
    el.css({
        left: comp.x + "px", top: comp.y + "px",
        width: comp.w + "px", height: comp.h + "px",
        transform: getComponentTransform(comp)
    });
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
        var before = screen ? treeSnapshot(screen) : null;
        var inGroup = screen && Tree.ancestors(screen, comp.id).some(function (a) { return a.type === "@group"; });
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
        }
        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            if (orig.x !== comp.x || orig.y !== comp.y || orig.w !== comp.w || orig.h !== comp.h) {
                if (inGroup) {
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
