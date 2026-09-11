// Standalone copy of the SAME bootstrap embedded inline in nexa-plugin.html
// (editor context). Deliberately duplicated rather than shared via one
// <script src> for both: the editor's copy is proven/stable and loaded via
// the admin /plugins bundle (a filesystem read, not an HTTP fetch — it has
// no use for a servable file), while THIS file exists specifically to be
// fetched by deployed runtime pages (served publicly on RED.httpNode — see
// the "/nexa/_registry.js" route in nexa-plugin.js). Keeping them separate
// avoids risking the already-tested editor bootstrap while wiring up the
// runtime. If they ever need to diverge (e.g. runtime-only capabilities),
// that's one more reason not to force them to share one file.
(function () {
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
                    events: def.events || []
                };
            });
        }
    };
    pendingQueue.forEach(function (item) { window.NEXA.registerComponent(item[0], item[1]); });
})();
