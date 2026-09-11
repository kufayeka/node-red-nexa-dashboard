import {
    state, ZOOM_STEP, LOGIC_CANVAS_W, LOGIC_CANVAS_H, LOGIC_GRID_SIZE,
    ensureScreensLoaded
} from "./state.js";
import { undo, redo } from "./history.js";
import { groupSelection, ungroupSelection, deselectAll, startMarqueeSelect } from "./canvas/selection.js";
import { copySelection, pasteClipboard } from "./canvas/clipboard.js";
import { removeComponents } from "./canvas/component-renderer.js";
import { setZoom, buildZoomToolbar, renderActiveScreen } from "./canvas/canvas-ui.js";
import { setLogicZoom, applyLogicZoomTransform, buildLogicZoomToolbar } from "./logic/logic-zoom.js";
import { deselectAllLogic, copyLogicSelection, pasteLogicClipboard, refreshLogicSelectionVisuals, startLogicMarqueeSelect } from "./logic/logic-selection.js";
import { removeLogicNodes, renderLogicCanvas } from "./logic/logic-nodes.js";
import { buildPalette, renderEventsPanel, refreshEventsHighlight } from "./sidebar/palette-events-panel.js";

export function onKeyDown(e) {
    if (!state.trayContent) return;
    var isTextField = window.$(e.target).is("input,textarea");
    if ((e.key === "Delete" || e.key === "Backspace") && !isTextField) {
        if (state.activeCanvasTab === "logic") {
            if (state.logicSelectedIds.length) {
                e.preventDefault();
                removeLogicNodes(state.logicSelectedIds.slice());
            }
            return;
        }
        if (state.selectedIds.length) {
            e.preventDefault();
            removeComponents(state.selectedIds.slice());
            return;
        }
    }
    if ((e.ctrlKey || e.metaKey) && !isTextField) {
        if (e.key === "z" || e.key === "Z") {
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
        } else if (e.key === "y" || e.key === "Y") {
            e.preventDefault();
            redo();
        } else if (e.key === "g" || e.key === "G") {
            if (state.activeCanvasTab === "ui") {
                e.preventDefault();
                if (e.shiftKey) ungroupSelection(); else groupSelection();
            }
        } else if (e.key === "c" || e.key === "C") {
            e.preventDefault();
            if (state.activeCanvasTab === "logic") copyLogicSelection(false);
            else copySelection(false);
        } else if (e.key === "x" || e.key === "X") {
            e.preventDefault();
            if (state.activeCanvasTab === "logic") copyLogicSelection(true);
            else copySelection(true);
        } else if (e.key === "v" || e.key === "V") {
            e.preventDefault();
            if (state.activeCanvasTab === "logic") pasteLogicClipboard();
            else pasteClipboard();
        }
    }
}

export function buildCanvasArea(trayBody) {
    trayBody.css({
        height: "100%", position: "relative", padding: "0", overflow: "hidden",
        display: "flex", "flex-direction": "column"
    });

    state.zoomLevel = 1;

    var canvasTabsWrap = window.$("<div>").css({ flex: "0 0 auto", background: "#fff", "border-bottom": "1px solid #ddd" }).appendTo(trayBody);
    var canvasTabsUl = window.$("<ul>").appendTo(canvasTabsWrap);
    var panesWrap = window.$("<div>").css({ flex: "1 1 auto", position: "relative", overflow: "hidden" }).appendTo(trayBody);

    var uiPane = window.$("<div>").css({ position: "absolute", top: "0", left: "0", right: "0", bottom: "0" }).appendTo(panesWrap);
    var logicPane = window.$("<div>").css({ position: "absolute", top: "0", left: "0", right: "0", bottom: "0", display: "none" }).appendTo(panesWrap);

    state.viewportEl = window.$("<div>").css({
        height: "100%", position: "relative", overflow: "auto",
        display: "flex", background: "#d8d8d8"
    }).appendTo(uiPane);

    state.sizerEl = window.$("<div>").css({ margin: "auto", "flex-shrink": "0", position: "relative" }).appendTo(state.viewportEl);

    state.stageEl = window.$("<div>").css({
        position: "absolute", left: "0", top: "0",
        "transform-origin": "0 0"
    }).appendTo(state.sizerEl);

    state.artboardEl = window.$("<div>", { id: "nexa-artboard" }).css({
        position: "relative",
        "box-shadow": "0 0 0 1px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.15)"
    }).appendTo(state.stageEl);

    state.artboardEl.on("mousedown", function (e) {
        if (e.target !== state.artboardEl.get(0)) return;
        if (!e.shiftKey) deselectAll();
        startMarqueeSelect(e);
    });

    state.viewportEl.on("wheel", function (e) {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        var oe = e.originalEvent;
        var vpOffset = state.viewportEl.offset();
        var focalPoint = { x: oe.clientX - vpOffset.left, y: oe.clientY - vpOffset.top };
        setZoom(state.zoomLevel + (oe.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), focalPoint);
    });

    buildZoomToolbar(uiPane);

    state.logicZoomLevel = 1;
    state.logicViewportEl = window.$("<div>").css({
        height: "100%", position: "relative", overflow: "auto", background: "#e9e9e9"
    }).appendTo(logicPane);
    state.logicSizerEl = window.$("<div>").css({ position: "relative" }).appendTo(state.logicViewportEl);
    state.logicStageEl = window.$("<div>").css({
        position: "absolute", left: "0", top: "0", "transform-origin": "0 0"
    }).appendTo(state.logicSizerEl);
    state.logicArtboardEl = window.$("<div>").css({
        position: "relative", width: LOGIC_CANVAS_W + "px", height: LOGIC_CANVAS_H + "px",
        "background-color": "#fff",
        "background-image":
            "linear-gradient(to right, #e3e3e3 1px, transparent 1px)," +
            "linear-gradient(to bottom, #e3e3e3 1px, transparent 1px)",
        "background-size": LOGIC_GRID_SIZE + "px " + LOGIC_GRID_SIZE + "px"
    }).appendTo(state.logicStageEl);
    state.logicArtboardEl.on("mousedown", function (e) {
        if (e.target !== state.logicArtboardEl.get(0)) return;
        if (!e.shiftKey) deselectAllLogic();
        startLogicMarqueeSelect(e);
    });

    state.logicViewportEl.on("wheel", function (e) {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        var oe = e.originalEvent;
        var vpOffset = state.logicViewportEl.offset();
        var focalPoint = { x: oe.clientX - vpOffset.left, y: oe.clientY - vpOffset.top };
        setLogicZoom(state.logicZoomLevel + (oe.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP), focalPoint);
    });
    applyLogicZoomTransform();
    buildLogicZoomToolbar(logicPane);

    var canvasTabs = window.RED.tabs.create({
        element: canvasTabsUl,
        onchange: function (tab) {
            if (!tab) return;
            state.activeCanvasTab = tab.id;
            uiPane.toggle(tab.id === "ui");
            logicPane.toggle(tab.id === "logic");
            if (tab.id === "logic") {
                renderLogicCanvas();
                refreshEventsHighlight();
            } else {
                state.logicSelectedIds = [];
                refreshLogicSelectionVisuals();
            }
        }
    });
    canvasTabs.addTab({ id: "ui", label: "UI" });
    canvasTabs.addTab({ id: "logic", label: "Logic" });

    window.$(document).on("keydown.nexa", onKeyDown);
}

export function registerPagesEditorAction() {
    window.RED.actions.add("nexa:open-pages-editor", function () {
        window.RED.tray.show({
            id: "nexa-pages-editor",
            title: "Pages",
            width: Infinity,
            buttons: [
                {
                    id: "nexa-pages-editor-close",
                    text: "Close",
                    click: function () { window.RED.tray.close(); }
                }
            ],
            open: function (tray) {
                state.trayContent = tray.find(".red-ui-tray-body");
                buildCanvasArea(state.trayContent);
                ensureScreensLoaded(function () { renderActiveScreen(); });
                if (state.componentsPane) buildPalette(state.componentsPane);
                if (state.eventsPane) renderEventsPanel();
            },
            show: function () {
                window.$("#red-ui-header-shade").hide();
            },
            close: function () {
                window.$(document).off("keydown.nexa");
                state.trayContent = null;
                state.artboardEl = null;
                state.stageEl = null;
                state.sizerEl = null;
                state.viewportEl = null;
                state.zoomLabelEl = null;
                state.logicViewportEl = null;
                state.logicArtboardEl = null;
                state.logicSvgEl = null;
                state.logicStageEl = null;
                state.logicSizerEl = null;
                state.logicZoomLabelEl = null;
                state.logicSelectedIds = [];
                state.activeCanvasTab = "ui";
                state.undoStack = [];
                state.redoStack = [];
            }
        });
    });
}
