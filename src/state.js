// --- Global State & Data Model for Nexa Dashboard Editor -----------------

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.2;

export const SVG_NS = "http://www.w3.org/2000/svg";
export const LOGIC_CANVAS_W = 2000;
export const LOGIC_CANVAS_H = 1400;
export const LOGIC_NODE_W = 150;
export const LOGIC_NODE_H = 34;
export const LOGIC_GRID_SIZE = 20;

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
    "open-url": { label: "Open URL", hasInput: true, hasOutput: false, color: "#5a8f8f" }
};

export const state = {
    screens: [],
    activeScreenId: null,
    screensLoaded: false,
    screenCounter: 0,
    projectConfigNode: null,

    selectedIds: [],
    logicSelectedIds: [],
    activeCanvasTab: "ui",

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
    layersPane: null,
    eventsPane: null,
    screenListEl: null,
    screenFormEl: null
};

export function genId() {
    return "n" + Math.random().toString(16).slice(2, 10);
}

export function snap(v, gridSize) {
    return Math.round(v / gridSize) * gridSize;
}

export function getActiveScreen() {
    return state.screens.find(function (s) { return s.id === state.activeScreenId; });
}

export function makeScreen(opts) {
    state.screenCounter++;
    return {
        id: genId(),
        name: (opts && opts.name) || ("Screen " + state.screenCounter),
        path: (opts && opts.path) || ("/screen" + state.screenCounter),
        width: (opts && opts.width) || 1280,
        height: (opts && opts.height) || 800,
        gridSize: (opts && opts.gridSize) || 20,
        snap: opts ? opts.snap !== false : true,
        components: (opts && opts.components) || [],
        groups: (opts && opts.groups) || [],
        layers: (opts && opts.layers) || [{ id: "default", name: "Default Layer", parentId: null, visible: true }],
        logic: (opts && opts.logic) || { nodes: [], wires: [] }
    };
}

export function markDirty() {
    if (state.projectConfigNode) state.projectConfigNode.screens = state.screens;
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

export function ensureScreensLoaded(cb) {
    if (state.screensLoaded) {
        if (cb) cb();
        return;
    }
    state.projectConfigNode = getOrCreateProjectConfigNode();
    var data = (state.projectConfigNode && state.projectConfigNode.screens) || [];
    data.forEach(function (s) {
        if (!s.groups) s.groups = [];
        if (!s.layers || !s.layers.length) s.layers = [{ id: "default", name: "Default Layer", parentId: null, visible: true }];
        s.components.forEach(function (c) { if (!c.layerId) c.layerId = s.layers[0].id; });
        if (!s.logic) s.logic = { nodes: [], wires: [] };
    });
    state.screenCounter = data.length;
    state.screens = data.length ? data : [makeScreen({ name: "Screen 1", path: "/screen1" })];
    if (state.projectConfigNode) state.projectConfigNode.screens = state.screens;
    state.activeScreenId = state.screens[0].id;
    state.screensLoaded = true;
    if (cb) cb();
}

export function findComponent(id) {
    var screen = getActiveScreen();
    return screen && screen.components.find(function (c) { return c.id === id; });
}

export function findGroup(id) {
    var screen = getActiveScreen();
    return screen && (screen.groups || []).find(function (g) { return g.id === id; });
}

export function groupMemberIds(groupId) {
    var screen = getActiveScreen();
    if (!screen) return [];
    return screen.components.filter(function (c) { return c.g === groupId; }).map(function (c) { return c.id; });
}

export function findLayer(id) {
    var screen = getActiveScreen();
    return screen && (screen.layers || []).find(function (l) { return l.id === id; });
}

export function getLayerChildren(parentId) {
    var screen = getActiveScreen();
    if (!screen) return [];
    return (screen.layers || []).filter(function (l) { return l.parentId === parentId; });
}

export function isLayerVisible(layerId) {
    var layer = findLayer(layerId);
    while (layer) {
        if (!layer.visible) return false;
        layer = layer.parentId ? findLayer(layer.parentId) : null;
    }
    return true;
}

export function getComponentsInLayer(layerId) {
    var screen = getActiveScreen();
    if (!screen) return [];
    return screen.components.filter(function (c) { return c.layerId === layerId; });
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

