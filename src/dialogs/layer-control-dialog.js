import { markDirty } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

// One plain JSON typedInput field (types locked to just "json", so there's
// no str/num/bool switcher to accidentally pick) instead of a per-row
// name/state list-editor — deliberately simple, matching how a Function
// node's own msg.payload would already be shaped: [{name, state}].
export function openLayerControlNodeEditor(node) {
    var statesInput;
    window.RED.tray.show({
        id: "nexa-logic-layercontrol-editor",
        title: "Configure Layer Control Node",
        width: 450,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    var raw = (typeof statesInput.typedInput === "function") ? statesInput.typedInput("value") : statesInput.val();
                    try {
                        var parsed = JSON.parse(raw);
                        node.states = Array.isArray(parsed) ? parsed : [];
                    } catch (e) {
                        node.states = [];
                    }
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("Shows, hides or removes nodes of this screen's Hierarchy (usually groups) by name. Can be overridden at runtime by an incoming msg.payload with the same array shape.")
                .appendTo(body);

            var row = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888", "margin-bottom": "4px" }).text("Visibility by node name (JSON array)").appendTo(row);
            var initialText = JSON.stringify((node.states && node.states.length) ? node.states : [{ name: "Group 1", state: "show" }], null, 2);
            statesInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).appendTo(row);
            if (typeof statesInput.typedInput === "function") {
                statesInput.typedInput({ default: "json", types: ["json"] });
                statesInput.typedInput("value", initialText);
            } else {
                statesInput.val(initialText);
            }

            window.$("<div>").css({ "font-size": "11px", color: "#aaa", "margin-top": "6px" })
                .html('Example: <code>[{"name":"Popup","state":"hide"}]</code> &mdash; state is one of "show", "hide" (drawn, not visible), "remove" (not drawn). What is inside a node follows it.')
                .appendTo(body);
        }
    });
}
