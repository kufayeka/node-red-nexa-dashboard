import {
    state, getActiveScreen, makeScreen, markDirty, getApp, genId, Scope, Types,
    findTemplate, makeTemplate,
    makeFolder, findFolder, deleteFolder,
    makeFlow, findFlow, deleteFlow,
    duplicateScreen, duplicateTemplate, duplicateFlow,
    convertScreenToTemplate, convertTemplateToScreen
} from "../state.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { applyConstraints } from "../canvas/constraints.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";
import { renderTemplateForm, showEditBar, hideEditBar } from "./templates-panel.js";
import { updateCanvasTabsVisibility } from "../editor-tray.js";

export function refreshLogicCanvasIfActive() {
    if (state.activeCanvasTab === "logic") renderLogicCanvas();
}

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
}

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

function isFolderDescendant(ancestorId, testId) {
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

export function buildScreensFlowsTreeNodes() {
    var folderNodes = {};
    state.folders.forEach(function (f) {
        folderNodes[f.id] = {
            id: f.id,
            label: f.name,
            icon: "fa fa-folder-o",
            container: true,
            type: "folder",
            children: [],
            actions: [
                { id: "add-screen-in", icon: "fa fa-plus", title: "Add item in group" },
                { id: "delete", icon: "fa fa-trash-o", title: "Delete group" }
            ]
        };
    });

    var screensSection = {
        id: "section:screens",
        label: "Screens",
        icon: "fa fa-desktop",
        container: true,
        type: "section",
        badge: String(state.screens.length),
        actions: [
            { id: "add-screen", icon: "fa fa-plus", title: "Add Screen" },
            { id: "add-group-screen", icon: "fa fa-folder-o", title: "Add Group" }
        ],
        children: []
    };

    var templatesSection = {
        id: "section:templates",
        label: "Templates",
        icon: "fa fa-clone",
        container: true,
        type: "section",
        badge: String(state.templates.length),
        actions: [
            { id: "add-template", icon: "fa fa-plus", title: "Add Template" },
            { id: "add-group-template", icon: "fa fa-folder-o", title: "Add Group" }
        ],
        children: []
    };

    var flowsSection = {
        id: "section:flows",
        label: "Flows",
        icon: "fa fa-code-fork",
        container: true,
        type: "section",
        badge: String(state.flows.length),
        actions: [
            { id: "add-flow", icon: "fa fa-plus", title: "Add Flow" },
            { id: "add-group-flow", icon: "fa fa-folder-o", title: "Add Group" }
        ],
        children: []
    };

    function placeInScreen(itemNode, parentId) {
        if (parentId && folderNodes[parentId]) {
            folderNodes[parentId].children.push(itemNode);
        } else {
            screensSection.children.push(itemNode);
        }
    }

    function placeInTemplate(itemNode, parentId) {
        if (parentId && folderNodes[parentId]) {
            folderNodes[parentId].children.push(itemNode);
        } else {
            templatesSection.children.push(itemNode);
        }
    }

    function placeInFlow(itemNode, parentId) {
        if (parentId && folderNodes[parentId]) {
            folderNodes[parentId].children.push(itemNode);
        } else {
            flowsSection.children.push(itemNode);
        }
    }

    // Screens
    state.screens.forEach(function (s) {
        var screenVars = (s.variables || []).map(function (v) {
            return {
                id: "screen-var:" + s.id + ":" + v.id,
                label: v.name,
                title: v.name + " (" + (v.type || "string") + ")",
                icon: "fa fa-tag",
                type: "screen-variable",
                actions: [
                    { id: "delete-screen-var", icon: "fa fa-trash-o", title: "Delete variable" }
                ]
            };
        });

        var node = {
            id: s.id,
            label: s.name,
            title: s.name + " (" + (s.path || "/screen") + ")",
            icon: "fa fa-desktop",
            type: "screen",
            container: true,
            children: screenVars,
            muted: !!s.disabled,
            actions: [
                { id: "add-screen-var", icon: "fa fa-plus", title: "Add Variable" },
                { id: "convert", icon: "fa fa-exchange", title: "Convert to Template" },
                { id: "duplicate", icon: "fa fa-clone", title: "Duplicate screen" }
            ]
        };
        if (state.screens.length > 1) {
            node.actions.push({ id: "delete", icon: "fa fa-trash-o", title: "Delete screen" });
        }
        placeInScreen(node, s.parentId);
    });

    // Templates
    state.templates.forEach(function (t) {
        var node = {
            id: t.id,
            label: t.name,
            title: t.name + (t.identifier ? " (@" + t.identifier + ")" : ""),
            icon: "fa fa-clone",
            type: "template",
            actions: [
                { id: "convert", icon: "fa fa-exchange", title: "Convert to Screen" },
                { id: "duplicate", icon: "fa fa-files-o", title: "Duplicate template" },
                { id: "delete", icon: "fa fa-trash-o", title: "Delete template" }
            ]
        };
        placeInTemplate(node, t.parentId);
    });

    // Flows
    state.flows.forEach(function (fl) {
        var node = {
            id: fl.id,
            label: fl.name,
            title: fl.name + " (" + (fl.endpoint || "/flow") + ")",
            icon: "fa fa-code-fork",
            type: "flow",
            actions: [
                { id: "open", icon: "fa fa-external-link", title: "Open flow in new tab" },
                { id: "duplicate", icon: "fa fa-files-o", title: "Duplicate flow" },
                { id: "delete", icon: "fa fa-trash-o", title: "Delete flow" }
            ]
        };
        placeInFlow(node, fl.parentId);
    });

    // App Variables Root Section
    var app = getApp();
    var appVars = app.variables || [];
    var appVarsSection = {
        id: "section:app-variables",
        label: "App Variables",
        icon: "fa fa-globe",
        container: true,
        type: "section",
        badge: String(appVars.length),
        actions: [
            { id: "add-app-var", icon: "fa fa-plus", title: "Add App Variable" }
        ],
        children: appVars.map(function (v) {
            return {
                id: "app-var:" + v.id,
                label: v.name,
                title: v.name + " (" + (v.type || "string") + (v.persist && v.persist !== "none" ? ", " + v.persist : "") + ")",
                icon: "fa fa-cube",
                type: "app-variable",
                actions: [
                    { id: "delete-app-var", icon: "fa fa-trash-o", title: "Delete variable" }
                ]
            };
        })
    };

    // Folders placement into their section or parent folder (preserving folders order)
    var screenFolderList = [], templateFolderList = [], flowFolderList = [];
    state.folders.forEach(function (f) {
        var node = folderNodes[f.id];
        if (f.parentId && folderNodes[f.parentId] && f.parentId !== f.id && !isFolderDescendant(f.id, f.parentId)) {
            folderNodes[f.parentId].children.push(node);
        } else if (f.parentId === "section:templates" || f.category === "template") {
            templateFolderList.push(node);
        } else if (f.parentId === "section:flows" || f.category === "flow") {
            flowFolderList.push(node);
        } else if (f.parentId === "section:screens" || f.category === "screen") {
            screenFolderList.push(node);
        } else {
            var hasTemplates = state.templates.some(function (t) { return t.parentId === f.id; });
            var hasFlows = state.flows.some(function (fl) { return fl.parentId === f.id; });
            if (hasTemplates) {
                f.category = "template";
                templateFolderList.push(node);
            } else if (hasFlows) {
                f.category = "flow";
                flowFolderList.push(node);
            } else {
                f.category = "screen";
                screenFolderList.push(node);
            }
        }
    });

    screensSection.children = screenFolderList.concat(screensSection.children);
    templatesSection.children = templateFolderList.concat(templatesSection.children);
    flowsSection.children = flowFolderList.concat(flowsSection.children);

    // Set folder badges
    Object.keys(folderNodes).forEach(function (fid) {
        folderNodes[fid].badge = String(folderNodes[fid].children.length);
    });

    screensSection.badge = String(state.screens.length);
    templatesSection.badge = String(state.templates.length);
    flowsSection.badge = String(state.flows.length);

    return [screensSection, templatesSection, flowsSection, appVarsSection];
}

function onScreensFlowsSelect(e) {
    var id = e.detail.id;
    if (id === "section:screens" || id === "section:templates" || id === "section:flows" || id === "section:app-variables") {
        if (id === "section:screens" && state.editingMode !== "screen" && state.screens.length) {
            selectScreenFromSidebar(state.activeScreenId || state.screens[0].id);
        } else if (id === "section:templates" && state.editingMode !== "template" && state.templates.length) {
            selectTemplateFromScreensPanel(state.activeTemplateId || state.templates[0].id);
        } else if (id === "section:flows" && state.editingMode !== "flow" && state.flows.length) {
            selectFlowFromScreensPanel(state.activeFlowId || state.flows[0].id);
        } else if (id === "section:app-variables") {
            var app = getApp();
            if (app.variables && app.variables.length) {
                state.editingMode = "app-variable";
                state.activeAppVariableId = app.variables[0].id;
                renderScreenForm();
            }
        }
        return;
    }
    if (id.startsWith("app-var:")) {
        state.editingMode = "app-variable";
        state.activeAppVariableId = id.substring("app-var:".length);
        renderScreenForm();
        return;
    }
    if (id.startsWith("screen-var:")) {
        var parts = id.split(":");
        state.editingMode = "screen-variable";
        state.activeScreenId = parts[1];
        state.activeScreenVariableId = parts[2];
        renderScreenForm();
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

function onScreensFlowsAction(e) {
    var id = e.detail.id;
    var action = e.detail.action;
    if (action === "add-screen") {
        addScreenFromSidebar({ parentId: null });
        return;
    }
    if (action === "add-template") {
        addTemplateFromScreensPanel({ parentId: null });
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
    if (action === "add-screen-var") {
        var s = state.screens.find(function (sc) { return sc.id === id; });
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

function onScreensFlowsRename(e) {
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

function onScreensFlowsMove(e) {
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
        } else if (d.targetId === "section:templates") {
            if (item.type === "screen") {
                var tmpl = convertScreenToTemplate(item.id);
                tmpl.parentId = null;
                markDirty();
                selectTemplateFromScreensPanel(tmpl.id);
                return;
            } else if (item.type === "template") {
                item.parentId = null;
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
        if (d.targetId === "section:screens" || d.targetId === "section:templates" || d.targetId === "section:flows" || d.targetId === "section:app-variables") {
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

export function renderScreenList() {
    if (!state.screenListEl) return;
    state.screenListEl.empty();

    var hasNexaKit = typeof window !== "undefined" && (window.NexaKit || (window.customElements && window.customElements.get("nx-tree")));

    if (hasNexaKit) {
        var treeHost = window.$("<div>", { "class": "nexa-screens-tree-host" }).css({
            width: "100%", "box-sizing": "border-box"
        }).appendTo(state.screenListEl);

        var treeEl = document.createElement("nx-tree");
        treeEl.setAttribute("empty-text", "No items yet — click + Add Screen, Template or Flow");
        treeEl.setAttribute("persist-key", "screens-flows:tree");
        treeEl.addEventListener("nx-tree-select", onScreensFlowsSelect);
        treeEl.addEventListener("nx-tree-move", onScreensFlowsMove);
        treeEl.addEventListener("nx-tree-action", onScreensFlowsAction);
        treeEl.addEventListener("nx-tree-rename", onScreensFlowsRename);
        treeHost.get(0).appendChild(treeEl);

        var nodes = buildScreensFlowsTreeNodes();
        treeEl.nodes = nodes;
        var activeId = state.editingMode === "app-variable" ? ("app-var:" + state.activeAppVariableId)
            : state.editingMode === "screen-variable" ? ("screen-var:" + state.activeScreenId + ":" + state.activeScreenVariableId)
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

function renderFlowForm(flow) {
    var header = window.$("<div>").css({
        "font-weight": "bold",
        "font-size": "13px",
        "margin-bottom": "14px",
        "padding-bottom": "8px",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
        color: "var(--red-ui-primary-text-color, #1e293b)",
        display: "flex",
        "align-items": "center",
        gap: "6px"
    }).html('<i class="fa fa-code-fork" style="color: #6366f1;"></i> Flow Properties').appendTo(state.screenFormEl);

    function row(label, field, value, type) {
        var r = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text(label).appendTo(r);
        var input = window.$("<input>", { type: type || "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(value).appendTo(r);
        input.on("change", function () {
            flow[field] = input.val();
            if (field === "name") renderScreenList();
            markDirty();
        });
        return input;
    }

    row("Flow Name", "name", flow.name);
    row("Starting Endpoint", "endpoint", flow.endpoint);

    // Flow Routing Policy
    var policyRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Flow Routing Rules").appendTo(policyRow);
    var policySelect = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" }).appendTo(policyRow);
    window.$("<option>", { value: "strict" }).text("Strict Sequential (Must enter via Route Trigger)").appendTo(policySelect);
    window.$("<option>", { value: "free" }).text("Free Jump (Allow direct jump to any flow screen)").appendTo(policySelect);
    policySelect.val(flow.routingPolicy || "strict");
    policySelect.on("change", function () {
        flow.routingPolicy = policySelect.val();
        markDirty();
    });

    window.$("<div>").css({
        "margin-top": "12px",
        padding: "10px 12px",
        background: "#f0fdf4",
        border: "1px solid #bbf7d0",
        "border-radius": "6px",
        "font-size": "11px",
        color: "#166534",
        "line-height": "1.5"
    }).html('<strong><i class="fa fa-info-circle"></i> Screen Flow Gateway</strong><br>Flow is the exclusive public entrypoint. Screens are rendered as internal views.<br><br>Public URL format: <code>/nexa' + (flow.endpoint || '/flow') + '/&lt;screen-path&gt;</code>.<br>Configure logic & routing in the <strong>Logic</strong> tab.').appendTo(state.screenFormEl);

    var btnRow = window.$("<div>").css({ "margin-top": "14px" }).appendTo(state.screenFormEl);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-primary" })
        .html('<i class="fa fa-code-fork"></i> Open Flow Logic Canvas')
        .css({ width: "100%", height: "30px", "font-size": "12px", display: "inline-flex", "align-items": "center", "justify-content": "center", gap: "6px" })
        .on("click", function () {
            if (state.canvasTabs && typeof state.canvasTabs.activateTab === "function") {
                state.canvasTabs.activateTab("logic");
            }
        }).appendTo(btnRow);
}

function renderFolderForm(folder) {
    var header = window.$("<div>").css({
        "font-weight": "bold",
        "font-size": "13px",
        "margin-bottom": "14px",
        "padding-bottom": "8px",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
        color: "var(--red-ui-primary-text-color, #1e293b)",
        display: "flex",
        "align-items": "center",
        gap: "6px"
    }).html('<i class="fa fa-folder-open-o" style="color: #f59e0b;"></i> Group Properties').appendTo(state.screenFormEl);

    var r = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text("Group Name").appendTo(r);
    var input = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(folder.name).appendTo(r);
    input.on("change", function () {
        folder.name = input.val();
        renderScreenList();
        markDirty();
    });

    var pRow = window.$("<div>").css({ "margin-bottom": "14px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text("Parent Group").appendTo(pRow);
    var pSel = window.$("<select>").css({ width: "100%" }).appendTo(pRow);
    window.$("<option>", { value: "" }).text("(Root level)").appendTo(pSel);
    state.folders.forEach(function (f) {
        if (f.id !== folder.id && !isFolderDescendant(folder.id, f.id)) {
            window.$("<option>", { value: f.id }).text(f.name).appendTo(pSel);
        }
    });
    pSel.val(folder.parentId || "");
    pSel.on("change", function () {
        folder.parentId = pSel.val() || null;
        renderScreenList();
        markDirty();
    });

    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small" })
        .css({ color: "#ef4444", "margin-top": "12px", display: "inline-flex", "align-items": "center", gap: "4px" })
        .html('<i class="fa fa-trash"></i> Delete Group')
        .on("click", function () {
            deleteFolder(folder.id);
            state.selectedFolderId = null;
            markDirty();
            renderScreenList();
            renderScreenForm();
        }).appendTo(state.screenFormEl);
}

function renderVariablePropertiesForm(variable, isApp, screen) {
    var header = window.$("<div>").css({
        "font-weight": "bold",
        "font-size": "13px",
        "margin-bottom": "14px",
        "padding-bottom": "8px",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
        color: "var(--red-ui-primary-text-color, #1e293b)",
        display: "flex",
        "align-items": "center",
        gap: "6px"
    }).html(isApp
        ? '<i class="fa fa-globe" style="color: #6366f1;"></i> App Variable Properties'
        : '<i class="fa fa-tag" style="color: #0284c7;"></i> Screen Variable Properties (' + (screen ? screen.name : "") + ')'
    ).appendTo(state.screenFormEl);

    // Context / info box
    window.$("<div>").css({
        "margin-bottom": "14px",
        padding: "8px 12px",
        background: isApp ? "#f5f3ff" : "#f0f9ff",
        border: "1px solid " + (isApp ? "#ddd6fe" : "#bae6fd"),
        "border-radius": "6px",
        "font-size": "11px",
        color: isApp ? "#5b21b6" : "#0369a1",
        "line-height": "1.4"
    }).html(isApp
        ? '<strong>Global App Variable</strong><br>Shared across every screen. Bind in components using <code>{' + (variable.name || "var") + '}</code> or access in Logic via "Set Variable" / Function.'
        : '<strong>Screen-Scoped Variable (' + (screen ? screen.name : "Screen") + ')</strong><br>Available to all components on this screen. Bind in components using <code>{' + (variable.name || "var") + '}</code>.'
    ).appendTo(state.screenFormEl);

    // Variable Name Row
    var nameRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Variable Name").appendTo(nameRow);
    var nameInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(variable.name || "").appendTo(nameRow);
    var nameError = window.$("<div>").css({ "font-size": "10.5px", color: "#ef4444", "margin-top": "3px", display: "none" }).appendTo(nameRow);

    nameInput.on("input change", function () {
        var val = nameInput.val().trim();
        if (!val || (Scope && Scope.NAME_RE && !Scope.NAME_RE.test(val))) {
            nameError.text('Invalid name. Must start with a letter/$/_ and contain only alphanumeric characters.').show();
        } else {
            nameError.hide();
            variable.name = val;
            renderScreenList();
            markDirty();
        }
    });

    // Type Row
    var typeRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Type").appendTo(typeRow);
    var typeSelect = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" }).appendTo(typeRow);
    ["string", "number", "boolean", "object", "array", "color"].forEach(function (t) {
        window.$("<option>", { value: t }).text(t).appendTo(typeSelect);
    });
    (getApp().types || []).forEach(function (t) {
        window.$("<option>", { value: "type:" + t.id }).text(t.name + " (custom type)").appendTo(typeSelect);
    });
    typeSelect.val(variable.type || "string");

    // Default Value Row
    var valRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Default Value").appendTo(valRow);
    var valInputContainer = window.$("<div>").appendTo(valRow);

    function renderValueControl(currentType) {
        valInputContainer.empty();
        if (currentType === "boolean") {
            var bSel = window.$("<select>").css({ width: "100%", padding: "4px" }).appendTo(valInputContainer);
            window.$("<option>", { value: "false" }).text("false").appendTo(bSel);
            window.$("<option>", { value: "true" }).text("true").appendTo(bSel);
            bSel.val(String(!!variable.defaultValue));
            bSel.on("change", function () {
                variable.defaultValue = bSel.val() === "true";
                markDirty();
            });
        } else if (currentType === "number") {
            var nIn = window.$("<input>", { type: "number" }).css({ width: "100%", "box-sizing": "border-box" })
                .val(variable.defaultValue !== undefined ? variable.defaultValue : 0).appendTo(valInputContainer);
            nIn.on("change input", function () {
                var num = parseFloat(nIn.val());
                variable.defaultValue = isFinite(num) ? num : 0;
                markDirty();
            });
        } else if (currentType === "color") {
            var cWrap = window.$("<div>").css({ display: "flex", gap: "6px", "align-items": "center" }).appendTo(valInputContainer);
            var colorPick = window.$("<input>", { type: "color" }).css({ width: "32px", height: "26px", padding: "0", border: "1px solid #ccc", "border-radius": "3px", cursor: "pointer" })
                .val(variable.defaultValue || "#000000").appendTo(cWrap);
            var colorText = window.$("<input>", { type: "text" }).css({ flex: "1 1 auto", "box-sizing": "border-box" })
                .val(variable.defaultValue || "#000000").appendTo(cWrap);
            colorPick.on("input change", function () {
                colorText.val(colorPick.val());
                variable.defaultValue = colorPick.val();
                markDirty();
            });
            colorText.on("input change", function () {
                colorPick.val(colorText.val());
                variable.defaultValue = colorText.val();
                markDirty();
            });
        } else if (currentType === "object" || currentType === "array") {
            var valStr = "";
            try {
                valStr = variable.defaultValue !== undefined ? JSON.stringify(variable.defaultValue, null, 2) : (currentType === "array" ? "[]" : "{}");
            } catch (err) { valStr = currentType === "array" ? "[]" : "{}"; }
            var ta = window.$("<textarea>", { rows: 4 }).css({ width: "100%", "box-sizing": "border-box", "font-family": "monospace", "font-size": "11px", padding: "5px" })
                .val(valStr).appendTo(valInputContainer);
            var jsonErr = window.$("<div>").css({ "font-size": "10.5px", color: "#ef4444", "margin-top": "3px", display: "none" }).appendTo(valInputContainer);
            ta.on("change", function () {
                try {
                    variable.defaultValue = JSON.parse(ta.val());
                    jsonErr.hide();
                    markDirty();
                } catch (e) {
                    jsonErr.text("Invalid JSON syntax").show();
                }
            });
        } else {
            var sIn = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" })
                .val(variable.defaultValue !== undefined ? String(variable.defaultValue) : "").appendTo(valInputContainer);
            sIn.on("change input", function () {
                variable.defaultValue = sIn.val();
                markDirty();
            });
        }
    }

    renderValueControl(variable.type || "string");

    typeSelect.on("change", function () {
        var oldType = variable.type || "string";
        var newType = typeSelect.val();
        variable.type = newType;
        if (newType === "boolean" && typeof variable.defaultValue !== "boolean") variable.defaultValue = false;
        else if (newType === "number" && typeof variable.defaultValue !== "number") variable.defaultValue = 0;
        else if (newType === "object" && (typeof variable.defaultValue !== "object" || Array.isArray(variable.defaultValue))) variable.defaultValue = {};
        else if (newType === "array" && !Array.isArray(variable.defaultValue)) variable.defaultValue = [];
        else if (newType === "color" && typeof variable.defaultValue !== "string") variable.defaultValue = "#000000";
        else if (newType === "string" && typeof variable.defaultValue !== "string") variable.defaultValue = "";
        renderValueControl(newType);
        markDirty();
    });

    // Kept for (Persistence) - Only for App Variables
    if (isApp) {
        var persistRow = window.$("<div>").css({ "margin-bottom": "14px" }).appendTo(state.screenFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
            .text("Kept for (Persistence)").appendTo(persistRow);
        var persistSelect = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" }).appendTo(persistRow);
        window.$("<option>", { value: "none" }).text("this page (resets on reload)").appendTo(persistSelect);
        window.$("<option>", { value: "session" }).text("tab session (sessionStorage)").appendTo(persistSelect);
        window.$("<option>", { value: "local" }).text("browser (localStorage — kept across reloads)").appendTo(persistSelect);
        persistSelect.val(variable.persist || "none");
        persistSelect.on("change", function () {
            variable.persist = persistSelect.val();
            markDirty();
        });
    }

    // Delete Button
    var btnRow = window.$("<div>").css({ "margin-top": "16px", "padding-top": "12px", "border-top": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)" }).appendTo(state.screenFormEl);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small" })
        .css({ color: "#ef4444", display: "inline-flex", "align-items": "center", gap: "5px" })
        .html('<i class="fa fa-trash"></i> Delete Variable')
        .on("click", function () {
            if (isApp) {
                var app = getApp();
                app.variables = (app.variables || []).filter(function (v) { return v.id !== variable.id; });
                state.activeAppVariableId = null;
                state.editingMode = "screen";
            } else if (screen) {
                screen.variables = (screen.variables || []).filter(function (v) { return v.id !== variable.id; });
                state.activeScreenVariableId = null;
                state.editingMode = "screen";
            }
            markDirty();
            renderScreenList();
            renderScreenForm();
        }).appendTo(btnRow);
}

export function renderScreenForm() {
    if (!state.screenFormEl) return;
    state.screenFormEl.empty();

    if (state.selectedFolderId) {
        var folder = findFolder(state.selectedFolderId);
        if (folder) {
            renderFolderForm(folder);
            return;
        }
    }

    if (state.editingMode === "app-variable") {
        var app = getApp();
        var appVar = (app.variables || []).find(function (v) { return v.id === state.activeAppVariableId; });
        if (appVar) {
            renderVariablePropertiesForm(appVar, true, null);
            return;
        }
    }

    if (state.editingMode === "screen-variable") {
        var sc = state.screens.find(function (s) { return s.id === state.activeScreenId; });
        var scVar = sc && (sc.variables || []).find(function (v) { return v.id === state.activeScreenVariableId; });
        if (scVar) {
            renderVariablePropertiesForm(scVar, false, sc);
            return;
        }
    }

    if (state.editingMode === "flow") {
        var flow = findFlow(state.activeFlowId);
        if (flow) {
            renderFlowForm(flow);
            return;
        }
    }

    if (state.editingMode === "template") {
        renderTemplateForm(state.screenFormEl);
        return;
    }

    var screen = getActiveScreen();
    if (!screen || state.editingMode !== "screen") {
        window.$("<div>", { style: "text-align: center; color: var(--red-ui-secondary-text-color, #94a3b8); padding: 32px 16px; font-size: 12px;" })
            .html('<i class="fa fa-desktop" style="font-size: 24px; color: #cbd5e1; display: block; margin-bottom: 8px;"></i>Select a screen, template, or flow from the tree on the left.')
            .appendTo(state.screenFormEl);
        return;
    }

    var header = window.$("<div>").css({
        "font-weight": "bold",
        "font-size": "13px",
        "margin-bottom": "14px",
        "padding-bottom": "8px",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
        color: "var(--red-ui-primary-text-color, #1e293b)",
        display: "flex",
        "align-items": "center",
        gap: "6px"
    }).html('<i class="fa fa-sliders" style="color: #0284c7;"></i> Screen Properties').appendTo(state.screenFormEl);

    function row(label, field, value, type) {
        var r = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text(label).appendTo(r);
        var input = window.$("<input>", { type: type || "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(value).appendTo(r);
        input.on("change", function () {
            var v = type === "number" ? (parseInt(input.val(), 10) || 0) : input.val();
            var oldSize = { w: screen.width, h: screen.height };
            screen[field] = v;
            if (field === "width" || field === "height") applyConstraints(null, screen.components || [], oldSize, { w: screen.width, h: screen.height });
            if (field === "name" || field === "path") renderScreenList();
            markDirty();
            renderActiveScreen();
        });
        return input;
    }

    row("Name", "name", screen.name);
    row("URL path", "path", screen.path);
    var DEVICES = [
        ["", "Custom size"], ["1920x1080", "Full HD 1920 × 1080"], ["1366x768", "Laptop 1366 × 768"],
        ["1280x800", "HMI panel 10\" 1280 × 800"], ["1024x768", "HMI panel 1024 × 768"], ["800x480", "HMI panel 7\" 800 × 480"],
        ["1180x820", "Tablet landscape 1180 × 820"], ["820x1180", "Tablet portrait 820 × 1180"], ["390x844", "Phone 390 × 844"]
    ];
    var presetRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text("Device").appendTo(presetRow);
    var presetSel = window.$("<select>").css({ width: "100%" }).appendTo(presetRow);
    DEVICES.forEach(function (d) { window.$("<option>", { value: d[0] }).text(d[1]).appendTo(presetSel); });
    presetSel.val(screen.width + "x" + screen.height);
    if (!presetSel.val()) presetSel.val("");
    var widthInput = row("Width (px)", "width", screen.width, "number");
    var heightInput = row("Height (px)", "height", screen.height, "number");
    presetSel.on("change", function () {
        var m = /^(\d+)x(\d+)$/.exec(presetSel.val());
        if (!m) return;
        var oldSize = { w: screen.width, h: screen.height };
        screen.width = Number(m[1]); screen.height = Number(m[2]);
        widthInput.val(screen.width); heightInput.val(screen.height);
        applyConstraints(null, screen.components || [], oldSize, { w: screen.width, h: screen.height });
        markDirty();
        renderActiveScreen();
        syncHelp();
    });
    [widthInput, heightInput].forEach(function (inp) { inp.on("change", function () { presetSel.val(screen.width + "x" + screen.height); if (!presetSel.val()) presetSel.val(""); syncHelp(); }); });

    var modeRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text("On the live page").appendTo(modeRow);
    var modeSel = window.$("<select>").css({ width: "100%" }).appendTo(modeRow);
    [["fixed", "Exact size (this device), centred"], ["fit", "Scale to fit the window (keep proportions)"],
        ["fitWidth", "Scale to the window width (scroll down)"], ["fill", "Fill the window (responsive, by constraints)"]]
        .forEach(function (o) { window.$("<option>", { value: o[0] }).text(o[1]).appendTo(modeSel); });
    modeSel.val(screen.displayMode || "fixed");
    var modeHelp = window.$("<div>").css({ "font-size": "11px", color: "var(--red-ui-secondary-text-color, #888)", "margin-top": "4px" }).appendTo(modeRow);
    var HELP = {
        fixed: function () { return "Shown at exactly " + screen.width + " × " + screen.height + " px — for a known panel / device."; },
        fit: "Everything scales together so the whole screen fits any window.",
        fitWidth: "Scales to the window's width; taller content scrolls — good for web pages.",
        fill: "The screen takes the window's size. Nothing scales: set constraints (left / right / scale…) on top-level items and use frames with auto layout."
    };
    var syncHelp = function () { var h = HELP[modeSel.val()]; modeHelp.text(typeof h === "function" ? h() : (h || "")); };
    syncHelp();
    modeSel.on("change", function () {
        if (modeSel.val() === "fixed") delete screen.displayMode; else screen.displayMode = modeSel.val();
        syncHelp();
        markDirty();
    });
    row("Grid size (px)", "gridSize", screen.gridSize, "number");

    var checksWrap = window.$("<div>").css({
        "margin-top": "12px",
        "padding-top": "10px",
        "border-top": "1px solid var(--red-ui-secondary-border-color, #f1f5f9)",
        display: "flex",
        "flex-direction": "column",
        gap: "8px"
    }).appendTo(state.screenFormEl);

    var snapRow = window.$("<label>").css({ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer" }).appendTo(checksWrap);
    var snapInput = window.$("<input>", { type: "checkbox" }).prop("checked", screen.snap !== false).appendTo(snapRow);
    window.$("<span>").text("Snap to grid").appendTo(snapRow);
    snapInput.on("change", function () {
        screen.snap = snapInput.is(":checked");
        markDirty();
    });

    var enableRow = window.$("<label>").css({ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer" }).appendTo(checksWrap);
    var enableInput = window.$("<input>", { type: "checkbox" }).prop("checked", !screen.disabled).appendTo(enableRow);
    window.$("<span>").text("Enable screen (live page at URL path)").appendTo(enableRow);
    enableInput.on("change", function () {
        screen.disabled = !enableInput.is(":checked");
        markDirty();
        renderScreenList();
    });
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
        expandAllScreensTree: expandAllScreensTree,
        collapseAllScreensTree: collapseAllScreensTree,
        removeScreen: removeScreen
    });
}
