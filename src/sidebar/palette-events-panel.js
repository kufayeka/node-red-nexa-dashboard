import { state, getActiveScreen, findTemplate, templateContains } from "../state.js";

function getComponentColor(category, typeId) {
    if (typeId === "@lit-component") return "#f3e8ff";
    if (typeId && typeId.indexOf("@template") === 0) return "#fef9c3";
    var cat = (category || "").toLowerCase();
    if (cat.indexOf("basic") !== -1 || cat.indexOf("shape") !== -1) return "#dbeafe";
    if (cat.indexOf("form") !== -1 || cat.indexOf("input") !== -1) return "#e0e7ff";
    if (cat.indexOf("display") !== -1 || cat.indexOf("text") !== -1) return "#d1fae5";
    if (cat.indexOf("chart") !== -1 || cat.indexOf("gauge") !== -1) return "#fef3c7";
    return "#e2e8f0";
}

function getComponentIcon(label, typeId) {
    var l = (label || "").toLowerCase();
    if (typeId === "@lit-component") return "fa-code";
    if (typeId && typeId.indexOf("@template") === 0) return "fa-clone";
    if (l.indexOf("rect") !== -1 || l.indexOf("box") !== -1) return "fa-square-o";
    if (l.indexOf("circle") !== -1) return "fa-circle-o";
    if (l.indexOf("line") !== -1) return "fa-minus";
    if (l.indexOf("text") !== -1) return "fa-font";
    if (l.indexOf("image") !== -1 || l.indexOf("picture") !== -1) return "fa-picture-o";
    if (l.indexOf("button") !== -1) return "fa-hand-pointer-o";
    if (l.indexOf("switch") !== -1 || l.indexOf("toggle") !== -1) return "fa-toggle-on";
    if (l.indexOf("slider") !== -1) return "fa-sliders";
    if (l.indexOf("chart") !== -1) return "fa-line-chart";
    if (l.indexOf("gauge") !== -1) return "fa-tachometer";
    return "fa-cube";
}

function getLogicNodeMeta(type) {
    if (type === "onload" || type === "onrender" || type === "onclose" || type === "param-input" || type === "ui-event") {
        return { color: "#e6e0f8", icon: "fa-play-circle-o", portOut: true, portIn: false };
    }
    if (type === "function") {
        return { color: "#fdf0c2", icon: "fa-code", portOut: true, portIn: true };
    }
    if (type === "debug") {
        return { color: "#87a980", icon: "fa-bug", portOut: false, portIn: true };
    }
    if (type === "inject") {
        return { color: "#a6bbcf", icon: "fa-clock-o", portOut: true, portIn: false };
    }
    if (type === "reload") {
        return { color: "#e2d96e", icon: "fa-refresh", portOut: true, portIn: true };
    }
    if (type === "open-url") {
        return { color: "#a6bbcf", icon: "fa-external-link", portOut: true, portIn: true };
    }
    if (type === "ui-update" || type === "set-template-param") {
        return { color: "#c0deed", icon: "fa-pencil-square-o", portOut: false, portIn: true };
    }
    if (type === "layer-control") {
        return { color: "#f0dcb8", icon: "fa-object-group", portOut: false, portIn: true };
    }
    return { color: "#e0e7ff", icon: "fa-cube", portOut: true, portIn: true };
}

function sectionHeader(parentEl, title) {
    return window.$("<div>", { "class": "red-ui-palette-header" }).css({
        padding: "5px 8px",
        "font-size": "11px",
        "font-weight": "bold",
        background: "var(--red-ui-palette-header-background, var(--red-ui-tertiary-background, #f3f3f3))",
        color: "var(--red-ui-palette-header-color, var(--red-ui-secondary-text-color, #475569))",
        "text-transform": "uppercase",
        "letter-spacing": "0.5px",
        display: "flex",
        "align-items": "center",
        gap: "6px",
        margin: "8px 0 4px 0",
        "border-radius": "3px",
        border: "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
        "user-select": "none"
    }).html('<i class="fa fa-angle-down"></i> <span>' + title + '</span>').appendTo(parentEl);
}

function makeComponentChip(paletteEl, label, dropTypeId, category, icon) {
    var color = getComponentColor(category, dropTypeId);
    var iconClass = icon || getComponentIcon(label, dropTypeId);

    var chip = window.$("<div>", {
        "class": "nexa-palette-item",
        "data-type-id": dropTypeId || ""
    }).css({
        display: "flex",
        "align-items": "center",
        width: "250px",
        // Centered via the flex parent's align-self, NOT "margin: auto" —
        // see the comment on state.componentsPane's own creation for why an
        // auto margin here throws jQuery UI draggable's drag-ghost tracking
        // off by however many px it takes to center a box in this pane.
        "align-self": "center",
        margin: "4px 0",
        height: "26px",
        "border-radius": "5px",
        border: "1px solid var(--red-ui-node-border, rgba(0, 0, 0, 0.25))",
        background: color,
        position: "relative",
        cursor: "grab",
        "user-select": "none",
        "box-sizing": "border-box",
        "box-shadow": "0 1px 2px rgba(0,0,0,0.05)",
        transition: "box-shadow 0.15s, border-color 0.15s",
        overflow: "hidden"
    }).appendTo(paletteEl);

    // Left Icon Container (Node-RED palette style)
    var iconContainer = window.$("<div>", { "class": "red-ui-palette-icon-container" }).css({
        position: "absolute",
        left: "0",
        top: "0",
        bottom: "0",
        width: "28px",
        "border-right": "1px solid rgba(0,0,0,0.12)",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        background: "rgba(0,0,0,0.06)",
        "border-top-left-radius": "4px",
        "border-bottom-left-radius": "4px",
        color: "rgba(0,0,0,0.65)",
        "font-size": "12px",
        "pointer-events": "none"
    }).appendTo(chip);
    window.$("<i>", { "class": "fa " + iconClass }).appendTo(iconContainer);

    // Label Element (centered text)
    window.$("<div>", { "class": "red-ui-palette-label" }).css({
        flex: "1 1 auto",
        "margin-left": "28px",
        "font-size": "12px",
        "font-weight": "500",
        "text-align": "center",
        color: "var(--red-ui-node-label-color, #222)",
        padding: "0 6px",
        overflow: "hidden",
        "text-overflow": "ellipsis",
        "white-space": "nowrap",
        "pointer-events": "none"
    }).text(label).appendTo(chip);

    chip.draggable({
        helper: "clone",
        appendTo: "#red-ui-editor",
        // Actual placement now happens in state.artboardEl's own
        // .droppable() (editor-tray.js) — that's also what makes
        // revert:"invalid" meaningful: it reverts only when the drop wasn't
        // accepted there (wrong tab / outside the artboard / no canvas
        // open), instead of always, the way it did before that droppable
        // existed.
        revert: "invalid",
        zIndex: 10000,
        // No cursorAt, and never resize ui.helper here (matching core's own
        // palette.js draggable): the actual drag-ghost/mouse offset bug
        // turned out to be the chip's own CSS (see makeComponentChip's
        // "align-self" comment above, and componentsPane's), not this
        // config — jQuery UI draggable computes the click offset once, up
        // front, from the source element's own size/margins.
        start: function (e, ui) {
            if (ui && ui.helper) {
                ui.helper.css({
                    "z-index": 10000,
                    opacity: 0.88,
                    "pointer-events": "none",
                    "box-shadow": "0 6px 16px rgba(0,0,0,0.25)"
                });
            }
        },
        stop: function () {
            if (!state.artboardEl) {
                if (window.RED && window.RED.notify) window.RED.notify("Open the Pages canvas first (menu → Pages)", { type: "warning", timeout: 2000 });
                return;
            }
            if (state.activeCanvasTab !== "ui") {
                if (window.RED && window.RED.notify) window.RED.notify("Switch to the UI tab first", { type: "warning", timeout: 2000 });
                return;
            }
        }
    });
    return chip;
}

export function buildPalette(paletteEl) {
    paletteEl.empty();
    var components = (window.NEXA && typeof window.NEXA.getComponents === "function") ? window.NEXA.getComponents() : [];
    var availableTemplates = (state.templates || []).filter(function (t) {
        if (state.editingMode === "template" && state.activeTemplateId) {
            return !templateContains(t.id, state.activeTemplateId);
        }
        return true;
    });

    if (!components.length && !availableTemplates.length) {
        window.$("<div>").css({ color: "#999", "font-size": "12px", padding: "12px", "text-align": "center" }).text("No components registered.").appendTo(paletteEl);
    }

    // Group components by category
    var categories = {};
    components.forEach(function (def) {
        var cat = def.category || "Components";
        categories[cat] = categories[cat] || [];
        categories[cat].push(def);
    });

    Object.keys(categories).forEach(function (catName) {
        sectionHeader(paletteEl, catName);
        categories[catName].forEach(function (def) {
            makeComponentChip(paletteEl, def.label, def.id, def.category, def.icon);
        });
    });

    if (availableTemplates.length) {
        sectionHeader(paletteEl, "Templates");
        availableTemplates.forEach(function (t) {
            makeComponentChip(paletteEl, t.name, "@template:" + t.id, "Templates", "fa-clone");
        });
    }

    sectionHeader(paletteEl, "Custom");
    makeComponentChip(paletteEl, "Lit Component", "@lit-component", "Custom", "fa-code");
}

export function renderEventsPanel() {
    if (!state.eventsPane) return;
    state.eventsPane.empty();
    var screen = getActiveScreen();

    function chip(container, label, makeNode, compId, nodeType) {
        var meta = getLogicNodeMeta(nodeType);

        var item = window.$("<div>", {
            "class": "nexa-palette-item",
            "data-comp-id": compId || "",
            "data-palette-type": nodeType || ""
        }).css({
            display: "flex",
            "align-items": "center",
            width: "250px",
            // Centered via the flex parent's align-self, NOT "margin: auto"
            // — see the comment on state.eventsPane's own creation for why.
            "align-self": "center",
            margin: "4px 0",
            height: "26px",
            "border-radius": "5px",
            border: "1px solid var(--red-ui-node-border, rgba(0, 0, 0, 0.25))",
            background: meta.color,
            position: "relative",
            cursor: "grab",
            "user-select": "none",
            "box-sizing": "border-box",
            "box-shadow": "0 1px 2px rgba(0,0,0,0.05)",
            transition: "box-shadow 0.15s, border-color 0.15s",
            overflow: "hidden"
        }).appendTo(container);
        // state.logicArtboardEl's .droppable() (editor-tray.js) reads this
        // back via ui.draggable.data(...) to build the actual node — a
        // logic-node chip can't be reduced to a plain type-id string the way
        // a component chip's data-type-id is, since e.g. an
        // "Instance #1234 -> Set Value" chip's node also needs its own
        // captured instanceId/paramName.
        item.data("nexaMakeNode", makeNode);

        // Input Port (Node-RED palette port)
        if (meta.portIn) {
            window.$("<div>", { "class": "red-ui-palette-port red-ui-palette-port-input" }).css({
                position: "absolute", left: "-5px", top: "7px", width: "10px", height: "10px",
                "border-radius": "3px", background: "var(--red-ui-node-port-background, #d9d9d9)",
                border: "1px solid var(--red-ui-node-border, #888)", "box-sizing": "border-box",
                "pointer-events": "none"
            }).appendTo(item);
        }

        // Left Icon Container (Node-RED palette icon container)
        var iconContainer = window.$("<div>", { "class": "red-ui-palette-icon-container" }).css({
            position: "absolute", left: "0", top: "0", bottom: "0", width: "28px",
            "border-right": "1px solid rgba(0,0,0,0.12)",
            display: "flex", "align-items": "center", "justify-content": "center",
            background: "rgba(0,0,0,0.06)", "border-top-left-radius": "4px", "border-bottom-left-radius": "4px",
            color: "rgba(0,0,0,0.65)", "font-size": "12px", "pointer-events": "none"
        }).appendTo(item);
        window.$("<i>", { "class": "fa " + meta.icon }).appendTo(iconContainer);

        // Label Element (centered text)
        window.$("<div>", { "class": "red-ui-palette-label" }).css({
            flex: "1 1 auto", "margin-left": "28px", "margin-right": meta.portOut ? "4px" : "0",
            "font-size": "11px", "font-weight": "500",
            "text-align": "center", color: "var(--red-ui-node-label-color, #222)",
            padding: "0 4px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
            "pointer-events": "none"
        }).text(label).appendTo(item);

        // Output Port (Node-RED palette port)
        if (meta.portOut) {
            window.$("<div>", { "class": "red-ui-palette-port red-ui-palette-port-output" }).css({
                position: "absolute", right: "-5px", top: "7px", width: "10px", height: "10px",
                "border-radius": "3px", background: "var(--red-ui-node-port-background, #d9d9d9)",
                border: "1px solid var(--red-ui-node-border, #888)", "box-sizing": "border-box",
                "pointer-events": "none"
            }).appendTo(item);
        }

        item.draggable({
            helper: "clone",
            appendTo: "#red-ui-editor",
            // Actual placement now happens in state.logicArtboardEl's own
            // .droppable() (editor-tray.js) — that's also what makes
            // revert:"invalid" meaningful: it reverts only when the drop
            // wasn't accepted there (Logic tab not open / no canvas open),
            // instead of always, the way it did before that droppable
            // existed.
            revert: "invalid",
            zIndex: 10000,
            // No cursorAt, and never resize ui.helper here (matching core's
            // own palette.js draggable): the actual drag-ghost/mouse offset
            // bug turned out to be this chip's own CSS ("align-self" comment
            // above, and eventsPane's), not this config — jQuery UI draggable
            // computes the click offset once, up front, from the source
            // element's own size/margins.
            start: function (e, ui) {
                if (ui && ui.helper) {
                    ui.helper.css({
                        "z-index": 10000,
                        opacity: 0.88,
                        "pointer-events": "none",
                        "box-shadow": "0 6px 16px rgba(0,0,0,0.25)"
                    });
                }
            },
            stop: function () {
                if (!state.logicArtboardEl || !state.logicArtboardEl.is(":visible")) {
                    if (window.RED && window.RED.notify) window.RED.notify("Open the Pages canvas and switch to the Logic tab first", { type: "warning", timeout: 2500 });
                }
            }
        });
        return item;
    }

    sectionHeader(state.eventsPane, "Lifecycle");
    chip(state.eventsPane, "On Load", function () { return { type: "onload" }; }, "", "onload");
    chip(state.eventsPane, "On Render", function () { return { type: "onrender" }; }, "", "onrender");
    chip(state.eventsPane, "On Close", function () { return { type: "onclose" }; }, "", "onclose");
    if (state.editingMode === "template") {
        chip(state.eventsPane, "On Params Change", function () { return { type: "param-input" }; }, "", "param-input");
    }

    sectionHeader(state.eventsPane, "Utility");
    chip(state.eventsPane, "Function", function () { return { type: "function", code: "return msg;" }; }, "", "function");
    chip(state.eventsPane, "Debug", function () { return { type: "debug" }; }, "", "debug");
    chip(state.eventsPane, "Inject", function () { return { type: "inject", intervalMs: 5000, payloadType: "json", payload: '{"text":"Hello World"}', once: false }; }, "", "inject");
    chip(state.eventsPane, "Reload Page", function () { return { type: "reload" }; }, "", "reload");
    chip(state.eventsPane, "Open URL", function () { return { type: "open-url", url: "", mode: "replace", newTab: false }; }, "", "open-url");
    chip(state.eventsPane, "Layer Control", function () { return { type: "layer-control", states: [] }; }, "", "layer-control");

    function hasSparkplugBinding(comp) {
        if (!comp) return false;
        if (comp.sparkplugBinding && typeof comp.sparkplugBinding === "string") return true;
        var props = comp.props || {};
        var keys = Object.keys(props);
        for (var i = 0; i < keys.length; i++) {
            var v = props[keys[i]];
            if (typeof v === "string" && v.indexOf("{sparkplug:") !== -1) return true;
        }
        return false;
    }

    if (screen && screen.components.length) {
        sectionHeader(state.eventsPane, "Components on this screen");
        screen.components.forEach(function (comp) {
            var shortId = comp.id.slice(-4);
            if (comp.type === "@template") {
                var template = findTemplate(comp.templateId);
                var instanceName = "Instance #" + shortId + (template ? (" (" + template.name + ")") : "");
                if (hasSparkplugBinding(comp)) {
                    chip(state.eventsPane, instanceName + " → on Sparkplug Update", function () {
                        return { type: "ui-event", compId: comp.id, event: "sparkplug-change" };
                    }, comp.id, "ui-event");
                }
                (template && template.params || []).forEach(function (param) {
                    chip(state.eventsPane, instanceName + " → Set " + param.label, function () {
                        return { type: "set-template-param", instanceId: comp.id, paramName: param.name };
                    }, comp.id, "set-template-param");
                });
                return;
            }
            if (comp.type === "@lit-component") {
                var litName = "Lit Component #" + shortId;
                if (hasSparkplugBinding(comp)) {
                    chip(state.eventsPane, litName + " → on Sparkplug Update", function () {
                        return { type: "ui-event", compId: comp.id, event: "sparkplug-change" };
                    }, comp.id, "ui-event");
                }
                (comp.litEvents || []).forEach(function (evt) {
                    chip(state.eventsPane, litName + " → on " + evt.name, function () {
                        return { type: "ui-event", compId: comp.id, event: evt.name };
                    }, comp.id, "ui-event");
                });
                chip(state.eventsPane, litName + " → Update", function () {
                    return { type: "ui-update", compId: comp.id, config: {} };
                }, comp.id, "ui-update");
                return;
            }
            var typeDef = window.NEXA.getComponent(comp.type);
            var name = (typeDef ? typeDef.label : comp.type) + " #" + shortId;
            if (hasSparkplugBinding(comp)) {
                chip(state.eventsPane, name + " → on Sparkplug Update", function () {
                    return { type: "ui-event", compId: comp.id, event: "sparkplug-change" };
                }, comp.id, "ui-event");
            }
            if (typeDef) {
                (typeDef.events || []).forEach(function (evtDef) {
                    chip(state.eventsPane, name + " → " + evtDef.label, function () {
                        return { type: "ui-event", compId: comp.id, event: evtDef.name };
                    }, comp.id, "ui-event");
                });
            }
            chip(state.eventsPane, name + " → Update", function () {
                return { type: "ui-update", compId: comp.id, config: {} };
            }, comp.id, "ui-update");
        });
    } else {
        window.$("<div>").css({ color: "#999", "font-size": "12px", padding: "10px", "text-align": "center" }).text("Add components to the screen (Components tab) to see their event/update nodes here.").appendTo(state.eventsPane);
    }
    refreshEventsHighlight();
}

export function refreshEventsHighlight() {
    if (!state.eventsPane) return;
    state.eventsPane.find(".nexa-palette-item").css({
        background: "#fff",
        "border-color": "var(--red-ui-node-border, rgba(0,0,0,0.25))",
        "box-shadow": "0 1px 2px rgba(0,0,0,0.05)"
    });
    if (!state.selectedIds.length) return;
    state.selectedIds.forEach(function (id) {
        state.eventsPane.find('.nexa-palette-item[data-comp-id="' + id + '"]').css({
            background: "#fff3e0",
            "border-color": "#ff5722",
            "box-shadow": "0 0 0 2px #ff5722"
        });
    });
}


