// --- Types tab: types (UDT — a class for data) and their app instances ----------
// A type: params (Group, Device…), members (name, data type — or another type —,
// default, unit, read / read-write, and a source: a tag address with {Param}s).
// An instance is a variable of the type: the "Instances" list here makes APP
// variables (every screen sees them); a screen / group / frame can declare its
// own in its Variables list with the type as the variable's type.
// See src/model/types.js and docs/TYPES.md.
import { state, markDirty, genId, getApp, Types, Scope } from "../state.js";
import { redrawCanvas } from "../canvas/canvas-ui.js";

var BASE_TYPES = ["number", "boolean", "string", "object", "array", "color"];
var selectedId = null;

function lit() { return window.NEXA_LIT; }

function typeRefOptions(exceptId) {
    return BASE_TYPES.map(function (t) { return { value: t, label: t }; })
        .concat((getApp().types || []).filter(function (t) { return t.id !== exceptId; }).map(function (t) { return { value: "type:" + t.id, label: t.name + " (type)" }; }));
}

function uniqueName(base, list) {
    var n = 1, name = base;
    while (list.some(function (x) { return x.name === name; })) name = base + (++n);
    return name;
}

function changed() {
    markDirty();
    redrawCanvas();   // bindings to instances show the change; the panel stays
}

export function renderTypesPanel() {
    var pane = state.typesPane;
    if (!pane) return;
    pane.empty();
    var app = getApp();
    if (!window.NexaKit || !lit()) {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("The Types tab needs the Nexa property kit.").appendTo(pane);
        return;
    }
    var types = app.types;
    if (!types.some(function (t) { return t.id === selectedId; })) selectedId = types[0] ? types[0].id : null;
    var type = types.filter(function (t) { return t.id === selectedId; })[0] || null;

    // ---- the type picker + add / delete
    var bar = window.$("<div>", { "class": "nx-kit" }).css({ display: "flex", gap: "6px", "align-items": "center", "margin-bottom": "8px" }).appendTo(pane);
    var sel = window.$("<select>").css({ flex: "1" }).appendTo(bar);
    if (!types.length) window.$("<option>").text("(no types yet)").appendTo(sel);
    types.forEach(function (t) { window.$("<option>", { value: t.id }).text(t.name).appendTo(sel); });
    sel.val(selectedId || "");
    sel.on("change", function () { selectedId = sel.val(); renderTypesPanel(); });
    window.$("<button>", { type: "button", "class": "nx-btn", title: "New type" }).html('<i class="fa fa-plus"></i> Type').appendTo(bar).on("click", function () {
        var t = { id: genId(), name: uniqueName("Motor", types), params: [{ id: genId(), name: "Device", defaultValue: "" }], members: [] };
        types.push(t);
        selectedId = t.id;
        changed();
        renderTypesPanel();
    });
    if (type) {
        window.$("<button>", { type: "button", "class": "nx-icon-btn", title: "Delete this type" }).html('<i class="fa fa-trash-o"></i>').appendTo(bar).on("click", function () {
            var users = app.variables.filter(function (v) { return v.type === "type:" + type.id; }).length;
            if (users && !window.confirm(type.name + " has " + users + " app instance(s). Delete the type anyway? (The instances stay, without a type.)")) return;
            types.splice(types.indexOf(type), 1);
            changed();
            renderTypesPanel();
        });
    }
    window.$("<div>").css({ "font-size": "11px", color: "var(--red-ui-secondary-text-color, #888)", "margin-bottom": "8px" })
        .text("A type is a class for data: members (with defaults, or a tag address using the type's parameters) that every instance shares. Bind {M101.Speed}; pass {M101} to a template param.")
        .appendTo(pane);
    if (!type) return;

    // ---- the type itself: name, params, members (a live view: edits don't rebuild the panel)
    var host = window.$("<div>").appendTo(pane).get(0);
    var view = function () {
        return {
            name: type.name,
            params: (type.params || []).map(function (p) { return { name: p.name, value: p.defaultValue === undefined ? "" : String(p.defaultValue) }; }),
            members: (type.members || []).map(function (m) {
                return { name: m.name, dataType: m.dataType || "number", value: m.defaultValue === undefined ? "" : (typeof m.defaultValue === "object" ? JSON.stringify(m.defaultValue) : String(m.defaultValue)),
                    unit: m.unit || "", access: m.access || "read", source: m.source || "" };
            })
        };
    };
    var current = view();
    var memberProblems = function () {
        var problems = [], names = {};
        (type.members || []).forEach(function (m) {
            if (!Scope.NAME_RE.test(m.name || "")) problems.push("member \"" + (m.name || "") + "\": letters, digits, _ or $, not starting with a digit");
            else if (names[m.name]) problems.push("member \"" + m.name + "\" twice");
            names[m.name] = true;
        });
        return problems.join(" · ") || null;
    };
    var meta = {
        id: "@type", stateList: [], inputs: [], outputs: [], groupOrder: ["Type", "Parameters", "Members"],
        props: {
            name: { key: "name", type: "string", group: "Type", label: "Type name", default: "", noReset: true },
            params: { key: "params", type: "list", group: "Parameters", label: "Parameters", default: [], noReset: true, noun: "parameter", itemLabel: "name",
                help: "Filled in per instance, used in the members' sources as {Name}. Built in: {InstanceName}, {ParentInstanceName}.",
                item: { row: true, fields: {
                name: { type: "string", label: "Parameter", default: "" }, value: { type: "string", label: "Default", default: "" } } } },
            members: { key: "members", type: "list", group: "Members", label: "Members", default: [], noReset: true, noun: "member", itemLabel: "name",
                validate: memberProblems,
                item: { fields: {
                name: { type: "string", label: "Member", default: "" },
                dataType: { type: "enum", label: "Data type", default: "number", options: typeRefOptions(type.id) },
                source: { type: "string", label: "Tag (with {Params}); empty = a value", placeholder: "{sparkplug:{Group}::{Node}::{Device}::Speed}", default: "" },
                value: { type: "string", label: "Default (a value member)", default: "" },
                unit: { type: "string", label: "Unit", default: "" },
                access: { type: "enum", label: "Access", default: "read", options: [{ value: "read", label: "read" }, { value: "readwrite", label: "read / write" }] } } } }
        }
    };
    var handle = window.NexaKit.renderInspector(host, {
        meta: meta, props: current, persistKey: "nexa-type",
        set: function (key, v) {
            if (key === "name") type.name = String(v || "").trim() || type.name;
            if (key === "params") {
                var oldP = type.params || [];
                type.params = (v || []).map(function (it, i) { return { id: (oldP[i] && oldP[i].id) || genId(), name: String(it.name || "").trim() || ("Param" + (i + 1)), defaultValue: it.value }; });
            }
            if (key === "members") {
                var oldM = type.members || [];
                type.members = (v || []).map(function (it, i) {
                    var dt = it.dataType || "number";
                    var def = it.value;
                    if (dt === "number") def = def === "" || def === undefined ? 0 : (isFinite(Number(def)) ? Number(def) : 0);
                    else if (dt === "boolean") def = def === true || def === "true";
                    else if (dt === "object" || dt === "array") { try { def = def ? JSON.parse(def) : (dt === "array" ? [] : {}); } catch (e) { def = dt === "array" ? [] : {}; } }
                    return { id: (oldM[i] && oldM[i].id) || genId(), name: String(it.name || "").trim() || ("member" + (i + 1)), dataType: dt,
                        defaultValue: Types.isTypeRef(dt) ? undefined : def, unit: it.unit || "", access: it.access === "readwrite" ? "readwrite" : "read", source: String(it.source || "").trim() };
                });
            }
            Object.keys(current).forEach(function (k) { delete current[k]; });
            Object.assign(current, view());
            handle.update();
            changed();
            // the type's name / params show in the picker and the instance columns
            if (key === "name") sel.find('option[value="' + type.id + '"]').text(type.name);
            if (key === "params") renderInstances();
        }
    });

    // ---- app instances of this type: one column per parameter
    var instHost = window.$("<div>").css({ "margin-top": "10px" }).appendTo(pane).get(0);
    function renderInstances() {
        instHost.innerHTML = "";
        var params = type.params || [];
        var fields = { name: { type: "string", label: "Instance", default: "" } };
        params.forEach(function (p) { fields["p_" + p.name] = { type: "string", label: p.name, default: p.defaultValue === undefined ? "" : String(p.defaultValue) }; });
        var mine = function () { return app.variables.filter(function (v) { return v.type === "type:" + type.id; }); };
        var iview = function () {
            return { instances: mine().map(function (v) {
                var row = { name: v.name };
                params.forEach(function (p) { row["p_" + p.name] = v.params && v.params[p.name] !== undefined ? String(v.params[p.name]) : ""; });
                return row;
            }) };
        };
        var icurrent = iview();
        var ih = window.NexaKit.renderInspector(instHost, {
            meta: { id: "@instances", stateList: [], inputs: [], outputs: [], props: {
                instances: { key: "instances", type: "list", group: "Instances (app — every screen)", label: "Instances", default: [], noReset: true, noun: "instance", itemLabel: "name",
                    help: "Each is an app variable of type " + type.name + ": bind {name.Member}. A screen / frame can declare its own instance in its Variables list.",
                    item: { row: params.length < 3, fields: fields } } } },
            props: icurrent, persistKey: "nexa-type-instances",
            set: function (key, rows) {
                var old = mine();
                var others = app.variables.filter(function (v) { return v.type !== "type:" + type.id; });
                var next = (rows || []).map(function (r, i) {
                    var p = {};
                    params.forEach(function (x) { if (r["p_" + x.name] !== undefined && r["p_" + x.name] !== "") p[x.name] = r["p_" + x.name]; });
                    var prev = old[i] || {};
                    return { id: prev.id || genId(), name: String(r.name || "").trim() || uniqueName(type.name.replace(/\W/g, "") + "_", others), type: "type:" + type.id, params: p, overrides: prev.overrides || {} };
                });
                app.variables = others.concat(next);
                Object.keys(icurrent).forEach(function (k) { delete icurrent[k]; });
                Object.assign(icurrent, iview());
                ih.update();
                changed();
            }
        });
    }
    renderInstances();
}
