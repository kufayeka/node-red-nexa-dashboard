// Web and browser data on the page: an API call, browser storage, cookies (./web-ops.js).
import { defineLogicRuntimes } from "../registry.js";
import { runHttpNode, runStorageNode, runCookieNode } from "./web-ops.js";

defineLogicRuntimes({
    // passes on when the response is in
    "http-request": { run: function (node, msg, ctx) { runHttpNode(ctx.screen, node, msg, ctx.next); } },
    "storage": { run: function (node, msg, ctx) { return runStorageNode(ctx.screen, node, msg); } },
    "cookie": { run: function (node, msg, ctx) { return runCookieNode(ctx.screen, node, msg); } }
});
