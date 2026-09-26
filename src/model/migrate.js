// --- Bring a surface saved before the node tree up to date ------------------
// Pre-tree surfaces kept every component in one flat `components` array with
// `layerId` (layers: [{ id, name, parentId, state }]) and `g` (groups: [{ id }]).
// migrateSurface() turns that into the tree (see tree.js), idempotently:
//   - the FIRST layer (normally "Default Layer") melts into the root: its
//     components stay top-level (the common case changes nothing at all)
//   - every other layer becomes an @group of the same name (nested layers ->
//     nested groups), `state` -> `visibility`, so the Logic "Layer Control"
//     node (by name) keeps working
//   - every old group becomes an @group ("Group 1", …) inside its layer
//   - a group's box hugs its members; their x / y become relative to it, so
//     nothing moves on screen
import { fitGroup } from "./tree.js";

export var TREE_VERSION = 1;

function genIdFallback() {
    return "n" + Math.random().toString(16).slice(2, 10);
}

export function migrateSurface(surface, genId) {
    if (!surface) return surface;
    genId = genId || genIdFallback;
    if (!surface.components) surface.components = [];
    if (!surface.orphans) surface.orphans = [];
    if (!surface.logic) surface.logic = { nodes: [], wires: [] };
    if (surface.treeVersion >= TREE_VERSION) return surface;

    var layers = (surface.layers || []).map(function (l) {
        // pre-3-state saves only had `visible`
        return { id: l.id, name: l.name || "Layer", parentId: l.parentId || null, state: l.state || (l.visible === false ? "hide" : "show") };
    });
    var rootLayer = layers[0] || null;
    var layerById = {};
    layers.forEach(function (l) { layerById[l.id] = l; });
    var effLayer = function (c) {
        return c.layerId && layerById[c.layerId] ? c.layerId : (rootLayer ? rootLayer.id : null);
    };

    // 1. old groups -> @group nodes, in the layer of their first member
    var groupNode = {};
    var groupCount = 0;
    var flat = [];
    surface.components.forEach(function (c) {
        if (c.g) {
            var g = groupNode[c.g];
            if (!g) {
                groupCount++;
                g = groupNode[c.g] = { id: c.g, type: "@group", name: "Group " + groupCount, x: 0, y: 0, w: 0, h: 0, children: [], layerId: effLayer(c) };
                flat.push(g);
            }
            g.children.push(c);
            delete c.layerId; // a member follows its group's layer
        } else {
            flat.push(c);
        }
        delete c.g;
    });
    Object.keys(groupNode).forEach(function (id) { fitGroup(groupNode[id]); });

    // 2. layers -> @group nodes (the first layer is the root)
    var layerNode = {};
    layers.forEach(function (l) {
        if (rootLayer && l.id === rootLayer.id) return;
        layerNode[l.id] = { id: l.id, type: "@group", name: l.name, x: 0, y: 0, w: 0, h: 0, children: [], visibility: l.state === "show" ? undefined : l.state };
    });
    var containerOf = function (layerId) {
        return layerId && layerNode[layerId] ? layerNode[layerId] : null; // null = root
    };
    var root = [];
    var placedLayers = {};
    // a layer's group sits where its first member was, parent layers first
    var placeLayer = function (layerId) {
        if (!layerNode[layerId] || placedLayers[layerId]) return;
        placedLayers[layerId] = true;
        var parentLayer = layerById[layerId].parentId;
        if (parentLayer && layerNode[parentLayer]) placeLayer(parentLayer);
        var parent = containerOf(parentLayer);
        (parent ? parent.children : root).push(layerNode[layerId]);
    };
    flat.forEach(function (c) {
        var layerId = c.type === "@group" && c.layerId !== undefined ? c.layerId : effLayer(c);
        delete c.layerId;
        placeLayer(layerId);
        var parent = containerOf(layerId);
        (parent ? parent.children : root).push(c);
    });
    // empty layers still become (empty) groups: Layer Control may target them by name
    layers.forEach(function (l) { placeLayer(l.id); });
    // the root layer's own state applies to its top-level components
    if (rootLayer && rootLayer.state && rootLayer.state !== "show") {
        root.forEach(function (n) { if (!layerNode[n.id]) n.visibility = rootLayer.state; });
    }
    // fit layer groups inside out (deepest first)
    var fitDeep = function (n) { (n.children || []).forEach(fitDeep); if (layerNode[n.id]) fitGroup(n); };
    root.forEach(fitDeep);

    surface.components = root;
    delete surface.layers;
    delete surface.groups;
    surface.treeVersion = TREE_VERSION;
    return surface;
}
