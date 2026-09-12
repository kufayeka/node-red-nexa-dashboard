import { state, ensureScreensLoaded } from "../state.js";
import { buildPalette, renderEventsPanel } from "./palette-events-panel.js";
import { renderPropertiesPanel } from "./properties-panel.js";
import { renderLayersPanel } from "../canvas/layers.js";
import { renderScreenList, renderScreenForm, addScreenFromSidebar } from "./screens-panel.js";
import { renderTemplateList, renderTemplateForm, addTemplateFromSidebar, exitTemplateEditing } from "./templates-panel.js";

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
    state.templatesPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);

    state.screenListEl = window.$("<div>", { "class": "nexa-screen-list" }).css({ "margin-bottom": "8px" }).appendTo(screensPane);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-primary" }).text("+ Add Screen").css({ width: "100%", "margin-bottom": "10px" }).on("click", addScreenFromSidebar).appendTo(screensPane);
    state.screenFormEl = window.$("<div>").css({ "margin-top": "10px", "border-top": "1px solid var(--red-ui-secondary-border-color, #eee)", "padding-top": "10px" }).appendTo(screensPane);

    state.templateListEl = window.$("<div>", { "class": "nexa-template-list" }).css({ "margin-bottom": "8px" }).appendTo(state.templatesPane);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-primary" }).text("+ Add Template").css({ width: "100%", "margin-bottom": "10px" }).on("click", addTemplateFromSidebar).appendTo(state.templatesPane);
    state.templateFormEl = window.$("<div>", { "class": "nexa-template-form" }).css({ "margin-top": "10px", "border-top": "1px solid var(--red-ui-secondary-border-color, #eee)", "padding-top": "10px" }).appendTo(state.templatesPane);

    state.sidebarTabs = window.RED.tabs.create({
        element: ul,
        onchange: function (tab) {
            if (!tab) return;
            state.componentsPane.toggle(tab.id === "components");
            screensPane.toggle(tab.id === "screens");
            state.propertiesPane.toggle(tab.id === "properties");
            state.layersPane.toggle(tab.id === "layers");
            state.eventsPane.toggle(tab.id === "events");
            state.templatesPane.toggle(tab.id === "templates");
            if (tab.id === "screens") {
                // The Screens form (name/URL path/width/height/grid/snap) is
                // screen-shaped, not template-shaped (no `path` on a
                // template) — same "picking a screen means work on this
                // screen" rule already applied to selectScreenFromSidebar/
                // addScreenFromSidebar, just triggered from the sidebar tab
                // itself this time.
                if (state.editingMode === "template") exitTemplateEditing();
                ensureScreensLoaded(function () {
                    renderScreenList();
                    renderScreenForm();
                });
            }
            if (tab.id === "templates") {
                ensureScreensLoaded(function () { renderTemplateList(); renderTemplateForm(); });
            }
            if (tab.id === "components") buildPalette(state.componentsPane);
            if (tab.id === "properties") renderPropertiesPanel();
            if (tab.id === "layers") renderLayersPanel();
            if (tab.id === "events") renderEventsPanel();
        }
    });
    state.sidebarTabs.addTab({ id: "components", label: "Components" });
    state.sidebarTabs.addTab({ id: "screens", label: "Screens" });
    state.sidebarTabs.addTab({ id: "templates", label: "Templates" });
    state.sidebarTabs.addTab({ id: "properties", label: "Properties" });
    state.sidebarTabs.addTab({ id: "layers", label: "Layers" });
    state.sidebarTabs.addTab({ id: "events", label: "Events" });

    if (window.NEXA && typeof window.NEXA.onRegister === "function") {
        window.NEXA.onRegister(function () {
            if (state.componentsPane) {
                buildPalette(state.componentsPane);
            }
            if (state.eventsPane && state.eventsPane.is(":visible")) {
                renderEventsPanel();
            }
        });
    }

    return container;
}
