import { state, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, getActiveScreen, Tree, Scope } from "../state.js";
import { readbackLayout } from "./layout-readback.js";
import { refreshSelectionVisuals } from "./selection.js";
import { renderComponent, ensureSparkplugLiveRenderWired, registerScreenRenderer } from "./component-renderer.js";
import { renderPropertiesPanel } from "../sidebar/properties-panel.js";
import { ensureSparkplugCommsWired } from "./sparkplug-live.js";

export function renderActiveScreen() {
    if (!state.artboardEl) return;
    var screen = getActiveScreen();
    if (!screen) return;
    // Idempotent — safe to call on every render. Ensures any component
    // already bound to a Sparkplug metric (props containing "{sparkplug:
    // ...}") gets its live value updated, not just whatever was live at
    // first render, without requiring the user to have opened the "MQTT
    // Sparkplug" sidebar tab first.
    ensureSparkplugCommsWired();
    ensureSparkplugLiveRenderWired();
    state.selectedIds = [];
    state.selectionHandlesEl = null; // artboardEl.empty() below discards its DOM node too
    renderPropertiesPanel();
    state.artboardEl.empty();
    state.artboardEl.css({
        width: screen.width + "px",
        height: screen.height + "px",
        "background-color": "#fff",
        "background-image":
            "linear-gradient(to right, #e3e3e3 1px, transparent 1px)," +
            "linear-gradient(to bottom, #e3e3e3 1px, transparent 1px)",
        "background-size": screen.gridSize + "px " + screen.gridSize + "px"
    });
    if (state.stageEl) {
        state.stageEl.css({ width: screen.width + "px", height: screen.height + "px" });
    }
    applyZoomTransform();
    // the root's children; containers draw their own children inside them
    // the surface's variables (a template: its params too) are the root of every scope chain
    var rootScope = Scope.surfaceScope(screen, state.editingMode === "template");
    screen.components.forEach(function (node) { renderComponent(node, null, null, rootScope); });
    // boxes placed by auto layout back into the nodes; when that re-fitted a
    // group (its children's x / y shift), draw once more with the new values
    var changed = readbackLayout(screen);
    if (changed.redraw && !renderActiveScreen._again) {
        renderActiveScreen._again = true;
        try { renderActiveScreen(); } finally { renderActiveScreen._again = false; }
    }
}

registerScreenRenderer(renderActiveScreen);

// Reachable from the browser console and the tests.
if (typeof window !== "undefined") window.__nexaEditor = Object.assign(window.__nexaEditor || {}, { render: renderActiveScreen });

export function applyZoomTransform() {
    if (!state.stageEl || !state.sizerEl) return;
    var screen = getActiveScreen();
    if (!screen) return;
    state.stageEl.css("transform", "scale(" + state.zoomLevel + ")");
    state.sizerEl.css({
        width: (screen.width * state.zoomLevel) + "px",
        height: (screen.height * state.zoomLevel) + "px"
    });
    updateZoomLabel();
    refreshSelectionVisuals();
}

export function updateZoomLabel() {
    if (state.zoomLabelEl) state.zoomLabelEl.text(Math.round(state.zoomLevel * 100) + "%");
}

export function setZoom(newZoom, focalPoint) {
    if (!state.viewportEl || !state.sizerEl) return;
    newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    if (newZoom === state.zoomLevel) return;

    var vp = state.viewportEl.get(0);
    if (!focalPoint) {
        focalPoint = { x: vp.clientWidth / 2, y: vp.clientHeight / 2 };
    }
    var sizerOffset = state.sizerEl.position();
    var stageX = (vp.scrollLeft + focalPoint.x - sizerOffset.left) / state.zoomLevel;
    var stageY = (vp.scrollTop + focalPoint.y - sizerOffset.top) / state.zoomLevel;

    state.zoomLevel = newZoom;
    applyZoomTransform();

    var newOffset = state.sizerEl.position();
    vp.scrollLeft = stageX * state.zoomLevel + newOffset.left - focalPoint.x;
    vp.scrollTop = stageY * state.zoomLevel + newOffset.top - focalPoint.y;
}

export function zoomIn() { setZoom(state.zoomLevel + ZOOM_STEP); }
export function zoomOut() { setZoom(state.zoomLevel - ZOOM_STEP); }
export function zoomReset() { setZoom(1); }

export function zoomToFit() {
    if (!state.viewportEl) return;
    var screen = getActiveScreen();
    if (!screen) return;
    var vp = state.viewportEl.get(0);
    var pad = 40;
    var availW = Math.max(vp.clientWidth - pad * 2, 10);
    var availH = Math.max(vp.clientHeight - pad * 2, 10);
    var fitZoom = Math.min(availW / screen.width, availH / screen.height);
    fitZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitZoom));
    state.zoomLevel = fitZoom;
    applyZoomTransform();
    var sizerW = screen.width * state.zoomLevel, sizerH = screen.height * state.zoomLevel;
    vp.scrollLeft = Math.max(0, (sizerW - vp.clientWidth) / 2);
    vp.scrollTop = Math.max(0, (sizerH - vp.clientHeight) / 2);
}

export function buildZoomToolbar(trayBody) {
    var bar = window.$("<div>", { "class": "nexa-zoom-toolbar" }).css({
        position: "absolute", right: "16px", bottom: "16px", "z-index": "10",
        display: "flex", "align-items": "center",
        background: "#fff", "border-radius": "4px",
        "box-shadow": "0 1px 4px rgba(0,0,0,0.3)",
        overflow: "hidden"
    }).appendTo(trayBody);

    function zoomBtn(icon, title, onClick) {
        return window.$("<a>", { href: "#", title: title }).css({
            width: "26px", height: "26px", display: "flex",
            "align-items": "center", "justify-content": "center",
            color: "#555", cursor: "pointer"
        }).append(window.$("<i>", { "class": "fa " + icon })).on("click", function (e) {
            e.preventDefault();
            onClick();
        }).appendTo(bar);
    }

    zoomBtn("fa-minus", "Zoom out", zoomOut);
    state.zoomLabelEl = window.$("<span>").css({
        width: "44px", "text-align": "center", "font-size": "11px", color: "#555"
    }).appendTo(bar);
    zoomBtn("fa-circle-o", "Reset zoom", zoomReset);
    zoomBtn("fa-plus", "Zoom in", zoomIn);
    zoomBtn("fa-compress", "Zoom to fit", zoomToFit);
    updateZoomLabel();
}
