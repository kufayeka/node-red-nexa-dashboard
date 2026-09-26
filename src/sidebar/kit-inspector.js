// --- Properties panel for SDK components (NEXA.component) -----------------
// The inspector itself is the property kit's (dist/nexa-sdk-kit.bundle.js,
// window.NexaKit), rendered from the component's schema (def.nexa). This file
// is only the editor's side of it: where a change goes (the comp's props,
// undo history, dirty flag, canvas re-render) and what the kit's widgets may
// ask the editor for (the code tray, the known Sparkplug tags).
import { state, getActiveScreen, markDirty, Tree, Scope } from "../state.js";
import { pushHistory } from "../history.js";
import { refreshComponentRender } from "../canvas/component-renderer.js";
import { openCodeEditorTray } from "../dialogs/lit-code-dialog.js";
import { listKnownSparkplugBindings } from "../canvas/sparkplug-live.js";

// Changes to the same prop within this window are one undo step (typing).
var PROP_HISTORY_MERGE_MS = 1500;

var hostReady = false;
function ensureKitHost() {
    if (hostReady || !window.NexaKit) return;
    hostReady = true;
    window.NexaKit.setHost({
        openCode: openCodeEditorTray,
        // what the selected node can bind to as {name}: its containers' variables,
        // the screen's (a template: its params and variables), nearest first
        listVariables: function () {
            var screen = getActiveScreen();
            var id = state.selectedIds.length === 1 ? state.selectedIds[0] : null;
            if (!screen || !id) return [];
            return Scope.visibleVariables(screen, Tree.ancestors(screen, id), state.editingMode === "template", Tree.find(screen, id));
        }
    });
    // The tag picker's suggestions come from the tag PROVIDER; the editor
    // knows the live Sparkplug tree, so it fills in that provider's list().
    // (Other providers — OPC UA, SQL, UDT — add their own when they register.)
    if (window.NexaSDK && window.NexaSDK.getTagProvider("sparkplug")) {
        window.NexaSDK.extendTagProvider("sparkplug", {
            list: function () {
                var p = window.NexaSDK.getTagProvider("sparkplug");
                return listKnownSparkplugBindings().map(function (b) {
                    return { address: p.format(b.ref), label: b.label, detail: b.binding };
                });
            }
        });
    }
}

function clone(v) {
    return v === undefined || v === null || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v));
}

export function setComponentProp(comp, key, value) {
    var screen = getActiveScreen();
    comp.props = comp.props || {};
    var from = comp.props[key];
    comp.props[key] = value;
    var now = Date.now();
    var last = state.undoStack[state.undoStack.length - 1];
    if (screen && last && last.t === "props" && last.id === comp.id && last.key === key && last.screenId === screen.id && now - last.at < PROP_HISTORY_MERGE_MS) {
        last.to = clone(value);
        last.at = now;
        state.redoStack = [];
    } else if (screen) {
        pushHistory({ t: "props", screenId: screen.id, id: comp.id, key: key, from: clone(from), to: clone(value), at: now });
    }
    markDirty();
    refreshComponentRender(comp);
}

/** true when the kit rendered the inspector (the caller skips its legacy form). */
export function renderKitInspector(container, comp, typeDef) {
    if (!typeDef || !typeDef.nexa || !window.NexaKit) return false;
    ensureKitHost();
    comp.props = comp.props || {};
    window.NexaKit.renderInspector(container.jquery ? container.get(0) : container, {
        meta: typeDef.nexa,
        props: comp.props,
        persistKey: comp.type,
        set: function (key, value) { setComponentProp(comp, key, value); },
        // the state switcher: design-time only, no undo step, not "unsaved"
        preview: function (key, value) { comp.props[key] = value; refreshComponentRender(comp); }
    });
    return true;
}
