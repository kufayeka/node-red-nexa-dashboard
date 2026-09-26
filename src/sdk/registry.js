// --- NEXA component registry (single source for editor AND runtime) --------
// Bundled into the editor bundle, the SDK bundle (dist/nexa-sdk.bundle.js)
// and the deployed page's /nexa/_registry.js — whichever runs first creates
// window.NEXA, the others get the same object back (ensureRegistry is
// idempotent). This replaces the two hand-kept copies that used to drift
// apart (src/registry.js vs lib/nexa-registry-client.js).
//
// Plugins may run BEFORE any of those (the editor loads plugin .html files
// in no guaranteed order), so they talk to a shim and the real registry
// drains its queues here:
//   legacy:  window.NEXA._q = [[id, def], ...]        (NEXA.registerComponent)
//   SDK:     window.NEXA._c = [def, ...]               (NEXA.defineComponent)
// SDK plugins are ES modules that import sdk/nexa-component-sdk.js (it waits
// for the SDK), so they never see a shim. A plain <script> plugin can queue
// with this one-liner instead (it keeps the legacy queue too, so an old
// plugin loading after it still finds NEXA.registerComponent):
//   var NEXA = window.NEXA = window.NEXA || { _q: [], registerComponent: function (id, d) { this._q.push([id, d]); } }; NEXA.defineComponent = NEXA.defineComponent || function (d) { (NEXA._c = NEXA._c || []).push(d); };

function normalizeEvents(events) {
    return (events || []).map(function (e) {
        return typeof e === "string" ? { name: e, label: "On " + e } : { name: e.name, label: e.label || ("On " + e.name) };
    });
}

export function ensureRegistry() {
    var w = window;
    if (w.NEXA && w.NEXA.__nexaRegistry) return w.NEXA;
    var shim = w.NEXA || {};
    var pendingDefs = shim._q || [];
    var pendingSdkDefs = shim._c || [];
    var registry = {};
    var listeners = [];
    var api = {
        __nexaRegistry: true,
        registerComponent: function (id, def) {
            registry[id] = def;
            listeners.forEach(function (fn) {
                try { fn(id, def); } catch (e) { /* a listener must not break registration */ }
            });
        },
        onRegister: function (fn) {
            listeners.push(fn);
        },
        getComponent: function (id) {
            return registry[id];
        },
        getComponents: function () {
            return Object.keys(registry).map(function (id) {
                var def = registry[id];
                return {
                    id: id,
                    category: def.category || "General",
                    label: def.label || id,
                    icon: def.icon,
                    defaultSize: def.defaultSize || { w: 100, h: 60 },
                    capabilities: def.capabilities || {},
                    defaults: def.defaults || {},
                    bindable: def.bindable || [],
                    render: def.render,
                    onBind: def.onBind,
                    events: normalizeEvents(def.events)
                };
            });
        },
        // SDK entry point for plain scripts. Queued until the SDK runtime
        // installs its compiler (see src/sdk/component.js).
        defineComponent: function (def) {
            if (api._defineComponent) return api._defineComponent(def);
            api._c.push(def);
            return undefined;
        },
        _c: [],
        _defineComponent: null,
        // Called once by the SDK runtime: from now on NEXA.defineComponent compiles immediately.
        _installComponentCompiler: function (fn) {
            api._defineComponent = fn;
            var queued = api._c.splice(0);
            queued.forEach(function (def) {
                try { fn(def); } catch (e) { console.error("[nexa] component \"" + (def && def.id) + "\" failed to register:", e); }
            });
        }
    };
    w.NEXA = api;
    pendingDefs.forEach(function (item) { api.registerComponent(item[0], item[1]); });
    pendingSdkDefs.forEach(function (item) { api._c.push(item); });
    return api;
}
