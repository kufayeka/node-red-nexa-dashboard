// Nexa Runtime Session State
// Centralized state container for the deployed-page client runtime.

export const VIS_RANK = { show: 0, hide: 1, remove: 2 };

export const IO_WRITE_TIMEOUT_MS = 5000;
// the IO value types, from the one wire format
export { V as IO_V } from "../shared/io/frame.js";

export const PERSIST_PREFIX = "nexa:app:";
export const LOGIC_MAX_STEPS = 2000;

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
    sparkplugBoundComponents: [],
    sparkplugBindingIndex: {},
    sparkplugIndexBatch: 0,
    sparkplugDirtyKeys: null,
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

    // (the screen on show, the active flow: src/runtime/features/navigation.js getEffectiveScreen() / getActiveFlowScreen())

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

export var activeScreenTimers = state.activeScreenTimers;

