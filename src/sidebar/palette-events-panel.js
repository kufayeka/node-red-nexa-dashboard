import { state, getActiveScreen } from "../state.js";
import { addComponentAt } from "../canvas/component-renderer.js";
import { addLogicNode } from "../logic/logic-nodes.js";

export function buildPalette(paletteEl) {
    paletteEl.empty();
    var components = (window.NEXA && typeof window.NEXA.getComponents === "function") ? window.NEXA.getComponents() : [];
    if (!components.length) {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("No components registered.").appendTo(paletteEl);
        return;
    }
    components.forEach(function (def) {
        var chip = window.$("<div>", { "class": "nexa-palette-item" }).css({
            padding: "8px",
            margin: "0 0 6px 0",
            border: "1px solid #ccc",
            "border-radius": "4px",
            background: "#fff",
            cursor: "grab",
            "font-size": "13px",
            "text-align": "center"
        }).text(def.label).appendTo(paletteEl);

        chip.draggable({
            helper: "clone",
            appendTo: "#red-ui-editor",
            revert: "invalid",
            revertDuration: 100,
            zIndex: 1000,
            stop: function (e, ui) {
                if (!state.artboardEl) {
                    if (window.RED && window.RED.notify) window.RED.notify("Open the Pages canvas first (menu → Pages)", { type: "warning", timeout: 2000 });
                    return;
                }
                if (state.activeCanvasTab !== "ui") {
                    if (window.RED && window.RED.notify) window.RED.notify("Switch to the UI tab first", { type: "warning", timeout: 2000 });
                    return;
                }
                var offset = state.artboardEl.offset();
                var x = (ui.offset.left - offset.left) / state.zoomLevel;
                var y = (ui.offset.top - offset.top) / state.zoomLevel;
                if (x >= 0 && y >= 0 && x <= state.artboardEl.width() && y <= state.artboardEl.height()) {
                    addComponentAt(def.id, x, y);
                }
            }
        });
    });
}

export function renderEventsPanel() {
    if (!state.eventsPane) return;
    state.eventsPane.empty();
    var screen = getActiveScreen();

    function sectionLabel(text) {
        window.$("<div>").css({ "font-weight": "bold", "font-size": "11px", color: "#888", margin: "10px 0 4px" }).text(text).appendTo(state.eventsPane);
    }

    function chip(label, makeNode, compId) {
        var item = window.$("<div>", { "class": "nexa-palette-item", "data-comp-id": compId || "" }).css({
            padding: "8px", margin: "0 0 6px 0", border: "1px solid #ccc",
            "border-radius": "4px", background: "#fff", cursor: "grab",
            "font-size": "12px"
        }).text(label).appendTo(state.eventsPane);
        item.draggable({
            helper: "clone",
            appendTo: "#red-ui-editor",
            revert: "invalid",
            revertDuration: 100,
            zIndex: 1000,
            stop: function (e, ui) {
                if (!state.logicArtboardEl || !state.logicArtboardEl.is(":visible")) {
                    if (window.RED && window.RED.notify) window.RED.notify("Open the Pages canvas and switch to the Logic tab first", { type: "warning", timeout: 2500 });
                    return;
                }
                var offset = state.logicArtboardEl.offset();
                var x = (ui.offset.left - offset.left) / state.logicZoomLevel;
                var y = (ui.offset.top - offset.top) / state.logicZoomLevel;
                if (x < 0 || y < 0) return;
                addLogicNode(makeNode(), x, y);
            }
        });
        return item;
    }

    sectionLabel("Lifecycle");
    chip("On Load", function () { return { type: "onload" }; });
    chip("On Render", function () { return { type: "onrender" }; });
    chip("On Close", function () { return { type: "onclose" }; });

    sectionLabel("Utility");
    chip("Function", function () { return { type: "function", code: "return msg;" }; });
    chip("Debug", function () { return { type: "debug" }; });
    chip("Inject", function () { return { type: "inject", intervalMs: 5000, payloadType: "json", payload: '{"text":"Hello World"}', once: false }; });
    chip("Reload Page", function () { return { type: "reload" }; });
    chip("Open URL", function () { return { type: "open-url", url: "", mode: "replace", newTab: false }; });

    if (screen && screen.components.length) {
        sectionLabel("Components on this screen");
        screen.components.forEach(function (comp) {
            var typeDef = window.NEXA.getComponent(comp.type);
            if (!typeDef) return;
            var shortId = comp.id.slice(-4);
            var name = (typeDef.label || comp.type) + " #" + shortId;
            (typeDef.events || []).forEach(function (evtDef) {
                chip(name + " → " + evtDef.label, function () {
                    return { type: "ui-event", compId: comp.id, event: evtDef.name };
                }, comp.id);
            });
            chip(name + " → Update", function () {
                return { type: "ui-update", compId: comp.id, config: {} };
            }, comp.id);
        });
    } else {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("Add components to the screen (Components tab) to see their event/update nodes here.").appendTo(state.eventsPane);
    }
    refreshEventsHighlight();
}

export function refreshEventsHighlight() {
    if (!state.eventsPane) return;
    state.eventsPane.find(".nexa-palette-item").css({ background: "#fff", "border-color": "#ccc" });
    if (!state.selectedIds.length) return;
    state.selectedIds.forEach(function (id) {
        state.eventsPane.find('.nexa-palette-item[data-comp-id="' + id + '"]').css({ background: "#fff3e0", "border-color": "#ff5722" });
    });
}
