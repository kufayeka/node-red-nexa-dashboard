import {
    state, ZOOM_STEP, LOGIC_CANVAS_W, LOGIC_CANVAS_H, LOGIC_GRID_SIZE,
    LOGIC_NODE_W, LOGIC_NODE_H, ensureScreensLoaded, getActiveScreen, findComponent, markDirty
} from "./state.js";
import { undo, redo, pushHistory } from "./history.js";
import { groupSelection, ungroupSelection, deselectAll, selectOnly, startMarqueeSelect, toggleFlipForSelection } from "./canvas/selection.js";
import { copySelection, pasteClipboard } from "./canvas/clipboard.js";
import { removeComponents, addComponentAt, addSparkplugMetricComponentAt, refreshComponentRender } from "./canvas/component-renderer.js";
import { makeSparkplugBindingPath } from "./canvas/sparkplug-live.js";
import { setZoom, buildZoomToolbar, renderActiveScreen } from "./canvas/canvas-ui.js";
import { setLogicZoom, applyLogicZoomTransform, buildLogicZoomToolbar } from "./logic/logic-zoom.js";
import { deselectAllLogic, copyLogicSelection, pasteLogicClipboard, refreshLogicSelectionVisuals, startLogicMarqueeSelect } from "./logic/logic-selection.js";
import { removeLogicNodes, renderLogicCanvas, addLogicNode } from "./logic/logic-nodes.js";
import { buildPalette, renderEventsPanel, refreshEventsHighlight } from "./sidebar/palette-events-panel.js";
import { renderPropertiesPanel } from "./sidebar/properties-panel.js";

// Broader than a plain "is this an <input>/<textarea>" check: a real code
// editor widget (RED.editor.createEditor — ace, monaco, or CodeMirror
// depending on Node-RED's own configuration) doesn't necessarily put
// keyboard focus on a bare <input>/<textarea> tag — some route typing
// through a `contenteditable` surface, or a textarea buried inside the
// editor's own wrapper. Missing this was a real, reported bug: typing
// Ctrl+C/Ctrl+V to copy/paste TEXT inside a code-editor dialog (e.g. the
// Lit Component's "Edit Code..." dialog) instead cloned/copied the
// currently-selected CANVAS component, because this canvas-wide keydown
// handler didn't recognize the editor's focused element as "text editing"
// and went ahead with its own Ctrl+C/Ctrl+V shortcut.
function isEditableTarget(target) {
    var $t = window.$(target);
    if ($t.is("input,textarea")) return true;
    return $t.closest("[contenteditable='true'], .ace_editor, .monaco-editor, .CodeMirror").length > 0;
}

export function onKeyDown(e) {
    if (!state.trayContent) return;
    var isTextField = isEditableTarget(e.target);
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
    if (state.activeCanvasTab === "ui" && !isTextField && !e.ctrlKey && !e.metaKey && e.shiftKey) {
        if (e.key === "H" || e.key === "h") {
            e.preventDefault();
            toggleFlipForSelection("h");
            return;
        }
        if (e.key === "V" || e.key === "v") {
            e.preventDefault();
            toggleFlipForSelection("v");
            return;
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

    // Mirrors core's own chart.droppable({accept:".red-ui-palette-node", ...})
    // in view.js — placement lives here, on the actual drop target, instead
    // of inside the palette chip's own draggable "stop" handler. This is
    // also what gives revert:"invalid" (see makeComponentChip) real meaning:
    // jQuery UI now has an actual accepted-target check to revert against,
    // rather than reverting on every drop because nothing was ever "valid".
    // [data-type-id] (set by makeComponentChip, but not by the Events tab's
    // logic-node chips) is what tells this apart from those.
    // "[data-sparkplug-metric]" (set by sparkplug-panel.js's metric chip) is
    // the SAME "marker attribute for accept(), rich payload via .data()"
    // split the Events tab's logic-node chips already use — a metric
    // reference (group/edge/device/name) doesn't reduce to a bare type-id
    // string the way a plain component drop does.
    state.artboardEl.droppable({
        accept: "[data-type-id], [data-sparkplug-metric]",
        tolerance: "pointer",
        drop: function (event, ui) {
            var offset = state.artboardEl.offset();
            var x = (event.pageX - offset.left) / state.zoomLevel;
            var y = (event.pageY - offset.top) / state.zoomLevel;
            if (x < 0 || y < 0 || x > state.artboardEl.width() || y > state.artboardEl.height()) return;

            var metricRef = ui.draggable.data("nexaSparkplugMetric");
            if (metricRef) {
                var screen = getActiveScreen();
                var targetComp = null;
                var hitEl = (document.elementFromPoint && event.clientX !== undefined) ? document.elementFromPoint(event.clientX, event.clientY) : null;
                if (hitEl) {
                    var $compEl = window.$(hitEl).closest("#nexa-artboard [data-id]");
                    if ($compEl.length) {
                        var compId = $compEl.attr("data-id");
                        targetComp = findComponent(compId);
                    }
                }
                if (!targetComp && screen && screen.components) {
                    for (var i = screen.components.length - 1; i >= 0; i--) {
                        var c = screen.components[i];
                        if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
                            targetComp = c;
                            break;
                        }
                    }
                }

                if (targetComp) {
                    var bindingPath = makeSparkplugBindingPath(metricRef);
                    targetComp.sparkplugBinding = bindingPath;
                    if (targetComp.props && (targetComp.props.text !== undefined || targetComp.type === "kufayeka-text-label")) {
                        targetComp.props.text = bindingPath;
                    }
                    selectOnly(targetComp.id);
                    refreshComponentRender(targetComp);
                    renderPropertiesPanel();
                    renderEventsPanel();
                    pushHistory({ t: "edit", screenId: screen.id, compId: targetComp.id, sparkplugBinding: bindingPath });
                    markDirty();
                    if (window.RED && window.RED.notify) {
                        var typeDef = window.NEXA ? window.NEXA.getComponent(targetComp.type) : null;
                        var compName = (typeDef ? typeDef.label : targetComp.type) + " #" + targetComp.id.slice(-4);
                        window.RED.notify("Assigned Sparkplug metric to " + compName + ": " + metricRef.metricName, { type: "success", timeout: 2500 });
                    }
                    return;
                }

                addSparkplugMetricComponentAt(metricRef, x, y);
                return;
            }
            var dropTypeId = ui.draggable.attr("data-type-id");
            if (dropTypeId) addComponentAt(dropTypeId, x, y);
        }
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

    // Same reasoning as state.artboardEl's droppable above. The Events tab's
    // chip() stashes its makeNode() factory via .data("nexaMakeNode", ...)
    // (there's no plain-string equivalent of a component's data-type-id,
    // since what a logic-node chip produces isn't just a type name — e.g.
    // "Instance #1234 -> Set Value" needs its own captured instanceId/param).
    // [data-palette-type] (set by that same chip(), but not by component
    // chips) is what tells this apart from those.
    state.logicArtboardEl.droppable({
        accept: "[data-palette-type]",
        tolerance: "pointer",
        drop: function (event, ui) {
            var makeNode = ui.draggable.data("nexaMakeNode");
            if (typeof makeNode !== "function") return;
            var offset = state.logicArtboardEl.offset();
            var x = (event.pageX - offset.left) / state.logicZoomLevel;
            var y = (event.pageY - offset.top) / state.logicZoomLevel;
            if (x < 0 || y < 0) return;
            var nodeX = Math.max(0, Math.round(x - LOGIC_NODE_W / 2));
            var nodeY = Math.max(0, Math.round(y - LOGIC_NODE_H / 2));
            addLogicNode(makeNode(), nodeX, nodeY);
        }
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
                // Closing the tray without explicitly clicking "Back to
                // Screens" should still leave template-editing mode — reopening
                // via the sidebar's "Open Pages Canvas" button should show
                // screens, not silently resume editing whatever template was
                // last open.
                state.editingMode = "screen";
                state.activeTemplateId = null;
            }
        });
    });
}
