const { createDeltaBatcher } = require("./sparkplug/deltaBatcher.js");
const { getCurrentProject } = require("../nodes/nexa-project.js");
const { Worker } = require("worker_threads");
const path = require("path");

// Deployed-screen HTTP server (rendering, static assets, SSE, write-back)
// runs in its OWN worker thread on its OWN dedicated port — see
// lib/screen-worker.js's header for why (CPU-contention isolation between
// Node-RED flow execution and dashboard-serving, not a "something was slow"
// fix). Overridable via RED.settings.nexaDashboard.screenWorkerPort.
const DEFAULT_SCREEN_WORKER_PORT = 1881;

// How often the editor's Sparkplug tree gets a (merged) delta batch over
// RED.comms — see lib/sparkplug/deltaBatcher.js.
const EDITOR_DELTA_BATCH_MS = 75;

// Test-only seam: a real worker_threads.Worker can't be driven by faking
// require(...) in the TEST process (a worker has its own, independent
// module registry) — so tests substitute this factory instead, same spirit
// as nodes/nexa-sparkplug.js's own _setWorkerFactoryForTests. Never
// overridden outside tests.
var screenWorkerFactory = function (workerData) {
    return new Worker(path.join(__dirname, "screen-worker.js"), { workerData: workerData });
};
function _setScreenWorkerFactoryForTests(fn) { screenWorkerFactory = fn; }

// kufayeka-nexa-sparkplug is a REAL, multi-instance Node-RED config node
// (like @kufayeka/node-red-asset-engine's kufayeka-sparkplug-edge-node) —
// several can exist, each independently connected. Which one is "active"
// for a given project is just a normal config-node reference, picked via
// the project's own "Sparkplug Connection" field (nodes/nexa-project.js/
// .html) — resolved the same way any node resolves a config-node picker
// field at runtime, via RED.nodes.getNode(id). No module-level singleton
// needed here; each nexa-sparkplug instance's own worker/connection
// lifecycle is already fully self-contained regardless of how many exist.
function getActiveSparkplugNode(RED) {
    var project = getCurrentProject();
    if (!project || !project.sparkplugConnection) return null;
    return RED.nodes.getNode(project.sparkplugConnection);
}

// Screens (the "Nexa" project: screens + their components) are NOT a
// separate JSON file — they live on the kufayeka-nexa-project CONFIG NODE
// (see ../nodes/nexa-project.js), the same pattern node-red-asset-engine
// uses for its kufayeka-asset-schema config node. That means Node-RED's own
// Deploy/flows.json/export/import/Projects(git) already persists this data
// for free — no save endpoint needed here.
//
// Deployed screens are served under this prefix — HTML render, static
// assets, SSE stream, snapshot, and write-back all now live in
// lib/screen-worker.js's own dedicated HTTP server/port (see that file's
// header), not here. This constant stays here only because a couple of
// admin-only conveniences below (the "_screen-port" lookup, log messages)
// still reference it.
const RUNTIME_PREFIX = "/nexa";

module.exports = function(RED) {
  // Shared between onadd/onremove below (unlike the plain in-process
  // subscriptions elsewhere in this file, a worker thread + bound port is a
  // real enough resource to actually terminate/clear on removal).
  let screenWorker = null;
  let snapshotRefreshInterval = null;
  let activeScreenWorkerPort = null;

  RED.plugins.registerPlugin("kufayeka-nexa-dashboard", {
    type: "node-red-runtime-plugin",
    onadd: function() {
      const log = RED.log || console;
      // (A "nexa/value" comms republish of every Asset Engine change used to
      // live here. Nothing ever subscribed to it — it only tripled the
      // per-change editor websocket traffic next to asset-engine's own
      // "assets/changed" — so it's gone.)

      // --- Nexa's own MQTT Sparkplug connection (kufayeka-nexa-sparkplug) —
      // independent of the Asset Engine subscription above. Re-checked on
      // every "flows:started" (fires on every deploy, including the very
      // first one that creates this config node) rather than once, since
      // the node may not exist yet the first time this plugin loads, and a
      // later redeploy can also replace it with a fresh instance (new
      // broker settings) — re-wiring only actually happens when the
      // instance in hand has changed. Also the ONLY place that needs to
      // detect a connection swap now (the old per-SSE-connection 3s poll in
      // lib/screen-worker.js's predecessor is gone — there's one central
      // subscription here instead of one per browser tab).
      let sparkplugUnsubscribe = null;
      let wiredSparkplugNode = null;
      let snapshotDirty = false;

      function wireSparkplugSubscription() {
        const sparkplugNode = getActiveSparkplugNode(RED);
        if (sparkplugNode === wiredSparkplugNode) return;
        if (sparkplugUnsubscribe) {
          sparkplugUnsubscribe();
          sparkplugUnsubscribe = null;
        }
        wiredSparkplugNode = sparkplugNode;
        // Tell the screen worker about the swap regardless of whether a new
        // node exists (an empty {} snapshot is correct too) — `resync:true`
        // makes it push an "event: resync" to every already-open SSE
        // client, the same recovery an already-open deployed screen needs
        // across a redeploy that swaps the connection (see the resync
        // comment this replaced, previously duplicated per-SSE-connection).
        if (screenWorker) {
          screenWorker.postMessage({
            type: "sparkplug-snapshot",
            snapshot: sparkplugNode ? sparkplugNode.getSnapshot() : {},
            resync: true
          });
        }
        if (!sparkplugNode) return;
        // Editor copy is batched (see lib/sparkplug/deltaBatcher.js) and
        // published as an ARRAY of deltas; the screen worker below still
        // gets every delta immediately, so deployed screens stay real-time.
        const editorBatcher = createDeltaBatcher(function (batch) {
          if (RED.comms && RED.comms.publish) RED.comms.publish("nexa/sparkplug/delta", batch);
        }, EDITOR_DELTA_BATCH_MS);
        const unsubscribeTree = sparkplugNode.subscribeTree(function (delta, serialized) {
          editorBatcher.push(delta);
          if (screenWorker) {
            screenWorker.postMessage({ type: "sparkplug-delta", serialized: serialized });
          }
          snapshotDirty = true;
        });
        sparkplugUnsubscribe = function () { unsubscribeTree(); editorBatcher.stop(); };
        log.info("[kufayeka-nexa-dashboard] subscribed to Nexa Sparkplug connection (live values -> nexa/sparkplug/delta)");
      }
      RED.events.on("flows:started", wireSparkplugSubscription);

      // Throttled full-snapshot refresh so lib/screen-worker.js's one-shot
      // "_sparkplug-snapshot" GET (served to a freshly-opened tab, before it
      // opens SSE) doesn't drift far from live state under continuous
      // updates — without re-serializing the whole tree on every single
      // delta the way the immediate relay above does for the cheap part.
      snapshotRefreshInterval = setInterval(function () {
        if (!snapshotDirty || !screenWorker || !wiredSparkplugNode) return;
        snapshotDirty = false;
        screenWorker.postMessage({ type: "sparkplug-snapshot", snapshot: wiredSparkplugNode.getSnapshot(), resync: false });
      }, 2000);

      // --- Deployed-screen HTTP server, in its own worker thread + its own
      // dedicated port (see lib/screen-worker.js's header for why: CPU-
      // contention isolation between Node-RED flow execution and dashboard-
      // serving, not a "something was slow" fix — nothing here was measured
      // as blocking before this split).
      function computeComponentScriptSrcs() {
        var srcs = [];
        (RED.plugins.getByType("nexa-ui-component-package") || []).forEach(function (pkg) {
          (pkg.runtimeScripts || []).forEach(function (src) { srcs.push(src); });
        });
        return srcs;
      }

      function startScreenWorker() {
        if (screenWorker) return;
        activeScreenWorkerPort = (RED.settings && RED.settings.nexaDashboard && RED.settings.nexaDashboard.screenWorkerPort) || DEFAULT_SCREEN_WORKER_PORT;
        const project = getCurrentProject();
        const initialSparkplugNode = getActiveSparkplugNode(RED);
        screenWorker = screenWorkerFactory({
          port: activeScreenWorkerPort,
          project: { screens: (project && project.screens) || [], templates: (project && project.templates) || [] },
          componentScriptSrcs: computeComponentScriptSrcs(),
          // Third-party "nexa-ui-component-package" plugins (e.g.
          // @kufayeka/nexa-component-basic-shapes) still register their own
          // runtimeScripts as root-relative paths served on Node-RED's OWN
          // main httpNode/httpAdmin server, not on this worker's dedicated
          // port — a deployed screen now loads from a DIFFERENT origin, so a
          // plain relative <script src> for those would 404 there (the
          // reported "unknown component" bug: the script never loads, so it
          // never calls window.NEXA.registerComponent). The worker uses this
          // to rewrite those specific srcs into absolute URLs pointing back
          // at Node-RED's real port, same hostname the browser already used
          // to reach it (see lib/screen-worker.js's renderScreenHtml).
          nodeRedPort: (RED.settings && RED.settings.uiPort) || 1880,
          sparkplugSnapshot: initialSparkplugNode ? initialSparkplugNode.getSnapshot() : {}
        });
        screenWorker.on("message", function (msg) {
          if (!msg) return;
          if (msg.type === "listening") {
            log.info("[kufayeka-nexa-dashboard] serving deployed screens on port " + msg.port + " (" + RUNTIME_PREFIX + "/*)");
            return;
          }
          if (msg.type === "write-request") {
            const sparkplugNode = getActiveSparkplugNode(RED);
            const ok = sparkplugNode
              ? sparkplugNode.writeMetrics(msg.groupId, msg.edgeNodeId, msg.deviceId, msg.metrics)
              : false;
            screenWorker.postMessage({ type: "write-result", requestId: msg.requestId, ok: ok });
          }
        });
      }
      startScreenWorker();

      // A redeploy can change the project's own screens/templates (or which
      // UI component packages are registered) — push the latest to the
      // worker every time, not just once at startup.
      RED.events.on("flows:started", function () {
        if (!screenWorker) return;
        const project = getCurrentProject();
        screenWorker.postMessage({
          type: "project",
          project: { screens: (project && project.screens) || [], templates: (project && project.templates) || [] },
          componentScriptSrcs: computeComponentScriptSrcs(),
          nodeRedPort: (RED.settings && RED.settings.uiPort) || 1880
        });
      });

      // SDK bundles for the EDITOR (lib/nexa-plugin.html loads them via plain
      // <script src>s — see build.js and src/sdk/runtime-entry.js for why
      // they're not folded into the editor's own bundle). Deployed pages get
      // the SDK from lib/screen-worker.js's own "/nexa/_sdk.js" route instead.
      // The module component plugins import: <root>/nexa-sdk/nexa-component-sdk.js,
      // on BOTH the editor (httpAdmin) and deployed pages (httpNode) so a
      // plugin served from <root>/<plugin>/vendor/ reaches it with the same
      // relative path ("../../nexa-sdk/nexa-component-sdk.js"). CORS: a
      // deployed page lives on the screen worker's port, a module import from
      // Node-RED's port is cross-origin.
      const sendFacade = function (req, res) {
        res.set("Access-Control-Allow-Origin", "*");
        res.type("application/javascript");
        res.sendFile(path.join(__dirname, "..", "sdk", "nexa-component-sdk.js"));
      };
      if (RED.httpAdmin) RED.httpAdmin.get("/nexa-sdk/nexa-component-sdk.js", sendFacade);
      if (RED.httpNode) RED.httpNode.get("/nexa-sdk/nexa-component-sdk.js", sendFacade);

      if (RED.httpAdmin) {
        // Lit + component SDK, and the editor-only property kit (see build.js).
        // "_lit-vendor.js" is the pre-SDK name of the first one, kept as an alias.
        const sendSdk = function (req, res) {
          res.type("application/javascript");
          res.sendFile(path.join(__dirname, "..", "dist", "nexa-sdk.bundle.js"));
        };
        RED.httpAdmin.get("/nexa-dashboard/_sdk.js", sendSdk);
        RED.httpAdmin.get("/nexa-dashboard/_lit-vendor.js", sendSdk);
        RED.httpAdmin.get("/nexa-dashboard/_sdk-kit.js", function (req, res) {
          res.type("application/javascript");
          res.sendFile(path.join(__dirname, "..", "dist", "nexa-sdk-kit.bundle.js"));
        });

        // Deployed screens now live on lib/screen-worker.js's own dedicated
        // port, not this admin server's — the editor's "Open Screen" button
        // (src/sidebar/screens-panel.js) needs to know which port to build
        // the URL against, since it can't just assume "same origin as the
        // admin UI" anymore.
        RED.httpAdmin.get("/nexa-dashboard/_screen-port", function (req, res) {
          res.json({ port: activeScreenWorkerPort });
        });

        // Editor's "MQTT Sparkplug" sidebar tab fetches this ONCE on open
        // for its initial tree (RED.comms only delivers deltas from here on,
        // not history) — see src/canvas/sparkplug-live.js.
        RED.httpAdmin.get("/nexa-dashboard/_sparkplug-tree", function (req, res) {
          const sparkplugNode = getActiveSparkplugNode(RED);
          res.json(sparkplugNode ? sparkplugNode.getSnapshot() : {});
        });

        // Manual "Rebirth / Refresh" button (src/sidebar/sparkplug-panel.js)
        // — see nodes/nexa-sparkplug.js's requestRebirthAll() for why this
        // needs to exist at all even though the listener also auto-requests
        // a rebirth on its own: NBIRTH/DBIRTH are one-shot, not
        // broker-retained, so a user should always be able to force a fresh
        // one on demand, not just wait for the automatic recovery path.
        RED.httpAdmin.post("/nexa-dashboard/_sparkplug-rebirth", function (req, res) {
          const sparkplugNode = getActiveSparkplugNode(RED);
          if (!sparkplugNode) {
            res.status(404).json({ error: "No Nexa Sparkplug connection configured yet." });
            return;
          }
          const count = sparkplugNode.requestRebirthAll();
          res.json({ requested: count });
        });
      }

      // Deployed-page runtime (HTML render, static assets, SSE, snapshot,
      // write-back) all now lives in lib/screen-worker.js's own worker
      // thread + dedicated port, wired above (startScreenWorker() /
      // wireSparkplugSubscription()) — see that file's header for the full
      // route list and protocol.
    },
    onremove: function() {
      if (snapshotRefreshInterval) { clearInterval(snapshotRefreshInterval); snapshotRefreshInterval = null; }
      if (screenWorker) {
        screenWorker.postMessage({ type: "close" });
        screenWorker.terminate().catch(function () {});
        screenWorker = null;
      }
    }
  });
};
module.exports._setScreenWorkerFactoryForTests = _setScreenWorkerFactoryForTests;
