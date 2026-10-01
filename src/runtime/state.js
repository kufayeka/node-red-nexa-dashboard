// Nexa Runtime Session State
// Centralized state container for the deployed-page client runtime.

export const VIS_RANK = { show: 0, hide: 1, remove: 2 };

export const IO_WRITE_TIMEOUT_MS = 5000;
export const IO_V = { OFFLINE: 0, NULL: 1, FALSE: 2, TRUE: 3, INT32: 4, FLOAT64: 5, STRING: 6, JSON: 7 };

export const PERSIST_PREFIX = "nexa_var_";
export const LOGIC_MAX_STEPS = 1000;

export const state = {
    // DOM & Pins
    pins: [],
    pinsQueued: false,
    pinsRemeasure: false,
    pinPageListener: false,

    // Lit Web Component classes cache
    litClassCache: {},

    // Sparkplug & Realtime IO
    sparkplugCache: {},
    sparkplugConnectionLost: false,
    sparkplugBoundComponents: {},
    sparkplugBindingIndex: {},
    sparkplugIndexBatch: [],
    sparkplugDirtyKeys: {},
    sparkplugFlushScheduled: false,

    io: {
        ws: null,
        opened: false,
        hb: 1000,
        lastRx: 0,
        watchdog: null,
        layout: [],            // idx -> {key, type, engUnit, properties, metadata}
        keysSig: null,
        pending: {},           // id -> {resolve, reject, timer}
        nextId: 1,
        everOpened: false,
        failures: 0,
        backoff: 1000,
        reconnectTimer: null
    },

    // Variable Scopes
    currentSharedScope: null,
    currentAppScope: null,

    // Active Screen & Flow Navigation
    currentEffectiveScreen: null,
    currentActiveFlow: null,
    currentActiveFlowScreen: null,
    currentActiveRenderScreen: null,

    // Active timers and listeners
    activeScreenTimers: [],
    activeDisplayModeResize: null,
    activeBreakpointResize: null,

    // Overlays & Teleports
    overlays: [],
    overlayStack: [],
    overlayZ: 1000,
    overlayKeysWired: false,
    pendingTeleports: [],

    // Browser navigation listeners
    popstateWired: false,
    beforeunloadWired: false
};
