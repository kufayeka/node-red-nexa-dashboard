// Nexa Link on the page (docs/LINK.md). Transport: src/runtime/io/link.js.
import { defineLogicRuntimes } from "../registry.js";
import { cloneMsg } from "../../../runtime/logic/context.js";
import { linkRequest, linkSend } from "../../../runtime/io/link.js";

defineLogicRuntimes({
    // msg.payload to the flow; output 1: msg.payload = its answer, output 2: msg.error
    "link-request": {
        run: function (node, msg, ctx) {
            linkRequest(node.channel, msg ? msg.payload : null, ctx.screen && ctx.screen.id).then(function (value) {
                const out = cloneMsg(msg || {});
                out.payload = value;
                delete out.error;
                ctx.nextPort(0, out);
            }, function (e) {
                const out = cloneMsg(msg || {});
                out.error = e && e.message ? e.message : String(e);
                ctx.nextPort(1, out);
            });
        }
    },
    // fire and forget; passes msg on once it is sent
    "link-send": {
        run: function (node, msg, ctx) {
            linkSend(node.channel, msg ? msg.payload : null, ctx.screen && ctx.screen.id).then(function () {
                ctx.next(msg);
            }, function (e) {
                console.error("[nexa-logic] To Node-RED node " + node.id + " failed: " + (e && e.message));
            });
        }
    },
    // fired by ./link-ops.js for every message the flow pushes
    "link-receive": { run: function (node, msg) { return msg; } }
});
