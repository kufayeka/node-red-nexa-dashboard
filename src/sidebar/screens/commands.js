// Screens & Flows tab: the commands (open in the browser, add / select / remove a screen, template,
// flow or folder, open the properties dialog of a tree item, expand / collapse).
import { state, getActiveScreen, makeScreen, markDirty, getApp, genId, Tree, findTemplate, makeTemplate, makeFolder, findFolder, makeFlow, findFlow } from "../../state.js";
import { renderActiveScreen } from "../../canvas/canvas-ui.js";
import { showEditBar, hideEditBar } from "../templates-panel.js";
import { updateCanvasTabsVisibility } from "../../editor-tray.js";
import { selectOnly, selectMultiple, isSelected } from "../../canvas/selection.js";
import { revealSlotsOf } from "../../canvas/component-renderer.js";
import { openScreenPropertiesDialog } from "../../dialogs/screen-dialog.js";
import { openScreenVariablePropertiesDialog } from "../../dialogs/screen-variable-dialog.js";
import { openTemplatePropertiesDialog } from "../../dialogs/template-dialog.js";
import { openTemplateVariablePropertiesDialog } from "../../dialogs/template-variable-dialog.js";
import { openTemplateParamPropertiesDialog } from "../../dialogs/template-param-dialog.js";
import { openComponentTemplatePropertiesDialog } from "../../dialogs/component-template-dialog.js";
import { openFlowPropertiesDialog } from "../../dialogs/flow-dialog.js";
import { openAppVariablePropertiesDialog } from "../../dialogs/app-variable-dialog.js";
import { openSharedVariablePropertiesDialog } from "../../dialogs/shared-variable-dialog.js";
import { openFolderPropertiesDialog } from "../../dialogs/folder-dialog.js";
import { refreshLogicCanvasIfActive, renderScreenList } from "../screens-panel.js";
import { renderScreenForm } from "./screen-form.js";

// Deployed screens live on lib/screen-worker.js's own dedicated port
var cachedScreenWorkerPort = null;

function fetchScreenWorkerPort(cb) {
    if (cachedScreenWorkerPort !== null) { cb(cachedScreenWorkerPort); return; }
    if (!window.$ || typeof window.$.getJSON !== "function") { cb(null); return; }
    window.$.getJSON("nexa-dashboard/_screen-port", function (data) {
        cachedScreenWorkerPort = (data && data.port) || null;
        cb(cachedScreenWorkerPort);
    }).fail(function () { cb(null); });
}

export function openScreenInBrowser(screen) {
    var tab = window.open("", "_blank");
    fetchScreenWorkerPort(function (port) {
        var cleanPath = (screen.path || "").replace(/^\/+/, "");
        var hostname = window.location.hostname || "localhost";
        var fullUrl = "http://" + hostname + ":" + (port || 1881) + "/nexa/" + cleanPath;
        if (tab) tab.location.href = fullUrl;
    });
}

export function openFlowInBrowser(flow) {
    var tab = window.open("", "_blank");
    fetchScreenWorkerPort(function (port) {
        var cleanEndpoint = (flow.endpoint || "").replace(/^\/+/, "");
        var hostname = window.location.hostname || "localhost";
        var fullUrl = "http://" + hostname + ":" + (port || 1881) + "/nexa/" + cleanEndpoint;
        if (tab) tab.location.href = fullUrl;
    });
}

export function expandAllScreensTree() {
    if (state.screensFlowsTreeEl && typeof state.screensFlowsTreeEl.setAllCollapsed === "function") {
        state.screensFlowsTreeEl.setAllCollapsed(false);
    }
}

export function collapseAllScreensTree() {
    if (state.screensFlowsTreeEl && typeof state.screensFlowsTreeEl.setAllCollapsed === "function") {
        state.screensFlowsTreeEl.setAllCollapsed(true);
    }
}

export function selectComponentFromTree(surfId, compId, additive) {
    var scr = state.screens.find(function (s) { return s.id === surfId; });
    var tmpl = !scr && findTemplate(surfId);
    if (!scr && !tmpl) return;

    // 1. If Pages editor tray is not open, open it
    if (!state.trayContent && window.RED && window.RED.actions) {
        window.RED.actions.invoke("nexa:open-pages-editor");
    }

    // 2. Switch to active screen or template
    if (scr) {
        if (state.activeScreenId !== surfId || state.editingMode !== "screen") {
            selectScreenFromSidebar(surfId);
        }
    } else {
        if (state.activeTemplateId !== surfId || state.editingMode !== "template") {
            selectTemplateFromScreensPanel(surfId);
        }
    }

    // 3. Switch tray canvas tabs to "ui"
    if (state.canvasTabs && typeof state.canvasTabs.activateTab === "function") {
        state.canvasTabs.activateTab("ui");
    }

    // 4. Hierarchy-style selection on screen
    var screen = getActiveScreen();
    var loc = screen && Tree.locate(screen, compId);
    if (loc && !loc.orphan) {
        var hidden = Tree.ancestors(screen, compId).concat([loc.node]).filter(function (n) {
            return n && n.overlay && n.overlay.kind && !state.overlayPreview[n.id];
        });
        if (hidden.length) {
            hidden.forEach(function (n) { state.overlayPreview[n.id] = true; });
            renderActiveScreen({ keepPanel: true });
        }
        if (typeof revealSlotsOf === "function") {
            revealSlotsOf(compId);
        }
        if (additive) {
            if (isSelected(compId)) selectMultiple(state.selectedIds.filter(function (cid) { return cid !== compId; }), { keepSidebarTab: true });
            else selectMultiple(state.selectedIds.concat([compId]), { keepSidebarTab: true });
        } else {
            selectOnly(compId, { keepSidebarTab: true });
        }
    }

    // 5. Keep the tree node selected in Screens & Flows tree
    if (state.screensFlowsTreeEl) {
        state.screensFlowsTreeEl.selected = ["screen-comp:" + surfId + ":" + compId];
    }
}

export function openPropertiesDialogForId(id) {
    if (!id) return;
    if (id.startsWith("screen-comp:")) {
        var parts = id.split(":");
        var surfId = parts[1];
        var compId = parts[2];
        selectComponentFromTree(surfId, compId, false);
        return;
    }
    if (id.startsWith("screen-var:")) {
        var parts = id.split(":");
        var sId = parts[1];
        var varId = parts[2];
        var s = state.screens.find(function (sc) { return sc.id === sId; });
        var v = s && (s.variables || []).find(function (x) { return x.id === varId; });
        if (v && s) openScreenVariablePropertiesDialog(v, s);
        return;
    }
    if (id.startsWith("template-var:")) {
        var parts = id.split(":");
        var tId = parts[1];
        var varId = parts[2];
        var t = findTemplate(tId);
        var v = t && (t.variables || []).find(function (x) { return x.id === varId; });
        if (v && t) openTemplateVariablePropertiesDialog(v, t);
        return;
    }
    if (id.startsWith("template-param:")) {
        var parts = id.split(":");
        var tId = parts[1];
        var paramId = parts[2];
        var t = findTemplate(tId);
        var p = t && (t.params || []).find(function (x) { return x.id === paramId; });
        if (p && t) openTemplateParamPropertiesDialog(p, t);
        return;
    }
    if (id.startsWith("app-var:")) {
        var varId = id.substring("app-var:".length);
        var app = getApp();
        var v = (app.variables || []).find(function (x) { return x.id === varId; });
        if (v) openAppVariablePropertiesDialog(v);
        return;
    }
    if (id.startsWith("shared-var:")) {
        var varId = id.substring("shared-var:".length);
        var app = getApp();
        var v = (app.sharedVariables || []).find(function (x) { return x.id === varId; });
        if (v) openSharedVariablePropertiesDialog(v);
        return;
    }
    var screen = state.screens.find(function (sc) { return sc.id === id; });
    if (screen) {
        openScreenPropertiesDialog(screen);
        return;
    }
    var template = findTemplate(id);
    if (template) {
        if (template.kind === "component") {
            openComponentTemplatePropertiesDialog(template);
        } else {
            openTemplatePropertiesDialog(template);
        }
        return;
    }
    var flow = findFlow(id);
    if (flow) {
        openFlowPropertiesDialog(flow);
        return;
    }
    var folder = findFolder(id);
    if (folder) {
        openFolderPropertiesDialog(folder);
        return;
    }
}

export function addAppVariableFromSidebar() {
    var app = getApp();
    app.variables = app.variables || [];
    var newVar = { id: genId(), name: "appVar" + (app.variables.length + 1), type: "string", defaultValue: "", persist: "none" };
    app.variables.push(newVar);
    state.editingMode = "app-variable";
    state.activeAppVariableId = newVar.id;
    markDirty();
    renderScreenList();
    renderScreenForm();
    if (state.screensFlowsTreeEl && typeof state.screensFlowsTreeEl.reveal === "function") {
        state.screensFlowsTreeEl.reveal("app-var:" + newVar.id);
    }
    openAppVariablePropertiesDialog(newVar);
}

export function addSharedVariableFromSidebar() {
    var app = getApp();
    app.sharedVariables = app.sharedVariables || [];
    var newVar = { id: genId(), name: "sharedVar" + (app.sharedVariables.length + 1), type: "string", defaultValue: "" };
    app.sharedVariables.push(newVar);
    state.editingMode = "shared-variable";
    state.activeSharedVariableId = newVar.id;
    markDirty();
    renderScreenList();
    renderScreenForm();
    if (state.screensFlowsTreeEl && typeof state.screensFlowsTreeEl.reveal === "function") {
        state.screensFlowsTreeEl.reveal("shared-var:" + newVar.id);
    }
    openSharedVariablePropertiesDialog(newVar);
}

export function selectScreenFromSidebar(id) {
    state.editingMode = "screen";
    state.activeTemplateId = null;
    state.selectedFolderId = null;
    state.activeScreenId = id;
    updateCanvasTabsVisibility();
    renderScreenList();
    renderScreenForm();
    renderActiveScreen();
    refreshLogicCanvasIfActive();
    hideEditBar();
}

export function selectTemplateFromScreensPanel(id) {
    state.editingMode = "template";
    state.activeTemplateId = id;
    state.selectedFolderId = null;
    updateCanvasTabsVisibility();
    renderScreenList();
    renderScreenForm();
    renderActiveScreen();
    refreshLogicCanvasIfActive();
    showEditBar();
}

export function selectFlowFromScreensPanel(id) {
    state.editingMode = "flow";
    state.activeFlowId = id;
    state.selectedFolderId = null;
    updateCanvasTabsVisibility();
    renderScreenList();
    renderScreenForm();
    refreshLogicCanvasIfActive();
    hideEditBar();
}

export function selectFolderFromScreensPanel(id) {
    state.selectedFolderId = id;
    renderScreenList();
    renderScreenForm();
}

export function addScreenFromSidebar(opts) {
    state.editingMode = "screen";
    state.activeTemplateId = null;
    state.selectedFolderId = null;
    var screen = makeScreen(opts || {});
    state.screens.push(screen);
    state.activeScreenId = screen.id;
    updateCanvasTabsVisibility();
    renderScreenList();
    renderScreenForm();
    renderActiveScreen();
    refreshLogicCanvasIfActive();
    hideEditBar();
    markDirty();
}

export function addTemplateFromScreensPanel(opts) {
    state.editingMode = "template";
    state.selectedFolderId = null;
    var template = makeTemplate(opts || {});
    state.templates.push(template);
    state.activeTemplateId = template.id;
    updateCanvasTabsVisibility();
    renderScreenList();
    renderScreenForm();
    renderActiveScreen();
    refreshLogicCanvasIfActive();
    showEditBar();
    markDirty();
}

export function addFlowFromSidebar(opts) {
    state.editingMode = "flow";
    state.selectedFolderId = null;
    var flow = makeFlow(opts || {});
    state.flows.push(flow);
    state.activeFlowId = flow.id;
    updateCanvasTabsVisibility();
    renderScreenList();
    renderScreenForm();
    refreshLogicCanvasIfActive();
    hideEditBar();
    markDirty();
}

export function addGroupFromSidebar(opts) {
    var folder = makeFolder(opts || {});
    if (opts && opts.category) folder.category = opts.category;
    else if (!folder.category) {
        folder.category = state.editingMode === "flow" ? "flow" : state.editingMode === "template" ? "template" : "screen";
    }
    state.folders.push(folder);
    state.selectedFolderId = folder.id;
    renderScreenList();
    renderScreenForm();
    markDirty();
}

export function removeScreen(id) {
    if (state.screens.length <= 1) return;
    var wasActive = id === state.activeScreenId;
    state.screens = state.screens.filter(function (s) { return s.id !== id; });
    if (wasActive) state.activeScreenId = state.screens[0].id;
    renderScreenList();
    renderScreenForm();
    if (wasActive) {
        renderActiveScreen();
        refreshLogicCanvasIfActive();
    }
    markDirty();
}
