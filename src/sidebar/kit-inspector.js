// --- Properties panel for SDK components (NEXA.component) -----------------
// The inspector itself is the property kit's (dist/nexa-sdk-kit.bundle.js,
// window.NexaKit), rendered from the component's schema (def.nexa). This file
// is only the editor's side of it: where a change goes (the comp's props,
// undo history, dirty flag, canvas re-render) and what the kit's widgets may
// ask the editor for (the code tray, the known Sparkplug tags).
import { state, getActiveScreen, markDirty, Tree, Scope, getApp } from "../state.js";
import { pushHistory } from "../history.js";
import { refreshComponentRender } from "../canvas/component-renderer.js";
import { openCodeEditorTray } from "../dialogs/lit-code-dialog.js";
import { listKnownSparkplugBindings } from "../canvas/sparkplug-live.js";
import { uploadAssets, loadAssets } from "../assets-client.js";
import { pushTreeChange, treeSnapshot } from "../history.js";
import { responsiveHost } from "../canvas/breakpoints-ui.js";

// Changes to the same prop within this window are one undo step (typing).
var PROP_HISTORY_MERGE_MS = 1500;

var hostReady = false;
function ensureKitHost() {
    if (hostReady || !window.NexaKit) return;
    hostReady = true;
    loadAssets();
    window.NexaKit.setHost({
        openCode: openCodeEditorTray,
        // nx-asset's Import…: the files go to the Assets tab's store
        uploadAssets: function (files) { return uploadAssets(files); },
        // what the selected node can bind to as {name}: its containers' variables,
        // the screen's (a template: its params and variables), nearest first
        listVariables: function () {
            var screen = getActiveScreen();
            var id = state.selectedIds.length === 1 ? state.selectedIds[0] : null;
            if (!screen || !id) return [];
            var list = Scope.visibleVariables(screen, Tree.ancestors(screen, id), state.editingMode === "template", Tree.find(screen, id), getApp());
            // the page's URL: {$route.params.<name>} for each ":name" in the screen's path, the query, the path
            var route = { id: "$route", name: "the URL", kind: "route" };
            ((screen.path || "").match(/:([A-Za-z_$][\w$]*)/g) || []).forEach(function (p) {
                list.push({ name: "$route.params." + p.slice(1), type: "string", value: "(from the URL)", owner: route });
            });
            list.push({ name: "$route.query", type: "object", value: "(?a=1&b=2 → {a, b})", owner: route });
            list.push({ name: "$route.path", type: "string", value: "(the page path)", owner: route });
            // the breakpoint in use on the page (the window's width)
            list.push({ name: "$breakpoint", type: "string", value: "xs | sm | md | lg | xl | 2xl | 3xl", owner: { id: "$breakpoint", name: "the window's width", kind: "route" } });
            // the colour mode in use on the page
            list.push({ name: "$colorMode", type: "string", value: "light | dark", owner: { id: "$colorMode", name: "the theme", kind: "route" } });
            return list;
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
    var screen = getActiveScreen();
    // a prop per breakpoint (📱 of each field): kept in comp.overrides[band].props
    var responsive = screen ? responsiveHost(comp, Tree.parentOf(screen, comp.id), function (n) { return n.props || {}; },
        function (n, key, v) { n.props = Object.assign({}, n.props || {}); if (v === undefined) delete n.props[key]; else n.props[key] = v; },
        function (key) { return key !== "__previewState" && key !== "__fallback"; },
        function (fn) {
            var before = treeSnapshot(screen);
            fn();
            pushTreeChange(screen, before);
            markDirty();
            refreshComponentRender(comp);
        }) : null;
    window.NexaKit.renderInspector(container.jquery ? container.get(0) : container, {
        meta: typeDef.nexa,
        props: function () { return comp.props || {}; },
        persistKey: comp.type,
        responsive: responsive,
        set: function (key, value) { setComponentProp(comp, key, value); },
        // the state switcher: design-time only, no undo step, not "unsaved"
        preview: function (key, value) { comp.props[key] = value; refreshComponentRender(comp); }
    });
    return true;
}
