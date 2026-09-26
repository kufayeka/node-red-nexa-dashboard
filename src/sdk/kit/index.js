// Entry of dist/nexa-sdk-kit.bundle.js — the Nexa property kit (editor only).
// Defines the nx-* widgets and publishes window.NexaKit:
//   NexaKit.renderInspector(container, { meta, props, set, preview, persistKey })
//   NexaKit.setHost({ openCode, ... })       what the widgets ask the editor for
//   NexaKit.defineWidget(tag, factory)       a plugin's own inspector widget
//   NexaKit.openDialog({ title, content, buttons })
//   NexaKit.validateProp(propSchema, value, props)
import { html, css, nothing } from "lit";
import { setHost, getHost, KitElement, str, icon } from "./base.js";
import { ensureStyles } from "./styles.js";
import { NxText, NxTextarea, NxNumber, NxSelect, NxSegmented, NxCombobox, NxCheckbox, NxToggle, NxSlider, NxColor } from "./inputs.js";
import { NxCode, NxTag, NxList, NxStateSwitcher, NxAlert, NxBadge, NxField, NxSection, NxTabs, NxTab, NxRow } from "./composite.js";
import { renderInspector, validateProp, openDialog } from "./inspector.js";
import { NxTree } from "./tree.js";
import { NxAlign, NxSpacing } from "./layout-widgets.js";

var ELEMENTS = {
    "nx-text": NxText, "nx-textarea": NxTextarea, "nx-number": NxNumber, "nx-select": NxSelect, "nx-segmented": NxSegmented,
    "nx-combobox": NxCombobox, "nx-checkbox": NxCheckbox, "nx-toggle": NxToggle, "nx-slider": NxSlider, "nx-color": NxColor,
    "nx-code": NxCode, "nx-tag": NxTag, "nx-list": NxList, "nx-state-switcher": NxStateSwitcher,
    "nx-alert": NxAlert, "nx-badge": NxBadge, "nx-field": NxField,
    "nx-section": NxSection, "nx-tabs": NxTabs, "nx-tab": NxTab, "nx-row": NxRow,
    "nx-tree": NxTree, "nx-align": NxAlign, "nx-spacing": NxSpacing
};

// A plugin's own inspector widget: factory({ KitElement, html, css, nothing, str, icon }) -> class.
// It follows the same contract as the built-in ones (.value + nx-change, frame(), bind()).
function defineWidget(tag, factory) {
    if (customElements.get(tag)) return customElements.get(tag);
    var Klass = factory({ KitElement: KitElement, html: html, css: css, nothing: nothing, str: str, icon: icon });
    if (typeof Klass !== "function" || !(Klass.prototype instanceof KitElement)) throw new Error("[nexa] defineInspectorWidget(\"" + tag + "\"): the factory must return a class extending KitElement");
    customElements.define(tag, Klass);
    return Klass;
}

if (!window.NexaKit) {
    Object.keys(ELEMENTS).forEach(function (tag) {
        if (!customElements.get(tag)) customElements.define(tag, ELEMENTS[tag]);
    });
    window.NexaKit = {
        renderInspector: renderInspector,
        validateProp: validateProp,
        openDialog: openDialog,
        setHost: setHost,
        getHost: getHost,
        defineWidget: defineWidget,
        ensureStyles: ensureStyles,
        KitElement: KitElement,
        elements: Object.keys(ELEMENTS)
    };
    // inspector widgets plugins defined before the kit loaded
    (window.__nexaInspectorWidgets || []).splice(0).forEach(function (w) {
        try { defineWidget(w[0], w[1]); } catch (e) { console.error(e); }
    });
}
