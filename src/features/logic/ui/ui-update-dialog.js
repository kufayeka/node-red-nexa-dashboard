// --- The Update node's dialog: What it does (cards), then the property tree, keep / set --------
// Two kinds of Update node:
//   - of a COMPONENT (node.props.compId): its own props (the Properties tab's tree: its place and
//     size, its own groups), never the items of its target lists (a chart's series);
//   - of ONE ITEM of a target list (node.props.item = { list, id }: one series of a chart): only that
//     item's fields and that item's actions. Its message is the item's own: its fields bound to
//     Message read the message sent to THIS node (two series can both bind msg.payload).
// What it does: "Set properties" or one of the actions, each a card saying what it is for and the
// message it expects. A prop not set shows "keep"; a set value is static or a binding (Message →
// payload.speed: from the message this node gets). A prop bound in the Properties is left to it.
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

// a prop already bound (in the Properties): not set here, its own binding decides
function keepBound(p, now, where) {
    if (isBindingList(now) || isLegacyBinding(now)) {
        p.enabledWhen = function () { return false; };
        p.help = "Bound in " + where + " (Binding): this node's message reaches it through a Message source there.";
    } else if (now !== undefined) p.default = clone(now);
    p.noReset = false;
    return p;
}

/** The props a component's Update node can set (defaults = the component's values now). */
export function updatableProps(comp, typeDef) {
    var out = {};
    Object.keys(GEOMETRY).forEach(function (k) {
        out[k] = normalizeProp(k, Object.assign({ group: "Position & Size", default: comp[k] !== undefined ? comp[k] : 0 }, GEOMETRY[k]));
    });
    var own = {};
    var targets = typeDef && typeDef.nexa && typeDef.nexa.targetList ? typeDef.nexa.targetList.map(function (t) { return t.key; }) : [];
    if (comp.type === "@lit-component") {
        (comp.litBindable || []).forEach(function (p) {
            var type = p.type === "number" || p.type === "boolean" || p.type === "color" ? p.type : p.type === "object" || p.type === "array" ? "json" : "string";
            own[p.name] = normalizeProp(p.name, { type: type, default: p.defaultValue, group: "Properties" });
        });
    } else if (typeDef && typeDef.nexa) {
        Object.keys(typeDef.nexa.props).forEach(function (k) {
            var p = typeDef.nexa.props[k];
            // its target lists (a chart's series) have Update nodes of their own
            if (SKIP_TYPES[p.type] || k.charAt(0) === "_" || targets.indexOf(k) !== -1) return;
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
    Object.keys(own).forEach(function (k) { out[k] = keepBound(own[k], props[k], "the component's Properties"); });
    return out;
}

/** The fields an item's Update node can set: the item's own (its section = the group). */
export function itemProps(target, listProp, item) {
    var out = {}, fields = (listProp.item && listProp.item.fields) || {};
    Object.keys(fields).forEach(function (k) {
        var f = fields[k];
        if (SKIP_TYPES[f.type] || k === target.idField) return;
        var p = normalizeProp(k, Object.assign({}, f, { group: f.section || "General" }));
        delete p.section;
        delete p.visibleWhen;   // an item field's visibleWhen takes the item; here every field shows
        out[k] = keepBound(p, item ? item[k] : undefined, "its Properties");
    });
    return out;
}

// a short text for an action's params (what msg.payload holds)
function paramsText(a) {
    if (a.example !== undefined) return typeof a.example === "string" ? a.example : JSON.stringify(a.example);
    var ps = a.params ? Object.keys(a.params) : [];
    if (!ps.length) return "";
    return "{ " + ps.map(function (k) { var t = a.params[k]; return k + ": " + (typeof t === "string" ? t : t && t.type ? t.type : "…"); }).join(", ") + " }";
}

var cssDone = false;
function ensureCss() {
    if (cssDone) return;
    cssDone = true;
    var st = document.createElement("style");
    st.textContent = [
        ".nexa-uu-cards{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}",
        ".nexa-uu-card{display:flex;gap:8px;align-items:flex-start;border:1px solid #d0d0d0;border-radius:4px;padding:8px 10px;cursor:pointer;background:#fff}",
        ".nexa-uu-card:hover{border-color:#8aa4c8}",
        ".nexa-uu-card.on{border-color:#0f62fe;box-shadow:inset 3px 0 0 #0f62fe;background:#f4f8ff}",
        ".nexa-uu-card input{margin-top:3px}",
        ".nexa-uu-card b{display:block;font-size:12.5px;color:#161616}",
        ".nexa-uu-card span{display:block;font-size:11.5px;color:#525252;margin-top:2px}",
        ".nexa-uu-card code{display:block;font-size:11px;color:#0f62fe;margin-top:4px;white-space:pre-wrap;font-family:monospace}",
        ".nexa-uu-head{font-size:11px;color:#888;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em}",
        ".nexa-uu-params label{display:block;font-size:11px;color:#888;margin:4px 0 2px}"
    ].join("\n");
    document.head.appendChild(st);
}

export function openUiUpdateNodeEditor(node) {
    var comp = findComponent(node.props.compId);
    var isLitComponent = comp && comp.type === "@lit-component";
    var typeDef = comp && !isLitComponent && window.NEXA.getComponent(comp.type);
    var nexa = typeDef && typeDef.nexa;
    // one item of a target list (a series)?
    var ref = node.props.item && node.props.item.list ? node.props.item : null;
    var target = ref && nexa ? (nexa.targetList || []).filter(function (t) { return t.key === ref.list; })[0] : null;
    var listProp = target ? nexa.props[target.key] : null;
    var items = target && typeDef.targetItems ? typeDef.targetItems(comp.props, target.key) : [];
    var item = target ? items.filter(function (it) { return it && it[target.idField] === ref.id; })[0] : null;
    var itemName = item ? (item.name || item.label || ref.id) : ref ? ref.id : "";

    var actions = (target ? target.actionList : nexa && nexa.actionList) || [];
    var choice = node.props.action && actions.some(function (a) { return a.name === node.props.action; }) ? node.props.action : "";
    var paramsInput = null, handle = null;
    var cfg = clone(node.props.config || {});
    // the old dialog kept "" for a blank (kept) field: not set
    Object.keys(cfg).forEach(function (k) { if (cfg[k] === "" || cfg[k] === null || cfg[k] === undefined) delete cfg[k]; });

    window.RED.tray.show({
        id: "nexa-logic-uiupdate-editor",
        title: ref ? "Update " + (target ? target.noun : "item") + ": " + itemName : "Update Component",
        width: 560,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Done", "class": "primary",
                click: function () {
                    node.props.config = cfg;
                    if (choice) {
                        node.props.action = choice;
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
            ensureCss();
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px", overflow: "auto" });
            if (!comp || (!typeDef && !isLitComponent) || (ref && (!target || !item))) {
                window.$("<div>").text(ref ? "This " + (target ? target.noun : "item") + " is not in the component any more." : "This component no longer exists.").appendTo(body);
                return;
            }
            if (ref) {
                window.$("<div>").css({ "font-size": "12px", color: "#525252", "margin-bottom": "10px" })
                    .text("This node updates only the " + target.noun + " \"" + itemName + "\" (Id " + ref.id + "). Its message is its own: a field bound to Message reads the message sent to this node.")
                    .appendTo(body);
            }

            // ---- What it does: cards --------------------------------------------------------
            window.$("<div>").addClass("nexa-uu-head").text("What it does").appendTo(body);
            var cards = window.$("<div>").addClass("nexa-uu-cards").appendTo(body);
            var propsBox = window.$("<div>");
            var pbox = window.$("<div>").addClass("nexa-uu-params");
            function card(value, title, text, code) {
                var c = window.$("<label>").addClass("nexa-uu-card").attr("data-action", value).appendTo(cards);
                window.$("<input>", { type: "radio", name: "nexa-uu-what" }).prop("checked", choice === value).appendTo(c)
                    .on("change", function () { choice = value; sync(); });
                var t = window.$("<div>").appendTo(c);
                window.$("<b>").text(title).appendTo(t);
                if (text) window.$("<span>").text(text).appendTo(t);
                if (code) window.$("<code>").text(code).appendTo(t);
            }
            card("", "Set properties", ref
                ? "Changes the " + target.noun + "'s properties you set below, each time a message arrives. The rest stay as they are."
                : "Changes the properties you set below, each time a message arrives. The rest stay as they are.", "");
            actions.forEach(function (a) {
                var pt = paramsText(a);
                card(a.name, a.label, a.help || "", pt ? "msg.payload = " + pt : "msg.payload: not needed");
            });

            pbox.appendTo(body);
            window.$("<label>").text("Its parameters when msg.payload has none (JSON or text)").appendTo(pbox);
            paramsInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box", "font-family": "monospace" })
                .val(node.props.actionParams === undefined ? "" : (typeof node.props.actionParams === "string" ? node.props.actionParams : JSON.stringify(node.props.actionParams))).appendTo(pbox);
            window.$("<div>").css({ "font-size": "11px", color: "#888", margin: "4px 0 12px" })
                .text("msg.action = \"<name>\" (from a Function) runs another action of the same list.").appendTo(pbox);

            propsBox.appendTo(body);
            function sync() {
                cards.children().each(function () { var c = window.$(this); c.toggleClass("on", c.attr("data-action") === choice); });
                pbox.toggle(!!choice);
                propsBox.toggle(!choice);
            }
            sync();

            // ---- Set properties: the property tree, keep / set ------------------------------
            window.$("<div>").addClass("nexa-uu-head").text(ref ? "The " + target.noun + "'s properties" : "Properties").appendTo(propsBox);
            window.$("<div>").addClass("nexa-uiupdate-help").css({ "font-size": "12px", color: "#888", "margin-bottom": "8px" })
                .text("Only what you set changes; the rest is kept. A set value can be a binding: Message → payload.speed takes it from the message this node gets.")
                .appendTo(propsBox);
            var host = window.$("<div>").addClass("nexa-uiupdate-tree").appendTo(propsBox);
            if (!window.NexaKit) { host.text("The property kit is not loaded."); return; }
            var props = ref ? itemProps(target, listProp, item) : updatableProps(comp, typeDef);
            var groups = [];
            Object.keys(props).forEach(function (k) { var g = props[k].group || "General"; if (groups.indexOf(g) === -1) groups.push(g); });
            var meta = {
                id: "ui-update:" + comp.type + (ref ? ":" + ref.list : ""), label: nexa ? nexa.label : comp.type,
                props: props, stateList: [], partList: [], inputs: [], outputs: [], eventList: [], actionList: [],
                groupOrder: ref ? groups : ["Position & Size"].concat(nexa && nexa.groupOrder ? nexa.groupOrder : [])
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
