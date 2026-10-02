// Variables on the page. The scope rules live in src/runtime/state/ (and src/model/scope.js).
import { defineLogicRuntimes } from "../registry.js";
import { cloneMsg } from "../../../runtime/logic/context.js";
import { resolveScope } from "../../../runtime/state/scope.js";
import { cloneValue, setMsgPath } from "../../../runtime/state/variable.js";
import { setVariable, setVariablesMulti, getVariablesMulti } from "./variable-ops.js";

defineLogicRuntimes({
    "set-variable": {
        run: function (node, msg, ctx) {
            setVariable(ctx.screen, node, msg);
            return msg;
        }
    },
    "set-variable-multi": {
        run: function (node, msg, ctx) {
            setVariablesMulti(ctx.screen, node, msg);
            return msg;
        }
    },
    "get-variable": {
        run: function (node, msg, ctx) {
            const scope = resolveScope(ctx.screen, node.props.scope, node.id);
            const out = cloneMsg(msg || {});
            setMsgPath(out, node.props.target || "payload", scope ? cloneValue(scope[node.props.name]) : undefined);
            return out;
        }
    },
    "get-variable-multi": {
        run: function (node, msg, ctx) { return getVariablesMulti(ctx.screen, node, msg); }
    },
    // fired by the variable watchers (src/runtime/state/variable.js)
    "on-variable-change": { run: function (node, msg) { return msg; } }
});
