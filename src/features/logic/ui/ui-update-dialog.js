// --- The Update Component node's dialog: the component's property tree, keep / set ---------
// The same tree as the Properties tab (the kit's renderInspector, the component's own groups and
// props, its place and size), over the NODE's config instead of the component: a prop the node
// does not set shows "keep"; editing one sets it (Keep takes it back). A set value can be static
// or a binding priority list: a Message source reads the message this node gets
// (Message → payload.speed), resolved on the page when the node runs.
// A prop the component itself binds (its Properties: Binding) is not set here: the message
// reaches it through its own Message source, and its place in that list decides.
import { findComponent, markDirty } from "../../../state.js";
import { normalizeProp } from "../../../sdk/schema.js";
import { isBindingList, isLegacyBinding } from "../../../model/binding.js";

var GEOMETRY = {
    x: { type: "number", label: "X", unit: "px" },
    y: { type: "number", label: "Y", unit: "px" },
    w: { type: "number", label: "Width", unit: "px" },
    h: { type: "number", label: "Height", unit: "px" },
    rotation: { type: "number", label: "Rotation", unit: "°" }
};
var SKIP_TYPES = { tag: 1, code: 1, action: 1 };

function clone(v) {
    return v === null || v === undefined || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v));
}

/** The props the node can set, as kit props (defaults = the component's values now). */
export function updatableProps(comp, typeDef) {
    var out = {};
    Object.keys(GEOMETRY).forEach(function (k) {
        out[k] = normalizeProp(k, Object.assign({ group: "Position & Size", default: comp[k] !== undefined ? comp[k] : 0 }, GEOMETRY[k]));
    });
    var own = {};
    if (comp.type === "@lit-component") {
        (comp.litBindable || []).forEach(function (p) {
            var type = p.type === "number" || p.type === "boolean" || p.type === "color" ? p.type : p.type === "object" || p.type === "array" ? "json" : "string";
            own[p.name] = normalizeProp(p.name, { type: type, default: p.defaultValue, group: "Properties" });
        });
    } else if (typeDef && typeDef.nexa) {
        Object.keys(typeDef.nexa.props).forEach(function (k) {
            var p = typeDef.nexa.props[k];
            if (SKIP_TYPES[p.type] || k.charAt(0) === "_") return;
            own[k] = Object.assign({}, p);
        });
    } else if (typeDef) {
        Object.keys(typeDef.defaults || {}).forEach(function (k) {
            var d = typeDef.defaults[k] || {};
            var type = d.type === "number" || d.type === "color" ? d.type : d.type === "checkbox" ? "boolean" : "string";
            own[k] = normalizeProp(k, { type: type, default: d.value, group: "Properties" });
        });
    }
    var props = comp.props || {};
    Object.keys(own).forEach(function (k) {
        var p = own[k], now = props[k];
        if (isBindingList(now) || isLegacyBinding(now)) {
            // bound by the component itself: the message reaches it through its Message source
            p.enabledWhen = function () { return false; };
            p.help = "Bound in the component's Properties (Binding): this node's message reaches it through a Message source there.";
        } else if (now !== undefined) p.default = clone(now);
        p.noReset = false;
        out[k] = p;
    });
    return out;
}

export function openUiUpdateNodeEditor(node) {
    var comp = findComponent(node.props.compId);
    var isLitComponent = comp && comp.type === "@lit-component";
    var typeDef = comp && !isLitComponent && window.NEXA.getComponent(comp.type);
    // an SDK component's declared actions (reload, open a URL…): the node can run one
    var actions = (typeDef && typeDef.nexa && typeDef.nexa.actionList) || [];
    var actionSel = null, paramsInput = null, handle = null;
    var cfg = clone(node.props.config || {});
    // the old dialog kept "" for a blank (kept) field: not set
    Object.keys(cfg).forEach(function (k) { if (cfg[k] === "" || cfg[k] === null || cfg[k] === undefined) delete cfg[k]; });

    window.RED.tray.show({
        id: "nexa-logic-uiupdate-editor",
        title: "Update Component",
        width: 520,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Done", "class": "primary",
                click: function () {
                    node.props.config = cfg;
                    var act = actionSel ? actionSel.val() : "";
                    if (act) {
                        node.props.action = act;
                        var rawParams = paramsInput ? String(paramsInput.val() || "").trim() : "";
                        if (rawParams) {
                            try { node.props.actionParams = JSON.parse(rawParams); } catch (e) { node.props.actionParams = rawParams; }
                        } else delete node.props.actionParams;
                    } else { delete node.props.action; delete node.props.actionParams; }
                    markDirty();
                    window.RED.tray.close();
                }
            }
        ],
        close: function () { if (handle) { handle.destroy(); handle = null; } },
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px", overflow: "auto" });
            if (!comp || (!typeDef && !isLitComponent)) {
                window.$("<div>").text("This component no longer exists.").appendTo(body);
                return;
            }
            // What it does: set properties, or run one of the component's actions
            var propsBox = body;
            if (actions.length) {
                var arow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
                window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888" }).text("What it does").appendTo(arow);
                actionSel = window.$("<select>").css({ width: "100%" }).appendTo(arow);
                window.$("<option>", { value: "" }).text("Set its properties").appendTo(actionSel);
                actions.forEach(function (a) { window.$("<option>", { value: a.name }).text("Run: " + (a.label || a.name)).appendTo(actionSel); });
                actionSel.val(node.props.action || "");
                var pbox = window.$("<div>").css({ "margin-top": "8px" }).appendTo(arow);
                window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888" }).text("Its parameters (JSON or text), when msg.payload has none").appendTo(pbox);
                paramsInput = window.$("<input>", { type: "text", placeholder: "e.g. {\"url\": \"https://…\"}" }).css({ width: "100%", "box-sizing": "border-box", "font-family": "monospace" })
                    .val(node.props.actionParams === undefined ? "" : (typeof node.props.actionParams === "string" ? node.props.actionParams : JSON.stringify(node.props.actionParams))).appendTo(pbox);
                var phelp = window.$("<div>").css({ "font-size": "11px", color: "#888", "margin-top": "4px" }).appendTo(pbox);
                propsBox = window.$("<div>").appendTo(body);
                var sync = function () {
                    var a = actions.filter(function (x) { return x.name === actionSel.val(); })[0];
                    pbox.toggle(!!a);
                    propsBox.toggle(!a);
                    var ps = a && a.params ? Object.keys(a.params) : [];
                    phelp.text(a ? (ps.length ? "msg.payload = { " + ps.map(function (k) { return k + (a.params[k].label ? " (" + a.params[k].label + ")" : ""); }).join(", ") + " }" : "No parameters.") + " msg.action = another action's name also works." : "");
                };
                actionSel.on("change", sync);
                sync();
            }
            window.$("<div>").addClass("nexa-uiupdate-help").css({ "font-size": "12px", color: "#888", "margin-bottom": "8px" })
                .text("Only what you set changes; the rest is kept. A set value can be a binding: Message → payload.speed takes it from the message this node gets.")
                .appendTo(propsBox);
            var host = window.$("<div>").addClass("nexa-uiupdate-tree").appendTo(propsBox);
            if (!window.NexaKit) { host.text("The property kit is not loaded."); return; }
            var nexa = typeDef && typeDef.nexa;
            var meta = {
                id: "ui-update:" + comp.type, label: nexa ? nexa.label : comp.type,
                props: updatableProps(comp, typeDef), stateList: [], partList: [], inputs: [], outputs: [], eventList: [], actionList: [],
                groupOrder: ["Position & Size"].concat(nexa && nexa.groupOrder ? nexa.groupOrder : [])
            };
            handle = window.NexaKit.renderInspector(host.get(0), {
                meta: meta,
                props: function () { return cfg; },
                persistKey: "ui-update",
                fallbacks: false,
                set: function (k, v) {
                    if (k.charAt(0) === "_" || !meta.props[k]) return;   // __fallback / __previewState: not the node's
                    cfg[k] = v;
                },
                keep: {
                    isSet: function (k) { return Object.prototype.hasOwnProperty.call(cfg, k); },
                    keep: function (k) { delete cfg[k]; }
                }
            });
        }
    });
}

// Reachable from the browser console and the tests.
if (typeof window !== "undefined") window.__nexaEditor = Object.assign(window.__nexaEditor || {}, { openUiUpdateNodeEditor: openUiUpdateNodeEditor });
