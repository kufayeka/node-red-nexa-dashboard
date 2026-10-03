// The backend half of a Nexa component plugin, in one call:
//
//   // widgets/my-plugin.js  (the file package.json "node-red.plugins" points at)
//   module.exports = function (RED) {
//       require("@kufayeka/node-red-nexa-dashboard/sdk/package")(RED, {
//           id: "acme-nexa-gauges",            // the Node-RED plugin id
//           name: "acme-nexa-gauges",          // URL segment: <root>/<name>/vendor/...
//           dir: require("path").join(__dirname, "..", "dist"),
//           modules: ["gauges.js"]             // ES modules importing nexa-component-sdk.js
//       });
//   };
//
// It serves `dir` at <root>/<name>/vendor/ on BOTH the editor (httpAdmin)
// and deployed pages (httpNode) — so a module there imports the SDK as
// "../../nexa-sdk/nexa-component-sdk.js" in both — with CORS (a deployed page
// runs on the screen worker's own port), and registers the package so the
// dashboard puts the modules on every deployed page. The editor side is the
// plugin's .html file next to this .js:
//   <script type="module" src="acme-nexa-gauges/vendor/gauges.js"></script>
// `scripts` (plain, non-module files) is accepted too.
//
// `adminApi(router, RED)`: the plugin's own routes for its editor side (a property editor's
// `this.api`, NexaSDK.adminApi(name)), mounted at <admin root>/<name>/api/ on the editor only,
// JSON bodies parsed, behind Node-RED's login: GET needs "flows.read", the rest "flows.write".
//   adminApi: (router) => { router.get("/curves", (req, res) => res.json([...])); }
// A handler that throws (or rejects) answers 500 { error }.
const express = require("express");

module.exports = function registerNexaComponentPackage(RED, opts) {
    if (!opts || !opts.id || !opts.name || !opts.dir) throw new Error("[nexa] sdk/package: { id, name, dir } are required");
    const route = "/" + opts.name + "/vendor";
    const runtimeScripts = []
        .concat((opts.scripts || []).map((f) => route + "/" + f))
        .concat((opts.modules || []).map((f) => ({ src: route + "/" + f, module: true })));
    const serve = express.static(opts.dir, {
        setHeaders: function (res) { res.set("Access-Control-Allow-Origin", "*"); }
    });
    RED.plugins.registerPlugin(opts.id, {
        type: "nexa-ui-component-package",
        runtimeScripts: runtimeScripts,
        onadd: function () {
            if (RED.httpAdmin) RED.httpAdmin.use(route, serve);
            if (RED.httpNode) RED.httpNode.use(route, serve);
        }
    });
    var apiRoute = null;
    if (typeof opts.adminApi === "function") {
        apiRoute = "/" + opts.name + "/api";
        const router = express.Router();
        router.use(express.json({ limit: "2mb" }));
        const can = function (perm) {
            return RED.auth && typeof RED.auth.needsPermission === "function" ? RED.auth.needsPermission(perm) : function (req, res, next) { next(); };
        };
        const read = can("flows.read"), write = can("flows.write");
        router.use(function (req, res, next) { (req.method === "GET" || req.method === "HEAD" ? read : write)(req, res, next); });
        // an async handler that rejects goes to the error handler below (Express 4 would hang)
        ["get", "post", "put", "patch", "delete"].forEach(function (m) {
            const orig = router[m].bind(router);
            router[m] = function (path) {
                const handlers = Array.prototype.slice.call(arguments, 1).map(function (h) {
                    if (typeof h !== "function" || h.length >= 4) return h;
                    return function (req, res, next) {
                        try { const r = h(req, res, next); if (r && typeof r.then === "function") r.catch(next); } catch (e) { next(e); }
                    };
                });
                return orig.apply(null, [path].concat(handlers));
            };
        });
        opts.adminApi(router, RED);
        router.use(function (err, req, res, next) { // eslint-disable-line no-unused-vars
            res.status(err && err.status || 500).json({ error: String(err && err.message || err) });
        });
        if (RED.httpAdmin) RED.httpAdmin.use(apiRoute, router);
    }
    return { route: route, runtimeScripts: runtimeScripts, apiRoute: apiRoute };
};
