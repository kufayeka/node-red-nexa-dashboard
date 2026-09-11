// --- NEXA component registry -------------------------------------------
// Component plugins call NEXA.registerComponent(id, def) from their own
// .html — see @kufayeka/nexa-component-basic-shapes for real examples.
export function initNexaRegistry() {
    var pendingQueue = (window.NEXA && window.NEXA._q) || [];
    var registry = {};
    window.NEXA = {
        registerComponent: function (id, def) {
            registry[id] = def;
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
                    events: (def.events || []).map(function (e) {
                        return typeof e === "string" ? { name: e, label: "On " + e } : { name: e.name, label: e.label || ("On " + e.name) };
                    })
                };
            });
        }
    };
    pendingQueue.forEach(function (item) { window.NEXA.registerComponent(item[0], item[1]); });
}

// Initialize immediately so window.NEXA is always present
initNexaRegistry();
