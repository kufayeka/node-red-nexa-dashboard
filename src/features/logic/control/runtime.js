// Flow control on the page: Function, Switch, Delay, Join, Debug.
import { defineLogicRuntimes } from "../registry.js";
import { cloneMsg, varsFor, BROWSER_API } from "../../../runtime/logic/context.js";
import { cloneValue } from "../../../runtime/state/variable.js";
import { makeRoute } from "../../../runtime/state/scope.js";
import { runSwitchNode, runDelayNode } from "./control-runtime-helpers.js";

defineLogicRuntimes({
    // node.code is the body of an async function (msg, vars, route, storage, cookies, http, getVariable, setVariable)
    "function": {
        run: function (node, msg, ctx) {
            const screen = ctx.screen;
            const fnVars = varsFor(screen, node);
            const result = new Function("msg", "vars", "route", "storage", "cookies", "http", "getVariable", "setVariable",
                "return (async function(){ " + (node.code || "return msg;") + " })();")(
                cloneMsg(msg), fnVars, cloneValue(((screen.__scopes || {})["@app"] || {}).$route || makeRoute()),
                BROWSER_API.storage, BROWSER_API.cookies, BROWSER_API.http,
                function (name, scopeId) { return fnVars.get(name, scopeId); },
                function (name, value, scopeId, op) { return fnVars.set(name, value, scopeId, op); });
            result.then(ctx.next).catch(function (e) {
                console.error("[nexa-logic] function node " + node.id + " rejected:", e);
            });
        }
    },
    "switch": {
        run: function (node, msg, ctx) {
            runSwitchNode(ctx.screen, node, msg, ctx.budget, ctx.continuePropagation, ctx.runLogicGraph);
        }
    },
    "delay": {
        run: function (node, msg, ctx) {
            runDelayNode(ctx.screen, node, msg, ctx.budget, ctx.continuePropagation);
        }
    },
    // not built on the page yet: each message passes on as it comes
    "join": { run: function (node, msg) { return msg; } },
    "debug": {
        run: function (node, msg) {
            console.log("[nexa-logic debug]", msg);
            return msg;
        }
    }
});
