// --- The node tree of a surface (a screen or a template) ---------------------
// A surface's `components` array is its ROOT's children; a container node
// (@group, @frame) has its own `children`. Order = stacking order (later =
// on top). Every container is a coordinate space: a node's x / y are relative
// to its parent's box (the surface itself for top-level nodes).
//
// Nodes removed from the tree without being deleted — the children of a
// deleted container — live in `surface.orphans`: kept, not rendered, and can
// be placed again.
//
// Pure functions (no DOM): shared by the editor, the deployed page (through
// dist/nexa-model-client.js) and the tests.

export var CONTAINER_TYPES = { "@group": true, "@frame": true };

export function isContainer(node) {
    return !!(node && (CONTAINER_TYPES[node.type] || isSlotHost(node)));
}

// ---- slots: a component that holds other nodes (Tabs, Accordion, a card…) -----------
// A component whose definition declares `slots` is a SLOT HOST (node.slots = true): its
// children are one @frame per slot (child.inSlot = the slot's name), made and kept in step
// by syncSlots(). A slot frame is an ordinary frame — auto layout, fill, variables, what
// is dropped in it — but the component places it (a native <slot> in its shadow DOM), so
// it isn't moved, resized or taken out on its own. What goes in the component goes into
// one of its slot frames.

export function isSlotHost(node) {
    return !!(node && node.slots === true && !CONTAINER_TYPES[node.type]);
}

export function isSlotFrame(node) {
    return !!(node && node.type === "@frame" && typeof node.inSlot === "string" && node.inSlot !== "");
}

function slotFrame(slot, genId) {
    return {
        id: genId(), type: "@frame", inSlot: slot.name, slotLabel: slot.label || slot.name,
        x: 0, y: 0, w: 0, h: 0, children: [],
        layout: Object.assign({ mode: "vertical", padding: { t: 16, r: 16, b: 16, l: 16 }, gap: 8 }, slot.layout || {}),
        style: { fill: "", stroke: "", strokeWidth: 0, radius: 0, clip: true }
    };
}

/**
 * Makes `node` a slot host with one frame per slot of `slots` ([{ name, label, layout? }],
 * in order): a missing one is added, a frame whose slot is gone is kept (marked
 * slotUnused: its content stays, not drawn) — the slot may come back (a tab renamed back).
 * Returns true when it changed anything.
 */
export function syncSlots(node, slots, genId) {
    if (!node || CONTAINER_TYPES[node.type]) return false;
    var changed = false;
    if (node.slots !== true) { node.slots = true; changed = true; }
    var list = node.children || (node.children = []);
    var byName = {};
    list.forEach(function (c) { if (isSlotFrame(c) && !byName[c.inSlot]) byName[c.inSlot] = c; });
    // A slot renamed in place (a tab's value edited): as many slots as before, and where the old
    // one was, a name nothing has yet. Its frame takes the new name, with its content, instead of
    // being left "not used" next to a new empty one. (A reorder, an add or a remove is not this.)
    var wanted = (slots || []).filter(function (sl) { return sl && sl.name !== undefined && sl.name !== null && sl.name !== ""; })
        .map(function (sl) { return String(sl.name); });
    var active = list.filter(function (c) { return isSlotFrame(c) && !c.slotUnused; });
    if (active.length === wanted.length) {
        active.forEach(function (f, i) {
            var was = f.inSlot, now = wanted[i];
            if (was === now || wanted.indexOf(was) !== -1 || byName[now] || byName[was] !== f) return;
            delete byName[was];
            f.inSlot = now;
            byName[now] = f;
            changed = true;
        });
    }
    var ordered = [];
    (slots || []).forEach(function (slot) {
        if (!slot || slot.name === undefined || slot.name === null || slot.name === "") return;
        var name = String(slot.name);
        var f = byName[name];
        if (!f) { f = slotFrame({ name: name, label: slot.label, layout: slot.layout }, genId); changed = true; }
        var label = slot.label || name;
        if (f.slotLabel !== label) { f.slotLabel = label; changed = true; }
        if (f.slotUnused) { delete f.slotUnused; changed = true; }
        delete byName[name];
        ordered.push(f);
    });
    // kept: the frames of slots no longer declared (and anything else that ended up here)
    list.forEach(function (c) {
        if (ordered.indexOf(c) !== -1) return;
        if (isSlotFrame(c) && !c.slotUnused) { c.slotUnused = true; changed = true; }
        ordered.push(c);
    });
    if (ordered.length !== list.length || ordered.some(function (c, i) { return c !== list[i]; })) changed = true;
    node.children = ordered;
    return changed;
}

/** The slot frame of a host by slot name (or null). */
export function slotOf(node, name) {
    return kids(node).filter(function (c) { return isSlotFrame(c) && c.inSlot === String(name); })[0] || null;
}

export function kids(node) {
    return (node && node.children) || [];
}

function listOf(surface, parent) {
    if (!parent) return surface.components || (surface.components = []);
    return parent.children || (parent.children = []);
}

/** Depth-first, parents before children. fn(node, parent, index, depth) -> false stops descending into it. */
export function walk(surface, fn, opts) {
    var stop = false;
    function visit(list, parent, depth) {
        for (var i = 0; i < list.length && !stop; i++) {
            var node = list[i];
            var r = fn(node, parent, i, depth);
            if (r === "stop") { stop = true; return; }
            if (r !== false && node.children) visit(node.children, node, depth + 1);
        }
    }
    visit((surface && surface.components) || [], null, 0);
    if (opts && opts.orphans && surface && surface.orphans) visit(surface.orphans, null, 0);
}

/** Every node of the tree (optionally the orphans too), parents before children. */
export function allNodes(surface, opts) {
    var out = [];
    walk(surface, function (n) { out.push(n); }, opts);
    return out;
}

/** { node, parent (null = root), list, index, orphan } or null. */
export function locate(surface, id) {
    var found = null;
    function search(list, parent, orphan) {
        for (var i = 0; i < list.length; i++) {
            var n = list[i];
            if (n.id === id) { found = { node: n, parent: parent, list: list, index: i, orphan: orphan }; return true; }
            if (n.children && search(n.children, n, orphan)) return true;
        }
        return false;
    }
    if (!surface) return null;
    if (!search(surface.components || [], null, false) && surface.orphans) search(surface.orphans, null, true);
    return found;
}

export function find(surface, id) {
    var loc = locate(surface, id);
    return loc ? loc.node : null;
}

export function parentOf(surface, id) {
    var loc = locate(surface, id);
    return loc ? loc.parent : null;
}

/** Ancestors of a node, outermost first (not including the node). */
export function ancestors(surface, id) {
    var chain = [];
    var loc = locate(surface, id);
    while (loc && loc.parent) {
        chain.unshift(loc.parent);
        loc = locate(surface, loc.parent.id);
    }
    return chain;
}

export function isAncestor(surface, ancestorId, id) {
    return ancestors(surface, id).some(function (a) { return a.id === ancestorId; });
}

/** Inserts `node` into parentId's children (null = root) at index (default: on top). */
export function insert(surface, parentId, index, node) {
    var parent = parentId ? find(surface, parentId) : null;
    if (parentId && !isContainer(parent)) throw new Error("[nexa] insert: " + parentId + " is not a container");
    if (parent && isSlotHost(parent) && !(isSlotFrame(node) && !slotOf(parent, node.inSlot))) throw new Error("[nexa] it goes into one of the component's slots (a panel), not into the component itself");
    var list = listOf(surface, parent);
    var at = index === undefined || index === null || index > list.length ? list.length : Math.max(0, index);
    list.splice(at, 0, node);
    return node;
}

/** Takes a node out of the tree (or the orphans); returns { node, parentId, index, orphan }. */
export function detach(surface, id) {
    var loc = locate(surface, id);
    if (!loc) return null;
    loc.list.splice(loc.index, 1);
    return { node: loc.node, parentId: loc.parent ? loc.parent.id : null, index: loc.index, orphan: loc.orphan };
}

/** Moves a node under parentId (null = root) at index. Refuses a move into itself. */
export function move(surface, id, parentId, index) {
    if (parentId && (parentId === id || isAncestor(surface, id, parentId))) throw new Error("[nexa] move: a node can't go inside itself");
    var here = locate(surface, id);
    if (here && isSlotFrame(here.node) && here.parent && isSlotHost(here.parent) && (parentId || null) !== here.parent.id) throw new Error("[nexa] a component's slot stays in its component");
    var d = detach(surface, id);
    if (!d) return null;
    // moving within the same list: the index was counted with the node still in it
    if (d.parentId === (parentId || null) && !d.orphan && index !== undefined && index !== null && index > d.index) index--;
    insert(surface, parentId || null, index, d.node);
    return d.node;
}

/**
 * Deletes a node. A container's children are NOT deleted: they become
 * orphans (kept, not rendered, x / y in surface coordinates so they come back
 * where they were). Returns the deleted node, or null.
 */
export function remove(surface, id) {
    var loc = locate(surface, id);
    var origin = loc && !loc.orphan ? absBox(surface, id) : { x: loc && loc.node.x || 0, y: loc && loc.node.y || 0 };
    var d = detach(surface, id);
    if (!d) return null;
    if (isContainer(d.node) && d.node.children && d.node.children.length) {
        surface.orphans = surface.orphans || [];
        var orphan = function (c, ox, oy) {
            c.x = (c.x || 0) + ox;
            c.y = (c.y || 0) + oy;
            surface.orphans.push(c);
        };
        if (isSlotHost(d.node)) {
            // a slot host: what its slots held (the slot frames go with it)
            d.node.children.forEach(function (f) {
                var bw = borderOf(f);
                kids(f).forEach(function (c) { orphan(c, origin.x + (f.x || 0) + bw, origin.y + (f.y || 0) + bw); });
                f.children = [];
            });
        } else {
            d.node.children.forEach(function (c) { orphan(c, origin.x, origin.y); });
            d.node.children = [];
        }
    }
    return d.node;
}

/** Moves an orphan back into the tree. */
export function placeOrphan(surface, id, parentId, index) {
    var i = (surface.orphans || []).findIndex(function (n) { return n.id === id; });
    if (i === -1) return null;
    var node = surface.orphans.splice(i, 1)[0];
    insert(surface, parentId || null, index, node);
    return node;
}

/** Deep copy of a node with fresh ids everywhere (paste / duplicate). */
export function cloneWithNewIds(node, genId) {
    var copy = JSON.parse(JSON.stringify(node));
    (function renew(n) {
        n.id = genId();
        (n.children || []).forEach(renew);
    })(copy);
    return copy;
}

/** Where a container's children's x / y = 0 is, in surface coordinates (inside a frame's border). */
export function contentOrigin(surface, id) {
    var b = absBox(surface, id);
    if (!b) return { x: 0, y: 0 };
    var bw = borderOf(find(surface, id));
    return { x: b.x + bw, y: b.y + bw };
}

/** A frame's stroke width (its children start inside it); 0 for anything else. */
export function borderOf(node) {
    var st = node && node.type === "@frame" && node.style;
    var w = st && st.stroke ? Number(st.strokeWidth) : 0;
    return w > 0 ? w : 0;
}

/** Box of a node in surface coordinates (sum of the ancestors' offsets). */
export function absBox(surface, id) {
    var loc = locate(surface, id);
    if (!loc) return null;
    var n = loc.node;
    var x = n.x || 0, y = n.y || 0;
    // a child is positioned inside its frame's border (CSS: from the padding edge);
    // a node placed "on the screen" has the screen's coordinates (what it holds, its own)
    if (!onScreen(n)) {
        var chain = ancestors(surface, id).reverse(); // nearest first
        for (var i = 0; i < chain.length; i++) {
            var a = chain[i], b = borderOf(a);
            x += (a.x || 0) + b; y += (a.y || 0) + b;
            if (onScreen(a)) break;
        }
    }
    return { x: x, y: y, w: n.w || 0, h: n.h || 0 };
}

/** Placed "on the screen" (Layout.placeOf): its x / y are the surface's. */
export function onScreen(node) {
    return !!node && node.place === "screen" && !(node.type === "@frame" && node.inSlot) && !(node.overlay && node.overlay.kind);
}

/** The parent's box size (the surface for a top-level node) — the space a node moves in. */
export function parentSize(surface, id) {
    var p = parentOf(surface, id);
    return p ? { w: p.w || 0, h: p.h || 0 } : { w: surface.width || 0, h: surface.height || 0 };
}

// ---- groups ------------------------------------------------------------------------
// A group hugs its children: its box is their bounds, their x / y relative to it.

export function childBounds(node) {
    var list = kids(node);
    if (!list.length) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    list.forEach(function (c) {
        minX = Math.min(minX, c.x || 0);
        minY = Math.min(minY, c.y || 0);
        maxX = Math.max(maxX, (c.x || 0) + (c.w || 0));
        maxY = Math.max(maxY, (c.y || 0) + (c.h || 0));
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Re-fits a group to its children (children keep their place on screen). */
export function fitGroup(group) {
    if (!group || group.type !== "@group") return group;
    var b = childBounds(group);
    if (!b) return group;
    if (b.x !== 0 || b.y !== 0) {
        kids(group).forEach(function (c) { c.x = (c.x || 0) - b.x; c.y = (c.y || 0) - b.y; });
        group.x = (group.x || 0) + b.x;
        group.y = (group.y || 0) + b.y;
    }
    group.w = b.w;
    group.h = b.h;
    return group;
}

/** Re-fits every group on the path from a node up to the root (after it moved / resized). */
export function refitGroupsUp(surface, id) {
    ancestors(surface, id).reverse().forEach(function (a) { if (a.type === "@group") fitGroup(a); });
}

/**
 * After a node left the container `id` (moved out, deleted, unplaced): a group
 * left empty is deleted, like in Figma (and so on up), and the groups around
 * re-hug their children. Returns the ids of the deleted groups.
 */
export function tidyContainer(surface, id) {
    var dropped = [];
    var loc = id ? locate(surface, id) : null;
    while (loc && !loc.orphan && loc.node.type === "@group" && !kids(loc.node).length) {
        var parentId = loc.parent ? loc.parent.id : null;
        loc.list.splice(loc.index, 1);
        dropped.push(loc.node.id);
        loc = parentId ? locate(surface, parentId) : null;
    }
    if (loc && !loc.orphan) {
        fitGroup(loc.node);
        refitGroupsUp(surface, loc.node.id);
    }
    return dropped;
}

/**
 * Wraps sibling nodes into a new container (at the position of the top-most
 * one): an @group by default, or `container.type` ("@frame"). Its box is their
 * bounds and their x / y become relative to it, so nothing moves on screen.
 * All ids must share one parent. Returns the container.
 */
export function wrapIn(surface, ids, container) {
    return wrapInGroup(surface, ids, container);
}

export function wrapInGroup(surface, ids, group) {
    var locs = ids.map(function (id) { return locate(surface, id); }).filter(Boolean);
    if (!locs.length) return null;
    var parent = locs[0].parent;
    if (locs.some(function (l) { return l.parent !== parent || l.orphan; })) throw new Error("[nexa] wrap: nodes must share one parent");
    if (parent && isSlotHost(parent)) throw new Error("[nexa] wrap: a component's slots stay in it");
    locs.sort(function (a, b) { return a.index - b.index; });
    var at = locs[locs.length - 1].index - (locs.length - 1);
    var list = listOf(surface, parent);
    locs.slice().reverse().forEach(function (l) { list.splice(l.index, 1); });
    group.type = group.type === "@frame" ? "@frame" : "@group";
    group.children = locs.map(function (l) { return l.node; });
    group.x = 0; group.y = 0;
    var b = childBounds(group);
    kids(group).forEach(function (c) { c.x = (c.x || 0) - b.x; c.y = (c.y || 0) - b.y; });
    group.x = b.x; group.y = b.y; group.w = b.w; group.h = b.h;
    list.splice(at, 0, group);
    return group;
}

/** Replaces a group by its children (they keep their place on screen). Returns the children. */
export function unwrap(surface, id) {
    var loc = locate(surface, id);
    if (!loc || !isContainer(loc.node) || isSlotHost(loc.node) || (isSlotFrame(loc.node) && isSlotHost(loc.parent))) return [];
    var g = loc.node;
    var children = kids(g);
    children.forEach(function (c) { c.x = (c.x || 0) + (g.x || 0); c.y = (c.y || 0) + (g.y || 0); });
    loc.list.splice.apply(loc.list, [loc.index, 1].concat(children));
    return children;
}

// ---- visibility / lock ------------------------------------------------------------
// A node's own visibility is "show" | "hide" | "remove"; its EFFECTIVE one is
// the most restrictive on its path to the root ("hide" still renders — instant
// to show again — "remove" doesn't render at all). A locked ancestor locks it.

var VIS_RANK = { show: 0, hide: 1, remove: 2 };

export function effectiveVisibility(surface, id) {
    var chain = ancestors(surface, id).concat([find(surface, id)]);
    var eff = "show";
    chain.forEach(function (n) {
        var v = (n && n.visibility) || "show";
        if (VIS_RANK[v] > VIS_RANK[eff]) eff = v;
    });
    return eff;
}

export function effectiveLocked(surface, id) {
    return ancestors(surface, id).concat([find(surface, id)]).some(function (n) { return n && n.locked; });
}

/** Containers (group / frame) with this name — how the Logic "Layer Control" node targets them. */
export function findByName(surface, name) {
    var out = [];
    walk(surface, function (n) { if (isContainer(n) && n.name === name) out.push(n); });
    return out;
}
