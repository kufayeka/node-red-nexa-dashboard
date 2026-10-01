// --- Variables and their lexical scope chain ----------------------------------
// Variables live on the screen (surface.variables) and on containers
// (node.variables of an @group / @frame), each { id, name, type, defaultValue }
// — the same shape as a template's params. A {name} binding in a node's props
// resolves to the NEAREST declaration going outwards: the node's containers,
// innermost first, then the screen. A "@template" instance is a boundary: the
// nodes inside see the template's params (and its own containers' variables),
// never the screen around the instance — what crosses is passed in through
// the instance's paramValues ({name} there resolves in the OUTER scope).
//
// A scope is a plain object whose prototype is the enclosing scope
// (Object.create(parent)), so an ordinary property lookup — scope[name], the
// way {path} interpolation reads — walks the whole chain, and a value set on
// one scope is seen by everything inside it (unless shadowed).

import { variableValue, isTypeRef, findType, memberPaths } from "./types.js";

export var NAME_RE = /^[A-Za-z_$][\w$]*$/;

/** A scope inside `parent` (null = a root) with `variables`' default values. */
export function makeScope(parent, variables) {
    var scope = Object.create(parent || null);
    (variables || []).forEach(function (v) {
        // a variable of a type (UDT) starts as an instance of it (types.js)
        if (v && typeof v.name === "string" && NAME_RE.test(v.name)) scope[v.name] = variableValue(v);
    });
    return scope;
}

function clone(v) {
    return v !== null && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
}

/** Whether a node declares variables (and so opens a scope of its own). */
export function hasVariables(node) {
    return !!(node && Array.isArray(node.variables) && node.variables.length);
}

/**
 * The root scope of a surface: a screen's variables — or, for a template, its
 * params (defaults) and variables (a param wins over a variable of the same name).
 */
export function surfaceScope(surface, isTemplate, parent) {
    // `parent`: the app scope (app variables, $route) above every screen / template
    var scope = makeScope(parent || null, surface && surface.variables);
    if (isTemplate) {
        (surface.params || []).forEach(function (p) { if (p && NAME_RE.test(p.name || "")) scope[p.name] = clone(p.defaultValue); });
    }
    return scope;
}

/**
 * The names a node can bind to, nearest first, shadowed ones left out:
 * [{ name, type, value, owner: { id, name, kind: "container" | "screen" | "template" } }].
 * `ancestors`: the node's containers, outermost first (Tree.ancestors).
 */
export function visibleVariables(surface, ancestors, isTemplate, self, app) {
    var seen = {}, out = [];
    function add(list, owner, valueKey) {
        (list || []).forEach(function (v) {
            if (!v || !NAME_RE.test(v.name || "") || seen[v.name]) return;
            seen[v.name] = true;
            var t = isTypeRef(v.type) ? findType(v.type) : null;
            out.push({ name: v.name, type: t ? t.name : (v.type || "string"), value: t ? "(" + t.name + ")" : v[valueKey], owner: owner, typeId: t ? t.id : undefined });
            // an instance: its members too — {M101.Speed}, {M101.motor.Running}
            if (t) memberPaths(t).forEach(function (mp) {
                out.push({ name: v.name + "." + mp.path, type: mp.member.dataType || "string", value: mp.member.source ? "(" + (mp.member.access === "readwrite" ? "read / write" : "read") + " tag)" : mp.member.defaultValue, owner: owner, member: true });
            });
        });
    }
    var chain = (ancestors || []).slice();
    if (self && hasVariables(self)) chain.push(self);        // a container sees its own variables
    for (var i = chain.length - 1; i >= 0; i--) {
        add(chain[i].variables, { id: chain[i].id, name: chain[i].name || chain[i].type, kind: "container" }, "defaultValue");
    }
    if (isTemplate) add(surface.params, { id: surface.id, name: surface.name || "template", kind: "template" }, "defaultValue");
    add(surface.variables, { id: surface.id, name: isTemplate ? (surface.name || "template") : "screen", kind: isTemplate ? "template" : "screen" }, "defaultValue");
    if (app) add(app.variables, { id: "@app", name: "App", kind: "app" }, "defaultValue");
    if (app && app.sharedVariables) add(app.sharedVariables, { id: "@shared", name: "Shared / Server", kind: "shared" }, "defaultValue");
    return out;
}

/** Every variable declaration of a surface: [{ scopeId ("" = the surface), scopeName, variable }]. */
export function allDeclarations(surface, walk, app) {
    var out = [];
    if (app && app.sharedVariables) (app.sharedVariables || []).forEach(function (v) { out.push({ scopeId: "@shared", scopeName: "Shared / Server", variable: v }); });
    if (app) (app.variables || []).forEach(function (v) { out.push({ scopeId: "@app", scopeName: "App", variable: v }); });
    // a template's params: its Logic reads them like variables ({param1}, Get Variable, vars.get)
    (surface.params || []).forEach(function (p) { if (p && p.name) out.push({ scopeId: "", scopeName: "Template", variable: { id: p.id, name: p.name, type: p.type, defaultValue: p.defaultValue }, param: true }); });
    (surface.variables || []).forEach(function (v) { out.push({ scopeId: "", scopeName: surface.params ? "Template" : "Screen", variable: v }); });
    walk(surface, function (node) {
        if (hasVariables(node)) node.variables.forEach(function (v) { out.push({ scopeId: node.id, scopeName: node.name || node.type, variable: v }); });
    });
    return out;
}
