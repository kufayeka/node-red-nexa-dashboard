// Nexa Scope Hierarchy
// Scopes chain: $route -> Shared Scope -> App Scope -> Screen Scope -> Container Scopes.
import { state, PERSIST_PREFIX } from "../state.js";
import { resolveBindableValue } from "./variable.js";
import { refreshComponentRender, updateInstanceParam } from "../mounting/render.js";
import { registerSparkplugBoundComponentsFrom } from "../io/sparkplug.js";
import { isStructural } from "../mounting/slots.js";
import { markScopeLayer } from "../../model/binding.js";

export function storeFor(kind) {
    try {
        return kind === "local" ? window.localStorage : kind === "session" ? window.sessionStorage : null;
    } catch (e) {
        return null;
    }
}

export function makeRoute() {
    const loc = window.location || {};
    return {
        params: window.__NEXA_PARAMS__ || {},
        query: window.__NEXA_QUERY__ || {},
        path: loc.pathname || "",
        hash: (loc.hash || "").replace(/^#/, "")
    };
}

export function makeScope(parent, variables) {
    if (window.NexaModel) return window.NexaModel.makeScope(parent, variables);
    const scope = Object.create(parent || null);
    (variables || []).forEach(function (v) {
        if (v && v.name) scope[v.name] = v.defaultValue;
    });
    return scope;
}

export function hasVariables(node) {
    return !!(node && Array.isArray(node.variables) && node.variables.length);
}

export function makeSharedScope(app) {
    if (!state.currentSharedScope) {
        const root = Object.create(null);
        root.$route = makeRoute();
        state.currentSharedScope = makeScope(root, (app && app.sharedVariables) || []);
        state.currentSharedScope.__isSharedScope = true;
        markScopeLayer(state.currentSharedScope, "shared");
    } else if (app && Array.isArray(app.sharedVariables)) {
        app.sharedVariables.forEach(function (v) {
            if (v && v.name && !(v.name in state.currentSharedScope)) {
                state.currentSharedScope[v.name] = v.defaultValue;
            }
        });
    }
    return state.currentSharedScope;
}

export function makeAppScope(app) {
    const shared = state.currentSharedScope || makeSharedScope(app);
    const scope = markScopeLayer(makeScope(shared, app.variables), "app");
    scope.__persist = {};
    (app.variables || []).forEach(function (v) {
        if (!v || !v.name || !storeFor(v.persist)) return;
        scope.__persist[v.name] = v.persist;
        try {
            const raw = storeFor(v.persist).getItem(PERSIST_PREFIX + v.name);
            if (raw !== null) scope[v.name] = JSON.parse(raw);
        } catch (e) { /* unreadable: the default stays */ }
    });
    state.currentAppScope = scope;
    return scope;
}

export function resolveScope(screen, scopeId, nodeId) {
    const i = (nodeId || "").lastIndexOf("::");
    const instanceNs = i === -1 ? "" : nodeId.slice(0, i);
    const scopes = screen.__scopes || {};
    if (scopeId === "@shared") return scopes["@shared"] || state.currentSharedScope || makeSharedScope(window.__NEXA_APP__ || {});
    if (scopeId === "@app") return scopes["@app"];
    if (scopeId) return scopes[instanceNs ? instanceNs + "::" + scopeId : scopeId];
    return instanceNs ? screen.__paramStates && screen.__paramStates[instanceNs] : scopes[""];
}

export function ownerOf(scope, name) {
    let s = scope;
    while (s && !Object.prototype.hasOwnProperty.call(s, name)) s = Object.getPrototypeOf(s);
    return s;
}

export function refreshScope(screen, scope) {
    if (!screen || !Array.isArray(screen.components)) return;
    screen.components.forEach(function (comp) {
        const s = comp.__paramState;
        if (!s || !(s === scope || Object.prototype.isPrototypeOf.call(scope, s))) return;
        if (isStructural(comp)) return;
        if (comp.type === "@template") {
            const instState = screen.__paramStates && screen.__paramStates[comp.id];
            if (!instState) return;
            Object.keys(comp.paramValues || {}).forEach(function (name) {
                const raw = comp.paramValues[name];
                if (typeof raw !== "string" || raw.indexOf("{") === -1) return;
                const resolved = resolveBindableValue(raw, s);
                if (resolved !== instState[name]) updateInstanceParam(screen, comp.id, name, resolved);
            });
            return;
        }
        refreshComponentRender(screen, comp);
    });
    // a variable may be part of a tag address ({sparkplug:...::{line}/x})
    registerSparkplugBoundComponentsFrom(screen);
}

export function resolveInstanceParamState(comp, template, enclosingParamState) {
    const paramState = Object.create(state.currentAppScope || Object.prototype);
    (template.variables || []).forEach(function (v) {
        if (v && v.name) paramState[v.name] = window.NexaModel ? window.NexaModel.variableValue(v) : v.defaultValue;
    });
    (template.params || []).forEach(function (p) {
        paramState[p.name] = p.defaultValue;
    });
    Object.keys(comp.paramValues || {}).forEach(function (name) {
        const raw = comp.paramValues[name];
        paramState[name] = (typeof raw === "string" && raw.indexOf("{") !== -1) ? resolveBindableValue(raw, enclosingParamState) : raw;
    });
    return paramState;
}
