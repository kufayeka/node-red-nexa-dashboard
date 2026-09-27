// The template's outputs: "Send to Host" (inside a template: which output it sends
// on) and "On Template Output" (on the surface around an instance: which output
// it listens to). A copy a Populate made sends out of its Layout node instead.
import { state, markDirty, findComponent, findTemplate } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";
import { templateOutputs } from "../sidebar/palette-events-panel.js";

var NAME_RE = /^[A-Za-z_][\w-]*$/;

export function openTemplateOutputNodeEditor(node) {
    var sending = node.type === "template-output";
    var d = { output: node.output === undefined ? (sending ? "out" : "") : node.output };
    var inst = sending ? null : findComponent(node.instanceId);
    var names = inst ? templateOutputs(findTemplate(inst.templateId)) : [];
    window.RED.tray.show({
        id: "nexa-logic-template-output-editor",
        title: sending ? "Configure Send to Host" : "Configure On Template Output",
        width: 420,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    if (sending && !NAME_RE.test(d.output)) return;
                    node.output = d.output;
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            var help = window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px", "line-height": "1.5" }).appendTo(body);
            if (sending) {
                help.html("Sends the message <b>out of this template</b>, to where it is used:<br>" +
                    "• a copy a Populate made → out of the <b>Layout</b> node on the screen, with <code>msg.item</code> and <code>msg.index</code>;<br>" +
                    "• an instance placed on a screen → its <b>On Template Output</b> node there.<br>" +
                    "<code>msg.output</code> is the name below: give each output its own (e.g. <code>open-dialog</code>, <code>delete</code>).");
                window.$("<div>").css({ "font-size": "12px", "font-weight": "600", "margin-bottom": "4px" }).text("Output name").appendTo(body);
                var input = window.$("<input>", { type: "text", placeholder: "out" }).css({ width: "100%", "box-sizing": "border-box" }).val(d.output).appendTo(body);
                var err = window.$("<div>").css({ color: "#c00", "font-size": "11px", "margin-top": "4px" }).appendTo(body);
                input.on("input change", function () {
                    d.output = this.value.trim();
                    err.text(NAME_RE.test(d.output) ? "" : "A name: letters, digits, _ or -, not starting with a digit");
                });
            } else {
                help.html("Fires when this instance's template sends a message out (a <b>Send to Host</b> node inside it). " +
                    "Wire it to what should happen here: open a dialog, a popup, set a variable…");
                window.$("<div>").css({ "font-size": "12px", "font-weight": "600", "margin-bottom": "4px" }).text("Output").appendTo(body);
                var sel = window.$("<select>").css({ width: "100%" }).appendTo(body);
                window.$("<option>", { value: "" }).text("(any output)").appendTo(sel);
                names.concat(d.output && names.indexOf(d.output) === -1 ? [d.output] : []).forEach(function (n) { window.$("<option>", { value: n }).text(n).appendTo(sel); });
                sel.val(d.output);
                sel.on("change", function () { d.output = sel.val(); });
                if (!names.length) window.$("<div>").css({ "font-size": "11px", color: "#a60", "margin-top": "6px" }).text("This template has no Send to Host node yet.").appendTo(body);
            }
        }
    });
}
