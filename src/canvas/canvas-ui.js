import { state, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, getActiveScreen, getApp, Tree, Scope, Theme, appScope } from "../state.js";
import { readbackLayout } from "./layout-readback.js";
import { refreshSelectionVisuals } from "./selection.js";
import { renderComponent, ensureSparkplugLiveRenderWired, registerScreenRenderer } from "./component-renderer.js";
import { renderPropertiesPanel } from "../sidebar/properties-panel.js";
import { ensureSparkplugCommsWired } from "./sparkplug-live.js";
import { activeBreakpointId, breakpointList, previewWidth, bandPreviewWidth, designId, rangeOf, enterBreakpoint, leaveBreakpoint, checkSession } from "./breakpoints-ui.js";

// opts.keepPanel: redraw the canvas only — the selection stays, the properties
// panel is not rebuilt (an edit made IN the panel must not lose its field).
export function renderActiveScreen(opts) {
    var keepPanel = !!(opts && opts.keepPanel);
    if (!state.artboardEl) return;
    var screen = getActiveScreen();
    if (!screen) return;
    // a breakpoint is edited on one screen: another screen / a template is the design
    checkSession(screen);
    refreshBreakpointBar(screen);
    applyEditorTheme();
    var canvasW = previewWidth(screen);
    // Idempotent — safe to call on every render. Ensures any component
    // already bound to a Sparkplug metric (props containing "{sparkplug:
    // ...}") gets its live value updated, not just whatever was live at
    // first render, without requiring the user to have opened the "MQTT
    // Sparkplug" sidebar tab first.
    ensureSparkplugCommsWired();
    ensureSparkplugLiveRenderWired();
    state.selectionHandlesEl = null; // artboardEl.empty() below discards its DOM node too
    if (!keepPanel) {
        state.selectedIds = [];
        renderPropertiesPanel();
    }
    state.artboardEl.empty();
    state.artboardEl.css({
        width: canvasW + "px",
        height: screen.height + "px",
        "background-image":
            "linear-gradient(to right, #e3e3e3 1px, transparent 1px)," +
            "linear-gradient(to bottom, #e3e3e3 1px, transparent 1px)",
        "background-size": screen.gridSize + "px " + screen.gridSize + "px"
    });
    // the page's background: the theme's (jQuery UI's colour hook would turn a var() into a fixed colour)
    if (state.artboardEl[0] && state.artboardEl[0].style) state.artboardEl[0].style.backgroundColor = "var(--nexa-colors-bg, #fff)";
    if (state.stageEl) {
        state.stageEl.css({ width: canvasW + "px", height: screen.height + "px" });
    }
    applyZoomTransform();
    // the root's children; containers draw their own children inside them
    // the surface's variables (a template: its params too) are the root of every scope chain
    var rootScope = Scope.surfaceScope(screen, state.editingMode === "template", appScope());
    screen.components.forEach(function (node) { renderComponent(node, null, null, rootScope); });
    // boxes placed by auto layout back into the nodes; when that re-fitted a
    // group (its children's x / y shift), draw once more with the new values
    var changed = readbackLayout(screen);
    if (changed.redraw && !renderActiveScreen._again) {
        renderActiveScreen._again = true;
        try { renderActiveScreen(opts); } finally { renderActiveScreen._again = false; }
    }
    // components with slots draw them (Lit) after this: their boxes are read once they did
    var art = state.artboardEl && state.artboardEl[0];
    if (art && art.addEventListener && !art.__nexaSlotWatch) {
        art.__nexaSlotWatch = true;
        art.addEventListener("nexa-slots-rendered", scheduleSlotReadback);
    }
    if (Tree.allNodes(screen).some(Tree.isSlotHost)) scheduleSlotReadback();
}

// A component with slots drew (its first render, a tab switched): where its slot frames
// are now, back into the nodes — the selection box and drops follow.
var slotReadbackQueued = false;
function scheduleSlotReadback() {
    if (slotReadbackQueued) return;
    slotReadbackQueued = true;
    var later = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame.bind(window) : function (f) { return setTimeout(f, 16); };
    later(function () {
        slotReadbackQueued = false;
        var screen = getActiveScreen();
        if (!screen || !state.artboardEl) return;
        var changed = readbackLayout(screen);
        if (changed.redraw) redrawCanvas();
        else if (changed.length) refreshSelectionVisuals({ keepPanel: true });
    });
}

/** Redraws the canvas, keeping the selection and the properties panel as they are. */
export function redrawCanvas() {
    var screen = getActiveScreen();
    renderActiveScreen({ keepPanel: true });
    if (!screen) return;
    state.selectedIds = state.selectedIds.filter(function (id) { return !!Tree.find(screen, id); });
    refreshSelectionVisuals({ keepPanel: true });
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
    // the handles scale with the zoom; the properties panel has nothing to do with it
    refreshSelectionVisuals({ keepPanel: true });
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
    var fitZoom = Math.min(availW / previewWidth(screen), availH / screen.height);
    fitZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitZoom));
    state.zoomLevel = fitZoom;
    applyZoomTransform();
    var sizerW = screen.width * state.zoomLevel, sizerH = screen.height * state.zoomLevel;
    vp.scrollLeft = Math.max(0, (sizerW - vp.clientWidth) / 2);
    vp.scrollTop = Math.max(0, (sizerH - vp.clientHeight) / 2);
}

// --- the theme on the canvas: its tokens as CSS variables on the artboard, the preview mode ---
// (like the live page's :root; components get their {token:} props resolved in this mode)
export function editorThemeMode(theme) {
    var t = theme || Theme.themeOf(getApp());
    return state.themePreview || (t.defaultMode === "dark" ? "dark" : "light");
}
export function applyEditorTheme() {
    var theme = Theme.themeOf(getApp());
    var mode = editorThemeMode(theme);
    Theme.setTheme(theme, mode);
    if (window.NexaSDK && window.NexaSDK.setTheme) window.NexaSDK.setTheme(theme, mode);
    if (typeof document === "undefined" || typeof document.getElementById !== "function" || !document.head) return;
    var css = Theme.themeCss(theme, ".nexa-theme-root", '.nexa-theme-root[data-nexa-mode="dark"]');
    var style = document.getElementById("nexa-editor-theme-css");
    if (!style) { style = document.createElement("style"); style.id = "nexa-editor-theme-css"; document.head.appendChild(style); }
    if (style.textContent !== css) style.textContent = css;
    var ab = state.artboardEl && state.artboardEl[0];
    if (ab && ab.classList && typeof ab.setAttribute === "function") { ab.classList.add("nexa-theme-root"); ab.setAttribute("data-nexa-mode", mode); }
}

// --- the breakpoint bar (top of the canvas): the app's breakpoints, the widest first ---
// ★ = the band the screen is designed in (its width): the design. Another band shows the
// screen at its preview width; what is changed there is kept for that band.
var bpBar = null;
export function buildBreakpointBar(trayBody) {
    // in the tray's toolbar (next to Close), not over the canvas; it scrolls when there are many
    bpBar = window.$("<div>", { "class": "nexa-breakpoint-bar" }).css({
        display: "flex", "align-items": "center", background: "#fff", "border-radius": "4px",
        border: "1px solid var(--red-ui-secondary-border-color, #ccc)", "overflow-x": "auto", "overflow-y": "hidden",
        "font-size": "11px", "min-width": "0", "max-width": "100%", "scrollbar-width": "thin"
    }).appendTo(trayBody);
    refreshBreakpointBar(getActiveScreen());
    return bpBar;
}
function refreshBreakpointBar(screen) {
    if (!bpBar) return;
    bpBar.empty();
    var template = state.editingMode === "template";
    bpBar.toggle(!!screen && !template);
    if (!screen || template) return;
    var active = activeBreakpointId(), design = designId(screen);
    var list = breakpointList();
    list.forEach(function (b, i) {
        var on = b.id === active, isDesign = b.id === design;
        var width = bandPreviewWidth(screen, b.id);
        var icon = width < 640 ? "fa-mobile" : width < 1200 ? "fa-tablet" : "fa-desktop";
        var tip = b.name + " (" + rangeOf(b.id) + ")" + (b.device ? " · " + b.device : "") + " — " + (isDesign ? "the design (the screen's width, " + width + " px)"
            : "shown at " + width + " px; edits here are kept for " + b.name + (i > list.map(function (x) { return x.id; }).indexOf(design) ? " and narrower" : " and wider"));
        window.$("<a>", { href: "#", title: tip, "data-breakpoint": b.id })
            .css({ display: "flex", "align-items": "center", gap: "4px", padding: "0 8px", height: "26px", color: on ? "#fff" : "#555", background: on ? "#ff5722" : "transparent", "text-decoration": "none", "white-space": "nowrap" })
            .html('<i class="fa ' + icon + '"></i> ' + (isDesign ? '<i class="fa fa-star" style="font-size:9px"></i>' : "") + window.$("<span>").text(b.name).html() + ' <span style="opacity:.7">' + width + '</span>')
            .on("click", function (e) {
                e.preventDefault();
                if (b.id === activeBreakpointId()) return;
                if (b.id === designId(getActiveScreen())) leaveBreakpoint(); else enterBreakpoint(getActiveScreen(), b.id);
                renderActiveScreen();
                zoomToFit();
            }).appendTo(bpBar);
    });
}

export function buildZoomToolbar(trayBody) {
    // in the tray's footer, not over the canvas
    var bar = window.$("<div>", { "class": "nexa-zoom-toolbar" }).css({
        display: "flex", "align-items": "center", "line-height": "normal",
        background: "#fff", "border-radius": "4px",
        border: "1px solid var(--red-ui-secondary-border-color, #ccc)",
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
    return bar;
}
