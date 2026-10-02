// Screens & Flows tab: the per-item action menu and inline rename.
import { state, markDirty, getApp, genId, findTemplate, findFolder, deleteFolder, findFlow, deleteFlow, duplicateScreen, duplicateTemplate, duplicateFlow, convertScreenToTemplate, convertTemplateToScreen } from "../../state.js";
import { renderActiveScreen } from "../../canvas/canvas-ui.js";
import { openScreenVariablePropertiesDialog } from "../../dialogs/screen-variable-dialog.js";
import { openTemplateVariablePropertiesDialog } from "../../dialogs/template-variable-dialog.js";
import { openTemplateParamPropertiesDialog } from "../../dialogs/template-param-dialog.js";
import { renderScreenList } from "../screens-panel.js";
import { addAppVariableFromSidebar, addFlowFromSidebar, addGroupFromSidebar, addScreenFromSidebar, addSharedVariableFromSidebar, addTemplateFromScreensPanel, openFlowInBrowser, openPropertiesDialogForId, openScreenInBrowser, removeScreen, selectFlowFromScreensPanel, selectScreenFromSidebar, selectTemplateFromScreensPanel } from "./commands.js";
import { renderScreenForm } from "./screen-form.js";

export function onScreensFlowsAction(e) {
    var id = e.detail.id;
    var action = e.detail.action;
    if (action === "edit-props") {
        openPropertiesDialogForId(id);
        return;
    }
    if (action === "add-screen") {
        addScreenFromSidebar({ parentId: null });
        return;
    }
    if (action === "add-template" || action === "add-composite-template") {
        addTemplateFromScreensPanel({ parentId: null, kind: "composite" });
        return;
    }
    if (action === "add-component-template") {
        addTemplateFromScreensPanel({ parentId: null, kind: "component" });
        return;
    }
    if (action === "add-flow") {
        addFlowFromSidebar({ parentId: null });
        return;
    }
    if (action === "add-group-screen") {
        addGroupFromSidebar({ category: "screen", parentId: null });
        return;
    }
    if (action === "add-group-template") {
        addGroupFromSidebar({ category: "template", parentId: null });
        return;
    }
    if (action === "add-group-flow") {
        addGroupFromSidebar({ category: "flow", parentId: null });
        return;
    }
    if (action === "add-app-var") {
        addAppVariableFromSidebar();
        return;
    }
    if (action === "add-shared-var") {
        addSharedVariableFromSidebar();
        return;
    }
    if (action === "add-screen-var") {
        var sId = id.startsWith("screen-vars-group:") ? id.substring("screen-vars-group:".length) : id;
        var s = state.screens.find(function (sc) { return sc.id === sId; });
        if (s) {
            s.variables = s.variables || [];
            var newVar = { id: genId(), name: "var" + (s.variables.length + 1), type: "string", defaultValue: "" };
            s.variables.push(newVar);
            state.editingMode = "screen-variable";
            state.activeScreenId = s.id;
            state.activeScreenVariableId = newVar.id;
            markDirty();
            renderScreenList();
            renderScreenForm();
            if (state.screensFlowsTreeEl && typeof state.screensFlowsTreeEl.reveal === "function") {
                state.screensFlowsTreeEl.reveal("screen-var:" + s.id + ":" + newVar.id);
            }
            openScreenVariablePropertiesDialog(newVar, s);
            return;
        }
    }
    if (action === "add-template-var") {
        var tId = id.startsWith("template-vars-group:") ? id.substring("template-vars-group:".length) : id;
        var t = findTemplate(tId);
        if (t) {
            t.variables = t.variables || [];
            var newVar = { id: genId(), name: "var" + (t.variables.length + 1), type: "string", defaultValue: "" };
            t.variables.push(newVar);
            state.activeTemplateId = t.id;
            state.editingMode = "template-variable";
            state.activeTemplateVariableId = newVar.id;
            markDirty();
            renderScreenList();
            renderScreenForm();
            if (state.screensFlowsTreeEl && typeof state.screensFlowsTreeEl.reveal === "function") {
                state.screensFlowsTreeEl.reveal("template-var:" + t.id + ":" + newVar.id);
            }
            openTemplateVariablePropertiesDialog(newVar, t);
            return;
        }
    }
    if (action === "delete-template-var") {
        var parts = id.split(":");
        var tId = parts[1];
        var varId = parts[2];
        var t = findTemplate(tId);
        if (t && t.variables) {
            t.variables = t.variables.filter(function (v) { return v.id !== varId; });
            if (state.activeTemplateVariableId === varId) {
                state.activeTemplateVariableId = null;
                state.editingMode = "template";
            }
            markDirty();
            renderScreenList();
            renderScreenForm();
            return;
        }
    }
    if (action === "add-template-param") {
        var tId = id.startsWith("template-params-group:") ? id.substring("template-params-group:".length) : id;
        var t = findTemplate(tId);
        if (t) {
            t.params = t.params || [];
            var pName = "param" + (t.params.length + 1);
            var newParam = { id: genId(), name: pName, label: pName, type: "string", defaultValue: "" };
            t.params.push(newParam);
            state.activeTemplateId = t.id;
            state.editingMode = "template-param";
            state.activeTemplateParamId = newParam.id;
            markDirty();
            renderScreenList();
            renderScreenForm();
            if (state.screensFlowsTreeEl && typeof state.screensFlowsTreeEl.reveal === "function") {
                state.screensFlowsTreeEl.reveal("template-param:" + t.id + ":" + newParam.id);
            }
            openTemplateParamPropertiesDialog(newParam, t);
            return;
        }
    }
    if (action === "delete-template-param") {
        var parts = id.split(":");
        var tId = parts[1];
        var paramId = parts[2];
        var t = findTemplate(tId);
        if (t && t.params) {
            t.params = t.params.filter(function (p) { return p.id !== paramId; });
            if (state.activeTemplateParamId === paramId) {
                state.activeTemplateParamId = null;
                state.editingMode = "template";
            }
            markDirty();
            renderScreenList();
            renderScreenForm();
            return;
        }
    }
    if (action === "delete-app-var") {
        var varId = id.startsWith("app-var:") ? id.substring("app-var:".length) : id;
        var app = getApp();
        if (app && app.variables) {
            app.variables = app.variables.filter(function (v) { return v.id !== varId; });
            if (state.activeAppVariableId === varId) {
                state.activeAppVariableId = null;
                state.editingMode = "screen";
            }
            markDirty();
            renderScreenList();
            renderScreenForm();
            return;
        }
    }
    if (action === "delete-shared-var") {
        var varId = id.startsWith("shared-var:") ? id.substring("shared-var:".length) : id;
        var app = getApp();
        if (app && app.sharedVariables) {
            app.sharedVariables = app.sharedVariables.filter(function (v) { return v.id !== varId; });
            if (state.activeSharedVariableId === varId) {
                state.activeSharedVariableId = null;
                state.editingMode = "screen";
            }
            markDirty();
            renderScreenList();
            renderScreenForm();
            return;
        }
    }
    if (action === "delete-screen-var") {
        var parts = id.split(":");
        var screenId = parts[1];
        var varId = parts[2];
        var s = state.screens.find(function (sc) { return sc.id === screenId; });
        if (s && s.variables) {
            s.variables = s.variables.filter(function (v) { return v.id !== varId; });
            if (state.activeScreenVariableId === varId) {
                state.activeScreenVariableId = null;
                state.editingMode = "screen";
            }
            markDirty();
            renderScreenList();
            renderScreenForm();
            return;
        }
    }
    if (action === "open") {
        var fl = findFlow(id);
        if (fl) {
            openFlowInBrowser(fl);
            return;
        }
        var s = state.screens.find(function (sc) { return sc.id === id; });
        if (s) openScreenInBrowser(s);
    } else if (action === "convert") {
        var s = state.screens.find(function (sc) { return sc.id === id; });
        if (s) {
            var t = convertScreenToTemplate(s.id);
            markDirty();
            selectTemplateFromScreensPanel(t.id);
            return;
        }
        var tmpl = findTemplate(id);
        if (tmpl) {
            var sc = convertTemplateToScreen(tmpl.id);
            markDirty();
            selectScreenFromSidebar(sc.id);
            return;
        }
    } else if (action === "duplicate") {
        var s = state.screens.find(function (sc) { return sc.id === id; });
        if (s) {
            var copy = duplicateScreen(s.id);
            markDirty();
            selectScreenFromSidebar(copy.id);
            return;
        }
        var tmpl = findTemplate(id);
        if (tmpl) {
            var copyT = duplicateTemplate(tmpl.id);
            markDirty();
            selectTemplateFromScreensPanel(copyT.id);
            return;
        }
        var fl = findFlow(id);
        if (fl) {
            var copyFl = duplicateFlow(fl.id);
            markDirty();
            selectFlowFromScreensPanel(copyFl.id);
            return;
        }
    } else if (action === "delete") {
        var s = state.screens.find(function (sc) { return sc.id === id; });
        if (s) { removeScreen(s.id); return; }
        var tmpl = findTemplate(id);
        if (tmpl) {
            state.templates = state.templates.filter(function (x) { return x.id !== tmpl.id; });
            if (state.activeTemplateId === tmpl.id) {
                state.activeTemplateId = state.templates.length ? state.templates[0].id : null;
                if (!state.activeTemplateId) state.editingMode = "screen";
            }
            markDirty();
            renderScreenList();
            renderScreenForm();
            return;
        }
        var fl = findFlow(id);
        if (fl) {
            deleteFlow(fl.id);
            markDirty();
            renderScreenList();
            renderScreenForm();
            return;
        }
        var f = findFolder(id);
        if (f) {
            deleteFolder(f.id);
            if (state.selectedFolderId === f.id) state.selectedFolderId = null;
            markDirty();
            renderScreenList();
            renderScreenForm();
            return;
        }
    } else if (action === "add-screen-in") {
        var f = findFolder(id);
        if (f && f.category === "template") {
            addTemplateFromScreensPanel({ parentId: id });
        } else if (f && f.category === "flow") {
            addFlowFromSidebar({ parentId: id });
        } else {
            addScreenFromSidebar({ parentId: id });
        }
    } else if (action === "add-group-in") {
        var f = findFolder(id);
        addGroupFromSidebar({ parentId: id, category: f ? f.category : "screen" });
    }
}

export function onScreensFlowsRename(e) {
    var id = e.detail.id;
    var name = e.detail.name;
    if (id.startsWith("app-var:")) {
        var varId = id.substring("app-var:".length);
        var v = (getApp().variables || []).find(function (x) { return x.id === varId; });
        if (v && name && v.name !== name) {
            v.name = name;
            markDirty();
            renderScreenList();
            renderScreenForm();
        }
        return;
    }
    if (id.startsWith("screen-var:")) {
        var parts = id.split(":");
        var screenId = parts[1];
        var varId = parts[2];
        var s = state.screens.find(function (sc) { return sc.id === screenId; });
        var v = s && (s.variables || []).find(function (x) { return x.id === varId; });
        if (v && name && v.name !== name) {
            v.name = name;
            markDirty();
            renderScreenList();
            renderScreenForm();
        }
        return;
    }
    if (id.startsWith("template-var:")) {
        var parts = id.split(":");
        var tmplId = parts[1];
        var varId = parts[2];
        var tmpl = findTemplate(tmplId);
        var v = tmpl && (tmpl.variables || []).find(function (x) { return x.id === varId; });
        if (v && name && v.name !== name) {
            v.name = name;
            markDirty();
            renderScreenList();
            renderScreenForm();
        }
        return;
    }
    if (id.startsWith("template-param:")) {
        var parts = id.split(":");
        var tmplId = parts[1];
        var paramId = parts[2];
        var tmpl = findTemplate(tmplId);
        var p = tmpl && (tmpl.params || []).find(function (x) { return x.id === paramId; });
        if (p && name && p.name !== name) {
            p.name = name;
            if (!p.label || p.label === p.name) p.label = name;
            markDirty();
            renderScreenList();
            renderScreenForm();
        }
        return;
    }
    var item = state.screens.find(function (s) { return s.id === id; }) ||
        findTemplate(id) ||
        findFlow(id) ||
        findFolder(id);
    if (item && name && item.name !== name) {
        item.name = name;
        markDirty();
        renderScreenList();
        renderScreenForm();
        if (state.editingMode === "screen" && state.activeScreenId === id) renderActiveScreen();
        if (state.editingMode === "template" && state.activeTemplateId === id) renderActiveScreen();
    }
}
