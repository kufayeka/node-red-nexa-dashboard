// The Screens & Flows tab: the tree of folders / screens / templates / flows and the
// open item's form. The parts live in ./screens/; this file renders the tab and is its
// public API (re-exported below), so callers import from here as before.
import { state, markDirty } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";
import { addAppVariableFromSidebar, addFlowFromSidebar, addGroupFromSidebar, addScreenFromSidebar, addSharedVariableFromSidebar, addTemplateFromScreensPanel, collapseAllScreensTree, expandAllScreensTree, openScreenInBrowser, removeScreen, selectFlowFromScreensPanel, selectFolderFromScreensPanel, selectScreenFromSidebar, selectTemplateFromScreensPanel } from "./screens/commands.js";
import { renderScreenForm } from "./screens/screen-form.js";
import { onScreensFlowsAction, onScreensFlowsRename } from "./screens/tree-actions.js";
import { onScreensFlowsMove, onScreensFlowsOpen, onScreensFlowsSelect } from "./screens/tree-events.js";
import { buildScreensFlowsTreeNodes } from "./screens/tree-rows.js";

export function refreshLogicCanvasIfActive() {
    if (state.activeCanvasTab === "logic") renderLogicCanvas();
}

export function renderScreenList() {
    if (!state.screenListEl) return;

    var hasNexaKit = typeof window !== "undefined" && (window.NexaKit || (window.customElements && window.customElements.get("nx-tree")));

    // --- Fast-path: reuse existing tree to preserve scroll position ---
    if (hasNexaKit && state.screensFlowsTreeEl && state.screensFlowsTreeEl.isConnected) {
        var nodes = buildScreensFlowsTreeNodes();
        state.screensFlowsTreeEl.nodes = nodes;
        var activeId = state.editingMode === "app-variable" ? ("app-var:" + state.activeAppVariableId)
            : state.editingMode === "shared-variable" ? ("shared-var:" + state.activeSharedVariableId)
            : state.editingMode === "screen-variable" ? ("screen-var:" + state.activeScreenId + ":" + state.activeScreenVariableId)
            : state.editingMode === "screen-vars-group" ? ("screen-vars-group:" + state.activeScreenId)
            : state.editingMode === "template-variable" ? ("template-var:" + state.activeTemplateId + ":" + state.activeTemplateVariableId)
            : state.editingMode === "template-param" ? ("template-param:" + state.activeTemplateId + ":" + state.activeTemplateParamId)
            : state.editingMode === "flow" ? state.activeFlowId
            : state.editingMode === "template" ? state.activeTemplateId
            : (state.selectedFolderId || state.activeScreenId);
        state.screensFlowsTreeEl.selected = activeId ? [activeId] : [];
        return;
    }

    // --- Full rebuild (first render or tree detached) ---
    state.screenListEl.empty();

    if (hasNexaKit) {
        var treeHost = window.$("<div>", { "class": "nexa-screens-tree-host" }).css({
            width: "max-content", "min-width": "100%", "box-sizing": "border-box", display: "inline-block"
        }).appendTo(state.screenListEl);

        var treeEl = document.createElement("nx-tree");
        treeEl.setAttribute("empty-text", "No items yet — click + Add Screen, Template or Flow");
        treeEl.setAttribute("persist-key", "screens-flows:tree");
        treeEl.setAttribute("no-rename", "");
        treeEl.renamable = false;
        treeEl.addEventListener("nx-tree-select", onScreensFlowsSelect);
        treeEl.addEventListener("nx-tree-open", onScreensFlowsOpen);
        treeEl.addEventListener("nx-tree-move", onScreensFlowsMove);
        treeEl.addEventListener("nx-tree-action", onScreensFlowsAction);
        treeEl.addEventListener("nx-tree-rename", onScreensFlowsRename);
        treeHost.get(0).appendChild(treeEl);

        var nodes = buildScreensFlowsTreeNodes();
        treeEl.nodes = nodes;
        var activeId = state.editingMode === "app-variable" ? ("app-var:" + state.activeAppVariableId)
            : state.editingMode === "shared-variable" ? ("shared-var:" + state.activeSharedVariableId)
            : state.editingMode === "screen-variable" ? ("screen-var:" + state.activeScreenId + ":" + state.activeScreenVariableId)
            : state.editingMode === "screen-vars-group" ? ("screen-vars-group:" + state.activeScreenId)
            : state.editingMode === "template-variable" ? ("template-var:" + state.activeTemplateId + ":" + state.activeTemplateVariableId)
            : state.editingMode === "template-param" ? ("template-param:" + state.activeTemplateId + ":" + state.activeTemplateParamId)
            : state.editingMode === "flow" ? state.activeFlowId
            : state.editingMode === "template" ? state.activeTemplateId
            : (state.selectedFolderId || state.activeScreenId);
        treeEl.selected = activeId ? [activeId] : [];
        state.screensFlowsTreeEl = treeEl;
    }

    state.screens.forEach(function (screen) {
        var isActive = screen.id === state.activeScreenId && state.editingMode === "screen";
        var row = window.$("<div>", { "class": "nexa-screen-row" }).css({
            padding: "8px 10px",
            "border-radius": "5px",
            display: hasNexaKit ? "none" : "flex",
            "flex-wrap": "wrap",
            "align-items": "center",
            cursor: "pointer",
            background: isActive ? "var(--red-ui-list-item-selected-background, #e0f2fe)" : "var(--red-ui-secondary-background, #ffffff)",
            border: isActive ? "1px solid #7dd3fc" : "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
            "box-shadow": isActive ? "0 1px 3px rgba(2,132,199,0.12)" : "0 1px 2px rgba(0,0,0,0.02)",
            "font-size": "12px",
            "user-select": "none",
            gap: "4px",
            transition: "all 0.15s ease"
        }).appendTo(state.screenListEl);

        window.$("<span>", {
            style: "cursor: pointer; width: 14px; text-align: center; margin-right: 4px; flex: 0 0 14px;",
            title: screen.disabled ? "Screen is disabled (returns 404) — click to enable" : "Screen is enabled — click to disable"
        })
            .html(screen.disabled ? '<i class="fa fa-ban" style="color: #ef4444;"></i>' : '<i class="fa fa-circle" style="color: #10b981; font-size: 9px;"></i>')
            .on("click", function (e) {
                if (e && e.stopPropagation) e.stopPropagation();
                screen.disabled = !screen.disabled;
                markDirty();
                renderScreenList();
                renderScreenForm();
            })
            .appendTo(row);

        window.$("<span>", {
            style: "flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red-ui-primary-text-color, #222);" +
                (screen.disabled ? " text-decoration: line-through; opacity: 0.6;" : " font-weight: 600;")
        }).text(screen.name).appendTo(row);

        if (screen.disabled) {
            window.$("<span>", {
                style: "font-size: 9px; color: #ef4444; background: #fee2e2; padding: 1px 4px; border-radius: 3px; font-weight: 600; flex: 0 0 auto;"
            }).text("DISABLED").appendTo(row);
        }

        window.$("<div>", {
            style: "width: 100%; flex: 0 0 100%; font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 4px; padding: 2px 0; overflow: hidden;"
        }).html('<i class="fa fa-globe" style="font-size: 10px; color: #94a3b8;"></i> <span style="background: rgba(0,0,0,0.04); padding: 1px 5px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + (screen.path ? (screen.path.startsWith("/") ? screen.path : "/" + screen.path) : "/screen") + '</span>').appendTo(row);

        window.$("<button>", {
            type: "button",
            class: "red-ui-button red-ui-button-small",
            title: "Open deployed screen in new tab (" + (screen.path || "/screen") + ")",
            style: "flex: 1 1 auto; height: 22px; line-height: 20px; font-size: 11px; color: #0284c7; display: inline-flex; align-items: center; justify-content: center; gap: 4px;"
        }).html('<i class="fa fa-external-link"></i> Open')
            .on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                openScreenInBrowser(screen);
            })
            .appendTo(row);

        if (state.screens.length > 1) {
            window.$("<a>", {
                href: "#",
                title: "Delete screen",
                class: "red-ui-button red-ui-button-small",
                style: "flex: 0 0 auto; height: 22px; line-height: 20px; padding: 0 8px; font-size: 11px; color: #ef4444; display: inline-flex; align-items: center; justify-content: center;"
            }).html('<i class="fa fa-trash"></i>').on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                removeScreen(screen.id);
            }).appendTo(row);
        }

        row.on("click", function () { selectScreenFromSidebar(screen.id); });
    });
}

export * from "./screens/commands.js";
export * from "./screens/tree-rows.js";
export * from "./screens/tree-events.js";
export * from "./screens/tree-actions.js";
export * from "./screens/item-forms.js";
export * from "./screens/screen-form.js";

if (typeof window !== "undefined") {
    window.__refreshScreensFlowsTree = function () {
        renderScreenList();
    };
    window.__nexaEditorApi = window.__nexaEditorApi || {};
    Object.assign(window.__nexaEditorApi, {
        buildScreensFlowsTreeNodes: buildScreensFlowsTreeNodes,
        selectScreenFromSidebar: selectScreenFromSidebar,
        selectTemplateFromScreensPanel: selectTemplateFromScreensPanel,
        selectFlowFromScreensPanel: selectFlowFromScreensPanel,
        selectFolderFromScreensPanel: selectFolderFromScreensPanel,
        addScreenFromSidebar: addScreenFromSidebar,
        addTemplateFromScreensPanel: addTemplateFromScreensPanel,
        addFlowFromSidebar: addFlowFromSidebar,
        addGroupFromSidebar: addGroupFromSidebar,
        addAppVariableFromSidebar: addAppVariableFromSidebar,
        addSharedVariableFromSidebar: addSharedVariableFromSidebar,
        expandAllScreensTree: expandAllScreensTree,
        collapseAllScreensTree: collapseAllScreensTree,
        removeScreen: removeScreen
    });
    if (typeof global !== "undefined") {
        global.__addScreenBtn = { _handlers: { click: [function () { addScreenFromSidebar({ parentId: null }); }] } };
        global.__addTemplateBtn = { _handlers: { click: [function () { addTemplateFromScreensPanel({ parentId: null }); }] } };
    }
}
