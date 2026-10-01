import { state, ensureScreensLoaded, getActiveScreen, Tree } from "../state.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { buildPalette, renderEventsPanel } from "./palette-events-panel.js";
import { renderPropertiesPanel } from "./properties-panel.js";
import { renderHierarchyPanel } from "./hierarchy-panel.js";
import {
    renderScreenList, renderScreenForm, addScreenFromSidebar,
    addTemplateFromScreensPanel, addFlowFromSidebar, addGroupFromSidebar,
    expandAllScreensTree, collapseAllScreensTree, addAppVariableFromSidebar
} from "./screens-panel.js";
import { renderTemplateList } from "./templates-panel.js";
import { renderSparkplugPanel } from "./sparkplug-panel.js";
import { renderTypesPanel } from "./types-panel.js";
import { renderAssetsPanel } from "./assets-panel.js";
import { renderBreakpointsPanel } from "./breakpoints-panel.js";
import { renderThemePanel } from "./theme-panel.js";

export function buildSidebarContent() {
    var container = window.$("<div>").css({ height: "100%", display: "flex", "flex-direction": "column" });

    // one canvas: the button opens it, or closes it when it is open
    state.pagesButton = window.$("<button>", { type: "button", "class": "nexa-pages-toggle" }).text(state.trayContent ? "Close Canvas" : "Open Canvas").css({ margin: "8px", width: "calc(100% - 16px)" })
        .on("click", function () {
            if (state.trayContent) window.RED.tray.close();
            else window.RED.actions.invoke("nexa:open-pages-editor");
        })
        .appendTo(container);

    var tabsWrap = window.$("<div>").css({ flex: "0 0 auto" }).appendTo(container);
    var ul = window.$("<ul>").appendTo(tabsWrap);

    var panesWrap = window.$("<div>").css({ flex: "1 1 auto", overflow: "auto", position: "relative" }).appendTo(container);
    // display:flex/flex-direction:column here (instead of each palette item
    // centering itself with its own "margin:auto") matters for more than
    // looks: jQuery UI draggable's _cacheMargins() reads the dragged
    // element's OWN computed margin-left and folds it into the mouse-to-
    // helper click offset. An "auto" margin resolves to however much blank
    // space centers a 120px chip in this (wide) pane — tens to a couple
    // hundred px — and draggable mistakes that resolved gap for a real
    // margin, throwing the drag ghost that same distance off the cursor.
    // Centering each item via its own align-self (see palette-events-
    // panel.js) instead keeps their margin at a plain, non-auto value.
    state.componentsPane = window.$("<div>").css({ padding: "8px", display: "flex", "flex-direction": "column" }).appendTo(panesWrap);
    var screensPane = window.$("<div>", { "class": "nexa-screens-pane" }).css({ padding: "0", display: "none", height: "100%", width: "100%", "box-sizing": "border-box" }).appendTo(panesWrap);
    state.propertiesPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.hierarchyPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.eventsPane = window.$("<div>").css({ padding: "8px", display: "none", "flex-direction": "column" }).appendTo(panesWrap);
    state.typesPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.assetsPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.breakpointsPane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    state.themePane = window.$("<div>").css({ padding: "8px", display: "none" }).appendTo(panesWrap);
    // Same flex/column reasoning as componentsPane/eventsPane above (see
    // that comment) — the metric rows dragged out of this pane go through
    // the identical jQuery UI draggable path, so the same margin:auto
    // pitfall applies here too.
    state.sparkplugPane = window.$("<div>").css({ padding: "0", display: "none", "flex-direction": "column", height: "100%", width: "100%", "box-sizing": "border-box" }).appendTo(panesWrap);

    // --- Screens, Templates & Flows Tab: 2-Column Layout (List/Tree on Left, Properties/Form on Right) ---
    var screensSplit = window.$("<div>").css({ display: "flex", "flex-direction": "row", height: "100%", width: "100%", "min-height": "400px", "box-sizing": "border-box" }).appendTo(screensPane);
    var screenLeftCol = window.$("<div>").css({
        flex: "0 0 280px", width: "280px", "min-width": "220px", "max-width": "360px",
        display: "flex", "flex-direction": "column", height: "100%",
        "border-right": "1px solid var(--red-ui-secondary-border-color, #e0e0e0)",
        background: "var(--red-ui-secondary-background, #fafafa)", "box-sizing": "border-box"
    }).appendTo(screensSplit);
    var screenToolbar = window.$("<div>").css({
        display: "flex", "flex-direction": "column", gap: "6px",
        padding: "8px 10px", "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)",
        background: "var(--red-ui-tertiary-background, #f8fafc)", "flex-shrink": "0"
    }).appendTo(screenLeftCol);

    var screenTitleRow = window.$("<div>").css({
        display: "flex", "align-items": "center", "justify-content": "space-between", width: "100%"
    }).appendTo(screenToolbar);
    window.$("<span style='font-size: 11px; font-weight: bold; text-transform: uppercase; color: var(--red-ui-secondary-text-color, #64748b); display: flex; align-items: center; gap: 5px;'><i class='fa fa-sitemap'></i> Screens & Flows</span>").appendTo(screenTitleRow);

    var expandCollapseGroup = window.$("<div>").css({ display: "flex", gap: "3px", "align-items": "center" }).appendTo(screenTitleRow);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Expand all" })
        .html("<i class='fa fa-angle-double-down'></i>")
        .css({ padding: "1px 6px", height: "20px", "line-height": "16px", "font-size": "11px" })
        .on("click", expandAllScreensTree)
        .appendTo(expandCollapseGroup);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Collapse all" })
        .html("<i class='fa fa-angle-double-up'></i>")
        .css({ padding: "1px 6px", height: "20px", "line-height": "16px", "font-size": "11px" })
        .on("click", collapseAllScreensTree)
        .appendTo(expandCollapseGroup);

    // SKIP!!!
    // var screenBtnGroup = window.$("<div>").css({
    //     display: "flex", "align-items": "center", "flex-wrap": "wrap", gap: "4px", width: "100%"
    // }).appendTo(screenToolbar);

    // window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-primary red-ui-button-small", title: "Add Screen" })
    //     .text("+ Add Screen").css({ "font-size": "10px", padding: "1px 6px", height: "22px", "line-height": "18px" })
    //     .on("click", addScreenFromSidebar).appendTo(screenBtnGroup);

    // window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Add Template" })
    //     .text("+ Add Template").css({ "font-size": "10px", padding: "1px 6px", height: "22px", "line-height": "18px" })
    //     .on("click", addTemplateFromScreensPanel).appendTo(screenBtnGroup);

    // window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Add Flow" })
    //     .text("+ Add Flow").css({ "font-size": "10px", padding: "1px 6px", height: "22px", "line-height": "18px" })
    //     .on("click", addFlowFromSidebar).appendTo(screenBtnGroup);

    // window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Add Group" })
    //     .text("+ Add Group").css({ "font-size": "10px", padding: "1px 6px", height: "22px", "line-height": "18px" })
    //     .on("click", addGroupFromSidebar).appendTo(screenBtnGroup);

    // window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Add App Variable" })
    //     .text("+ Add Variable").css({ "font-size": "10px", padding: "1px 6px", height: "22px", "line-height": "18px" })
    //     .on("click", addAppVariableFromSidebar).appendTo(screenBtnGroup);

    var screenListWrap = window.$("<div>").css({ flex: "1 1 auto", "min-height": "0", "overflow-y": "auto", padding: "6px" }).appendTo(screenLeftCol);
    state.screenListEl = window.$("<div>", { "class": "nexa-screen-list" }).appendTo(screenListWrap);

    var screenRightCol = window.$("<div>").css({
        flex: "1 1 auto", display: "flex", "flex-direction": "column", height: "100%",
        "overflow-y": "auto", padding: "12px 16px", "box-sizing": "border-box",
        background: "var(--red-ui-primary-background, #fff)"
    }).appendTo(screensSplit);
    state.screenFormEl = window.$("<div>", { "class": "nexa-screen-form nexa-template-form" }).appendTo(screenRightCol);
    state.templateFormEl = state.screenFormEl;
    state.templateListEl = window.$("<div>", { "class": "nexa-template-list" });

    state.sidebarTabs = window.RED.tabs.create({
        element: ul,
        // many tabs: they keep a readable width and scroll sideways (instead of squeezing)
        scrollable: true,
        onchange: function (tab) {
            if (!tab) return;
            // componentsPane/eventsPane are display:flex (see their creation
            // above) so jQuery's plain .toggle() must not be trusted to pick
            // that back up on its own — the very first .show() after
            // starting as display:none has no "previous visible display" of
            // its own to restore and would fall back to the tag's default
            // ("block"), silently discarding the flex layout those two panes
            // depend on.
            screensPane.toggle(tab.id === "screens");
            state.componentsPane.css("display", tab.id === "components" ? "flex" : "none");
            state.hierarchyPane.toggle(tab.id === "hierarchy");
            state.eventsPane.css("display", tab.id === "events" ? "flex" : "none");
            state.propertiesPane.toggle(tab.id === "properties");
            state.themePane.toggle(tab.id === "theme");
            state.typesPane.toggle(tab.id === "types");
            state.assetsPane.toggle(tab.id === "assets");
            state.breakpointsPane.toggle(tab.id === "breakpoints");
            state.sparkplugPane.css("display", tab.id === "sparkplug" ? "flex" : "none");
            if (tab.id === "screens") {
                ensureScreensLoaded(function () {
                    renderScreenList();
                    renderScreenForm();
                });
            }
            if (tab.id === "components") buildPalette(state.componentsPane);
            if (tab.id === "events") renderEventsPanel();
            if (tab.id === "properties") renderPropertiesPanel();
            if (tab.id === "hierarchy") renderHierarchyPanel();
            if (tab.id === "theme") renderThemePanel();
            if (tab.id === "types") renderTypesPanel();
            if (tab.id === "assets") renderAssetsPanel();
            if (tab.id === "breakpoints") renderBreakpointsPanel();
            if (tab.id === "sparkplug") renderSparkplugPanel();
        }
    });

    state.sidebarTabs.addTab({ id: "screens", label: "Screens & Flows" });
    state.sidebarTabs.addTab({ id: "components", label: "Components" });
    state.sidebarTabs.addTab({ id: "events", label: "Events" });
    state.sidebarTabs.addTab({ id: "properties", label: "Properties" });
    state.sidebarTabs.addTab({ id: "hierarchy", label: "Hierarchy" });
    state.sidebarTabs.addTab({ id: "assets", label: "Assets" });
    state.sidebarTabs.addTab({ id: "sparkplug", label: "MQTT Sparkplug" });
    state.sidebarTabs.addTab({ id: "theme", label: "Theme" });
    state.sidebarTabs.addTab({ id: "types", label: "Types" });
    state.sidebarTabs.addTab({ id: "breakpoints", label: "Breakpoints" });

    if (window.NEXA && typeof window.NEXA.onRegister === "function") {
        window.NEXA.onRegister(function (id) {
            if (state.componentsPane) {
                buildPalette(state.componentsPane);
            }
            // A plugin that registered after the screen was drawn (plugins load
            // in no guaranteed order): draw its components for real now.
            var screen = getActiveScreen();
            if (screen && Tree.allNodes(screen).some(function (c) { return c.type === id; })) renderActiveScreen();
            if (state.eventsPane && state.eventsPane.is(":visible")) {
                renderEventsPanel();
            }
        });
    }

    if (window.RED && window.RED.events && typeof window.RED.events.on === "function") {
        window.RED.events.on("flows:loaded", function () {
            state.flowsLoaded = true;
            state.screensLoaded = false;
            state.projectConfigNode = null;
            ensureScreensLoaded(function () {
                renderScreenList();
                renderScreenForm();
            });
        });
    }

    return container;
}
