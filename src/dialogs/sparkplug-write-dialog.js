import { markDirty } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";
import { listKnownSparkplugBindings, parseSparkplugBindingPath } from "../canvas/sparkplug-live.js";

// Config dialog for a single "Sparkplug Write" node — value always comes
// from msg.payload at runtime (see runLogicGraph), so the only thing to
// configure here is WHICH tag. v1 scope limit (documented in
// runLogicGraph's own comment): the tag must be a fully concrete
// "{sparkplug:group::edge::device::metric}" binding, not one with an
// embedded "{param}" placeholder the way a component's own bound prop can
// have — a Logic node cloned into a nested "@template" instance carries no
// paramState of its own today.
export function openSparkplugWriteNodeEditor(node) {
    var tagInput, listSelect;
    window.RED.tray.show({
        id: "nexa-logic-sparkplug-write-editor",
        title: "Configure Sparkplug Write",
        width: 480,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.tag = (tagInput.val() || "").trim();
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("Publishes a Sparkplug DCMD/NCMD write when this node runs, with the value taken from msg.payload. Wire a \"ui-event\" (e.g. a button click) into this node.")
                .appendTo(body);

            var knownBindings = listKnownSparkplugBindings();
            if (knownBindings.length) {
                var pickRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(body);
                window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888" }).text("Pick a known tag (optional shortcut)").appendTo(pickRow);
                listSelect = window.$("<select>").css({ width: "100%" }).appendTo(pickRow);
                window.$("<option>", { value: "" }).text("(select to fill in below)").appendTo(listSelect);
                knownBindings.forEach(function (b) {
                    window.$("<option>", { value: b.binding }).text(b.label).appendTo(listSelect);
                });
                listSelect.on("change", function () {
                    var v = listSelect.val();
                    if (v) tagInput.val(v);
                });
            } else {
                window.$("<div>").css({ "font-size": "11px", color: "#a66", "margin-bottom": "8px" })
                    .text("No Sparkplug tags seen yet — open the \"MQTT Sparkplug\" sidebar tab first so tags show up here, or just type the binding below.")
                    .appendTo(body);
            }

            var row = window.$("<div>").css({ "margin-bottom": "4px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888" }).text("Sparkplug Tag").appendTo(row);
            tagInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" })
                .attr("placeholder", "{sparkplug:group::edgeNode::device::metric}")
                .val(node.tag || "").appendTo(row);

            var hint = window.$("<div>").css({ "font-size": "11px", "margin-top": "4px" }).appendTo(body);
            function updateHint() {
                var ref = parseSparkplugBindingPath(tagInput.val());
                if (!tagInput.val()) { hint.text(""); return; }
                hint.css("color", ref ? "#2f8f6f" : "#a66").text(ref ? "Valid tag." : "Not a valid {sparkplug:...} binding.");
            }
            tagInput.on("input", updateHint);
            updateHint();
        }
    });
}
