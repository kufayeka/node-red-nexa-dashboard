// The screen's components on the page: events, updates, layers, teleport, dialogs / drawers.
import { defineLogicRuntimes, flatConfig } from "../registry.js";
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
            runUiUpdateNode(ctx.screen, flatConfig(node), msg);
            return msg;
        }
    },
    "layer-control": {
        run: function (node, msg, ctx) {
            applyLayerControlUpdates(ctx.screen, (msg && Array.isArray(msg.payload)) ? msg.payload : (node.props.states || []));
            return msg;
        }
    },
    "teleport": {
        run: function (node, msg) {
            const el = elById(namespaceOf(node) + node.props.node);
            let to = node.props.toSource === "payload" ? (msg && msg.payload) : node.props.to;
            to = to === undefined || to === null ? "" : String(to).trim();
            if (!el) logicTrace("teleport: no such node", node.props.node);
            else if (!to || to === "home") teleportHome(el);
            else if (!teleportEl(el, teleportTarget(to), to)) logicTrace("teleport: no target", to);
            return msg;
        }
    },
    // its output fires once, when the overlay closes (msg.payload = the result): Open -> confirm -> act
    "overlay-open": {
        run: function (node, msg, ctx) {
            const ns = namespaceOf(node) + node.props.overlay;
            if (!openOverlay(ctx.screen, ns, msg, ctx.next)) logicTrace("overlay-open: no overlay", ns);
        }
    },
    "overlay-close": {
        run: function (node, msg) {
            closeOverlay(overlayForNode(flatConfig(node)), node.props.valueSource === "none" ? undefined : msg && msg.payload, "node");
        }
    }
});
