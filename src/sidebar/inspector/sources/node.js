// --- Sources every node has: General (name, lock, what it is) and its box ---------
// See ../compose.js for what a source is.
import { getActiveScreen, markDirty, Tree, Layout, isNodeLocked } from "../../../state.js";
import { pushHistory } from "../../../history.js";
import { ungroupSelection, setLockedForSelection, toggleFlipForSelection } from "../../../canvas/selection.js";

function isContainer(node) { return Tree.isContainer(node) && !Tree.isSlotHost(node); }

function kids(node) { var n = Tree.kids(node).length; return n + (n === 1 ? " child" : " children"); }

// what the node is, in words: "Frame — 3 children", "Slot “Tab 1” of tabs1"
function kindText(node, ctx) {
    if (Tree.isSlotFrame(node)) {
        var host = ctx.parent, hostDef = host && window.NEXA.getComponent(host.type);
        return "Slot “" + (node.slotLabel || node.inSlot) + "” of " + ((host && host.name) || (hostDef && hostDef.label) || "its component") + " — " + kids(node) +
            (node.slotUnused ? ". Not used now: its slot is gone (a tab removed); its content is kept and shows again when the slot comes back." : "");
    }
    if (isContainer(node)) return (node.type === "@frame" ? "Frame" : "Group") + " — " + kids(node);
    if (node.type === "@template") return "Template instance: " + (ctx.template ? ctx.template.name : "(missing)");
    if (node.type === "@lit-component") return "Lit Component";
    return (ctx.typeDef && ctx.typeDef.label) || node.type;
}

export var general = {
    id: "general", prefix: "gen$",
    props: function (ctx) {
        var node = ctx.node, cont = isContainer(node), slot = Tree.isSlotFrame(node);
        var out = {
            kind: { type: "action", group: "General", label: "Type", summary: function () { return kindText(node, ctx); }, info: function () { return kindText(node, ctx); },
                buttons: cont && !slot ? [{ label: node.type === "@frame" ? "Remove frame" : "Ungroup", icon: "fa fa-object-ungroup",
                    title: (node.type === "@frame" ? "Remove the frame, keep its children" : "Ungroup") + " (Ctrl+Shift+G)",
                    disabled: function () { return isNodeLocked(node.id); }, run: function () { ungroupSelection(); } }] : [] },
            name: { type: "string", group: "General", label: "Name", placeholder: node.type,
                help: "What the Hierarchy shows, and what Logic nodes find it by." }
        };
        if (!slot) out.locked = { type: "boolean", group: "General", label: cont ? "Locked (with everything inside)" : "Locked" };
        return out;
    },
    view: function (node) { return { kind: "", name: node.name || "", locked: !!node.locked }; },
    write: function (node, key, v) {
        if (key === "name") { var t = String(v || "").trim(); if (t) node.name = t; else delete node.name; }
        if (key === "locked") node.locked = !!v;
    },
    set: function (key, v, ctx) {
        var node = ctx.node;
        if (key === "locked") { setLockedForSelection(!!v, [node.id]); ctx.update(); return; }
        if (key === "name") {
            var next = String(v || "").trim();
            var screen = getActiveScreen();
            if (screen) pushHistory({ t: "node", screenId: screen.id, id: node.id, key: "name", from: node.name, to: next || undefined });
            if (next) node.name = next; else delete node.name;
            markDirty();
            if (ctx.refreshHierarchy) ctx.refreshHierarchy();
            ctx.update();
        }
    }
};

// X / Y kept inside what holds the node (the frame's inner box, or the screen)
function clampXY(node, field, val, ctx) {
    var screen = ctx.screen, parent = ctx.parent;
    if (!screen) return val;
    var container = parent;
    while (container && container.type === "@group") container = Tree.parentOf(screen, container.id);
    var minBound, maxBound, size = field === "x" ? (node.w || 0) : (node.h || 0);
    if (container && !Tree.onScreen(node)) {
        var isz = container.type === "@frame" && typeof Layout.innerSize === "function" ? Layout.innerSize(container) : null;
        var dim = isz ? (field === "x" ? isz.w : isz.h) : (field === "x" ? (container.w || 0) : (container.h || 0));
        var origin = parent ? Tree.contentOrigin(screen, parent.id) : { x: 0, y: 0 };
        var cont = Tree.contentOrigin(screen, container.id);
        var rel = field === "x" ? origin.x - cont.x : origin.y - cont.y;
        minBound = -rel;
        maxBound = Math.max(minBound, dim - rel - size);
    } else {
        var sd = field === "x" ? screen.width : screen.height;
        var ro = parent && !Tree.onScreen(node) ? Tree.contentOrigin(screen, parent.id) : { x: 0, y: 0 };
        var rr = field === "x" ? ro.x : ro.y;
        minBound = -rr;
        maxBound = Math.max(minBound, sd - rr - size);
    }
    return Math.max(minBound, Math.min(val, maxBound));
}

var locked = function (v, ctx) { return !isNodeLocked(ctx.node.id); };

/** A component's box: X / Y / W / H, rotation, flip (a frame and a template instance have their own). */
export var geometry = {
    id: "geometry", prefix: "geo$",
    applies: function (ctx) { var n = ctx.node; return !isContainer(n) && n.type !== "@template"; },
    props: function (ctx) {
        var caps = (ctx.typeDef && ctx.typeDef.capabilities) || {};
        var out = {
            x: { type: "number", group: "Position & Size", label: "X", unit: "px", enabledWhen: locked },
            y: { type: "number", group: "Position & Size", label: "Y", unit: "px", enabledWhen: locked },
            w: { type: "number", group: "Position & Size", label: "Width", unit: "px", min: 1, enabledWhen: locked },
            h: { type: "number", group: "Position & Size", label: "Height", unit: "px", min: 1, enabledWhen: locked }
        };
        if (caps.rotatable !== false) out.rotation = { type: "number", group: "Position & Size", label: "Rotation", unit: "°", enabledWhen: locked };
        if (caps.flippable !== false) {
            out.flipH = { type: "boolean", group: "Position & Size", label: "Flip horizontal (Shift+H)", enabledWhen: locked };
            out.flipV = { type: "boolean", group: "Position & Size", label: "Flip vertical (Shift+V)", enabledWhen: locked };
        }
        return out;
    },
    view: function (node) { return { x: node.x, y: node.y, w: node.w, h: node.h, rotation: node.rotation || 0, flipH: !!node.flipH, flipV: !!node.flipV }; },
    write: function (node, key, v, ctx) {
        var n = Number(v) || 0;
        if (key === "x" || key === "y") node[key] = ctx ? clampXY(node, key, n, ctx) : n;
        else if (key === "w" || key === "h") node[key] = Math.max(1, n);
        else if (key === "rotation") { if (n) node.rotation = n; else delete node.rotation; }
        else if (key === "flipH" || key === "flipV") node[key] = !!v;
    },
    set: function (key, v, ctx) {
        // flips go through the canvas's own action (one undo step, its re-render)
        if (key === "flipH" || key === "flipV") {
            if (!!ctx.node[key] !== !!v) toggleFlipForSelection(key === "flipH" ? "h" : "v");
            ctx.update();
            return;
        }
        ctx.commit(function () { geometry.write(ctx.node, key, v, ctx); });
    },
    canVary: function (key) { return key !== "flipH" && key !== "flipV"; }
};

/** A group's place: X / Y (its size follows its children). */
export var groupBox = {
    id: "groupBox", prefix: "gbox$",
    applies: function (ctx) { return ctx.node.type === "@group"; },
    props: function (ctx) {
        return {
            x: { type: "number", group: "Position & Size", label: "X", unit: "px", enabledWhen: locked },
            y: { type: "number", group: "Position & Size", label: "Y", unit: "px", enabledWhen: locked },
            size: { type: "action", group: "Position & Size", label: "Size", summary: function () { return Math.round(ctx.node.w) + " × " + Math.round(ctx.node.h); },
                info: function () { return Math.round(ctx.node.w) + " × " + Math.round(ctx.node.h) + " px: it follows its children."; } }
        };
    },
    view: function (node) { return { x: node.x, y: node.y, size: "" }; },
    write: function (node, key, v, ctx) { if (key === "x" || key === "y") node[key] = clampXY(node, key, Number(v) || 0, ctx); }
};
