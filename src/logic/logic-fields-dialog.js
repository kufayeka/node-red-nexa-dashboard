// The dialog of a Logic node a plugin defined (the SDK's defineLogicNode): built from its
// `properties` with the property kit's inspector, the same widgets as a component's inspector
// (bindings, tokens, lists…). It edits a copy of node.props; Save writes it back.
import { markDirty } from "../state.js";
import { logicMeta } from "../features/logic/registry.js";

export function hasFieldsDialog(type) {
    const m = logicMeta(type);
    return !!(m.plugin && m.fields && Object.keys(m.fields.props).length);
}

export function openLogicFieldsDialog(node, onSaved) {
    const meta = logicMeta(node.type);
    const draft = JSON.parse(JSON.stringify(node.props || {}));
    Object.keys(meta.fields.props).forEach(function (k) {
        if (!(k in draft)) draft[k] = JSON.parse(JSON.stringify(meta.fields.props[k].default === undefined ? null : meta.fields.props[k].default));
    });
    const kit = window.NexaKit;
    // in this dialog "the message" is the one that reaches the node (ctx.resolve fills it in)
    if (kit && typeof kit.setHost === "function") {
        kit.setHost({
            messageHelp: function (path) { return "The message that reaches this node: msg." + path + " when it runs."; },
            // what ctx.resolve fills in: variables, the message, text mixing them (not tags)
            bindingSources: ["var", "msg", "expr"]
        });
    }
    window.RED.tray.show({
        id: "nexa-logic-fields-editor",
        title: "Configure " + meta.label + " Node",
        width: 520,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.props = draft;
                    markDirty();
                    if (typeof onSaved === "function") onSaved();
                    window.RED.tray.close();
                }
            }
        ],
        close: function () { if (kit && typeof kit.setHost === "function") kit.setHost({ messageHelp: null, bindingSources: null }); },
        open: function (tray) {
            const body = tray.find(".red-ui-tray-body").css({ padding: "12px" }).get(0);
            if (meta.help) {
                const help = document.createElement("div");
                help.style.cssText = "font-size:12px;color:#888;margin-bottom:10px";
                help.textContent = meta.help;
                body.appendChild(help);
            }
            if (!kit || typeof kit.renderInspector !== "function") {
                body.appendChild(document.createTextNode("The property kit isn't loaded."));
                return;
            }
            kit.renderInspector(body, {
                meta: meta.fields,
                props: draft,
                persistKey: "logic:" + node.type,
                // a field holds a value or a binding the node resolves itself (ctx.resolve): no fallback values
                fallbacks: false,
                set: function (key, value) { draft[key] = value; }
            });
        }
    });
}
