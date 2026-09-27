// --- Variables of a screen / group / frame (property kit) -----------------------
// { id, name, type, defaultValue } — the same shape as a template's params.
// Anything inside the owner binds to one as {name} (nearest declaration wins,
// see src/model/scope.js); the Logic "Set Variable" node changes it live.
import { state, getActiveScreen, markDirty, genId, Scope, Types, getApp, isNodeLocked } from "../state.js";
import { pushHistory } from "../history.js";
import { redrawCanvas } from "../canvas/canvas-ui.js";

var TYPES = ["string", "number", "boolean", "object", "array", "color"];

// A variable of a type (UDT) is an instance: its "Default" is the parameters, "Device=M101, Group=G1".
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
        try { var v = t.trim() ? JSON.parse(t) : (type === "array" ? [] : {}); return v; } catch (e) { return type === "array" ? [] : {}; }
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

var PERSIST = [{ value: "none", label: "this page" }, { value: "session", label: "tab session" }, { value: "local", label: "browser (kept)" }];

/**
 * The Variables block for `owner`: a container node, the screen (`kind` true /
 * "screen") or the app ("app": the project config node — variables every
 * screen shares, optionally persisted). Returns false without the property kit.
 */
export function renderVariablesInspector(container, owner, kind) {
    if (!window.NexaKit || !window.NEXA_LIT) return false;
    var html = window.NEXA_LIT.html;
    var isApp = kind === "app";
    var isSurface = kind === true || kind === "screen" || isApp;
    var view = function () {
        return { variables: (owner.variables || []).map(function (v) {
            var it = { name: v.name, type: v.type || "string", value: Types.isTypeRef(v.type) ? showParams(v.params) : show(v.defaultValue, v.type) };
            if (isApp) it.persist = v.persist || "none";
            return it;
        }) };
    };
    var fields = {
        name: { type: "string", label: "Name", default: "" },
        type: { type: "enum", label: "Type", default: "string", options: typeOptions() },
        value: { type: "string", label: "Default", default: "" }
    };
    if (isApp) fields.persist = { type: "enum", label: "Kept for", default: "none", options: PERSIST };
    // the kit reads this object: kept in step with owner.variables after every edit
    var current = view();
    var meta = {
        id: "@variables", stateList: [], inputs: [], outputs: [],
        props: {
            variables: {
                key: "variables", type: "list", label: "", default: [], noReset: true,
                item: { row: !isApp, fields: fields }
            }
        },
        inspector: function (o) {
            var problems = variableProblems(owner.variables);
            return html`<nx-section heading="${isApp ? "App variables (every screen)" : "Variables"}" persist-key="${isApp ? "nexa-app-variables" : "nexa-variables"}">
                <div class="nx-help" style="margin-bottom:6px">${isApp
                    ? "Shared by every screen (global state). \"Kept for\" a tab session or the browser keeps the value across pages / reloads. Bind with {name}; set it with Set Variable, watch it with On Variable Change."
                    : "Bind with {name} in the props of anything " + (isSurface ? "on this screen" : "inside") + "; the nearest declaration wins. Change one live with the Logic \"Set Variable\" node."}</div>
                ${problems.map(function (p) { return html`<nx-alert tone="warning" text="${p}"></nx-alert>`; })}
                <nx-list ${o.bind("variables")}></nx-list>
            </nx-section>`;
        }
    };
    var handle = window.NexaKit.renderInspector(container.jquery ? container.get(0) : container, {
        meta: meta,
        props: current,
        persistKey: "nexa-variables",
        set: function (key, items) {
            if (!isSurface && isNodeLocked(owner.id)) return;
            var old = owner.variables || [];
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
            if (next.length || isApp) owner.variables = next; else delete owner.variables;
            var screen = getActiveScreen();
            if (!isSurface && screen) pushHistory({ t: "node", screenId: screen.id, id: owner.id, key: "variables", from: before, to: next.length ? JSON.parse(JSON.stringify(next)) : undefined });
            markDirty();
            current.variables = view().variables;
            handle.update();
            redrawCanvas();                 // {name} bindings show the new defaults; the panel stays
        }
    });
    return true;
}
