// Same pattern as @kufayeka/node-red-asset-engine's kufayeka-asset-schema
// config node: structural project data (screens + their components) lives
// on this node's config, so it travels with flow export/import, Node-RED
// Projects (git), and gets persisted for free by Node-RED's own Deploy —
// no separate save endpoint or JSON file needed.
//
// Unlike asset-schema, there is nothing "live" to keep out of this node —
// screens/components are themselves the structure (a component's binding
// is just a "@Path" string reference; the live tag VALUE behind it stays
// entirely in the Asset Engine's own runtime store, untouched by this).
// Module-level (not inside the RED-scoped export below) so the runtime
// page-serving route in lib/nexa-plugin.js — a DIFFERENT file requiring
// this one — can reach it via the exported getCurrentProject() below.
var currentProject = null;

module.exports = function (RED) {
  function NexaProjectNode(config) {
    RED.nodes.createNode(this, config);
    this.screens = Array.isArray(config.screens) ? config.screens : [];
    currentProject = this;

    if (RED.log) {
      RED.log.info(
        "[kufayeka-nexa-dashboard] Loaded project '" + (this.name || this.id) +
        "' (" + this.screens.length + " screen(s))"
      );
    }
  }
  RED.nodes.registerType("kufayeka-nexa-project", NexaProjectNode);
};

module.exports.getCurrentProject = function () {
  return currentProject;
};
