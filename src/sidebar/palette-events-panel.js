import { state, getActiveScreen, findTemplate, templateContains } from "../state.js";
import { addComponentAt } from "../canvas/component-renderer.js";
import { addLogicNode } from "../logic/logic-nodes.js";

function makeComponentChip(paletteEl, label, dropTypeId) {
    var chip = window.$("<div>", { "class": "nexa-palette-item" }).css({
        padding: "8px",
        margin: "0 0 6px 0",
        border: "1px solid #ccc",
        "border-radius": "4px",
        background: "#fff",
        cursor: "grab",
        "font-size": "13px",
        "text-align": "center"
    }).text(label).appendTo(paletteEl);

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
                addComponentAt(dropTypeId, x, y);
            }
        }
    });
    return chip;
}

export function buildPalette(paletteEl) {
    paletteEl.empty();
    var components = (window.NEXA && typeof window.NEXA.getComponents === "function") ? window.NEXA.getComponents() : [];
    // While editing a Template, dropping a template that already (directly or
    // transitively) contains the one being edited would close a cycle — see
    // templateContains() in state.js. Filtered out of the palette entirely
    // rather than allowed-then-rejected, so there's nothing confusing to drag
    // in the first place.
    var availableTemplates = (state.templates || []).filter(function (t) {
        if (state.editingMode === "template" && state.activeTemplateId) {
            return !templateContains(t.id, state.activeTemplateId);
        }
        return true;
    });

    if (!components.length) {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("No components registered.").appendTo(paletteEl);
    }

    components.forEach(function (def) { makeComponentChip(paletteEl, def.label, def.id); });

    if (availableTemplates.length) {
        window.$("<div>").css({ "font-weight": "bold", "font-size": "11px", color: "#888", margin: "10px 0 4px" }).text("Templates").appendTo(paletteEl);
        availableTemplates.forEach(function (t) { makeComponentChip(paletteEl, t.name, "@template:" + t.id); });
    }

    // Generic Lit Component node — always available, not tied to any
    // registered component package. Its code is authored per-instance in
    // the Properties panel after dropping it (see addComponentAt).
    window.$("<div>").css({ "font-weight": "bold", "font-size": "11px", color: "#888", margin: "10px 0 4px" }).text("Custom").appendTo(paletteEl);
    makeComponentChip(paletteEl, "Lit Component", "@lit-component");
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
    // Subflow-Input equivalent — only meaningful while authoring a template's
    // own internal logic, since it's the only surface with declared `params`
    // to react to. Outputs the instance's current param snapshot as
    // msg.payload whenever any param changes, or once on mount.
    if (state.editingMode === "template") {
        chip("On Params Change", function () { return { type: "param-input" }; });
    }

    sectionLabel("Utility");
    chip("Function", function () { return { type: "function", code: "return msg;" }; });
    chip("Debug", function () { return { type: "debug" }; });
    chip("Inject", function () { return { type: "inject", intervalMs: 5000, payloadType: "json", payload: '{"text":"Hello World"}', once: false }; });
    chip("Reload Page", function () { return { type: "reload" }; });
    chip("Open URL", function () { return { type: "open-url", url: "", mode: "replace", newTab: false }; });

    if (screen && screen.components.length) {
        sectionLabel("Components on this screen");
        screen.components.forEach(function (comp) {
            var shortId = comp.id.slice(-4);
            // A "@template" instance exposes one "Set <param>" chip per
            // param DECLARED BY ITS TEMPLATE (name-addressed now, not tied
            // to any specific internal node) — see "Phase 3 revision" in the
            // plan. Nested pass-through composes through ordinary wiring
            // (this instance's own template can itself have a param-input ->
            // Function -> set-template-param targeting one of ITS OWN nested
            // instances, authored on that template's own canvas), so nothing
            // special is needed here for nesting depth.
            if (comp.type === "@template") {
                var template = findTemplate(comp.templateId);
                var instanceName = "Instance #" + shortId + (template ? (" (" + template.name + ")") : "");
                (template && template.params || []).forEach(function (param) {
                    chip(instanceName + " → Set " + param.label, function () {
                        return { type: "set-template-param", instanceId: comp.id, paramName: param.name };
                    }, comp.id);
                });
                return;
            }
            // A "@lit-component" instance's events/bindable-props are
            // declared directly on the instance (comp.litEvents/litBindable)
            // rather than looked up from a registered type — there is no
            // separate registry entry to look up, since the code IS the
            // instance. The plain "ui-update"/ui-update-dialog.js path is
            // reused as-is for setting bindable props (it already reads
            // comp.litBindable when the target component is a Lit instance).
            if (comp.type === "@lit-component") {
                var litName = "Lit Component #" + shortId;
                (comp.litEvents || []).forEach(function (evt) {
                    chip(litName + " → on " + evt.name, function () {
                        return { type: "ui-event", compId: comp.id, event: evt.name };
                    }, comp.id);
                });
                chip(litName + " → Update", function () {
                    return { type: "ui-update", compId: comp.id, config: {} };
                }, comp.id);
                return;
            }
            var typeDef = window.NEXA.getComponent(comp.type);
            if (!typeDef) return;
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
