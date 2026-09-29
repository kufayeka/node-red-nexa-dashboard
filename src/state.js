// --- Global State & Data Model for Nexa Dashboard Editor -----------------
import * as Tree from "./model/tree.js";
import * as Layout from "./model/layout.js";
import * as Scope from "./model/scope.js";
import * as Types from "./model/types.js";
import * as Theme from "./model/theme.js";
import { migrateSurface, TREE_VERSION } from "./model/migrate.js";

export { Tree, Layout, Scope, Types, Theme };

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.2;

export const SVG_NS = "http://www.w3.org/2000/svg";
export const LOGIC_CANVAS_W = 2000;
export const LOGIC_CANVAS_H = 1400;
export const LOGIC_NODE_W = 150;
export const LOGIC_NODE_H = 34;
export const LOGIC_GRID_SIZE = 20;
/** A Logic node position on the canvas grid (hold Alt while dragging to place it freely). */
export function snapLogic(v) { return Math.round(v / LOGIC_GRID_SIZE) * LOGIC_GRID_SIZE; }

export const LOGIC_NODE_KINDS = {
    onload: { label: "On Load", hasInput: false, hasOutput: true, color: "#4b7d4b" },
    onrender: { label: "On Render", hasInput: false, hasOutput: true, color: "#4b7d4b" },
    onclose: { label: "On Close", hasInput: false, hasOutput: true, color: "#4b7d4b" },
    "ui-event": { hasInput: false, hasOutput: true, color: "#3a6fb0" },
    "ui-update": { hasInput: true, hasOutput: false, color: "#b0663a" },
    "function": { label: "Function", hasInput: true, hasOutput: true, color: "#7a5aa8" },
    "debug": { label: "Debug", hasInput: true, hasOutput: false, color: "#777" },
    "inject": { label: "Inject", hasInput: false, hasOutput: true, color: "#a5c261" },
    "reload": { label: "Reload Page", hasInput: true, hasOutput: false, color: "#8a8a8a" },
    "open-url": { label: "Open URL", hasInput: true, hasOutput: false, color: "#5a8f8f" },
    "layer-control": { label: "Layer Control", hasInput: true, hasOutput: false, color: "#c78a3a" },
    // Subflow-style parameter passing (see plan "Phase 3 revision"):
    // param-input is a SOURCE, like onload/onrender — only meaningful while
    // editing a Template, outputs that instance's current param snapshot.
    // set-template-param is a SINK placed on any canvas that can see a
    // "@template" instance, setting ONE of its declared params by name.
    "param-input": { label: "On Params Change", hasInput: false, hasOutput: true, color: "#4b7d4b" },
    // a template's output: inside the template, sends a message OUT to where it is used —
    // a copy a Populate made: out of that Layout node; a placed instance: its
    // "On Template Output" node on the surface around it (open a dialog, a popup…)
    "template-output": { label: "Send to Host", hasInput: true, hasOutput: false, color: "#9c6b9e" },
    "template-event": { label: "On Template Output", hasInput: false, hasOutput: true, color: "#4b7d4b" },
    "set-template-param": { hasInput: true, hasOutput: false, color: "#9c6b9e" },
    // sets a variable (screen / group / frame, see src/model/scope.js); passes msg on
    "set-variable": { label: "Set Variable", hasInput: true, hasOutput: true, color: "#9c6b9e" },
    "get-variable": { label: "Get Variable", hasInput: true, hasOutput: true, color: "#9c6b9e" },
    // a source: fires when the variable it watches changes (payload = new, previous = old)
    "on-variable-change": { label: "On Variable Change", hasInput: false, hasOutput: true, color: "#4b7d4b" },
    // web / data: an API call (async, continues when the response is in), browser storage, cookies
    "http-request": { label: "HTTP Request", hasInput: true, hasOutput: true, color: "#3a8fb0" },
    // the repeater: a container filled with a template, one card per item
    "populate": { label: "Populate", hasInput: true, hasOutput: true, color: "#5b8a3a" },
    // a container (frame) as a Logic node: Populate -> [Layout: Column] fills that column
    "layout": { label: "Layout", hasInput: true, hasOutput: true, color: "#5b8a3a" },
    // a dialog / drawer: Open (its output fires when it closes, with the result) / Close
    "overlay-open": { label: "Open", hasInput: true, hasOutput: true, color: "#8a5a3a" },
    "overlay-close": { label: "Close", hasInput: true, hasOutput: false, color: "#8a5a3a" },
    // a node drawn in a teleport target / on the page, or back home
    "teleport": { label: "Teleport", hasInput: true, hasOutput: true, color: "#8e44ad" },
    "storage": { label: "Storage", hasInput: true, hasOutput: true, color: "#3a8fb0" },
    "cookie": { label: "Cookie", hasInput: true, hasOutput: true, color: "#3a8fb0" },
    // Both write to a live Sparkplug tag (nodes/nexa-sparkplug.js's own MQTT
    // connection, via a DCMD/NCMD publish) — hasOutput:true because, like
    // "function", they're asynchronous (an HTTP round-trip) and only
    // continue the wire once the write is actually published; see
    // lib/nexa-runtime-client.js's runLogicGraph.
    "sparkplug-write": { hasInput: true, hasOutput: true, color: "#2f8f6f" },
    "sparkplug-write-multi": { label: "Sparkplug Write Multi", hasInput: true, hasOutput: true, color: "#2f8f6f" },
    // timing / delay node: pauses execution for delay ms/s before continuing
    "delay": { label: "Delay", hasInput: true, hasOutput: true, color: "#c8b261" },
    // SPA navigation: transition to a named screen, path, or history action without page reload
    "navigate": { label: "Goto Screen", hasInput: true, hasOutput: true, color: "#458296" }
};

export const state = {
    screens: [],
    activeScreenId: null,
    screensLoaded: false,
    screenCounter: 0,
    projectConfigNode: null,

    // Folders/Groups for organizing screens, templates, and flows
    folders: [],
    folderCounter: 0,

    // Reusable Screen Templates (see plan "Phase 3"). `editingMode` gates
    // getActiveScreen() (see below) so every existing caller — the whole
    // canvas/Logic-canvas/palette/properties/layers machinery — becomes
    // template-aware for free, with zero call-site changes.
    templates: [],
    templateCounter: 0,
    activeTemplateId: null,

    // Screen Flows: multi-app flows with endpoint routing & logic wiring
    flows: [],
    flowCounter: 0,
    activeFlowId: null,

    assetsPane: null,
    breakpointsPane: null,
    // dialogs / drawers shown on the canvas (editor only, not saved): id -> true
    overlayPreview: {},
    slotPreview: {},     // host id -> the slot shown on the canvas (a Tabs' tab while designing)
    // the colour mode the canvas previews ("light" / "dark"; null = the theme's default)
    themePreview: null,
    themePane: null,
    editingMode: "screen", // "screen" | "template" | "flow"

    selectedIds: [],
    logicSelectedIds: [],
    activeCanvasTab: "ui",
    canvasTabs: null,
    canvasTabsUl: null,

    zoomLevel: 1,
    logicZoomLevel: 1,

    undoStack: [],
    redoStack: [],
    clipboard: null,
    logicClipboard: null,

    // UI Canvas DOM references
    trayContent: null,
    artboardEl: null,
    stageEl: null,
    sizerEl: null,
    viewportEl: null,
    zoomLabelEl: null,
    selectionHandlesEl: null,

    // Logic Canvas DOM references
    logicViewportEl: null,
    logicArtboardEl: null,
    logicSvgEl: null,
    logicStageEl: null,
    logicSizerEl: null,
    logicZoomLabelEl: null,

    // Sidebar panes
    componentsPane: null,
    propertiesPane: null,
    hierarchyPane: null,
    eventsPane: null,
    screenListEl: null,
    screenFormEl: null,
    templatesPane: null,
    templateListEl: null,
    templateFormEl: null,
    templateParamsEl: null
};

// The editor's live state, reachable from the browser console and the tests.
if (typeof window !== "undefined") window.__nexaEditorState = state;

export function genId() {
    return "n" + Math.random().toString(16).slice(2, 10);
}

export function snap(v, gridSize) {
    return Math.round(v / gridSize) * gridSize;
}

// Returns whichever surface is currently being edited — a Screen normally,
// or a Template while state.editingMode === "template" (see the Templates
// sidebar tab). Every existing caller (findComponent, findLogicNode,
// groupMemberIds, the whole canvas/palette/properties/layers machinery)
// just wants "the current editable thing" and needs no changes for this.
export function getActiveScreen() {
    if (state.editingMode === "template") {
        return findTemplate(state.activeTemplateId);
    }
    if (state.editingMode === "flow") {
        return findFlow(state.activeFlowId);
    }
    return state.screens.find(function (s) { return s.id === state.activeScreenId; });
}

export function findTemplate(id) {
    return state.templates.find(function (t) { return t.id === id; });
}

// Author-convenience lookup for a Lit Component's own code calling
// this.mountTemplate(...) (see component-renderer.js) — template ids are
// opaque generated strings a Lit-code author has no easy way to see, so
// this also accepts the Template's own `name` or `identifier` field.
export function findTemplateByIdOrName(idOrName) {
    return findTemplate(idOrName) ||
        state.templates.find(function (t) { return t.name === idOrName || t.identifier === idOrName; });
}

// Templates, screens, and flows share globally-unique ids (genId()), so a history
// event's screenId can be looked up here without any change to the event
// shape itself.
export function findSurfaceById(id) {
    return state.screens.find(function (s) { return s.id === id; }) ||
        findTemplate(id) ||
        findFlow(id);
}

export function makeFolder(opts) {
    state.folderCounter++;
    return {
        id: genId(),
        name: (opts && opts.name) || ("Group " + state.folderCounter),
        parentId: (opts && opts.parentId) || null,
        category: (opts && opts.category) || "screen",
        type: "folder"
    };
}

export function findFolder(id) {
    return state.folders.find(function (f) { return f.id === id; });
}

export function deleteFolder(id) {
    var folder = findFolder(id);
    if (!folder) return;
    var parentId = folder.parentId || null;
    state.folders.forEach(function (f) { if (f.parentId === id) f.parentId = parentId; });
    state.screens.forEach(function (s) { if (s.parentId === id) s.parentId = parentId; });
    state.templates.forEach(function (t) { if (t.parentId === id) t.parentId = parentId; });
    state.flows.forEach(function (fl) { if (fl.parentId === id) fl.parentId = parentId; });
    state.folders = state.folders.filter(function (f) { return f.id !== id; });
}

export function makeFlow(opts) {
    state.flowCounter++;
    return {
        id: genId(),
        name: (opts && opts.name) || ("Flow " + state.flowCounter),
        endpoint: (opts && opts.endpoint) || ("/flow" + state.flowCounter),
        parentId: (opts && opts.parentId) || null,
        type: "flow",
        components: [],
        orphans: [],
        variables: (opts && opts.variables) || [],
        logic: (opts && opts.logic) ? cloneLogic(opts.logic) : { nodes: [], wires: [] }
    };
}

export function findFlow(id) {
    return state.flows.find(function (fl) { return fl.id === id; });
}

export function deleteFlow(id) {
    var wasActive = id === state.activeFlowId;
    state.flows = state.flows.filter(function (fl) { return fl.id !== id; });
    if (wasActive) {
        state.activeFlowId = state.flows.length ? state.flows[0].id : null;
        if (!state.activeFlowId && state.editingMode === "flow") {
            state.editingMode = "screen";
        }
    }
}

export function cloneSurfaceComponents(components, compIdMap) {
    compIdMap = compIdMap || {};
    function renew(n) {
        var copy = JSON.parse(JSON.stringify(n));
        var oldId = n.id;
        var newId = genId();
        compIdMap[oldId] = newId;
        copy.id = newId;
        if (copy.children && Array.isArray(copy.children)) {
            copy.children = copy.children.map(renew);
        }
        return copy;
    }
    return (components || []).map(renew);
}

export function cloneLogic(logic, compIdMap) {
    if (!logic || !Array.isArray(logic.nodes)) return { nodes: [], wires: [] };
    var idMap = {};
    var clonedNodes = (logic.nodes || []).map(function (n) {
        var copy = JSON.parse(JSON.stringify(n));
        var newId = genId();
        idMap[n.id] = newId;
        copy.id = newId;
        if (compIdMap) {
            if (copy.compId && compIdMap[copy.compId]) copy.compId = compIdMap[copy.compId];
            if (copy.componentId && compIdMap[copy.componentId]) copy.componentId = compIdMap[copy.componentId];
            if (copy.targetId && compIdMap[copy.targetId]) copy.targetId = compIdMap[copy.targetId];
            if (copy.container && compIdMap[copy.container]) copy.container = compIdMap[copy.container];
            if (copy.overlay && compIdMap[copy.overlay]) copy.overlay = compIdMap[copy.overlay];
            if (copy.node && compIdMap[copy.node]) copy.node = compIdMap[copy.node];
            if (typeof copy.tag === "string" && copy.tag.indexOf("comp:") === 0) {
                var parts = copy.tag.split(":");
                if (parts[1] && compIdMap[parts[1]]) {
                    parts[1] = compIdMap[parts[1]];
                    copy.tag = parts.join(":");
                }
            }
        }
        return copy;
    });
    var clonedWires = [];
    (logic.wires || []).forEach(function (w) {
        var newFrom = idMap[w.from];
        var newTo = idMap[w.to];
        if (newFrom && newTo) {
            var copyW = JSON.parse(JSON.stringify(w));
            copyW.from = newFrom;
            copyW.to = newTo;
            clonedWires.push(copyW);
        }
    });
    return { nodes: clonedNodes, wires: clonedWires };
}

export function duplicateScreen(id) {
    var orig = state.screens.find(function (s) { return s.id === id; });
    if (!orig) return null;
    state.screenCounter++;
    var compIdMap = {};
    var newScreen = {
        id: genId(),
        name: orig.name + " (Copy)",
        path: orig.path + "-copy",
        parentId: orig.parentId || null,
        width: orig.width,
        height: orig.height,
        gridSize: orig.gridSize,
        snap: orig.snap !== false,
        treeVersion: orig.treeVersion || TREE_VERSION,
        disabled: !!orig.disabled,
        displayMode: orig.displayMode,
        variables: JSON.parse(JSON.stringify(orig.variables || [])),
        components: cloneSurfaceComponents(orig.components, compIdMap),
        orphans: cloneSurfaceComponents(orig.orphans, compIdMap),
        logic: cloneLogic(orig.logic, compIdMap)
    };
    var idx = state.screens.indexOf(orig);
    state.screens.splice(idx + 1, 0, newScreen);
    return newScreen;
}

export function duplicateTemplate(id) {
    var orig = findTemplate(id);
    if (!orig) return null;
    state.templateCounter++;
    var compIdMap = {};
    var newTemplate = {
        id: genId(),
        name: orig.name + " (Copy)",
        identifier: orig.identifier ? (orig.identifier + "-copy") : "",
        parentId: orig.parentId || null,
        width: orig.width,
        height: orig.height,
        gridSize: orig.gridSize,
        snap: orig.snap !== false,
        treeVersion: orig.treeVersion || TREE_VERSION,
        params: JSON.parse(JSON.stringify(orig.params || [])),
        variables: JSON.parse(JSON.stringify(orig.variables || [])),
        components: cloneSurfaceComponents(orig.components, compIdMap),
        orphans: cloneSurfaceComponents(orig.orphans, compIdMap),
        logic: cloneLogic(orig.logic, compIdMap)
    };
    var idx = state.templates.indexOf(orig);
    state.templates.splice(idx + 1, 0, newTemplate);
    return newTemplate;
}

export function duplicateFlow(id) {
    var orig = findFlow(id);
    if (!orig) return null;
    state.flowCounter++;
    var newFlow = {
        id: genId(),
        name: orig.name + " (Copy)",
        endpoint: orig.endpoint + "-copy",
        parentId: orig.parentId || null,
        type: "flow",
        components: [],
        orphans: [],
        variables: JSON.parse(JSON.stringify(orig.variables || [])),
        logic: cloneLogic(orig.logic)
    };
    var idx = state.flows.indexOf(orig);
    state.flows.splice(idx + 1, 0, newFlow);
    return newFlow;
}

export function convertScreenToTemplate(id) {
    var screen = state.screens.find(function (s) { return s.id === id; });
    if (!screen) return null;
    if (state.screens.length <= 1) {
        var replacement = makeScreen({ name: "Screen " + (state.screenCounter + 1) });
        state.screens.push(replacement);
        if (state.activeScreenId === id) state.activeScreenId = replacement.id;
    }
    state.screens = state.screens.filter(function (s) { return s.id !== id; });
    state.templateCounter++;
    var template = {
        id: screen.id,
        name: screen.name,
        identifier: (screen.name || "template").toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
        parentId: screen.parentId || null,
        width: screen.width,
        height: screen.height,
        gridSize: screen.gridSize,
        snap: screen.snap !== false,
        treeVersion: screen.treeVersion || TREE_VERSION,
        params: [],
        variables: screen.variables || [],
        components: screen.components || [],
        orphans: screen.orphans || [],
        logic: screen.logic || { nodes: [], wires: [] }
    };
    state.templates.push(template);
    return template;
}

export function convertTemplateToScreen(id) {
    var template = findTemplate(id);
    if (!template) return null;
    state.templates = state.templates.filter(function (t) { return t.id !== id; });
    state.screenCounter++;
    var slug = (template.identifier || template.name || "screen").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    var screen = {
        id: template.id,
        name: template.name,
        path: "/" + slug,
        parentId: template.parentId || null,
        width: template.width,
        height: template.height,
        gridSize: template.gridSize,
        snap: template.snap !== false,
        treeVersion: template.treeVersion || TREE_VERSION,
        disabled: false,
        displayMode: "fixed",
        variables: template.variables || [],
        components: template.components || [],
        orphans: template.orphans || [],
        logic: template.logic || { nodes: [], wires: [] }
    };
    state.screens.push(screen);
    return screen;
}

// A surface's `components` is the root of its node tree (see model/tree.js);
// `orphans` holds nodes taken out of the tree without being deleted.
function makeSurfaceBase(opts) {
    return {
        id: genId(),
        width: (opts && opts.width) || 1280,
        height: (opts && opts.height) || 800,
        gridSize: (opts && opts.gridSize) || 20,
        snap: opts ? opts.snap !== false : true,
        components: (opts && opts.components) || [],
        orphans: (opts && opts.orphans) || [],
        treeVersion: TREE_VERSION,
        logic: (opts && opts.logic) || { nodes: [], wires: [] }
    };
}

export function makeScreen(opts) {
    state.screenCounter++;
    var screen = makeSurfaceBase(opts);
    screen.name = (opts && opts.name) || ("Screen " + state.screenCounter);
    screen.path = (opts && opts.path) || ("/screen" + state.screenCounter);
    screen.parentId = (opts && opts.parentId) || null;
    return screen;
}

// A Template is data-shape-identical to a Screen (no `path` — it's never
// routed to directly — plus a `params` list: the properties an instance of
// this template exposes outward, see templates-panel.js).
export function makeTemplate(opts) {
    state.templateCounter++;
    var template = makeSurfaceBase(opts);
    template.name = (opts && opts.name) || ("Template " + state.templateCounter);
    template.identifier = (opts && opts.identifier) || "";
    template.params = (opts && opts.params) || [];
    template.parentId = (opts && opts.parentId) || null;
    return template;
}

// DFS over a template's node tree (recursing into any nested `@template`
// instance's own template) — true if `candidateId` already, directly or
// transitively, contains an instance of `targetId`. Used both to block a
// cyclical drop in the palette (dropping `targetId` while editing
// `candidateId` would close a loop) and, defensively, as the mount-time
// visitedTemplateIds guard's underlying logic.
export function templateContains(candidateId, targetId, seen) {
    if (candidateId === targetId) return true;
    seen = seen || {};
    if (seen[candidateId]) return false;
    seen[candidateId] = true;
    var candidate = findTemplate(candidateId);
    if (!candidate) return false;
    return Tree.allNodes(candidate, { orphans: true }).some(function (c) {
        return c.type === "@template" && templateContains(c.templateId, targetId, seen);
    });
}

// The app: variables shared by every screen, kept on the project config node
// (docs/STATE.md). Its scope sits above every screen's and template's.
export function getApp() {
    var p = state.projectConfigNode;
    if (p && !Array.isArray(p.variables)) p.variables = [];
    if (p && !Array.isArray(p.types)) p.types = [];
    var app = p || { variables: [], types: [] };
    Types.setTypes(app.types);   // the types (UDT) instances are built from
    return app;
}
export function appScope() {
    return Scope.makeScope(null, getApp().variables);
}

export function markDirty() {
    if (state.projectConfigNode) {
        state.projectConfigNode.screens = state.screens;
        state.projectConfigNode.templates = state.templates;
        state.projectConfigNode.folders = state.folders;
        state.projectConfigNode.flows = state.flows;
    }
    // editing a breakpoint: the change becomes its override; the project keeps the design
    if (typeof state.onBreakpointDirty === "function") state.onBreakpointDirty();
    if (typeof RED !== "undefined" && RED.nodes && RED.nodes.dirty) {
        RED.nodes.dirty(true);
    }
}

export function getOrCreateProjectConfigNode() {
    var existing = null;
    RED.nodes.eachConfig(function (n) {
        if (n.type === "kufayeka-nexa-project") existing = n;
    });
    if (existing) return existing;

    var node_def = RED.nodes.getType("kufayeka-nexa-project");
    if (!node_def) {
        RED.notify("Nexa Dashboard: kufayeka-nexa-project node type not found — is the package installed correctly?", { type: "error" });
        return null;
    }
    var node = {
        id: RED.nodes.id(),
        _def: node_def,
        type: "kufayeka-nexa-project",
        z: "",
        users: [],
        name: "Nexa Project",
        screens: []
    };
    for (var d in node_def.defaults) {
        if (node[d] === undefined && node_def.defaults[d].value !== undefined) {
            node[d] = JSON.parse(JSON.stringify(node_def.defaults[d].value));
        }
    }
    RED.nodes.add(node);
    RED.nodes.dirty(true);
    return node;
}

// Pre-tree saves (flat components + layers + groups) become the node tree.
function backfillSurface(s) {
    migrateSurface(s, genId);
}

export function ensureScreensLoaded(cb) {
    if (state.screensLoaded) {
        if (cb) cb();
        return;
    }
    state.projectConfigNode = getOrCreateProjectConfigNode();
    var data = (state.projectConfigNode && state.projectConfigNode.screens) || [];
    data.forEach(backfillSurface);
    state.screenCounter = data.length;
    state.screens = data.length ? data : [makeScreen({ name: "Screen 1", path: "/screen1" })];
    if (state.projectConfigNode) state.projectConfigNode.screens = state.screens;
    state.activeScreenId = state.screens[0].id;

    var templateData = (state.projectConfigNode && state.projectConfigNode.templates) || [];
    templateData.forEach(function (t) {
        backfillSurface(t);
        if (!t.params) t.params = [];
        if (t.identifier === undefined) t.identifier = "";
        if (t.parentId === undefined) t.parentId = null;
    });
    state.templateCounter = templateData.length;
    state.templates = templateData;
    if (state.projectConfigNode) state.projectConfigNode.templates = state.templates;

    var folderData = (state.projectConfigNode && state.projectConfigNode.folders) || [];
    folderData.forEach(function (f) {
        if (f.parentId === undefined) f.parentId = null;
        f.type = "folder";
    });
    state.folderCounter = folderData.length;
    state.folders = folderData;
    if (state.projectConfigNode) state.projectConfigNode.folders = state.folders;

    var flowData = (state.projectConfigNode && state.projectConfigNode.flows) || [];
    flowData.forEach(function (f) {
        if (!f.logic) f.logic = { nodes: [], wires: [] };
        if (!f.components) f.components = [];
        if (!f.variables) f.variables = [];
        if (f.parentId === undefined) f.parentId = null;
        f.type = "flow";
    });
    state.flowCounter = flowData.length;
    state.flows = flowData;
    if (state.projectConfigNode) state.projectConfigNode.flows = state.flows;
    if (state.flows.length && !state.activeFlowId) state.activeFlowId = state.flows[0].id;

    state.screensLoaded = true;
    if (cb) cb();
}

/** A node of the active surface by id (anywhere in the tree, or an orphan). */
export function findComponent(id) {
    return Tree.find(getActiveScreen(), id);
}

// A node's EFFECTIVE visibility is the most restrictive on its path to the
// root: "show"; "hide" (still rendered, so showing it again is instant, but
// invisible and not selectable); "remove" (not rendered at all).
export function nodeVisibility(id) {
    var surface = getActiveScreen();
    return surface ? Tree.effectiveVisibility(surface, id) : "show";
}

export function isNodeVisible(id) {
    return nodeVisibility(id) === "show";
}

export function shouldRenderNode(id) {
    return nodeVisibility(id) !== "remove";
}

// Only a "show" node takes clicks / marquee / drags. (Kept apart from
// isNodeVisible: "interactable" and "visible" are different questions even
// though they coincide today.)
export function isNodeInteractable(id) {
    return nodeVisibility(id) === "show";
}

/** Locked itself or inside a locked container. */
export function isNodeLocked(id) {
    var surface = getActiveScreen();
    return !!(surface && Tree.effectiveLocked(surface, id));
}

export function findLogicNode(screenOrId, maybeId) {
    var screen, id;
    if (maybeId !== undefined) {
        screen = screenOrId;
        id = maybeId;
    } else {
        screen = getActiveScreen();
        id = screenOrId;
    }
    return screen && screen.logic && (screen.logic.nodes || []).find(function (n) { return n.id === id; });
}

if (typeof window !== "undefined") {
    window.__nexaEditorApi = window.__nexaEditorApi || {};
    Object.assign(window.__nexaEditorApi, {
        makeFolder: makeFolder,
        findFolder: findFolder,
        deleteFolder: deleteFolder,
        makeFlow: makeFlow,
        findFlow: findFlow,
        deleteFlow: deleteFlow,
        cloneLogic: cloneLogic,
        duplicateScreen: duplicateScreen,
        duplicateTemplate: duplicateTemplate,
        duplicateFlow: duplicateFlow,
        convertScreenToTemplate: convertScreenToTemplate,
        convertTemplateToScreen: convertTemplateToScreen,
        getActiveScreen: getActiveScreen,
        markDirty: markDirty
    });
}

