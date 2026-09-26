// Entry of lib/nexa-model.js (CommonJS, for lib/screen-worker.js) and of
// lib/nexa-model-client.js (window.NexaModel, for the deployed page's
// lib/nexa-runtime-client.js: the frame / auto layout CSS).
export * from "./tree.js";
export * from "./layout.js";
export { migrateSurface, TREE_VERSION } from "./migrate.js";

import { migrateSurface } from "./migrate.js";

/** Brings every screen and template of a project up to the node tree, in place. */
export function migrateProject(project) {
    if (!project) return project;
    (project.screens || []).forEach(function (s) { migrateSurface(s); });
    (project.templates || []).forEach(function (t) { migrateSurface(t); });
    return project;
}
