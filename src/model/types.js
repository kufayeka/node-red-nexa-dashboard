// --- Types (UDT): a class for data — members, defaults, where values come from --
// A type (project-level, kept on the project config node as `types`):
//   { id, name,
//     params:  [{ id, name, defaultValue }],                 e.g. Group, Node, Device, Prefix
//     members: [{ id, name, dataType, defaultValue, unit, access, source }] }
//   dataType: "string" | "number" | "boolean" | "object" | "array" | "color"
//             or "type:<typeId>" (a nested type — a Pump has a Motor)
//   access:   "read" | "readwrite"
//   source:   "" (a value: the default, or the instance's override) or a binding
//             with the type's params in it: "{sparkplug:{Group}::{Node}::{Device}::{Prefix}Speed}"
// An instance is a VARIABLE whose type is "type:<typeId>":
//   { id, name, type: "type:<typeId>", params: { Device: "M101", … }, overrides: { <memberId>: value } }
// so it has a scope (app / screen / frame), and Set / Get / watch like any variable.
//
// The instance's value is a plain object, one key per member. A member with a
// source holds a BindingRef — the binding text with the params filled in — and
// the renderers treat a BindingRef as that binding: {M101.Speed} becomes
// {sparkplug:G1::E1::M101::Speed}, then resolves and updates live as any tag does.

var TYPES = [];

/** The project's types (the editor: from the config node; the live page: window.__NEXA_APP__). */
export function setTypes(list) { TYPES = Array.isArray(list) ? list : []; }
export function getTypes() { return TYPES; }
export function findType(ref) {
    var id = typeof ref === "string" && ref.indexOf("type:") === 0 ? ref.slice(5) : ref;
    return TYPES.filter(function (t) { return t.id === id || t.name === id; })[0] || null;
}
export function isTypeRef(dataType) { return typeof dataType === "string" && dataType.indexOf("type:") === 0; }

/** A member whose value comes from somewhere: the binding with the params filled in. */
export function BindingRef(text, access) {
    this.__nexaBinding = text;
    this.access = access || "read";
}
BindingRef.prototype.toString = function () { return this.__nexaBinding; };
BindingRef.prototype.toJSON = function () { return this.__nexaBinding; };
export function isBindingRef(v) { return !!v && typeof v === "object" && typeof v.__nexaBinding === "string"; }

function clone(v) { return v !== null && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v; }

// {Param} in a member's source (and the built-ins {InstanceName}, {ParentInstanceName})
function fillParams(text, params) {
    return String(text).replace(/\{([A-Za-z_$][\w$]*)\}/g, function (whole, name) {
        return Object.prototype.hasOwnProperty.call(params, name) && params[name] !== undefined && params[name] !== null ? String(params[name]) : whole;
    });
}

/**
 * An instance's value: { <member>: value | BindingRef | nested instance }.
 * `params` merge over the type's defaults; `overrides` (by member id, then
 * name) replace a member's default. A nested member gets the parent's params
 * (same names), and its own name as {InstanceName}. Stops at depth 8 (a type
 * that contains itself).
 */
export function buildInstance(type, instName, params, overrides, depth, parentName) {
    depth = depth || 0;
    if (!type || depth > 8) return null;
    var p = {};
    (type.params || []).forEach(function (x) { if (x && x.name) p[x.name] = x.defaultValue; });
    Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    p.InstanceName = instName;
    if (parentName) p.ParentInstanceName = parentName;
    overrides = overrides || {};
    var out = {};
    Object.defineProperty(out, "__type", { value: type.id, enumerable: false });
    (type.members || []).forEach(function (m) {
        if (!m || !m.name) return;
        var ov = Object.prototype.hasOwnProperty.call(overrides, m.id) ? overrides[m.id]
            : Object.prototype.hasOwnProperty.call(overrides, m.name) ? overrides[m.name] : undefined;
        if (isTypeRef(m.dataType)) {
            var sub = findType(m.dataType);
            out[m.name] = sub ? buildInstance(sub, m.name, Object.assign({}, p, ov && typeof ov === "object" ? ov : {}), {}, depth + 1, instName) : null;
        } else if (m.source) {
            out[m.name] = new BindingRef(fillParams(m.source, p), m.access);
        } else {
            out[m.name] = clone(ov !== undefined ? ov : m.defaultValue);
        }
    });
    return out;
}

/** A variable's starting value: an instance for a typed one, its default otherwise. */
export function variableValue(v) {
    if (v && isTypeRef(v.type)) {
        var t = findType(v.type);
        return t ? buildInstance(t, v.name, v.params, v.overrides) : null;
    }
    return clone(v ? v.defaultValue : undefined);
}

/** The member declaration a path points at ({M101.motor.Speed}), or null. */
export function memberAt(instance, path) {
    var cur = instance, member = null;
    for (var i = 0; i < path.length; i++) {
        if (!cur || typeof cur !== "object" || !cur.__type) return null;
        var t = findType(cur.__type);
        member = t && (t.members || []).filter(function (m) { return m.name === path[i]; })[0];
        if (!member) return null;
        cur = cur[path[i]];
    }
    return member;
}

/** Member paths of a type, for the binding picker: ["Speed", "Running", "motor.Speed", …]. */
export function memberPaths(type, prefix, depth) {
    depth = depth || 0;
    var out = [];
    if (!type || depth > 4) return out;
    (type.members || []).forEach(function (m) {
        if (!m || !m.name) return;
        var path = prefix ? prefix + "." + m.name : m.name;
        out.push({ path: path, member: m });
        if (isTypeRef(m.dataType)) out = out.concat(memberPaths(findType(m.dataType), path, depth + 1));
    });
    return out;
}
