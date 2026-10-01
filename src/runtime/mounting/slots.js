// Containers & Slot Host Nodes
// Node hierarchy traversal, slot frames mounting, and component indexing.

export function isStructural(node) {
    return !!node && (node.type === "@group" || node.type === "@frame");
}

export function isSlotHostNode(node) {
    return !!node && node.slots === true && !isStructural(node);
}

export function isContainerNode(node) {
    return isStructural(node) || isSlotHostNode(node);
}

export function mountSlotFrames(el, comp, typeDef, mountChild) {
    if (!isSlotHostNode(comp) || !typeDef || typeof typeDef.slotHost !== "function") return;
    const host = typeDef.slotHost(el);
    if (!host) return;
    el.__childHost = host;
    host.__nexaNode = comp;
    (comp.children || []).forEach(function (child) {
        if (!child.slotUnused) mountChild(host, child);
    });
}

export function walkNodes(list, fn, parent) {
    (list || []).forEach(function (n) {
        fn(n, parent || null);
        if (isContainerNode(n)) walkNodes(n.children, fn, n);
    });
}

export function childNamespace(parentNamespace, child) {
    const i = parentNamespace.lastIndexOf("::");
    return (i === -1 ? "" : parentNamespace.slice(0, i + 2)) + child.id;
}

export function compIndex(screen) {
    let ix = screen.__compById;
    if (!ix) {
        ix = Object.create(null);
        (screen.components || []).forEach(function (c) { if (!(c.id in ix)) ix[c.id] = c; });
        Object.defineProperty(screen, "__compById", { value: ix, writable: true, configurable: true });
    }
    return ix;
}

export function findComponent(screen, id) {
    return compIndex(screen)[id];
}

export function addComponent(screen, comp) {
    screen.components.push(comp);
    const ix = compIndex(screen);
    if (!(comp.id in ix)) ix[comp.id] = comp;
}

export function findLogicNode(screen, id) {
    return ((screen.logic && screen.logic.nodes) || []).filter(function (n) { return n.id === id; })[0];
}

export function findTemplateById(templates, id) {
    return (templates || []).filter(function (t) { return t.id === id; })[0];
}

export function getComponentTemplateTarget(template) {
    if (!template || !template.components || !template.components.length) return null;
    for (let i = 0; i < template.components.length; i++) {
        const c = template.components[i];
        if (!isStructural(c)) return c;
    }
    let found = null;
    walkNodes(template.components, function (node) {
        if (!found && !isStructural(node)) found = node;
    });
    return found || template.components[0];
}
