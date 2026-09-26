// --- Variables of a screen / group / frame (property kit) -----------------------
// { id, name, type, defaultValue } — the same shape as a template's params.
// Anything inside the owner binds to one as {name} (nearest declaration wins,
// see src/model/scope.js); the Logic "Set Variable" node changes it live.
import { state, getActiveScreen, markDirty, genId, Scope, isNodeLocked } from "../state.js";
import { pushHistory } from "../history.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { selectOnly } from "../canvas/selection.js";

var TYPES = ["string", "number", "boolean", "object", "array", "color"];

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

/**
 * The Variables block for `owner` (a container node, or the surface itself
 * when `isSurface`). Returns false without the property kit.
 */
export function renderVariablesInspector(container, owner, isSurface) {
    if (!window.NexaKit || !window.NEXA_LIT) return false;
    var html = window.NEXA_LIT.html;
    var view = function () {
        return { variables: (owner.variables || []).map(function (v) { return { name: v.name, type: v.type || "string", value: show(v.defaultValue, v.type) }; }) };
    };
    var meta = {
        id: "@variables", stateList: [], inputs: [], outputs: [],
        props: {
            variables: {
                key: "variables", type: "list", label: "", default: [], noReset: true,
                item: { row: true, fields: {
                    name: { type: "string", label: "Name", default: "" },
                    type: { type: "enum", label: "Type", default: "string", options: TYPES.map(function (t) { return { value: t, label: t }; }) },
                    value: { type: "string", label: "Default", default: "" } } }
            }
        },
        inspector: function (o) {
            var problems = variableProblems(owner.variables);
            return html`<nx-section heading="Variables" persist-key="nexa-variables">
                <div class="nx-help" style="margin-bottom:6px">Bind with {name} in the props of anything ${isSurface ? "on this screen" : "inside"}; the nearest declaration wins. Change one live with the Logic "Set Variable" node.</div>
                ${problems.map(function (p) { return html`<nx-alert tone="warning" text="${p}"></nx-alert>`; })}
                <nx-list ${o.bind("variables")}></nx-list>
            </nx-section>`;
        }
    };
    var handle = window.NexaKit.renderInspector(container.jquery ? container.get(0) : container, {
        meta: meta,
        props: view(),
        persistKey: "nexa-variables",
        set: function (key, items) {
            if (!isSurface && isNodeLocked(owner.id)) return;
            var old = owner.variables || [];
            var next = (items || []).map(function (it, i) {
                var type = TYPES.indexOf(it.type) === -1 ? "string" : it.type;
                return { id: (old[i] && old[i].id) || genId(), name: String(it.name || "").trim() || ("var" + (i + 1)), type: type, defaultValue: parse(it.value, type) };
            });
            var before = old.length ? JSON.parse(JSON.stringify(old)) : undefined;
            if (next.length) owner.variables = next; else delete owner.variables;
            var screen = getActiveScreen();
            if (!isSurface && screen) pushHistory({ t: "node", screenId: screen.id, id: owner.id, key: "variables", from: before, to: next.length ? JSON.parse(JSON.stringify(next)) : undefined });
            markDirty();
            var keep = state.selectedIds.slice();
            renderActiveScreen();           // {name} bindings show the new defaults
            if (!isSurface && keep.length === 1) selectOnly(keep[0]);
            handle.update();
        }
    });
    return true;
}
