// The screen's components on the page: events, updates, layers, teleport, dialogs / drawers.
import { defineLogicRuntimes } from "../registry.js";
import { logicTrace } from "../../../runtime/logic/context.js";
import { runUiUpdateNode, applyLayerControlUpdates } from "../../../runtime/mounting/render.js";
import { teleportHome, teleportEl, teleportTarget } from "../../../runtime/features/teleport.js";
import { openOverlay, closeOverlay, overlayForNode } from "../../../runtime/features/overlays.js";
import { elById } from "../../../runtime/logic/widgets/populate.js";

// A node id inside a template copy is "<instance>::<id>": the same prefix finds its sibling nodes.
function namespaceOf(node) {
    const cut = node.id.lastIndexOf("::");
    return cut === -1 ? "" : node.id.slice(0, cut + 2);
}

defineLogicRuntimes({
    // fired by fireUiEvent (src/runtime/logic/runner.js)
    "ui-event": { run: function (node, msg) { return msg; } },
    "ui-update": {
        run: function (node, msg, ctx) {
            runUiUpdateNode(ctx.screen, node, msg);
            return msg;
        }
    },
    "layer-control": {
        run: function (node, msg, ctx) {
            applyLayerControlUpdates(ctx.screen, (msg && Array.isArray(msg.payload)) ? msg.payload : (node.states || []));
            return msg;
        }
    },
    "teleport": {
        run: function (node, msg) {
            const el = elById(namespaceOf(node) + node.node);
            let to = node.toSource === "payload" ? (msg && msg.payload) : node.to;
            to = to === undefined || to === null ? "" : String(to).trim();
            if (!el) logicTrace("teleport: no such node", node.node);
            else if (!to || to === "home") teleportHome(el);
            else if (!teleportEl(el, teleportTarget(to), to)) logicTrace("teleport: no target", to);
            return msg;
        }
    },
    // its output fires when the overlay closes (with the result) — and, as before the registry, also right away
    "overlay-open": {
        run: function (node, msg, ctx) {
            const ns = namespaceOf(node) + node.overlay;
            if (!openOverlay(ctx.screen, ns, msg, ctx.next)) logicTrace("overlay-open: no overlay", ns);
            return msg;
        }
    },
    "overlay-close": {
        run: function (node, msg) {
            closeOverlay(overlayForNode(node), node.valueSource === "none" ? undefined : msg && msg.payload, "node");
        }
    }
});
