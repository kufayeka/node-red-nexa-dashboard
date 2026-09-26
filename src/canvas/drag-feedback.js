// --- Drag feedback on the artboard: the target frame and the insert line ------
import { state, Tree, getActiveScreen } from "../state.js";

var outlineEl = null, lineEl = null;

function ensure(el, css) {
    if (el && state.artboardEl && el.parent().get(0) === state.artboardEl.get(0)) return el;
    return window.$("<div>").css(Object.assign({ position: "absolute", "pointer-events": "none", "z-index": 9998, display: "none" }, css)).appendTo(state.artboardEl);
}

/** Outlines the frame a drop would go into (null: none). */
export function showDropFrame(frame) {
    if (!state.artboardEl) return;
    outlineEl = ensure(outlineEl, { border: "2px solid #0d99ff", "box-sizing": "border-box", "border-radius": "2px" });
    var screen = getActiveScreen();
    if (!frame || !screen) { outlineEl.css("display", "none"); return; }
    var b = Tree.absBox(screen, frame.id);
    outlineEl.css({ display: "block", left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
}

/** The line where a drop would go in an auto layout (null: none). */
export function showInsertLine(line) {
    if (!state.artboardEl) return;
    lineEl = ensure(lineEl, { background: "#0d99ff", "border-radius": "1px" });
    if (!line) { lineEl.css("display", "none"); return; }
    lineEl.css({ display: "block", left: line.x + "px", top: line.y + "px", width: line.w + "px", height: line.h + "px" });
}

export function clearDragFeedback() {
    if (outlineEl) { outlineEl.remove(); outlineEl = null; }
    if (lineEl) { lineEl.remove(); lineEl = null; }
}

/** A pointer event's position in surface coordinates. */
export function pointerOnArtboard(e) {
    if (!state.artboardEl || typeof state.artboardEl.offset !== "function") return null;
    var o = state.artboardEl.offset();
    if (!o || typeof e.pageX !== "number") return null;
    return { x: (e.pageX - o.left) / state.zoomLevel, y: (e.pageY - o.top) / state.zoomLevel };
}
