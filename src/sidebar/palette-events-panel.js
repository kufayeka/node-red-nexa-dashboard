import { state, getActiveScreen, findTemplate, templateContains, Tree, Scope, Layout, getApp } from "../state.js";

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
    if (type === "template-output") return { color: "#e3d3ee", icon: "fa-sign-out", portOut: false, portIn: true };
    if (type === "template-event") return { color: "#e6e0f8", icon: "fa-sign-in", portOut: true, portIn: false };
    if (type === "onload" || type === "onrender" || type === "onclose" || type === "param-input" || type === "ui-event") {
        return { color: "#e6e0f8", icon: "fa-play-circle-o", portOut: true, portIn: false };
    }
    if (type === "route-trigger") {
        return { color: "#e6e0f8", icon: "fa-road", portOut: true, portIn: false };
    }
    if (type === "render-screen") {
        return { color: "#cde6f2", icon: "fa-desktop", portOut: true, portIn: true };
    }
    if (type === "send-to-flow") {
        return { color: "#e3d3ee", icon: "fa-paper-plane", portOut: true, portIn: true };
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
    if (type === "delay") {
        return { color: "#fdf0c2", icon: "fa-hourglass-half", portOut: true, portIn: true };
    }
    if (type === "navigate") {
        return { color: "#a6bbcf", icon: "fa-compass", portOut: true, portIn: true };
    }
    if (type === "ui-update" || type === "set-template-param") {
        return { color: "#c0deed", icon: "fa-pencil-square-o", portOut: false, portIn: true };
    }
    if (type === "layer-control") {
        return { color: "#f0dcb8", icon: "fa-object-group", portOut: false, portIn: true };
    }
    if (type === "set-variable" || type === "get-variable") {
        return { color: "#e3d3ee", icon: "fa-tag", portOut: true, portIn: true };
    }
    if (type === "on-variable-change") {
        return { color: "#c7e9c0", icon: "fa-eye", portOut: true, portIn: false };
    }
    if (type === "http-request") return { color: "#cde6f2", icon: "fa-globe", portOut: true, portIn: true };
    if (type === "populate") return { color: "#d7ecc6", icon: "fa-th-list", portOut: true, portIn: true };
    if (type === "layout") return { color: "#e8f3de", icon: "fa-columns", portOut: true, portIn: true };
    if (type === "overlay-open") return { color: "#f3dfcc", icon: "fa-window-maximize", portOut: true, portIn: true };
    if (type === "teleport") return { color: "#e8d6f0", icon: "fa-share", portOut: true, portIn: true };
    if (type === "overlay-close") return { color: "#f3dfcc", icon: "fa-window-close-o", portOut: false, portIn: true };
    if (type === "storage") return { color: "#cde6f2", icon: "fa-database", portOut: true, portIn: true };
    if (type === "cookie") return { color: "#cde6f2", icon: "fa-key", portOut: true, portIn: true };
    if (type === "sparkplug-write" || type === "sparkplug-write-multi") {
        return { color: "#bfe8d8", icon: "fa-upload", portOut: true, portIn: true };
    }
    return { color: "#e0e7ff", icon: "fa-cube", portOut: true, portIn: true };
}

/** The output names a template sends to its host ("Send to Host" nodes), in order. */
export function templateOutputs(template) {
    var out = [];
    ((template && template.logic && template.logic.nodes) || []).forEach(function (n) {
        var name = n.type === "template-output" ? (n.output || "out") : null;
        if (name && out.indexOf(name) === -1) out.push(name);
    });
    return out;
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
        display: "inline-flex",
        "align-items": "center",
        width: "max-content",
        "min-width": "140px",
        "align-self": "flex-start",
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

    // Label Element (left-aligned text, fits title)
    window.$("<div>", { "class": "red-ui-palette-label" }).css({
        flex: "1 1 auto",
        "margin-left": "28px",
        "font-size": "12px",
        "font-weight": "500",
        "text-align": "left",
        color: "var(--red-ui-node-label-color, #222)",
        padding: "0 8px 0 6px",
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

    // Frames: a box of their own, optionally laying out their children (src/model/layout.js)
    sectionHeader(paletteEl, "Layout");
    makeComponentChip(paletteEl, "Frame", "@frame:none", "Layout", "fa-square-o");
    makeComponentChip(paletteEl, "Row (auto layout)", "@frame:horizontal", "Layout", "fa-columns");
    makeComponentChip(paletteEl, "Column (auto layout)", "@frame:vertical", "Layout", "fa-bars");
    makeComponentChip(paletteEl, "Grid", "@frame:grid", "Layout", "fa-th");
    makeComponentChip(paletteEl, "Carousel", "@frame:carousel", "Layout", "fa-film");

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
        var compTemplates = availableTemplates.filter(function (t) { return t.kind === "component"; });
        var compositeTemplates = availableTemplates.filter(function (t) { return t.kind !== "component"; });
        if (compositeTemplates.length) {
            sectionHeader(paletteEl, "Composite Templates");
            compositeTemplates.forEach(function (t) {
                makeComponentChip(paletteEl, t.name, "@template:" + t.id, "Composite Templates", "fa-clone");
            });
        }
        if (compTemplates.length) {
            sectionHeader(paletteEl, "Component Templates");
            compTemplates.forEach(function (t) {
                makeComponentChip(paletteEl, t.name, "@template:" + t.id, "Component Templates", "fa-puzzle-piece");
            });
        }
    }

    sectionHeader(paletteEl, "Custom");
    makeComponentChip(paletteEl, "Lit Component", "@lit-component", "Custom", "fa-code");
}

export function renderEventsPanel() {
    if (!state.eventsPane) return;
    state.eventsPane.empty();
    var screen = getActiveScreen();

    function chip(container, label, makeNode, compId, nodeType, disabled, disabledReason) {
        var meta = getLogicNodeMeta(nodeType);
        var isDisabled = Boolean(disabled);

        var item = window.$("<div>", {
            "class": "nexa-palette-item" + (isDisabled ? " nexa-palette-item-disabled" : ""),
            "data-comp-id": compId || "",
            "data-palette-type": nodeType || "",
            "title": isDisabled ? (disabledReason || "This node is disabled in this mode") : ""
        }).css({
            display: "inline-flex",
            "align-items": "center",
            width: "max-content",
            "min-width": "140px",
            "align-self": "flex-start",
            margin: "4px 0",
            height: "26px",
            "border-radius": "5px",
            border: "1px solid var(--red-ui-node-border, rgba(0, 0, 0, 0.25))",
            background: meta.color,
            position: "relative",
            cursor: isDisabled ? "not-allowed" : "grab",
            opacity: isDisabled ? 0.42 : 1,
            filter: isDisabled ? "grayscale(0.6)" : "none",
            "user-select": "none",
            "box-sizing": "border-box",
            "box-shadow": isDisabled ? "none" : "0 1px 2px rgba(0,0,0,0.05)",
            transition: "box-shadow 0.15s, border-color 0.15s, opacity 0.15s",
            overflow: "hidden"
        }).appendTo(container);

        if (isDisabled) {
            item.attr("draggable", "false");
            item.on("mousedown click dragstart", function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (disabledReason && window.RED && window.RED.notify) {
                    window.RED.notify(disabledReason, { type: "warning", timeout: 2500 });
                }
                return false;
            });
        } else {
            item.data("nexaMakeNode", makeNode);
        }

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

        // Label Element (left-aligned text, fits title)
        window.$("<div>", { "class": "red-ui-palette-label" }).css({
            flex: "1 1 auto", "margin-left": "28px", "margin-right": meta.portOut ? "8px" : "4px",
            "font-size": "11px", "font-weight": "500",
            "text-align": "left", color: "var(--red-ui-node-label-color, #222)",
            padding: "0 8px 0 6px", "white-space": "nowrap",
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

        if (!isDisabled) {
            item.draggable({
                helper: "clone",
                appendTo: "#red-ui-editor",
                revert: "invalid",
                zIndex: 10000,
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
        }
        return item;
    }

    sectionHeader(state.eventsPane, "Lifecycle & Routing");
    if (state.editingMode === "flow") {
        chip(state.eventsPane, "Route Trigger", function () {
            var activeFl = getActiveScreen();
            var ep = (activeFl && activeFl.endpoint) || "/";
            return { type: "route-trigger", path: ep, cookies: "", includeDevice: true };
        }, "", "route-trigger");

        chip(state.eventsPane, "Route Not Found", function () {
            return { type: "route-not-found", cookies: "", includeDevice: true };
        }, "", "route-not-found");

        chip(state.eventsPane, "Render Screen", function () {
            return { type: "render-screen", screenId: (state.screens[0] && state.screens[0].id) || "", forwardPayload: true };
        }, "", "render-screen");

        chip(state.eventsPane, "Send to Flow", function () {
            return { type: "send-to-flow", action: "" };
        }, "", "send-to-flow", true, "Send to Flow is only used inside Screen Logic to dispatch data back to Flow.");

        chip(state.eventsPane, "Goto Screen (SPA)", function () {
            return { type: "navigate", mode: "screen", screenId: "", forwardPayload: true };
        }, "", "navigate", true, "Goto Screen is disabled in Flow Logic. Use 'Render Screen' to serve views in a Flow.");
    } else if (state.editingMode === "screen" || state.editingMode === "screen-variable" || state.editingMode === "app-variable") {
        chip(state.eventsPane, "On Load", function () { return { type: "onload" }; }, "", "onload");
        chip(state.eventsPane, "On Render", function () { return { type: "onrender" }; }, "", "onrender");
        chip(state.eventsPane, "On Close", function () { return { type: "onclose" }; }, "", "onclose");
        // the window's width crossed a breakpoint: msg.payload = "desktop" | "tablet" | "phone"
        chip(state.eventsPane, "On Breakpoint Change", function () { return { type: "on-variable-change", scope: "@app", name: "$breakpoint" }; }, "", "on-variable-change");

        chip(state.eventsPane, "Send to Flow", function () {
            return { type: "send-to-flow", action: "" };
        }, "", "send-to-flow");

        chip(state.eventsPane, "Goto Screen (SPA)", function () {
            return { type: "navigate", mode: "screen", screenId: "", forwardPayload: true };
        }, "", "navigate");

        chip(state.eventsPane, "Route Trigger", function () {
            return { type: "route-trigger" };
        }, "", "route-trigger", true, "Route Trigger is only available in Flow Logic.");

        chip(state.eventsPane, "Route Not Found", function () {
            return { type: "route-not-found" };
        }, "", "route-not-found", true, "Route Not Found is only available in Flow Logic.");

        chip(state.eventsPane, "Render Screen", function () {
            return { type: "render-screen" };
        }, "", "render-screen", true, "Render Screen is only used in Flow Logic.");
    } else {
        chip(state.eventsPane, "On Load", function () { return { type: "onload" }; }, "", "onload");
        chip(state.eventsPane, "On Render", function () { return { type: "onrender" }; }, "", "onrender");
        chip(state.eventsPane, "On Params Change", function () { return { type: "param-input" }; }, "", "param-input");
        sectionHeader(state.eventsPane, "Template");
        chip(state.eventsPane, "Send to Host", function () { return { type: "template-output", output: "out" }; }, "", "template-output");
    }

    sectionHeader(state.eventsPane, "Utility");
    chip(state.eventsPane, "Function", function () { return { type: "function", code: "return msg;" }; }, "", "function");
    chip(state.eventsPane, "Debug", function () { return { type: "debug" }; }, "", "debug");
    chip(state.eventsPane, "Inject", function () { return { type: "inject", intervalMs: 5000, payloadType: "json", payload: '{"text":"Hello World"}', once: false }; }, "", "inject");
    chip(state.eventsPane, "Reload Page", function () { return { type: "reload" }; }, "", "reload");
    chip(state.eventsPane, "Open URL", function () { return { type: "open-url", url: "", mode: "replace", newTab: false }; }, "", "open-url");
    chip(state.eventsPane, "Delay", function () { return { type: "delay", delay: 500, unit: "ms" }; }, "", "delay");
    chip(state.eventsPane, "Layer Control", function () { return { type: "layer-control", states: [] }; }, "", "layer-control");

    // Exactly 3 variable nodes (state management: get, set, watch with multiple dependencies)
    sectionHeader(state.eventsPane, "Variables");
    chip(state.eventsPane, "Set Variable", function () { return { type: "set-variable", scope: "", name: "", op: "set", valueSource: "payload" }; }, "", "set-variable");
    chip(state.eventsPane, "Get Variable", function () { return { type: "get-variable", scope: "", name: "", target: "payload" }; }, "", "get-variable");
    chip(state.eventsPane, "Watch Variable", function () { return { type: "on-variable-change", variables: [] }; }, "", "on-variable-change");

    sectionHeader(state.eventsPane, "Lists");
    chip(state.eventsPane, "Populate (repeat a template)", function () {
        var first = (state.templates || []).filter(function (t) { return !(state.editingMode === "template" && t.id === state.activeTemplateId); })[0];
        var p0 = first && (first.params || [])[0];
        return { type: "populate", container: "", template: first ? first.id : "", itemParam: p0 ? p0.name : undefined, mode: "append", key: "id", valueSource: "payload" };
    }, "", "populate");

    // the colour mode ({$colorMode}): light / dark / the viewer's system setting
    sectionHeader(state.eventsPane, "Theme");
    chip(state.eventsPane, "Set colour mode (msg.payload: light / dark / system)", function () { return { type: "set-variable", scope: "@app", name: "$colorMode", op: "set", valueSource: "payload" }; }, "", "set-variable");
    chip(state.eventsPane, "Dark mode", function () { return { type: "set-variable", scope: "@app", name: "$colorMode", op: "set", valueSource: "static", value: "dark" }; }, "", "set-variable");
    chip(state.eventsPane, "Light mode", function () { return { type: "set-variable", scope: "@app", name: "$colorMode", op: "set", valueSource: "static", value: "light" }; }, "", "set-variable");
    chip(state.eventsPane, "On colour mode change", function () { return { type: "on-variable-change", variables: [{ scope: "@app", name: "$colorMode" }], scope: "@app", name: "$colorMode" }; }, "", "on-variable-change");

    sectionHeader(state.eventsPane, "Web & data");
    chip(state.eventsPane, "HTTP Request", function () { return { type: "http-request", method: "GET", url: "", body: "payload", timeout: 10000 }; }, "", "http-request");
    chip(state.eventsPane, "Storage", function () { return { type: "storage", action: "get", store: "local", key: "", target: "payload", valueSource: "payload" }; }, "", "storage");
    chip(state.eventsPane, "Cookie", function () { return { type: "cookie", action: "get", name: "", target: "payload", valueSource: "payload", path: "/", sameSite: "Lax" }; }, "", "cookie");

    sectionHeader(state.eventsPane, "Sparkplug");
    chip(state.eventsPane, "Sparkplug Write", function () { return { type: "sparkplug-write", tag: "" }; }, "", "sparkplug-write");
    chip(state.eventsPane, "Sparkplug Write Multi", function () { return { type: "sparkplug-write-multi" }; }, "", "sparkplug-write-multi");

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

    // dialogs / drawers: Open (its output: when it closes, with the result) / Close / their events
    var overlays = screen ? Tree.allNodes(screen).filter(function (n) { return !!Layout.overlayOf(n); }) : [];
    sectionHeader(state.eventsPane, "Overlays (dialogs, drawers)");
    overlays.forEach(function (o) {
        var label = (o.name || (Layout.overlayOf(o).kind === "drawer" ? "Drawer" : "Dialog")) + " #" + o.id.slice(-4);
        chip(state.eventsPane, "Open " + label, function () { return { type: "overlay-open", overlay: o.id }; }, o.id, "overlay-open");
        chip(state.eventsPane, "Close " + label, function () { return { type: "overlay-close", overlay: o.id, valueSource: "payload" }; }, o.id, "overlay-close");
        chip(state.eventsPane, label + " → on Open", function () { return { type: "ui-event", compId: o.id, event: "open" }; }, o.id, "ui-event");
        chip(state.eventsPane, label + " → on Close", function () { return { type: "ui-event", compId: o.id, event: "close" }; }, o.id, "ui-event");
    });
    chip(state.eventsPane, "Close the top overlay", function () { return { type: "overlay-close", overlay: "", valueSource: "payload" }; }, "", "overlay-close");
    if (!overlays.length) window.$("<div>").css({ "font-size": "11px", color: "#999", margin: "2px 0 6px" }).text("Make a frame a Dialog or a Drawer: Properties → Overlay → Show as.").appendTo(state.eventsPane);

    // teleport: a node drawn in a target / on the page, or back home (the ones set to teleport, then any)
    sectionHeader(state.eventsPane, "Teleport");
    var teleporting = screen ? Tree.allNodes(screen).filter(function (n) { return typeof n.teleport === "string" && n.teleport; }) : [];
    teleporting.forEach(function (n) {
        var nm = (n.name || n.type.replace(/^@/, "")) + " #" + n.id.slice(-4);
        chip(state.eventsPane, "Teleport " + nm + " → " + (n.teleport === "@page" ? "page" : n.teleport), function () { return { type: "teleport", node: n.id, to: n.teleport, toSource: "static" }; }, n.id, "teleport");
        chip(state.eventsPane, "Send " + nm + " home", function () { return { type: "teleport", node: n.id, to: "", toSource: "static" }; }, n.id, "teleport");
    });
    chip(state.eventsPane, "Teleport a node (choose)", function () { return { type: "teleport", node: "", to: "@page", toSource: "static" }; }, "", "teleport");

    // every frame: a Layout node to wire a Populate into (selecting the frame on the canvas highlights it)
    var frames = screen ? Tree.allNodes(screen).filter(function (n) { return n.type === "@frame"; }) : [];
    if (frames.length) {
        sectionHeader(state.eventsPane, "Layouts on this screen");
        frames.forEach(function (f) {
            var kind = Layout.hasAutoLayout(f) ? { horizontal: "row", vertical: "column", grid: "grid", carousel: "carousel" }[Layout.layoutOf(f).mode] : "frame";
            var defaultKindName = { horizontal: "Row", vertical: "Column", grid: "Grid", carousel: "Carousel" }[Layout.layoutOf(f)?.mode] || "Frame";
            var baseName = (f.name && f.name !== "Frame" && f.name !== "Row" && f.name !== "Column" && f.name !== "Grid") ? f.name : defaultKindName;
            var frameDisplayName = f.name || (baseName + " #" + f.id.slice(-4));
            var label = frameDisplayName + (Layout.hasAutoLayout(f) ? " (" + kind + ")" : "");
            chip(state.eventsPane, label, function () {
                return { type: "layout", container: f.id };
            }, f.id, "layout");
            // a carousel: which slide is shown (msg.index, and msg.item for a populated one)
            if (Layout.layoutOf(f).mode === "carousel") {
                chip(state.eventsPane, frameDisplayName + " → on Slide Change", function () {
                    return { type: "ui-event", compId: f.id, event: "slide-change" };
                }, f.id, "ui-event");
            }
        });
    }

    // every component at any depth (groups / frames have no events of their own)
    var eventComps = screen ? Tree.allNodes(screen).filter(function (n) { return !Tree.isContainer(n) || Tree.isSlotHost(n); }) : [];
    if (eventComps.length) {
        sectionHeader(state.eventsPane, "Components on this screen");
        eventComps.forEach(function (comp) {
            var shortId = comp.id.slice(-4);
            if (comp.type === "@template") {
                var template = findTemplate(comp.templateId);
                var baseName = comp.name || (template ? template.name : "Instance");
                var instanceName = comp.name ? comp.name : (baseName + " #" + shortId);
                if (hasSparkplugBinding(comp)) {
                    chip(state.eventsPane, instanceName + " → on Sparkplug Update", function () {
                        return { type: "ui-event", compId: comp.id, event: "sparkplug-change" };
                    }, comp.id, "ui-event");
                }
                // what the template sends out (its "Send to Host" nodes, by output name)
                templateOutputs(template).forEach(function (name) {
                    chip(state.eventsPane, instanceName + " → on " + name, function () {
                        return { type: "template-event", instanceId: comp.id, output: name };
                    }, comp.id, "template-event");
                });
                (template && template.params || []).forEach(function (param) {
                    chip(state.eventsPane, instanceName + " → Set " + param.label, function () {
                        return { type: "set-template-param", instanceId: comp.id, paramName: param.name };
                    }, comp.id, "set-template-param");
                });
                return;
            }
            if (comp.type === "@lit-component") {
                var litBase = comp.name || "Lit Component";
                var litName = comp.name ? comp.name : (litBase + " #" + shortId);
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
            var baseName = comp.name || (typeDef ? typeDef.label : comp.type);
            var name = comp.name ? comp.name : (baseName + " #" + shortId);
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


