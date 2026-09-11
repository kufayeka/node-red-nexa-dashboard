import { state, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, LOGIC_CANVAS_W, LOGIC_CANVAS_H, LOGIC_NODE_W, LOGIC_NODE_H, getActiveScreen } from "../state.js";

export function applyLogicZoomTransform() {
    if (!state.logicStageEl || !state.logicSizerEl) return;
    state.logicStageEl.css("transform", "scale(" + state.logicZoomLevel + ")");
    state.logicSizerEl.css({
        width: (LOGIC_CANVAS_W * state.logicZoomLevel) + "px",
        height: (LOGIC_CANVAS_H * state.logicZoomLevel) + "px"
    });
    if (state.logicZoomLabelEl) state.logicZoomLabelEl.text(Math.round(state.logicZoomLevel * 100) + "%");
}

export function setLogicZoom(newZoom, focalPoint) {
    if (!state.logicViewportEl || !state.logicSizerEl) return;
    newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
    if (newZoom === state.logicZoomLevel) return;
    var vp = state.logicViewportEl.get(0);
    if (!focalPoint) focalPoint = { x: vp.clientWidth / 2, y: vp.clientHeight / 2 };
    var sizerOffset = state.logicSizerEl.position();
    var stageX = (vp.scrollLeft + focalPoint.x - sizerOffset.left) / state.logicZoomLevel;
    var stageY = (vp.scrollTop + focalPoint.y - sizerOffset.top) / state.logicZoomLevel;
    state.logicZoomLevel = newZoom;
    applyLogicZoomTransform();
    var newOffset = state.logicSizerEl.position();
    vp.scrollLeft = stageX * state.logicZoomLevel + newOffset.left - focalPoint.x;
    vp.scrollTop = stageY * state.logicZoomLevel + newOffset.top - focalPoint.y;
}

export function zoomLogicIn() { setLogicZoom(state.logicZoomLevel + ZOOM_STEP); }
export function zoomLogicOut() { setLogicZoom(state.logicZoomLevel - ZOOM_STEP); }
export function zoomLogicReset() { setLogicZoom(1); }

export function zoomLogicToFit() {
    if (!state.logicViewportEl) return;
    var screen = getActiveScreen();
    var nodes = (screen && screen.logic && screen.logic.nodes) || [];
    var vp = state.logicViewportEl.get(0);
    var pad = 60;
    if (!nodes.length) { zoomLogicReset(); return; }
    var minX = Math.min.apply(null, nodes.map(function (n) { return n.x; }));
    var minY = Math.min.apply(null, nodes.map(function (n) { return n.y; }));
    var maxX = Math.max.apply(null, nodes.map(function (n) { return n.x + LOGIC_NODE_W; }));
    var maxY = Math.max.apply(null, nodes.map(function (n) { return n.y + LOGIC_NODE_H; }));
    var boxW = Math.max(maxX - minX, 10), boxH = Math.max(maxY - minY, 10);
    var availW = Math.max(vp.clientWidth - pad * 2, 10);
    var availH = Math.max(vp.clientHeight - pad * 2, 10);
    var fitZoom = Math.min(availW / boxW, availH / boxH);
    fitZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitZoom));
    state.logicZoomLevel = fitZoom;
    applyLogicZoomTransform();
    var centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    vp.scrollLeft = Math.max(0, centerX * state.logicZoomLevel - vp.clientWidth / 2);
    vp.scrollTop = Math.max(0, centerY * state.logicZoomLevel - vp.clientHeight / 2);
}

export function buildLogicZoomToolbar(logicPane) {
    var bar = window.$("<div>").css({
        position: "absolute", right: "16px", bottom: "16px", "z-index": "10",
        display: "flex", "align-items": "center",
        background: "#fff", "border-radius": "4px",
        "box-shadow": "0 1px 4px rgba(0,0,0,0.3)",
        overflow: "hidden"
    }).appendTo(logicPane);

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

    zoomBtn("fa-minus", "Zoom out", zoomLogicOut);
    state.logicZoomLabelEl = window.$("<span>").css({
        width: "44px", "text-align": "center", "font-size": "11px", color: "#555"
    }).appendTo(bar);
    zoomBtn("fa-circle-o", "Reset zoom", zoomLogicReset);
    zoomBtn("fa-plus", "Zoom in", zoomLogicIn);
    zoomBtn("fa-compress", "Zoom to fit (the nodes you have, not the whole canvas)", zoomLogicToFit);
    applyLogicZoomTransform();
}
