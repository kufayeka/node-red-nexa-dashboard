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
    "open-url": { label: "Open URL", hasInput: true, hasOutput: false, color: "#5a8f8f" },
    "layer-control": { label: "Layer Control", hasInput: true, hasOutput: false, color: "#c78a3a" },
    // Subflow-style parameter passing (see plan "Phase 3 revision"):
    // param-input is a SOURCE, like onload/onrender — only meaningful while
    // editing a Template, outputs that instance's current param snapshot.
    // set-template-param is a SINK placed on any canvas that can see a
    // "@template" instance, setting ONE of its declared params by name.
    "param-input": { label: "On Params Change", hasInput: false, hasOutput: true, color: "#4b7d4b" },
    "set-template-param": { hasInput: true, hasOutput: false, color: "#9c6b9e" },
    // Both write to a live Sparkplug tag (nodes/nexa-sparkplug.js's own MQTT
    // connection, via a DCMD/NCMD publish) — hasOutput:true because, like
    // "function", they're asynchronous (an HTTP round-trip) and only
    // continue the wire once the write is actually published; see
    // lib/nexa-runtime-client.js's runLogicGraph.
    "sparkplug-write": { hasInput: true, hasOutput: true, color: "#2f8f6f" },
    "sparkplug-write-multi": { label: "Sparkplug Write Multi", hasInput: true, hasOutput: true, color: "#2f8f6f" }
};

export const state = {
    screens: [],
    activeScreenId: null,
    screensLoaded: false,
    screenCounter: 0,
    projectConfigNode: null,

    // Reusable Screen Templates (see plan "Phase 3"). `editingMode` gates
    // getActiveScreen() (see below) so every existing caller — the whole
    // canvas/Logic-canvas/palette/properties/layers machinery — becomes
    // template-aware for free, with zero call-site changes.
    templates: [],
    templateCounter: 0,
    editingMode: "screen", // "screen" | "template"
    activeTemplateId: null,

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
    screenFormEl: null,
    templatesPane: null,
    templateListEl: null,
    templateFormEl: null,
    templateParamsEl: null
};

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

// Templates and screens share globally-unique ids (genId()), so a history
// event's screenId can be looked up here without any change to the event
// shape itself.
export function findSurfaceById(id) {
    return state.screens.find(function (s) { return s.id === id; }) || findTemplate(id);
}

function makeSurfaceBase(opts) {
    return {
        id: genId(),
        width: (opts && opts.width) || 1280,
        height: (opts && opts.height) || 800,
        gridSize: (opts && opts.gridSize) || 20,
        snap: opts ? opts.snap !== false : true,
        components: (opts && opts.components) || [],
        groups: (opts && opts.groups) || [],
        layers: (opts && opts.layers) || [{ id: "default", name: "Default Layer", parentId: null, state: "show" }],
        logic: (opts && opts.logic) || { nodes: [], wires: [] }
    };
}

export function makeScreen(opts) {
    state.screenCounter++;
    var screen = makeSurfaceBase(opts);
    screen.name = (opts && opts.name) || ("Screen " + state.screenCounter);
    screen.path = (opts && opts.path) || ("/screen" + state.screenCounter);
    return screen;
}

// A Template is data-shape-identical to a Screen (no `path` — it's never
// routed to directly — plus a `params` list: the properties an instance of
// this template exposes outward, see templates-panel.js).
export function makeTemplate(opts) {
    state.templateCounter++;
    var template = makeSurfaceBase(opts);
    template.name = (opts && opts.name) || ("Template " + state.templateCounter);
    // Plain, user-editable reference/display field — mirrors the ROLE
    // screen.path plays on a Screen, but purely for the user's own
    // reference (not a routing key, and not the internal join key: every
    // "@template" instance still references the template by `template.id`,
    // exactly like a component still references its layer by `layer.id`
    // even though the layer's own `name` is freely renamable).
    template.identifier = (opts && opts.identifier) || "";
    // Flat param declarations: {id, name, label, type, defaultValue} — see
    // "Phase 3 revision" in the plan. `name` doubles as the {name}
    // interpolation key and the msg key on the param-input node's output.
    template.params = (opts && opts.params) || [];
    return template;
}

// DFS over `template.components` (recursing into any nested `@template`
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
    return (candidate.components || []).some(function (c) {
        return c.type === "@template" && templateContains(c.templateId, targetId, seen);
    });
}

export function markDirty() {
    if (state.projectConfigNode) {
        state.projectConfigNode.screens = state.screens;
        state.projectConfigNode.templates = state.templates;
    }
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

function backfillSurface(s) {
    if (!s.groups) s.groups = [];
    if (!s.layers || !s.layers.length) s.layers = [{ id: "default", name: "Default Layer", parentId: null, state: "show" }];
    // Pre-3-state saves only ever had a boolean `visible` — migrate it to
    // the new `state` field (true -> "show", false -> "hide") instead of
    // leaving both fields around for isLayerRenderState() to have to
    // understand two competing shapes forever.
    s.layers.forEach(function (l) {
        if (!l.state) {
            l.state = l.visible === false ? "hide" : "show";
            delete l.visible;
        }
    });
    s.components.forEach(function (c) { if (!c.layerId) c.layerId = s.layers[0].id; });
    if (!s.logic) s.logic = { nodes: [], wires: [] };
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
    });
    state.templateCounter = templateData.length;
    state.templates = templateData;
    if (state.projectConfigNode) state.projectConfigNode.templates = state.templates;

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
    if (!parentId) {
        return (screen.layers || []).filter(function (l) {
            return !l.parentId || !findLayer(l.parentId);
        });
    }
    return (screen.layers || []).filter(function (l) { return l.parentId === parentId; });
}

// A layer's OWN state is "show"/"hide"/"remove", but its EFFECTIVE state (the
// one that actually governs a component in it) is the most restrictive one
// anywhere up its parentId chain — a "show" sub-layer inside a "remove"
// parent is still removed, exactly like isLayerVisible's old ancestor-walk
// already did for plain visible/hidden.
var LAYER_STATE_RANK = { show: 0, hide: 1, remove: 2 };
export function getLayerRenderState(layerId) {
    var layer = findLayer(layerId);
    var effective = "show";
    while (layer) {
        var layerState = layer.state || "show";
        if (LAYER_STATE_RANK[layerState] > LAYER_STATE_RANK[effective]) effective = layerState;
        layer = layer.parentId ? findLayer(layer.parentId) : null;
    }
    return effective;
}

// CSS-visible: true only for "show" — "hide" is still mounted (see
// shouldRenderLayer) but must not paint or be interactable.
export function isLayerVisible(layerId) {
    return getLayerRenderState(layerId) === "show";
}

// Whether a component in this layer should have a DOM node at all —
// false only for "remove". "hide" still renders (isLayerVisible above
// handles hiding it), so toggling back to "show" is instant, no rebuild
// needed; "remove" doesn't exist in the DOM, so coming back out of it
// requires a fresh render (see renderComponent in component-renderer.js).
export function shouldRenderLayer(layerId) {
    return getLayerRenderState(layerId) !== "remove";
}

// "hide" and "remove" both lock their components out of selection/marquee/
// grouping — only a "show" component is interactable. Kept as its own name
// (rather than reusing isLayerVisible) since "interactable" and "visible"
// are different questions even though they coincide today (both are
// simply "=== show"): a future state that's visible-but-locked, or
// interactable-but-dimmed, wouldn't collapse into one boolean.
export function isLayerInteractable(layerId) {
    return getLayerRenderState(layerId) === "show";
}

export function getComponentsInLayer(layerId) {
    var screen = getActiveScreen();
    if (!screen) return [];
    var firstLayerId = screen.layers && screen.layers[0] && screen.layers[0].id;
    return screen.components.filter(function (c) {
        if (c.layerId === layerId) return true;
        if (!c.layerId && layerId === firstLayerId) return true;
        if (c.layerId && !findLayer(c.layerId) && layerId === firstLayerId) return true;
        return false;
    });
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

