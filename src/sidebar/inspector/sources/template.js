// --- Sources: a template instance's parameters, a Lit component's code, a legacy plugin -----
//   params   one field per param the instance's template declares (comp.paramValues[name]):
//            this ONE instance's value, like a Subflow instance's env vars; a Logic
//            "Set Template Param" node overrides it live
//   lit      an "@lit-component": its code (edited in a dialog, never inline), its bindable
//            properties (also its `static properties`) and the events its code emits
//   legacy   a pre-SDK component's `defaults` (NEXA.registerComponent): a field each
// See ../compose.js for what a source is.
import { markDirty } from "../../../state.js";
import { normalizeParamType, defaultValueForType } from "../../../param-types.js";
import { refreshComponentRender } from "../../../canvas/component-renderer.js";
import { openLitComponentCodeEditor, openCssCodeEditor } from "../../../dialogs/lit-code-dialog.js";

var KIT_TYPE = { string: "string", number: "number", boolean: "boolean", color: "color", object: "json", array: "json" };

export var params = {
    id: "params", prefix: "param$",
    applies: function (ctx) { return ctx.node.type === "@template" && !!ctx.template && (ctx.template.params || []).length > 0; },
    props: function (ctx) {
        var out = {};
        (ctx.template.params || []).forEach(function (param) {
            var t = normalizeParamType(param.type);
            out[param.name] = { type: KIT_TYPE[t] || "string", group: "Parameters", label: (param.label || param.name) + " {" + param.name + "}",
                default: param.defaultValue !== undefined ? param.defaultValue : defaultValueForType(t),
                help: "This instance's value of the template's {" + param.name + "}. A Logic \"Set Template Param\" node can change it live." };
        });
        return out;
    },
    view: function (node, ctx) {
        var out = {};
        (ctx.template.params || []).forEach(function (param) {
            out[param.name] = node.paramValues && node.paramValues[param.name] !== undefined ? node.paramValues[param.name] : param.defaultValue;
        });
        return out;
    },
    write: function (node, key, v) {
        node.paramValues = Object.assign({}, node.paramValues || {});
        node.paramValues[key] = v;
    }
};

// what a typed default value is, from its text
function parseTyped(text, type) {
    var t = text === undefined || text === null ? "" : String(text);
    if (type === "number") { var n = parseFloat(t); return isFinite(n) ? n : 0; }
    if (type === "boolean") return t === "true" || t === "1";
    if (type === "object" || type === "array") { try { return t.trim() ? JSON.parse(t) : (type === "array" ? [] : {}); } catch (e) { return type === "array" ? [] : {}; } }
    return t;
}
function lines(code) { var s = String(code || "").replace(/\s+$/, ""); return s ? s.split("\n").length : 0; }

export var lit = {
    id: "lit", prefix: "lit$",
    applies: function (ctx) { return ctx.node.type === "@lit-component"; },
    props: function (ctx) {
        var node = ctx.node;
        return {
            code: { type: "action", group: "Lit Code", label: "Code",
                summary: function () { return lines(node.litCode) + " lines" + (lines(node.litStyles) ? " · CSS " + lines(node.litStyles) + " lines" : ""); },
                info: function () { return lines(node.litCode) ? lines(node.litCode) + " lines of class body, " + lines(node.litStyles) + " lines of CSS." : "No code yet: write its render()."; },
                buttons: [{ label: "Edit Code…", icon: "fa fa-code", run: function () { openLitComponentCodeEditor(node); } }],
                help: "Edited in a dialog, like a Function node: nothing here can throw away what you typed." },
            bindable: { type: "list", group: "Lit Code", label: "Bindable properties", default: [], noun: "property", itemLabel: "name",
                item: { fields: {
                    name: { type: "string", label: "Name", default: "" },
                    type: { type: "enum", label: "Type", default: "string", options: ["string", "number", "boolean", "object", "array"] },
                    value: { type: "string", label: "Default", default: "" },
                    twoWay: { type: "boolean", label: "2-way: sync this.<name> changes back to its props", default: false } } },
                help: "Its `static properties`, and what Update Component / Properties can set. 2-way: an assignment to this.<name> in its own code (an @input handler) is saved back." },
            events: { type: "list", group: "Lit Code", label: "Events", default: [], noun: "event", itemLabel: "name",
                item: { fields: { name: { type: "string", label: "Name", default: "" } } },
                help: "The names its code emits with this.emit(name, payload): each gets an \"on <name>\" chip in the Events palette." }
        };
    },
    view: function (node) {
        return {
            code: "",
            bindable: (node.litBindable || []).map(function (p) {
                return { name: p.name || "", type: p.type || "string", value: typeof p.defaultValue === "object" ? JSON.stringify(p.defaultValue) : String(p.defaultValue === undefined ? "" : p.defaultValue), twoWay: !!p.twoWay };
            }),
            events: (node.litEvents || []).map(function (e) { return { name: e.name || "" }; })
        };
    },
    write: function (node, key, v) {
        if (key === "bindable") {
            var old = node.litBindable || [];
            node.litBindable = (v || []).map(function (it, i) {
                var type = it.type || "string";
                var p = { name: String(it.name || "").trim() || ("prop" + (i + 1)), type: type, defaultValue: parseTyped(it.value, type) };
                if (it.twoWay) p.twoWay = true;
                // a renamed property keeps its value
                var was = old[i];
                node.props = node.props || {};
                if (was && was.name !== p.name && node.props[was.name] !== undefined) { node.props[p.name] = node.props[was.name]; delete node.props[was.name]; }
                node.props[p.name] = p.defaultValue;
                return p;
            });
        }
        if (key === "events") node.litEvents = (v || []).map(function (it, i) { return { name: String(it.name || "").trim() || ("myEvent" + (i + 1)) }; });
    },
    set: function (key, v, ctx) {
        ctx.commit(function () { lit.write(ctx.node, key, v); });
        refreshComponentRender(ctx.node);
        ctx.update();
    }
};

var LEGACY_TYPE = { number: "number", color: "color", checkbox: "boolean", css: "action" };

export var legacy = {
    id: "legacy", prefix: "legacy$",
    applies: function (ctx) { return !!ctx.typeDef && !ctx.typeDef.nexa && typeof ctx.typeDef.renderProperties !== "function" && !!ctx.typeDef.defaults; },
    props: function (ctx) {
        var out = {}, defs = ctx.typeDef.defaults, node = ctx.node;
        Object.keys(defs).forEach(function (key) {
            var d = defs[key] || {};
            var type = LEGACY_TYPE[d.type] || "string";
            if (type === "action") {
                out[key] = { type: "action", group: "Properties", label: key, summary: function () { return lines(node.props && node.props[key]) + " lines"; },
                    buttons: [{ label: "Edit CSS…", icon: "fa fa-css3", run: function () { openCssCodeEditor(node, key, "Edit CSS (" + (ctx.typeDef.label || node.type) + ")"); } }] };
            } else out[key] = { type: type, group: "Properties", label: key, default: d.value };
        });
        return out;
    },
    view: function (node) { return Object.assign({}, node.props || {}); },
    write: function (node, key, v) { node.props = node.props || {}; node.props[key] = v; },
    set: function (key, v, ctx) {
        ctx.commit(function () { legacy.write(ctx.node, key, v); });
        refreshComponentRender(ctx.node);
        markDirty();
    }
};
