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
    return { route: route, runtimeScripts: runtimeScripts };
};
