// --- Source: the variables a node / the screen / the app declares -------------------
// { id, name, type, defaultValue } — the same shape as a template's params. Anything inside
// the owner binds to one as {name} (nearest declaration wins, see src/model/scope.js); the
// Logic "Set Variable" node changes it live. A variable of a type (UDT) is an instance: its
// "Default" is the parameters, "Device=M101, Group=G1". See ../compose.js for what a source is.
import { getActiveScreen, markDirty, genId, Scope, Types, getApp, isNodeLocked } from "../../../state.js";
import { pushHistory } from "../../../history.js";
import { redrawCanvas } from "../../../canvas/canvas-ui.js";

var TYPES = ["string", "number", "boolean", "object", "array", "color"];
var PERSIST = [{ value: "none", label: "this page" }, { value: "session", label: "tab session" }, { value: "local", label: "browser (kept)" }];

function showParams(p) { return Object.keys(p || {}).map(function (k) { return k + "=" + p[k]; }).join(", "); }
function parseParams(text) {
    var out = {};
    String(text || "").split(",").forEach(function (pair) {
        var i = pair.indexOf("=");
        if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    });
    return out;
}
function typeOptions() {
    return TYPES.map(function (t) { return { value: t, label: t }; })
        .concat((getApp().types || []).map(function (t) { return { value: "type:" + t.id, label: t.name + " (type)" }; }));
}
function show(v, type) {
    if (v === undefined || v === null) return "";
    if (type === "object" || type === "array") return JSON.stringify(v);
    return String(v);
}
function parse(text, type) {
    var t = text === undefined || text === null ? "" : String(text);
    if (type === "number") { var n = parseFloat(t); return isFinite(n) ? n : 0; }
    if (type === "boolean") return t === "true" || t === "1";
    if (type === "object" || type === "array") {
        try { return t.trim() ? JSON.parse(t) : (type === "array" ? [] : {}); } catch (e) { return type === "array" ? [] : {}; }
    }
    return t;
}

/** Problems with a list of variables: bad or duplicate names. */
export function variableProblems(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (v) {
        if (!Scope.NAME_RE.test(v.name || "")) out.push("\"" + (v.name || "") + "\" is not a valid name (letters, digits, _ or $, not starting with a digit)");
        else if (seen[v.name]) out.push("\"" + v.name + "\" is declared twice");
        seen[v.name] = true;
    });
    return out;
}

/**
 * The variables of `kind`: false = the selected container node (ctx.node), "screen" /
 * "template" = the surface, "app" = the project (variables every screen shares, optionally kept).
 */
export function variablesSource(kind) {
    var isApp = kind === "app";
    var isSurface = kind === true || kind === "screen" || kind === "template" || isApp;
    var owner = function (ctx) { return ctx.owner || ctx.node; };
    return {
        id: "variables", prefix: "var$",
        applies: function (ctx) { return isSurface || ctx.node.type === "@frame" || ctx.node.type === "@group"; },
        props: function () {
            var fields = {
                name: { type: "string", label: "Name", default: "" },
                type: { type: "enum", label: "Type", default: "string", options: typeOptions() },
                value: { type: "string", label: "Default", default: "" }
            };
            if (isApp) fields.persist = { type: "enum", label: "Kept for", default: "none", options: PERSIST };
            return {
                variables: { type: "list", group: isApp ? "App variables" : "Variables", label: isApp ? "App variables (every screen)" : "Variables",
                    default: [], noun: "variable", itemLabel: "name", item: { fields: fields },
                    validate: function (value, v, ctx) { return variableProblems(owner(ctx).variables).join(" · ") || null; },
                    help: isApp
                        ? "Shared by every screen (global state). \"Kept for\" a tab session or the browser keeps the value across pages / reloads. Bind with {name}; set it with Set Variable, watch it with On Variable Change."
                        : "Bind with {name} in the props of anything " + (kind === "template" ? "in this template (each copy / instance has its own)" : isSurface ? "on this screen" : "inside") +
                          "; the nearest declaration wins. Change one live with the Logic \"Set Variable\" node, or getVariable() / setVariable() in a Function." }
            };
        },
        view: function (node, ctx) {
            return { variables: (owner(ctx).variables || []).map(function (v) {
                var it = { name: v.name, type: v.type || "string", value: Types.isTypeRef(v.type) ? showParams(v.params) : show(v.defaultValue, v.type) };
                if (isApp) it.persist = v.persist || "none";
                return it;
            }) };
        },
        write: function () { /* set() owns the edit: ids, history */ },
        set: function (key, items, ctx) {
            var o = owner(ctx);
            if (!isSurface && isNodeLocked(o.id)) return;
            var old = o.variables || [];
            var next = (items || []).map(function (it, i) {
                var isInst = Types.isTypeRef(it.type) && !!Types.findType(it.type);
                var type = isInst ? it.type : (TYPES.indexOf(it.type) === -1 ? "string" : it.type);
                var v = { id: (old[i] && old[i].id) || genId(), name: String(it.name || "").trim() || ("var" + (i + 1)), type: type };
                if (isInst) { v.params = parseParams(it.value); v.overrides = (old[i] && old[i].overrides) || {}; }
                else v.defaultValue = parse(it.value, type);
                if (isApp && (it.persist === "session" || it.persist === "local")) v.persist = it.persist;
                return v;
            });
            var before = old.length ? JSON.parse(JSON.stringify(old)) : undefined;
            if (next.length || isApp) o.variables = next; else delete o.variables;
            var screen = getActiveScreen();
            if (!isSurface && screen) pushHistory({ t: "node", screenId: screen.id, id: o.id, key: "variables", from: before, to: next.length ? JSON.parse(JSON.stringify(next)) : undefined });
            markDirty();
            redrawCanvas();                 // {name} bindings show the new defaults; the tree stays
            ctx.update();
        }
    };
}
