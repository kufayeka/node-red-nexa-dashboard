// The Logic node registry: the one place that knows every Logic node type.
//
// A node type lives in its family folder (src/features/logic/<family>/) in three parts:
//   meta.js     what it is: type, label, colour, icon, ports. Used by the editor and the page.
//   editor.js   how the editor shows it: label(node), the dialog (edit), a hint, rules for adding it.
//   runtime.js  what it does on the page: run(node, msg, ctx).
// The editor bundle loads ./editor.js, the page bundle ./runtime.js; both load ./meta.js.
// Adding a node type = its entries in those three files. Nothing else switches on node.type.
// A plugin adds its own with the SDK's defineLogicNode (src/sdk/logic-node.js), into the same registry.
//
// The editor bundle, the page bundle and the SDK bundle each carry a copy of this module: the
// maps live on window so the three see one registry.

const store = (function () {
    const fresh = function () { return { metas: new Map(), editors: new Map(), runtimes: new Map(), listeners: [] }; };
    if (typeof window === "undefined") return fresh();
    return window.__nexaLogicRegistry || (window.__nexaLogicRegistry = fresh());
})();
const metas = store.metas;
const editors = store.editors;
const runtimes = store.runtimes;

function changed(type) {
    store.listeners.slice().forEach(function (fn) {
        try { fn(type); } catch (e) { console.error("[nexa-logic] a registry listener threw:", e); }
    });
}

/** fn(type) after a node type is added or changed (a plugin that loaded late). Returns the unsubscribe. */
export function onLogicTypesChange(fn) {
    store.listeners.push(fn);
    return function () { const i = store.listeners.indexOf(fn); if (i !== -1) store.listeners.splice(i, 1); };
}

const FALLBACK_META = Object.freeze({ type: "?", label: "", color: "#607d8b", icon: "fa-cube", chipColor: "#e0e7ff", inputs: 1, outputs: 1 });

/**
 * @param {Array<object>} list  [{type, label, color, icon, chipColor, inputs: 0|1, outputs: n, outputLabels?, ports?(node)}]
 *   ports(node) -> number of outputs when it depends on the node (a Switch: one per rule).
 */
export function defineLogicNodes(list) {
    list.forEach(function (m) {
        if (!m || !m.type) throw new Error("defineLogicNodes: a node needs a type");
        metas.set(m.type, Object.freeze(Object.assign({}, FALLBACK_META, m)));
        changed(m.type);
    });
}

/**
 * The editor half of one or more types.
 * @param {object} parts  {type: {label?(node), edit?(node), hint?, canAdd?(screen) -> string|null, decorate?(box, node, screen)}}
 */
export function defineLogicEditors(parts) {
    Object.keys(parts).forEach(function (type) { editors.set(type, parts[type]); });
}

/**
 * The page half: run(node, msg, ctx) -> a msg to pass on through output 1, or
 * nothing (a sink, or it passes on later itself through ctx.next / ctx.nextPort).
 * @param {object} parts  {type: {run(node, msg, ctx)}}
 */
export function defineLogicRuntimes(parts) {
    Object.keys(parts).forEach(function (type) { runtimes.set(type, parts[type]); changed(type); });
}

export function logicMeta(type) { return metas.get(type) || FALLBACK_META; }
export function hasLogicType(type) { return metas.has(type); }
export function logicEditor(type) { return editors.get(type) || null; }
export function logicRuntime(type) { return runtimes.get(type) || null; }
export function logicTypes() { return Array.from(metas.keys()); }

/**
 * The node's configuration with its id and type, flat ({id, type, ...props}): for the page's
 * engine helpers (populate, overlays, ui-update…) that take a config object.
 */
export function flatConfig(node) {
    return Object.assign({ id: node.id, type: node.type }, node.props);
}

/** How many output ports the node draws. */
export function logicOutputCount(node) {
    if (!node) return 1;
    const m = logicMeta(node.type);
    return typeof m.ports === "function" ? m.ports(node) : m.outputs;
}
