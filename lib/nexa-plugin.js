// Each Node-RED plugin gets its OWN fresh `RED` api object (see
// @node-red/registry/lib/util.js createNodeApi) — never read `RED.asset`
// here, it won't be there. getAssetController(RED) is the exported escape
// hatch: it returns the one real module-scoped AssetDomainController
// singleton regardless of which RED object calls it. No changes to
// node-red-asset-engine are made or required.
const { getAssetController } = require("@kufayeka/node-red-asset-engine/lib/asset-plugin.js");
const { getCurrentProject } = require("../nodes/nexa-project.js");
const path = require("path");

// Screens (the "Nexa" project: screens + their components) are NOT a
// separate JSON file — they live on the kufayeka-nexa-project CONFIG NODE
// (see ../nodes/nexa-project.js), the same pattern node-red-asset-engine
// uses for its kufayeka-asset-schema config node. That means Node-RED's own
// Deploy/flows.json/export/import/Projects(git) already persists this data
// for free — no save endpoint needed here.

// Deployed screens are served under this prefix on RED.httpNode (the
// PUBLIC app — separate from RED.httpAdmin, which only the editor uses) —
// deliberately prefixed rather than mounted at each screen's raw path, so
// this can never collide with a user's own http-in nodes wired into their
// own flows on the same shared Node-RED instance. See the plan doc for why
// this needed its own decision.
const RUNTIME_PREFIX = "/nexa";

// Simple {param} path matcher — screen.path looks like "/plant/:id/overview".
// Not using Express's own path-to-regexp directly since it's only an
// undeclared transitive dependency here (via express) and this is simple
// enough to not need it: single-level ":name" segments, same length only.
function matchScreenPath(pattern, actualPath) {
  var patternParts = pattern.split("/").filter(Boolean);
  var actualParts = actualPath.split("/").filter(Boolean);
  if (patternParts.length !== actualParts.length) return null;
  var params = {};
  for (var i = 0; i < patternParts.length; i++) {
    if (patternParts[i].charAt(0) === ":") {
      params[patternParts[i].slice(1)] = decodeURIComponent(actualParts[i]);
    } else if (patternParts[i] !== actualParts[i]) {
      return null;
    }
  }
  return params;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// JSON embedded inside a <script> block needs "</script>" (and the rarer
// "<!--") neutralized, or a component's own text prop containing that
// literal string could prematurely close the tag — a classic reflected-data
// XSS vector, not hypothetical here since props are free-text editor input.
function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function renderScreenHtml(RED, screen, templates, params, query) {
  var componentScripts = [];
  (RED.plugins.getByType("nexa-ui-component-package") || []).forEach(function (pkg) {
    (pkg.runtimeScripts || []).forEach(function (src) {
      componentScripts.push('<script src="' + escapeHtml(src) + '"></script>');
    });
  });

  return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
    "<title>" + escapeHtml(screen.name) + "</title>" +
    "<style>html,body{margin:0;padding:0;background:#ccc;}" +
    "#nexa-runtime-artboard{position:relative;background:#fff;margin:20px auto;" +
    "box-shadow:0 4px 12px rgba(0,0,0,0.2);}</style>" +
    "</head><body>" +
    '<div id="nexa-runtime-artboard" style="width:' + screen.width + "px;height:" + screen.height + 'px;"></div>' +
    '<script src="' + RUNTIME_PREFIX + '/_registry.js"></script>' +
    // Lit runtime, loaded before _runtime.js so window.NEXA_LIT is available
    // by the time mountAndFlatten renders any "@lit-component" instance —
    // see src/lit-vendor.js and build.js for how this is built.
    '<script src="' + RUNTIME_PREFIX + '/_lit-vendor.js"></script>' +
    componentScripts.join("") +
    // __NEXA_TEMPLATES__ carries the project's Reusable Screen Templates
    // (see Phase 3 of the plan) — screen.components can reference one via a
    // "@template" component type + templateId, and nexa-runtime-client.js
    // resolves/mounts/flattens them recursively from this array. Templates
    // are project-level, not screen-level, so they're not part of `screen`
    // itself and need their own embed here.
    "<script>window.__NEXA_SCREEN__ = " + safeJsonForScript(screen) + ";" +
    "window.__NEXA_TEMPLATES__ = " + safeJsonForScript(templates || []) + ";" +
    "window.__NEXA_PARAMS__ = " + safeJsonForScript(params) + ";" +
    "window.__NEXA_QUERY__ = " + safeJsonForScript(query) + ";</script>" +
    '<script src="' + RUNTIME_PREFIX + '/_runtime.js"></script>' +
    "</body></html>";
}

module.exports = function(RED) {
  RED.plugins.registerPlugin("kufayeka-nexa-dashboard", {
    type: "node-red-runtime-plugin",
    onadd: function() {
      const log = RED.log || console;
      let unsubscribe = null;

      function wireAssetSubscription() {
        if (unsubscribe) return;
        let asset;
        try {
          asset = getAssetController(RED);
        } catch (e) {
          log.warn("[kufayeka-nexa-dashboard] asset engine not available: " + e.message);
          return;
        }
        unsubscribe = asset.subscribe(function(meta) {
          if (RED.comms && RED.comms.publish) {
            RED.comms.publish("nexa/value", meta);
          }
        });
        log.info("[kufayeka-nexa-dashboard] subscribed to Asset Engine changes (live values -> nexa/value)");
      }

      // Plugin load order isn't guaranteed — wire lazily once all
      // plugins/nodes have finished loading and flows have started.
      RED.events.on("flows:started", wireAssetSubscription);

      // Lit vendor bundle for the EDITOR's own "@lit-component" preview
      // rendering (lib/nexa-plugin.html loads this via a plain <script src>
      // — see build.js and src/lit-vendor.js for why it's not folded into
      // the editor's own ES-module bundle). RED.httpAdmin only serves the
      // authenticated admin UI, so this is separate from the RED.httpNode
      // "_lit-vendor.js" route below, which serves deployed public pages.
      if (RED.httpAdmin) {
        RED.httpAdmin.get("/nexa-dashboard/_lit-vendor.js", function (req, res) {
          res.type("application/javascript");
          res.sendFile(path.join(__dirname, "nexa-lit-vendor.bundle.js"));
        });
      }

      // --- Deployed-page runtime (roadmap phase, now underway). STATIC
      // rendering only for now — the screen's layout/components appear at
      // their URL, but live tag binding (onBind) isn't wired up yet, since
      // that needs its own comms channel (RED.comms is scoped to the
      // authenticated editor, not public viewers of a deployed page) —
      // that's the clearly-flagged next increment, not silently missing.
      if (RED.httpNode) {
        RED.httpNode.get(RUNTIME_PREFIX + "/_registry.js", function (req, res) {
          res.type("application/javascript");
          res.sendFile(path.join(__dirname, "nexa-registry-client.js"));
        });
        RED.httpNode.get(RUNTIME_PREFIX + "/_runtime.js", function (req, res) {
          res.type("application/javascript");
          res.sendFile(path.join(__dirname, "nexa-runtime-client.js"));
        });
        RED.httpNode.get(RUNTIME_PREFIX + "/_lit-vendor.js", function (req, res) {
          res.type("application/javascript");
          res.sendFile(path.join(__dirname, "nexa-lit-vendor.bundle.js"));
        });

        RED.httpNode.get(RUNTIME_PREFIX + "/*", function (req, res) {
          const project = getCurrentProject();
          if (!project) {
            return res.status(404).send("Nexa project not found — has it been deployed at least once?");
          }
          const subPath = "/" + (req.params[0] || "");
          let matchedScreen = null;
          let matchedParams = null;
          for (const screen of project.screens || []) {
            const m = matchScreenPath(screen.path, subPath);
            if (m) { matchedScreen = screen; matchedParams = m; break; }
          }
          if (!matchedScreen) {
            return res.status(404).send("No Nexa screen found for path: " + subPath);
          }
          res.send(renderScreenHtml(RED, matchedScreen, project.templates, matchedParams, req.query || {}));
        });

        log.info("[kufayeka-nexa-dashboard] serving deployed screens under " + RUNTIME_PREFIX + "/*");
      }
    },
    onremove: function() {
      // no persistent resources created outside the running process
    }
  });
};
