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
    var screensPane = window.$("<div>", { "class": "nexa-screens-pane" }).css({ padding: "0", display: "none", height: "100%", width: "100%", "box-sizing": "border-box" }).appendTo(panesWrap);
    state.propertiesPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.layersPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.eventsPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.templatesPane = window.$("<div>", { "class": "nexa-templates-pane" }).css({ padding: "0", display: "none", height: "100%", width: "100%", "box-sizing": "border-box" }).appendTo(panesWrap);

    // --- Screens Tab: 2-Column Layout (List on Left, Properties on Right) ---
    var screensSplit = window.$("<div>").css({ display: "flex", "flex-direction": "row", height: "100%", width: "100%", "min-height": "400px", "box-sizing": "border-box" }).appendTo(screensPane);
    var screenLeftCol = window.$("<div>").css({
        flex: "0 0 240px", width: "240px", "min-width": "200px", "max-width": "300px",
        display: "flex", "flex-direction": "column", height: "100%",
        "border-right": "1px solid var(--red-ui-secondary-border-color, #e0e0e0)",
        background: "var(--red-ui-secondary-background, #fafafa)", "box-sizing": "border-box"
    }).appendTo(screensSplit);
    var screenToolbar = window.$("<div>").css({
        display: "flex", "align-items": "center", "justify-content": "space-between",
        padding: "8px 10px", "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)",
        background: "var(--red-ui-tertiary-background, #f8fafc)", "flex-shrink": "0"
    }).appendTo(screenLeftCol);
    window.$("<span style='font-size: 11px; font-weight: bold; text-transform: uppercase; color: var(--red-ui-secondary-text-color, #64748b); display: flex; align-items: center; gap: 5px;'><i class='fa fa-desktop'></i> Screens</span>").appendTo(screenToolbar);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-primary red-ui-button-small" })
        .text("+ Add Screen").css({ "font-size": "11px", padding: "2px 8px", height: "24px", "line-height": "20px" })
        .on("click", addScreenFromSidebar).appendTo(screenToolbar);
    var screenListWrap = window.$("<div>").css({ flex: "1 1 auto", "min-height": "0", "overflow-y": "auto", padding: "6px" }).appendTo(screenLeftCol);
    state.screenListEl = window.$("<div>", { "class": "nexa-screen-list" }).appendTo(screenListWrap);

    var screenRightCol = window.$("<div>").css({
        flex: "1 1 auto", display: "flex", "flex-direction": "column", height: "100%",
        "overflow-y": "auto", padding: "12px 16px", "box-sizing": "border-box",
        background: "var(--red-ui-primary-background, #fff)"
    }).appendTo(screensSplit);
    state.screenFormEl = window.$("<div>", { "class": "nexa-screen-form" }).appendTo(screenRightCol);

    // --- Templates Tab: 2-Column Layout (List on Left, Properties & Params on Right) ---
    var templatesSplit = window.$("<div>").css({ display: "flex", "flex-direction": "row", height: "100%", width: "100%", "min-height": "400px", "box-sizing": "border-box" }).appendTo(state.templatesPane);
    var templateLeftCol = window.$("<div>").css({
        flex: "0 0 240px", width: "240px", "min-width": "200px", "max-width": "300px",
        display: "flex", "flex-direction": "column", height: "100%",
        "border-right": "1px solid var(--red-ui-secondary-border-color, #e0e0e0)",
        background: "var(--red-ui-secondary-background, #fafafa)", "box-sizing": "border-box"
    }).appendTo(templatesSplit);
    var templateToolbar = window.$("<div>").css({
        display: "flex", "align-items": "center", "justify-content": "space-between",
        padding: "8px 10px", "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)",
        background: "var(--red-ui-tertiary-background, #f8fafc)", "flex-shrink": "0"
    }).appendTo(templateLeftCol);
    window.$("<span style='font-size: 11px; font-weight: bold; text-transform: uppercase; color: var(--red-ui-secondary-text-color, #64748b); display: flex; align-items: center; gap: 5px;'><i class='fa fa-clone'></i> Templates</span>").appendTo(templateToolbar);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-primary red-ui-button-small" })
        .text("+ Add Template").css({ "font-size": "11px", padding: "2px 8px", height: "24px", "line-height": "20px" })
        .on("click", addTemplateFromSidebar).appendTo(templateToolbar);
    var templateListWrap = window.$("<div>").css({ flex: "1 1 auto", "min-height": "0", "overflow-y": "auto", padding: "6px" }).appendTo(templateLeftCol);
    state.templateListEl = window.$("<div>", { "class": "nexa-template-list" }).appendTo(templateListWrap);

    var templateRightCol = window.$("<div>").css({
        flex: "1 1 auto", display: "flex", "flex-direction": "column", height: "100%",
        "overflow-y": "auto", padding: "12px 16px", "box-sizing": "border-box",
        background: "var(--red-ui-primary-background, #fff)"
    }).appendTo(templatesSplit);
    state.templateFormEl = window.$("<div>", { "class": "nexa-template-form" }).appendTo(templateRightCol);

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
