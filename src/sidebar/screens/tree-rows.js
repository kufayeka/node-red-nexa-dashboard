// Screens & Flows tab: what the tree shows (folders, screens, templates, flows, variables, components).
import { state, getApp, Tree } from "../../state.js";
import { nodeLabel as labelOfComp, nodeIcon as iconOfComp } from "../node-labels.js";
import { isFolderDescendant } from "./tree-events.js";

function buildComponentTreeRows(surface, list, orphan) {
    return (list || []).slice().reverse().map(function (node) {
        var vis = node.visibility || "show";
        var eff = orphan ? vis : (Tree && Tree.effectiveVisibility ? Tree.effectiveVisibility(surface, node.id) : vis);
        var isCont = Tree && Tree.isContainer ? Tree.isContainer(node) : false;
        var kids = isCont ? Tree.kids(node) : [];
        return {
            id: "screen-comp:" + surface.id + ":" + node.id,
            compId: node.id,
            surfaceId: surface.id,
            label: labelOfComp(node),
            title: labelOfComp(node) + " — " + node.type,
            icon: iconOfComp(node),
            container: isCont,
            badge: isCont ? String(kids.length) : "",
            muted: eff !== "show" || !!node.slotUnused,
            renamable: false,
            children: isCont ? buildComponentTreeRows(surface, kids, orphan) : []
        };
    });
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
                { id: "edit-props", icon: "fa fa-sliders", title: "Group Properties" },
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

    var compositeTemplates = state.templates.filter(function (t) { return t.kind !== "component"; });
    var componentTemplates = state.templates.filter(function (t) { return t.kind === "component"; });

    var compositeGroup = {
        id: "section:composite-templates",
        label: "Composite Templates",
        icon: "fa fa-cubes",
        container: true,
        type: "template-category",
        badge: String(compositeTemplates.length),
        actions: [
            { id: "add-composite-template", icon: "fa fa-plus", title: "Add Composite Template" },
            { id: "add-group-template", icon: "fa fa-folder-o", title: "Add Group" }
        ],
        children: []
    };

    var componentGroup = {
        id: "section:component-templates",
        label: "Component Templates",
        icon: "fa fa-puzzle-piece",
        container: true,
        type: "template-category",
        badge: String(componentTemplates.length),
        actions: [
            { id: "add-component-template", icon: "fa fa-plus", title: "Add Component Template" }
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
            { id: "add-composite-template", icon: "fa fa-plus", title: "Add Composite Template" },
            { id: "add-component-template", icon: "fa fa-puzzle-piece", title: "Add Component Template" }
        ],
        children: [compositeGroup, componentGroup]
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

    function placeInTemplate(itemNode, parentId, kind) {
        if (parentId && folderNodes[parentId]) {
            folderNodes[parentId].children.push(itemNode);
        } else if (kind === "component") {
            componentGroup.children.push(itemNode);
        } else {
            compositeGroup.children.push(itemNode);
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
        var compRows = buildComponentTreeRows(s, s.components || [], false);
        if (s.orphans && s.orphans.length) {
            compRows.push({
                id: "screen-unplaced-group:" + s.id,
                surfaceId: s.id,
                label: "Unplaced",
                icon: "fa fa-inbox",
                container: true,
                badge: String(s.orphans.length),
                children: buildComponentTreeRows(s, s.orphans, true)
            });
        }
        var compsGroup = {
            id: "screen-comps-group:" + s.id,
            surfaceId: s.id,
            label: "Components",
            icon: "fa fa-cubes",
            type: "screen-comps-group",
            container: true,
            badge: String((s.components || []).length + (s.orphans ? s.orphans.length : 0)),
            children: compRows
        };

        var screenVars = (s.variables || []).map(function (v) {
            return {
                id: "screen-var:" + s.id + ":" + v.id,
                label: v.name,
                title: v.name + " (" + (v.type || "string") + ")",
                icon: "fa fa-tag",
                type: "screen-variable",
                actions: [
                    { id: "edit-props", icon: "fa fa-pencil", title: "Edit Variable" },
                    { id: "delete-screen-var", icon: "fa fa-trash-o", title: "Delete variable" }
                ]
            };
        });

        var varsGroup = {
            id: "screen-vars-group:" + s.id,
            label: "Variables",
            icon: "fa fa-tags",
            type: "screen-vars-group",
            container: true,
            badge: String(screenVars.length),
            actions: [
                { id: "add-screen-var", icon: "fa fa-plus", title: "Add Variable" }
            ],
            children: screenVars
        };

        var node = {
            id: s.id,
            label: s.name,
            title: s.name + " (" + (s.path || "/screen") + ")",
            icon: "fa fa-desktop",
            type: "screen",
            container: true,
            children: [compsGroup, varsGroup],
            muted: !!s.disabled,
            actions: [
                { id: "edit-props", icon: "fa fa-sliders", title: "Screen Properties" },
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
        t.variables = t.variables || [];
        t.params = t.params || [];

        var tmplCompRows = buildComponentTreeRows(t, t.components || [], false);
        if (t.orphans && t.orphans.length) {
            tmplCompRows.push({
                id: "template-unplaced-group:" + t.id,
                surfaceId: t.id,
                label: "Unplaced",
                icon: "fa fa-inbox",
                container: true,
                badge: String(t.orphans.length),
                children: buildComponentTreeRows(t, t.orphans, true)
            });
        }
        var tmplCompsGroup = {
            id: "template-comps-group:" + t.id,
            surfaceId: t.id,
            label: "Components",
            icon: "fa fa-cubes",
            type: "template-comps-group",
            container: true,
            badge: String((t.components || []).length + (t.orphans ? t.orphans.length : 0)),
            children: tmplCompRows
        };

        var tmplVars = (t.variables || []).map(function (v) {
            return {
                id: "template-var:" + t.id + ":" + v.id,
                label: v.name,
                title: v.name + " (" + (v.type || "string") + ")",
                icon: "fa fa-tag",
                type: "template-variable",
                actions: [
                    { id: "edit-props", icon: "fa fa-pencil", title: "Edit Variable" },
                    { id: "delete-template-var", icon: "fa fa-trash-o", title: "Delete variable" }
                ]
            };
        });

        var varsGroup = {
            id: "template-vars-group:" + t.id,
            label: "Variables",
            icon: "fa fa-tags",
            type: "template-vars-group",
            container: true,
            badge: String(tmplVars.length),
            actions: [
                { id: "add-template-var", icon: "fa fa-plus", title: "Add Variable" }
            ],
            children: tmplVars
        };

        var tmplParams = (t.params || []).map(function (p) {
            return {
                id: "template-param:" + t.id + ":" + p.id,
                label: p.name,
                title: (p.label ? p.label + " (" + p.name + ")" : p.name) + " (" + (p.type || "string") + ")",
                icon: "fa fa-sliders",
                type: "template-param",
                actions: [
                    { id: "edit-props", icon: "fa fa-pencil", title: "Edit Parameter" },
                    { id: "delete-template-param", icon: "fa fa-trash-o", title: "Delete parameter" }
                ]
            };
        });

        var paramsGroup = {
            id: "template-params-group:" + t.id,
            label: "Parameters",
            icon: "fa fa-sliders",
            type: "template-params-group",
            container: true,
            badge: String(tmplParams.length),
            actions: [
                { id: "add-template-param", icon: "fa fa-plus", title: "Add Parameter" }
            ],
            children: tmplParams
        };

        var node = {
            id: t.id,
            label: t.name,
            title: t.name + (t.identifier ? " (@" + t.identifier + ")" : ""),
            icon: t.kind === "component" ? "fa fa-puzzle-piece" : "fa fa-clone",
            type: "template",
            container: true,
            children: t.kind === "component" ? [] : [tmplCompsGroup, varsGroup, paramsGroup],
            actions: [
                { id: "edit-props", icon: "fa fa-sliders", title: t.kind === "component" ? "Component Template Properties" : "Template Properties" },
                { id: "convert", icon: "fa fa-exchange", title: "Convert to Screen" },
                { id: "duplicate", icon: "fa fa-files-o", title: "Duplicate template" },
                { id: "delete", icon: "fa fa-trash-o", title: "Delete template" }
            ]
        };
        placeInTemplate(node, t.parentId, t.kind);
    });

    // Flows
    state.flows.forEach(function (fl) {
        var isDef = !!fl.isDefault;
        var node = {
            id: fl.id,
            label: fl.name + (isDef ? " ★" : ""),
            title: fl.name + (isDef ? " [Default Flow]" : "") + " (" + (fl.endpoint || "/flow") + ")",
            icon: "fa fa-code-fork",
            type: "flow",
            actions: [
                { id: "edit-props", icon: "fa fa-sliders", title: "Flow Properties" },
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
                    { id: "edit-props", icon: "fa fa-pencil", title: "Edit Variable" },
                    { id: "delete-app-var", icon: "fa fa-trash-o", title: "Delete variable" }
                ]
            };
        })
    };

    // Shared Variables Root Section (Server-synced realtime)
    var sharedVars = app.sharedVariables || [];
    var sharedVarsSection = {
        id: "section:shared-variables",
        label: "Shared Variables (Realtime Server)",
        icon: "fa fa-refresh",
        container: true,
        type: "section",
        badge: String(sharedVars.length),
        actions: [
            { id: "add-shared-var", icon: "fa fa-plus", title: "Add Shared Variable" }
        ],
        children: sharedVars.map(function (v) {
            return {
                id: "shared-var:" + v.id,
                label: v.name,
                title: v.name + " (" + (v.type || "string") + " [realtime nexa io protocol])",
                icon: "fa fa-database",
                type: "shared-variable",
                actions: [
                    { id: "edit-props", icon: "fa fa-pencil", title: "Edit Variable" },
                    { id: "delete-shared-var", icon: "fa fa-trash-o", title: "Delete variable" }
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

    return [screensSection, templatesSection, flowsSection, appVarsSection, sharedVarsSection];
}
