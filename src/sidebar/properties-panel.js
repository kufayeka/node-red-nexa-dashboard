// --- Properties panel -----------------------------------------------------------------
// One selected node: ONE property tree for everything about it (inspector/node-inspector.js:
// its name and lock, place and size, the layout around it, a frame's auto layout, the
// component's own props, a template's parameters, a Lit component's code, its variables,
// teleport), above the editor of the row picked in it. Several selected: what can be done to
// all of them. A legacy plugin's own renderProperties() form still renders below the tree.
import { state, findComponent, findTemplate, markDirty, getActiveScreen, Tree } from "../state.js";
import { groupSelection, frameSelection, setLockedForSelection, toggleFlipForSelection } from "../canvas/selection.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { refreshComponentRender } from "../canvas/component-renderer.js";
import { openCssCodeEditor } from "../dialogs/lit-code-dialog.js";
import { listKnownSparkplugBindings, parseSparkplugBindingPath } from "../canvas/sparkplug-live.js";
import { renderNodeInspector } from "./inspector/node-inspector.js";
import { activeBreakpointId, breakpointList, overriddenKeys, resetOverride, isDesign, rangeOf } from "../canvas/breakpoints-ui.js";

function previewText(code, emptyLabel) {
    if (!code) return emptyLabel;
    var firstLine = code.split("\n")[0];
    return (firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine) +
        " (" + code.length + " chars)";
}

// Three guarantees:
//   - a value being typed is committed first, to the node it was typed for (blur), never lost
//   - one build at a time: a commit that asks for a rebuild while one runs gets one more pass
//   - the same node still shown (the same object, the same breakpoint): its tree is only
//     updated, not rebuilt (focus, scroll, the picked row stay); otherwise rebuilt, and the
//     panel's scroll position stays while the same node is shown
var panelBuilding = false;
var panelAgain = false;
var panelShownKey = null;
var shown = null;          // { key, node, bp, handle }: the tree on show
export function renderPropertiesPanel() {
    if (!state.propertiesPane) return;
    if (panelBuilding) { panelAgain = true; return; }
    panelBuilding = true;
    try {
        do {
            panelAgain = false;
            commitPendingEdit();
            var pane = state.propertiesPane.get ? state.propertiesPane.get(0) : null;
            var scroller = pane && pane.parentNode;
            var key = state.selectedIds.join(",");
            var top = key === panelShownKey && scroller && typeof scroller.scrollTop === "number" ? scroller.scrollTop : 0;
            buildPropertiesPanel();
            panelShownKey = key;
            if (scroller && typeof scroller.scrollTop === "number") scroller.scrollTop = top;
        } while (panelAgain);
    } finally {
        panelBuilding = false;
    }
}

// a field of the panel still has focus (typing): blur it, its change commits now
function commitPendingEdit() {
    if (typeof document === "undefined" || !document.activeElement || !state.propertiesPane || !state.propertiesPane.get) return;
    var pane = state.propertiesPane.get(0);
    var a = document.activeElement;
    if (pane && a !== pane && typeof pane.contains === "function" && pane.contains(a) && typeof a.blur === "function") a.blur();
}

function buildPropertiesPanel() {
    var key = state.selectedIds.join(",");
    var comp = state.selectedIds.length === 1 ? findComponent(state.selectedIds[0]) : null;
    var bpId = activeBreakpointId();
    var pane = state.propertiesPane.get ? state.propertiesPane.get(0) : null;
    if (comp && shown && shown.key === key && shown.node === comp && shown.bp === bpId && shown.handle && pane && pane.contains(shown.handle.root)) {
        shown.handle.update();
        return;
    }
    shown = null;
    state.propertiesPane.empty();
    if (state.selectedIds.length > 1) {
        renderMultiSelection();
        return;
    }
    if (!comp) {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("Select a component on the canvas to edit its properties.").appendTo(state.propertiesPane);
        return;
    }
    if (!isDesign(bpId)) renderBreakpointBanner(comp, bpId);

    var isTemplateInstance = comp.type === "@template";
    var isLitComponent = comp.type === "@lit-component";
    // a group / frame (a component holding slots, a Tabs, is a component)
    var isContainer = Tree.isContainer(comp) && !Tree.isSlotHost(comp);
    var typeDef = isTemplateInstance || isLitComponent || isContainer ? null : window.NEXA.getComponent(comp.type);
    if (!isTemplateInstance && !isLitComponent && !isContainer && !typeDef) {
        window.$("<div>").css({ color: "#a00", "font-size": "12px" }).text("Unknown component type: " + comp.type).appendTo(state.propertiesPane);
        return;
    }
    if (!window.NexaKit) {
        window.$("<div>").css({ color: "#a00", "font-size": "12px" }).text("The property kit did not load (nexa-sdk-kit.bundle.js).").appendTo(state.propertiesPane);
        return;
    }
    var handle = renderNodeInspector(window.$("<div>").appendTo(state.propertiesPane), comp, {
        typeDef: typeDef,
        template: isTemplateInstance ? findTemplate(comp.templateId) : null,
        refreshHierarchy: refreshHierarchyIfOpen
    });
    var legacyForm = typeDef && !typeDef.nexa && typeof typeDef.renderProperties === "function";
    if (legacyForm) {
        // a pre-SDK plugin's own form (NEXA.registerComponent): kept, below the tree
        window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", margin: "14px 0 8px", "border-top": "1px solid #ddd", "padding-top": "10px" }).text(typeDef.label || comp.type).appendTo(state.propertiesPane);
        typeDef.renderProperties(state.propertiesPane, comp, {
            refreshComponentRender: refreshComponentRender,
            markDirty: markDirty,
            openCssCodeEditor: openCssCodeEditor,
            listKnownSparkplugBindings: listKnownSparkplugBindings,
            parseSparkplugBindingPath: parseSparkplugBindingPath,
            previewText: previewText
        });
    }
    if (!legacyForm) shown = { key: key, node: comp, bp: bpId, handle: handle };
}

// editing a breakpoint: say so, and what this node overrides here (with a reset)
function renderBreakpointBanner(comp, bpId) {
    var bpScreen = getActiveScreen();
    var bpName = (breakpointList().filter(function (b) { return b.id === bpId; })[0] || { name: bpId }).name + " (" + rangeOf(bpId) + ")";
    var keys = overriddenKeys(comp);
    var banner = window.$("<div>", { "class": "nexa-bp-banner" }).css({ background: "#fff3e0", border: "1px solid #ffb74d", "border-radius": "4px", padding: "6px 8px", "margin-bottom": "10px", "font-size": "11px", color: "#6d4c00" }).appendTo(state.propertiesPane);
    window.$("<div>").html('<i class="fa fa-mobile"></i> Editing <b>' + bpName + '</b>: changes here are kept for this breakpoint (and the ones further from the design); ★ keeps the design. A field\'s <i class="fa fa-mobile"></i> sets one value per breakpoint without switching.').appendTo(banner);
    if (!keys.length) return;
    var row = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "6px", "margin-top": "5px" }).appendTo(banner);
    window.$("<span>").css({ flex: "1 1 auto" }).text("● Overridden here: " + keys.join(", ")).appendTo(row);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small" }).text("Reset").attr("title", "Inherit it again (from the design / the wider breakpoint)")
        .on("click", function () {
            var parent = Tree.parentOf(bpScreen, comp.id);
            resetOverride(comp, parent && parent.type ? parent : null);
            markDirty();
            renderActiveScreen({ keepPanel: true });
            shown = null;
            renderPropertiesPanel();
        }).appendTo(row);
}

// several selected: what applies to all of them
function renderMultiSelection() {
    var pane = state.propertiesPane;
    window.$("<div>").css({ color: "#666", "font-size": "12px", "margin-bottom": "10px" }).text(state.selectedIds.length + " components selected.").appendTo(pane);
    var row = function () { return window.$("<div>").css({ display: "flex", gap: "6px", "margin-bottom": "6px" }).appendTo(pane); };
    var button = function (parent, html, title, fn) {
        return window.$("<button>", { type: "button", "class": "red-ui-button", title: title || "" }).html(html).css({ flex: "1" }).on("click", fn).appendTo(parent);
    };
    var groupRow = row();
    button(groupRow, "Group", "Group selection (Ctrl+G)", function () { groupSelection(); });
    button(groupRow, "Frame", "Frame selection (Ctrl+Alt+G)", frameSelection);
    var lockRow = row();
    button(lockRow, "Lock all", "", function () { setLockedForSelection(true); });
    button(lockRow, "Unlock all", "", function () { setLockedForSelection(false); });
    var flipRow = row();
    button(flipRow, '<i class="fa fa-arrows-h"></i> Flip H', "Flip Horizontal (Shift+H)", function () { toggleFlipForSelection("h"); });
    button(flipRow, '<i class="fa fa-arrows-v"></i> Flip V', "Flip Vertical (Shift+V)", function () { toggleFlipForSelection("v"); });
}

var hierarchyRefresher = null;
export function setHierarchyRefresher(fn) { hierarchyRefresher = fn; }
function refreshHierarchyIfOpen() { if (hierarchyRefresher) hierarchyRefresher(); }
