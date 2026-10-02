// Nexa Link Logic nodes (the page side of the "from Nexa" / "to Nexa" Node-RED nodes):
//   link-request  Request: msg.payload to the flow, waits for its answer.
//                 Output 1: msg.payload = the answer. Output 2: msg.error (error answer, timeout, no link).
//   link-send     To Node-RED: msg.payload to the flow, fire and forget; passes msg on once sent.
//   link-receive  From Node-RED: a source, fires with msg.payload for every message the flow pushes.
// node.channel = the kufayeka-nexa-channel config node id. Transport: ../../io/link.js.

import { cloneMsg } from "../context.js";
import { linkRequest, linkSend, linkSetSubscriptions } from "../../io/link.js";

export function runLinkRequestNode(screen, node, msg, budget, continueFromPort) {
    linkRequest(node.channel, msg ? msg.payload : null, screen && screen.id).then(function (value) {
        const out = cloneMsg(msg || {});
        out.payload = value;
        delete out.error;
        continueFromPort(screen, node, out, 0, budget);
    }, function (e) {
        const out = cloneMsg(msg || {});
        out.error = e && e.message ? e.message : String(e);
        continueFromPort(screen, node, out, 1, budget);
    });
}

export function runLinkSendNode(screen, node, msg, budget, continuePropagation) {
    linkSend(node.channel, msg ? msg.payload : null, screen && screen.id).then(function () {
        continuePropagation(screen, node, msg, budget);
    }, function (e) {
        console.error("[nexa-logic] To Node-RED node " + node.id + " failed: " + (e && e.message));
    });
}

let listening = [];   // the screens whose From Node-RED nodes fire now
let run = null;

function onPush(channelId, payload, meta) {
    let first = true;
    listening.forEach(function (screen) {
        ((screen && screen.logic && screen.logic.nodes) || []).forEach(function (n) {
            if (n.type !== "link-receive" || n.channel !== channelId) return;
            // the first node gets the payload itself, every other one a copy (a big answer is copied only when needed)
            const p = first || payload === null || typeof payload !== "object" ? payload : cloneMsg(payload);
            first = false;
            run(screen, n, { payload: p, topic: n.channelName || "", retained: !!meta.retained });
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
            if (n.type === "link-receive" && n.channel) ids.push(n.channel);
        });
    });
    linkSetSubscriptions(ids, onPush);
}
