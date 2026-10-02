// Logic nodes keep their configuration in node.props (like a component's props, like a
// plugin node from the SDK's defineLogicNode): node = { id, type, x, y, w, h, props: {...} }.
// Projects saved before that had it flat on the node; migrateLogicNode() moves it, once
// (a node that has props already is left alone). Pure: used by the editor, the screen
// worker, the page, and scripts/migrate-project.js.

/** What stays on the node itself; everything else is configuration. */
export const LOGIC_NODE_OWN_KEYS = ["id", "type", "x", "y", "w", "h", "props"];

export function migrateLogicNode(node) {
    if (!node || typeof node !== "object") return node;
    if (node.props && typeof node.props === "object" && !Array.isArray(node.props)) return node;
    const props = {};
    Object.keys(node).forEach(function (k) {
        if (LOGIC_NODE_OWN_KEYS.indexOf(k) !== -1) return;
        props[k] = node[k];
        delete node[k];
    });
    node.props = props;
    return node;
}

/** Every node of a logic graph ({nodes, wires}); returns how many were moved. */
export function migrateLogic(logic) {
    let moved = 0;
    ((logic && logic.nodes) || []).forEach(function (n) {
        const flat = !(n && n.props && typeof n.props === "object");
        migrateLogicNode(n);
        if (flat) moved++;
    });
    return moved;
}

/** A logic node's configuration, whatever its age (for readers that may see an unmigrated node). */
export function logicProps(node) {
    return (node && node.props) || node || {};
}
