// From Node-RED nodes on the open screen: which channels the page listens to, and
// firing those nodes when the flow pushes. Called by mountScreen (src/runtime/features/navigation.js).
import { cloneMsg } from "../../../runtime/logic/context.js";
import { linkSetSubscriptions } from "../../../runtime/io/link.js";

let listening = []; // the screens whose From Node-RED nodes fire now
let run = null;

function onPush(channelId, payload, meta) {
    let first = true;
    listening.forEach(function (screen) {
        ((screen && screen.logic && screen.logic.nodes) || []).forEach(function (n) {
            if (n.type !== "link-receive" || n.props.channel !== channelId) return;
            // the first node gets the payload itself, every other one a copy (a big answer is copied only when needed)
            const p = first || payload === null || typeof payload !== "object" ? payload : cloneMsg(payload);
            first = false;
            run(screen, n, { payload: p, topic: n.props.channelName || "", retained: !!meta.retained });
        });
    });
}

/** After a screen mounted: listen to the channels its From Node-RED nodes (and the active flow's) use. */
export function syncLinkSubscriptions(screens, runLogicGraph) {
    run = runLogicGraph;
    listening = (screens || []).filter(Boolean);
    const ids = [];
    listening.forEach(function (screen) {
        ((screen.logic && screen.logic.nodes) || []).forEach(function (n) {
            if (n.type === "link-receive" && n.props.channel) ids.push(n.props.channel);
        });
    });
    linkSetSubscriptions(ids, onPush);
}
