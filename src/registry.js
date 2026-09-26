// --- NEXA component registry -------------------------------------------
// The implementation lives in src/sdk/registry.js, shared with the SDK
// bundle and the deployed page's /nexa/_registry.js. Component plugins call
// NEXA.component(id, factory) (SDK) or NEXA.registerComponent(id, def)
// (legacy) — see @kufayeka/nexa-component-fields / -buttons for examples.
import { ensureRegistry } from "./sdk/registry.js";

export function initNexaRegistry() {
    return ensureRegistry();
}

// Initialize immediately so window.NEXA is always present
initNexaRegistry();
