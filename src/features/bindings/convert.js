// --- "Convert legacy bindings": the project's binding strings become binding lists -----------
// A prop bound the old way ("{speed}", "{sparkplug:…}", "{msg.x}", "Line {line} rpm" + its
// __fallback) becomes a binding priority list ({ $bind, static }: src/model/binding.js), the one
// format the inspector edits. Its value is the same either way: the page reads both, so this is
// never required; it is a tidy-up, run by hand (Node-RED's action list, Ctrl+Shift+P →
// "Nexa: convert legacy bindings").
// Only where the component's schema says the prop is bindable: a tag input / output stays a tag
// string, a component whose plugin is not loaded is left as it is (run it again later).
import { state, markDirty, Tree } from "../../state.js";
import { migrateLegacyBindings, BINDABLE_TYPES } from "../../model/binding.js";
import { redrawCanvas } from "../../canvas/canvas-ui.js";
import { renderPropertiesPanel } from "../../sidebar/properties-panel.js";

/** canConvert(key, fieldKey?) for one node, or null (nothing known about its props). */
export function convertibleKeys(node) {
    if (node.type === "@lit-component") {
        var names = (node.litBindable || []).map(function (p) { return p.name; });
        return function (k, f) { return !f && names.indexOf(k) !== -1; };
    }
    var def = window.NEXA && window.NEXA.getComponent(node.type);
    var meta = def && def.nexa;
    if (!meta) return null;
    var ioKeys = {};
    (meta.inputs || []).concat(meta.outputs || []).forEach(function (io) { ioKeys[io.key] = true; });
    return function (k, f) {
        var p = meta.props[k];
        if (!p || ioKeys[k]) return false;
        if (f === undefined) return !!(p.bindable && BINDABLE_TYPES[p.type]);
        var fld = p.item && p.item.fields && p.item.fields[f];
        return !!(fld && BINDABLE_TYPES[fld.type || "string"] && fld.bindable !== false);
    };
}

/** Converts every surface of the open project -> { values, nodes, skipped } (skipped: no schema). */
export function convertProjectBindings() {
    var report = { values: 0, nodes: 0, skipped: 0 };
    [].concat(state.screens || [], state.templates || []).forEach(function (surface) {
        Tree.walk(surface, function (node) {
            if (!node.props && !node.overrides) return;
            var can = convertibleKeys(node);
            if (!can) { if (hasLegacy(node.props)) report.skipped++; return; }
            var n = migrateLegacyBindings(node.props, can);
            Object.keys(node.overrides || {}).forEach(function (band) {
                var o = node.overrides[band];
                if (o && o.props) n += migrateLegacyBindings(o.props, can);
            });
            if (n) { report.values += n; report.nodes++; }
        }, { orphans: true });
    });
    if (report.values) markDirty();
    return report;
}

function hasLegacy(props) {
    return !!props && Object.keys(props).some(function (k) { return typeof props[k] === "string" && /\{[^{}]+\}/.test(props[k]) && !/^\{(asset|token):[^{}]+\}$/.test(props[k].trim()); });
}

export function registerConvertBindingsAction() {
    if (!window.RED || !window.RED.actions) return;
    window.RED.actions.add("nexa:convert-legacy-bindings", function () {
        var r = convertProjectBindings();
        var text = r.values
            ? "Nexa: " + r.values + " binding(s) in " + r.nodes + " node(s) are binding lists now. Deploy to save."
            : "Nexa: no legacy binding to convert.";
        if (r.skipped) text += " " + r.skipped + " node(s) skipped: their plugin is not loaded.";
        window.RED.notify(text, r.values ? "success" : "compact");
        if (r.values && state.trayContent) { redrawCanvas(); renderPropertiesPanel(); }
    }, { label: "Nexa: convert legacy bindings" });
}

if (typeof window !== "undefined") window.__nexaEditor = Object.assign(window.__nexaEditor || {}, { convertProjectBindings: convertProjectBindings });
