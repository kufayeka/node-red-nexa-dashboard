// Screens & Flows tab: selecting, opening and drag-moving tree items.
import { state, markDirty, getApp, findTemplate, findFolder, findFlow, convertScreenToTemplate, convertTemplateToScreen } from "../../state.js";
import { renderScreenList } from "../screens-panel.js";
import { openPropertiesDialogForId, selectComponentFromTree, selectFlowFromScreensPanel, selectFolderFromScreensPanel, selectScreenFromSidebar, selectTemplateFromScreensPanel } from "./commands.js";
import { renderScreenForm } from "./screen-form.js";

function reorderInArray(arr, itemId, targetId, position) {
    var fromIdx = arr.findIndex(function (x) { return x.id === itemId; });
    if (fromIdx === -1) return false;
    var toIdx = arr.findIndex(function (x) { return x.id === targetId; });
    if (toIdx === -1) return false;
    var item = arr.splice(fromIdx, 1)[0];
    toIdx = arr.findIndex(function (x) { return x.id === targetId; });
    if (position === "after") {
        arr.splice(toIdx + 1, 0, item);
    } else {
        arr.splice(toIdx, 0, item);
    }
    return true;
}

export function isFolderDescendant(ancestorId, testId) {
    var cur = findFolder(testId);
    var seen = {};
    while (cur && cur.parentId) {
        if (cur.parentId === ancestorId) return true;
        if (seen[cur.parentId]) break;
        seen[cur.parentId] = true;
        cur = findFolder(cur.parentId);
    }
    return false;
}

export function onScreensFlowsSelect(e) {
    var id = e.detail.id;
    if (id === "section:screens" || id === "section:templates" || id === "section:flows" || id === "section:app-variables" || id === "section:shared-variables" || id === "section:composite-templates" || id === "section:component-templates") {
        if (id === "section:screens" && state.editingMode !== "screen" && state.screens.length) {
            selectScreenFromSidebar(state.activeScreenId || state.screens[0].id);
        } else if (id === "section:composite-templates") {
            var compT = state.templates.find(function (t) { return t.kind !== "component"; });
            if (compT) selectTemplateFromScreensPanel(compT.id);
        } else if (id === "section:component-templates") {
            var cT = state.templates.find(function (t) { return t.kind === "component"; });
            if (cT) selectTemplateFromScreensPanel(cT.id);
        } else if (id === "section:templates" && state.editingMode !== "template" && state.templates.length) {
            selectTemplateFromScreensPanel(state.activeTemplateId || state.templates[0].id);
        } else if (id === "section:flows" && state.editingMode !== "flow" && state.flows.length) {
            selectFlowFromScreensPanel(state.activeFlowId || state.flows[0].id);
        } else if (id === "section:app-variables") {
            var app = getApp();
            if (app.variables && app.variables.length) {
                state.editingMode = "app-variable";
                state.activeAppVariableId = app.variables[0].id;
                if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = [id];
                renderScreenForm();
            }
        } else if (id === "section:shared-variables") {
            var app = getApp();
            if (app.sharedVariables && app.sharedVariables.length) {
                state.editingMode = "shared-variable";
                state.activeSharedVariableId = app.sharedVariables[0].id;
                if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = [id];
                renderScreenForm();
            }
        }
        return;
    }
    if (id.startsWith("screen-comp:")) {
        var parts = id.split(":");
        var surfId = parts[1];
        var compId = parts[2];
        selectComponentFromTree(surfId, compId, e && e.detail && e.detail.additive);
        return;
    }
    if (id.startsWith("screen-comps-group:") || id.startsWith("screen-unplaced-group:")) {
        var sId = id.split(":")[1];
        if (state.activeScreenId !== sId) selectScreenFromSidebar(sId);
        return;
    }
    if (id.startsWith("template-comps-group:") || id.startsWith("template-unplaced-group:")) {
        var tId = id.split(":")[1];
        if (state.activeTemplateId !== tId) selectTemplateFromScreensPanel(tId);
        return;
    }
    if (id.startsWith("app-var:")) {
        state.editingMode = "app-variable";
        state.activeAppVariableId = id.substring("app-var:".length);
        if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = [id];
        renderScreenForm();
        openPropertiesDialogForId(id);
        return;
    }
    if (id.startsWith("shared-var:")) {
        state.editingMode = "shared-variable";
        state.activeSharedVariableId = id.substring("shared-var:".length);
        if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = [id];
        renderScreenForm();
        openPropertiesDialogForId(id);
        return;
    }
    if (id.startsWith("screen-var:")) {
        var parts = id.split(":");
        state.editingMode = "screen-variable";
        state.activeScreenId = parts[1];
        state.activeScreenVariableId = parts[2];
        if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = [id];
        renderScreenForm();
        openPropertiesDialogForId(id);
        return;
    }
    if (id.startsWith("screen-vars-group:")) {
        var sId = id.substring("screen-vars-group:".length);
        var scr = state.screens.find(function (s) { return s.id === sId; });
        if (state.activeScreenId !== sId) {
            selectScreenFromSidebar(sId);
        }
        if (scr && scr.variables && scr.variables.length) {
            state.editingMode = "screen-variable";
            state.activeScreenVariableId = scr.variables[0].id;
            if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = ["screen-var:" + sId + ":" + scr.variables[0].id];
        } else {
            state.editingMode = "screen-vars-group";
            if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = [id];
        }
        renderScreenForm();
        return;
    }
    if (id.startsWith("template-vars-group:")) {
        var tId = id.substring("template-vars-group:".length);
        var tmpl = findTemplate(tId);
        if (state.activeTemplateId !== tId) {
            selectTemplateFromScreensPanel(tId);
        }
        if (tmpl && tmpl.variables && tmpl.variables.length) {
            state.editingMode = "template-variable";
            state.activeTemplateVariableId = tmpl.variables[0].id;
            if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = ["template-var:" + tId + ":" + tmpl.variables[0].id];
        } else {
            state.editingMode = "template-vars-group";
            if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = [id];
        }
        renderScreenForm();
        return;
    }
    if (id.startsWith("template-params-group:")) {
        var tId = id.substring("template-params-group:".length);
        var tmpl = findTemplate(tId);
        if (state.activeTemplateId !== tId) {
            selectTemplateFromScreensPanel(tId);
        }
        if (tmpl && tmpl.params && tmpl.params.length) {
            state.editingMode = "template-param";
            state.activeTemplateParamId = tmpl.params[0].id;
            if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = ["template-param:" + tId + ":" + tmpl.params[0].id];
        } else {
            state.editingMode = "template-params-group";
            if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = [id];
        }
        renderScreenForm();
        return;
    }
    if (id.startsWith("template-var:")) {
        var parts = id.split(":");
        var tId = parts[1];
        var varId = parts[2];
        if (state.activeTemplateId !== tId) {
            selectTemplateFromScreensPanel(tId);
        }
        state.editingMode = "template-variable";
        state.activeTemplateVariableId = varId;
        if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = [id];
        renderScreenForm();
        openPropertiesDialogForId(id);
        return;
    }
    if (id.startsWith("template-param:")) {
        var parts = id.split(":");
        var tId = parts[1];
        var paramId = parts[2];
        if (state.activeTemplateId !== tId) {
            selectTemplateFromScreensPanel(tId);
        }
        state.editingMode = "template-param";
        state.activeTemplateParamId = paramId;
        if (state.screensFlowsTreeEl) state.screensFlowsTreeEl.selected = [id];
        renderScreenForm();
        openPropertiesDialogForId(id);
        return;
    }
    var screen = state.screens.find(function (s) { return s.id === id; });
    if (screen) { selectScreenFromSidebar(id); return; }
    var template = findTemplate(id);
    if (template) { selectTemplateFromScreensPanel(id); return; }
    var flow = findFlow(id);
    if (flow) { selectFlowFromScreensPanel(id); return; }
    var folder = findFolder(id);
    if (folder) { selectFolderFromScreensPanel(id); return; }
}

export function onScreensFlowsOpen(e) {
    var id = e.detail && e.detail.id;
    if (id) {
        openPropertiesDialogForId(id);
    }
}

export function onScreensFlowsMove(e) {
    var d = e.detail;
    var item = state.screens.find(function (s) { return s.id === d.id; }) ||
        findTemplate(d.id) ||
        findFlow(d.id) ||
        findFolder(d.id);

    if (d.position === "inside") {
        if (!item) return;
        if (d.targetId === "section:screens") {
            if (item.type === "template") {
                var sc = convertTemplateToScreen(item.id);
                sc.parentId = null;
                markDirty();
                selectScreenFromSidebar(sc.id);
                return;
            } else if (item.type === "screen") {
                item.parentId = null;
            } else if (item.type === "folder") {
                item.parentId = null;
                item.category = "screen";
            }
        } else if (d.targetId === "section:templates" || d.targetId === "section:composite-templates" || d.targetId === "section:component-templates") {
            if (item.type === "screen") {
                var tmpl = convertScreenToTemplate(item.id);
                tmpl.parentId = null;
                if (d.targetId === "section:component-templates") tmpl.kind = "component";
                else tmpl.kind = "composite";
                markDirty();
                selectTemplateFromScreensPanel(tmpl.id);
                return;
            } else if (item.type === "template") {
                item.parentId = null;
                if (d.targetId === "section:component-templates") item.kind = "component";
                else if (d.targetId === "section:composite-templates") item.kind = "composite";
                markDirty();
                renderScreenList();
            } else if (item.type === "folder") {
                item.parentId = null;
                item.category = "template";
            }
        } else if (d.targetId === "section:flows") {
            if (item.type === "flow") {
                item.parentId = null;
            } else if (item.type === "folder") {
                item.parentId = null;
                item.category = "flow";
            }
        } else {
            var targetFolder = findFolder(d.targetId);
            if (targetFolder) {
                if (item.type === "folder" && (item.id === targetFolder.id || isFolderDescendant(item.id, targetFolder.id))) {
                    return;
                }
                item.parentId = targetFolder.id;
                if (item.type === "folder") {
                    item.category = targetFolder.category || item.category;
                }
            }
        }
    } else {
        if (d.targetId === "section:screens" || d.targetId === "section:templates" || d.targetId === "section:flows" || d.targetId === "section:app-variables" || d.targetId === "section:shared-variables") {
            return;
        }

        // Variable reordering
        if (d.id.startsWith("app-var:") && d.targetId.startsWith("app-var:")) {
            var app = getApp();
            reorderInArray(app.variables || [], d.id.substring("app-var:".length), d.targetId.substring("app-var:".length), d.position);
            markDirty();
            renderScreenList();
            return;
        }
        if (d.id.startsWith("shared-var:") && d.targetId.startsWith("shared-var:")) {
            var app = getApp();
            reorderInArray(app.sharedVariables || [], d.id.substring("shared-var:".length), d.targetId.substring("shared-var:".length), d.position);
            markDirty();
            renderScreenList();
            return;
        }
        if (d.id.startsWith("screen-var:") && d.targetId.startsWith("screen-var:")) {
            var sParts1 = d.id.split(":"), sParts2 = d.targetId.split(":");
            if (sParts1[1] === sParts2[1]) {
                var sc = state.screens.find(function (s) { return s.id === sParts1[1]; });
                if (sc && sc.variables) {
                    reorderInArray(sc.variables, sParts1[2], sParts2[2], d.position);
                    markDirty();
                    renderScreenList();
                }
            }
            return;
        }
        if (d.id.startsWith("template-var:") && d.targetId.startsWith("template-var:")) {
            var sParts1 = d.id.split(":"), sParts2 = d.targetId.split(":");
            if (sParts1[1] === sParts2[1]) {
                var tmpl = findTemplate(sParts1[1]);
                if (tmpl && tmpl.variables) {
                    reorderInArray(tmpl.variables, sParts1[2], sParts2[2], d.position);
                    markDirty();
                    renderScreenList();
                }
            }
            return;
        }
        if (d.id.startsWith("template-param:") && d.targetId.startsWith("template-param:")) {
            var sParts1 = d.id.split(":"), sParts2 = d.targetId.split(":");
            if (sParts1[1] === sParts2[1]) {
                var tmpl = findTemplate(sParts1[1]);
                if (tmpl && tmpl.params) {
                    reorderInArray(tmpl.params, sParts1[2], sParts2[2], d.position);
                    markDirty();
                    renderScreenList();
                }
            }
            return;
        }

        if (!item) return;

        var target = state.screens.find(function (s) { return s.id === d.targetId; }) ||
            findTemplate(d.targetId) ||
            findFlow(d.targetId) ||
            findFolder(d.targetId);
        if (target) {
            item.parentId = target.parentId || null;
            if (item.type === "folder" && target.type === "folder") {
                item.category = target.category || item.category;
                reorderInArray(state.folders, item.id, target.id, d.position);
            } else if (item.type === "screen" && target.type === "screen") {
                reorderInArray(state.screens, item.id, target.id, d.position);
            } else if (item.type === "template" && target.type === "template") {
                reorderInArray(state.templates, item.id, target.id, d.position);
            } else if (item.type === "flow" && target.type === "flow") {
                reorderInArray(state.flows, item.id, target.id, d.position);
            } else if (target.type === "template" && item.type === "screen") {
                var tmpl2 = convertScreenToTemplate(item.id);
                tmpl2.parentId = target.parentId || null;
                markDirty();
                selectTemplateFromScreensPanel(tmpl2.id);
                return;
            } else if (target.type === "screen" && item.type === "template") {
                var sc2 = convertTemplateToScreen(item.id);
                sc2.parentId = target.parentId || null;
                markDirty();
                selectScreenFromSidebar(sc2.id);
                return;
            }
        }
    }
    markDirty();
    renderScreenList();
}
