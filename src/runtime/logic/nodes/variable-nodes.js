// Variable Logic Nodes Handlers
// Implementations for set-variable, set-variable-multi, and get-variable-multi.

import { resolveScope } from "../../state/scope.js";
import { writeVariable, valueFromMsg, setMsgPath, cloneMsg, cloneValue } from "../../state/variable.js";

export function setVariable(screen, node, msg) {
    const scope = resolveScope(screen, node.scope, node.id);
    if (!scope) {
        console.warn("[nexa-logic] set-variable: no such scope", node.scope, node.name);
        return;
    }
    writeVariable(screen, scope, node.name, valueFromMsg(node, msg), node.op);
}

export function setVariablesMulti(screen, node, msg) {
    const assignments = Array.isArray(node.assignments) ? node.assignments : [];
    assignments.forEach(function (a) {
        if (!a || !a.name) return;
        const scope = resolveScope(screen, a.scope, node.id);
        if (!scope) {
            console.warn("[nexa-logic] set-variable-multi: no such scope", a.scope, a.name);
            return;
        }
        writeVariable(screen, scope, a.name, valueFromMsg(a, msg), a.op || "set");
    });
}

export function getVariablesMulti(screen, node, msg) {
    const out = cloneMsg(msg || {});
    const reads = Array.isArray(node.reads) ? node.reads : [];
    reads.forEach(function (r) {
        if (!r || !r.name) return;
        const gScope = resolveScope(screen, r.scope, node.id);
        const val = gScope ? cloneValue(gScope[r.name]) : undefined;
        setMsgPath(out, r.target || "payload", val);
    });
    return out;
}
