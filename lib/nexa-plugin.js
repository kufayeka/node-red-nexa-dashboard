// Each Node-RED plugin gets its OWN fresh `RED` api object (see
// @node-red/registry/lib/util.js createNodeApi) — never read `RED.asset`
// here, it won't be there. getAssetController(RED) is the exported escape
// hatch: it returns the one real module-scoped AssetDomainController
// singleton regardless of which RED object calls it. No changes to
// node-red-asset-engine are made or required.
const { getAssetController } = require("@kufayeka/node-red-asset-engine/lib/asset-plugin.js");
const { getCurrentProject } = require("../nodes/nexa-project.js");
const { getCurrentSparkplugNode } = require("../nodes/nexa-sparkplug.js");
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
    "window.__NEXA_QUERY__ = " + safeJsonForScript(query) + ";" +
    // A screen's own path can be nested arbitrarily deep (e.g.
    // "/plant/:id/overview"), so a RELATIVE "_sparkplug-stream" request from
    // this page would resolve against THAT depth, not RUNTIME_PREFIX's root
    // — this constant is what nexa-runtime-client.js's
    // setUpSparkplugLiveBinding actually requests against, always as an
    // absolute path.
    "window.__NEXA_RUNTIME_PREFIX__ = " + safeJsonForScript(RUNTIME_PREFIX) + ";</script>" +
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

      // --- Nexa's own MQTT Sparkplug connection (kufayeka-nexa-sparkplug) —
      // independent of the Asset Engine subscription above. Re-checked on
      // every "flows:started" (fires on every deploy, including the very
      // first one that creates this config node) rather than once, since
      // the node may not exist yet the first time this plugin loads, and a
      // later redeploy can also replace it with a fresh instance (new
      // broker settings) — re-wiring only actually happens when the
      // instance in hand has changed.
      let sparkplugUnsubscribe = null;
      let wiredSparkplugNode = null;

      function wireSparkplugSubscription() {
        const sparkplugNode = getCurrentSparkplugNode();
        if (sparkplugNode === wiredSparkplugNode) return;
        if (sparkplugUnsubscribe) {
          sparkplugUnsubscribe();
          sparkplugUnsubscribe = null;
        }
        wiredSparkplugNode = sparkplugNode;
        if (!sparkplugNode) return;
        sparkplugUnsubscribe = sparkplugNode.subscribeTree(function (delta) {
          if (RED.comms && RED.comms.publish) {
            RED.comms.publish("nexa/sparkplug/delta", delta);
          }
        });
        log.info("[kufayeka-nexa-dashboard] subscribed to Nexa Sparkplug connection (live values -> nexa/sparkplug/delta)");
      }
      RED.events.on("flows:started", wireSparkplugSubscription);

      // Lit vendor bundle for the EDITOR's own "@lit-component" preview
      // rendering (lib/nexa-plugin.html loads this via a plain <script src>
      // — see build.js and src/lit-vendor.js for why it's not folded into
      // the editor's own ES-module bundle). RED.httpAdmin only serves the
      // authenticated admin UI, so this is separate from the RED.httpNode
      // "_lit-vendor.js" route below, which serves deployed public pages.
      if (RED.httpAdmin) {
        RED.httpAdmin.get("/nexa-dashboard/_lit-vendor.js", function (req, res) {
          res.type("application/javascript");
          res.sendFile(path.join(__dirname, "..", "dist", "nexa-lit-vendor.bundle.js"));
        });

        // Editor's "MQTT Sparkplug" sidebar tab fetches this ONCE on open
        // for its initial tree (RED.comms only delivers deltas from here on,
        // not history) — see src/canvas/sparkplug-live.js.
        RED.httpAdmin.get("/nexa-dashboard/_sparkplug-tree", function (req, res) {
          const sparkplugNode = getCurrentSparkplugNode();
          res.json(sparkplugNode ? sparkplugNode.getSnapshot() : {});
        });

        // Manual "Rebirth / Refresh" button (src/sidebar/sparkplug-panel.js)
        // — see nodes/nexa-sparkplug.js's requestRebirthAll() for why this
        // needs to exist at all even though the listener also auto-requests
        // a rebirth on its own: NBIRTH/DBIRTH are one-shot, not
        // broker-retained, so a user should always be able to force a fresh
        // one on demand, not just wait for the automatic recovery path.
        RED.httpAdmin.post("/nexa-dashboard/_sparkplug-rebirth", function (req, res) {
          const sparkplugNode = getCurrentSparkplugNode();
          if (!sparkplugNode) {
            res.status(404).json({ error: "No Nexa Sparkplug connection configured yet." });
            return;
          }
          const count = sparkplugNode.requestRebirthAll();
          res.json({ requested: count });
        });
      }

      // --- Deployed-page runtime. STATIC rendering plus, for a component
      // bound to a Sparkplug metric, LIVE value updates via the SSE stream
      // below — RED.comms itself is scoped to the authenticated editor and
      // can never reach a public deployed page, so this is a separate,
      // deliberately minimal, unauthenticated push channel of its own.
      // General Asset Engine tag binding for deployed pages remains
      // unwired (a bigger, separate piece of work — see the README).
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
          res.sendFile(path.join(__dirname, "..", "dist", "nexa-lit-vendor.bundle.js"));
        });

        // One-shot initial state for a deployed page's Sparkplug-bound
        // components, fetched once on load (before/alongside opening the
        // SSE stream below) — without this, every such component would show
        // "???" until the NEXT value change happened to arrive.
        RED.httpNode.get(RUNTIME_PREFIX + "/_sparkplug-snapshot", function (req, res) {
          const sparkplugNode = getCurrentSparkplugNode();
          res.json(sparkplugNode ? sparkplugNode.getSnapshot() : {});
        });

        // Write-back for the Screen Logic graph's "Sparkplug Write"/
        // "Sparkplug Write Multi" nodes (lib/nexa-runtime-client.js) — a
        // deployed page runs in the browser and has no way to reach
        // nodes/nexa-sparkplug.js's own MQTT client directly, only over
        // HTTP. Body: { groupId, edgeNodeId, deviceId?, metrics: [{name,
        // value}, ...] } — deviceId omitted/falsy publishes a node-scoped
        // NCMD instead of a DCMD, mirroring requestRebirth's own NCMD/DCMD
        // choice. No request body parser is registered on RED.httpNode by
        // Node-RED itself (unlike RED.httpAdmin), so the body is read and
        // parsed by hand here rather than assuming one exists.
        //
        // Deliberately UNAUTHENTICATED for now, same as every other
        // RED.httpNode route in this file — this means ANYONE who can reach
        // the deployed page's URL can write to ANY tag this connection can
        // reach. Fine for development/testing (the reason this is being
        // shipped as-is), but a REAL production deployment needs this
        // gated — Node-RED's own HTTP Node auth (separate from admin auth,
        // see Node-RED's own settings.js httpNodeMiddleware/httpNodeAuth
        // docs) is the natural fit, or an allow-list of which tags a given
        // screen may write to. Not done here on purpose — flagging it
        // loudly instead of silently shipping something that LOOKS secure.
        RED.httpNode.post(RUNTIME_PREFIX + "/_sparkplug-write", function (req, res) {
          var chunks = [];
          req.on("data", function (c) { chunks.push(c); });
          req.on("error", function () {
            res.status(400).json({ error: "Request body read error." });
          });
          req.on("end", function () {
            var body;
            try {
              body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            } catch (e) {
              res.status(400).json({ error: "Invalid JSON body." });
              return;
            }
            const sparkplugNode = getCurrentSparkplugNode();
            if (!sparkplugNode) {
              res.status(404).json({ error: "No Nexa Sparkplug connection configured yet." });
              return;
            }
            var metrics = Array.isArray(body.metrics) ? body.metrics : [];
            if (!body.groupId || !body.edgeNodeId || !metrics.length) {
              res.status(400).json({ error: "groupId, edgeNodeId, and at least one metric are required." });
              return;
            }
            var ok = sparkplugNode.writeMetrics(
              String(body.groupId), String(body.edgeNodeId), body.deviceId ? String(body.deviceId) : null,
              metrics.map(function (m) { return { name: String(m.name), value: m.value }; })
            );
            res.json({ ok: ok });
          });
        });

        // Plain Server-Sent Events — deliberately NOT a WebSocket/Socket.IO
        // channel: SSE needs nothing but a GET request and the browser's
        // native EventSource, no client library to ship to a page that's
        // meant to stay "plain vanilla JS" (see nexa-runtime-client.js's own
        // header comment), and it's one-directional, which is all a passive
        // Sparkplug value stream ever needs to be.
        RED.httpNode.get(RUNTIME_PREFIX + "/_sparkplug-stream", function (req, res) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no" // disable nginx's own response buffering, if this is ever proxied through one
          });
          res.write(": connected\n\n");

          let sparkplugNode = getCurrentSparkplugNode();
          let unsubscribe = null;
          function subscribeToCurrentNode() {
            if (unsubscribe) { unsubscribe(); unsubscribe = null; }
            if (sparkplugNode) {
              unsubscribe = sparkplugNode.subscribeTree(function (delta) {
                res.write("data: " + JSON.stringify(delta) + "\n\n");
              });
            }
          }
          subscribeToCurrentNode();

          // Detects a redeploy that replaced the connection node instance —
          // editing kufayeka-nexa-sparkplug's own settings (broker URL,
          // filters) closes the OLD node and creates a fresh one (new
          // empty tree, new mqtt client); an already-open SSE connection
          // has no other way to notice this, since it only ever
          // subscribed to the instance that existed when it first
          // connected. A real reported bug: without this, an unattended
          // deployed screen left open across such a redeploy would just
          // silently stop receiving anything, forever, with no error.
          // Checked far more often than the keepalive ping below since
          // it's a cheap in-memory reference comparison, not real I/O.
          const resyncCheck = setInterval(function () {
            const latest = getCurrentSparkplugNode();
            if (latest !== sparkplugNode) {
              sparkplugNode = latest;
              subscribeToCurrentNode();
              // Named event (vs. the default "message") so the client can
              // tell "the underlying connection changed, re-fetch a full
              // snapshot" apart from an ordinary metric delta — see
              // nexa-runtime-client.js's "resync" listener.
              res.write("event: resync\ndata: {}\n\n");
            }
          }, 3000);
          // Comment-only keepalive so intermediary proxies/load balancers
          // don't silently time out and drop an otherwise-idle connection.
          const keepAlive = setInterval(function () { res.write(": ping\n\n"); }, 25000);
          req.on("close", function () {
            clearInterval(resyncCheck);
            clearInterval(keepAlive);
            if (unsubscribe) unsubscribe();
          });
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
          if (matchedScreen.disabled) {
            return res.status(404).send("Nexa screen is disabled: " + subPath);
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
