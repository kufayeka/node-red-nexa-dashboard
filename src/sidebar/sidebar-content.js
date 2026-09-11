import { state, ensureScreensLoaded } from "../state.js";
import { buildPalette, renderEventsPanel } from "./palette-events-panel.js";
import { renderPropertiesPanel } from "./properties-panel.js";
import { renderLayersPanel } from "../canvas/layers.js";
import { renderScreenList, renderScreenForm, addScreenFromSidebar } from "./screens-panel.js";

export function buildSidebarContent() {
    var container = window.$("<div>").css({ height: "100%", display: "flex", "flex-direction": "column" });

    window.$("<button>", { type: "button" }).text("Open Pages Canvas").css({ margin: "8px", width: "calc(100% - 16px)" })
        .on("click", function () { window.RED.actions.invoke("nexa:open-pages-editor"); })
        .appendTo(container);

    var tabsWrap = window.$("<div>").css({ flex: "0 0 auto" }).appendTo(container);
    var ul = window.$("<ul>").appendTo(tabsWrap);

    var panesWrap = window.$("<div>").css({ flex: "1 1 auto", overflow: "auto", position: "relative" }).appendTo(container);
    state.componentsPane = window.$("<div>").css({ padding: "8px" }).appendTo(panesWrap);
    var screensPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.propertiesPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.layersPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.eventsPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);

    state.screenListEl = window.$("<div>", { "class": "nexa-screen-list" }).css({ "margin-bottom": "8px" }).appendTo(screensPane);
    window.$("<button>", { type: "button" }).text("+ Add Screen").css({ width: "100%" }).on("click", addScreenFromSidebar).appendTo(screensPane);
    state.screenFormEl = window.$("<div>").css({ "margin-top": "14px", "border-top": "1px solid #ddd", "padding-top": "10px" }).appendTo(screensPane);

    var sidebarTabs = window.RED.tabs.create({
        element: ul,
        onchange: function (tab) {
            if (!tab) return;
            state.componentsPane.toggle(tab.id === "components");
            screensPane.toggle(tab.id === "screens");
            state.propertiesPane.toggle(tab.id === "properties");
            state.layersPane.toggle(tab.id === "layers");
            state.eventsPane.toggle(tab.id === "events");
            if (tab.id === "screens") {
                ensureScreensLoaded(function () {
                    renderScreenList();
                    renderScreenForm();
                });
            }
            if (tab.id === "components") buildPalette(state.componentsPane);
            if (tab.id === "properties") renderPropertiesPanel();
            if (tab.id === "layers") renderLayersPanel();
            if (tab.id === "events") renderEventsPanel();
        }
    });
    sidebarTabs.addTab({ id: "components", label: "Components" });
    sidebarTabs.addTab({ id: "screens", label: "Screens" });
    sidebarTabs.addTab({ id: "properties", label: "Properties" });
    sidebarTabs.addTab({ id: "layers", label: "Layers" });
    sidebarTabs.addTab({ id: "events", label: "Events" });

    return container;
}
