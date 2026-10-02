import { state, getActiveScreen, markDirty, Tree } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";

// The "Teleport" Logic node (src/runtime/ teleportEl / teleportHome): a node of
// this surface drawn in a teleport target (a frame's "teleport target" name) or on the page —
// or back home, where it is in the tree. Where to: fixed, or msg.payload (a target's name,
// "@page", or "" / "home"). The msg goes on.

function nodeName(n) { return (n.name || n.type.replace(/^@/, "")) + " #" + n.id.slice(-4); }
function targets() {
    var names = {};
    function walk(list) { (list || []).forEach(function (n) { if (typeof n.slot === "string" && n.slot.trim()) names[n.slot.trim()] = true; walk(n.children); }); }
    (state.screens || []).concat(state.templates || []).forEach(function (s) { walk(s.components); });
    return Object.keys(names).sort();
}

export function teleportNodeLabel(node) {
    var screen = getActiveScreen();
    var n = node.props.node && screen ? Tree.find(screen, node.props.node) : null;
    var who = n ? nodeName(n) : node.props.node ? "(missing node)" : "?";
    if (node.props.toSource === "payload") return "Teleport " + who + " → msg.payload";
    return (node.props.to ? "Teleport " + who + " → " + (node.props.to === "@page" ? "page" : node.props.to) : "Send " + who + " home");
}

export function openTeleportNodeEditor(node) {
    var screen = getActiveScreen();
    var all = screen ? Tree.allNodes(screen) : [];
    var d = { node: node.props.node || "", to: node.props.to === undefined ? "@page" : node.props.to, toSource: node.props.toSource || "static" };
    window.RED.tray.show({
        id: "nexa-logic-teleport-editor",
        title: "Configure Teleport Node",
        width: 440,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            { text: "Save", "class": "primary", click: function () {
                node.props.node = d.node; node.props.to = d.to; node.props.toSource = d.toSource;
                markDirty(); renderLogicCanvas(); window.RED.tray.close();
            } }
        ],
        open: function (tray) {
            var $ = window.$;
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            $("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px", "line-height": "1.45" })
                .text("Draws a node somewhere else on the live page: inside a frame named as a teleport target (Properties → Teleport), or on the page itself (above every frame, out of any clip). \"Home\" puts it back where it is in the tree. Its Logic, params and variables stay as they are. The message goes on.")
                .appendTo(body);
            var label = function (t) { return $("<label>").css({ display: "block", "font-size": "11px", color: "#888", margin: "10px 0 4px" }).text(t).appendTo(body); };
            label("The node");
            var sel = $("<select>").css({ width: "100%" }).appendTo(body);
            if (!all.length) $("<option>", { value: "" }).text("(nothing on this surface)").appendTo(sel);
            all.forEach(function (n) { $("<option>", { value: n.id }).text(nodeName(n) + (n.teleport ? "  ⇢ " + n.teleport : "")).appendTo(sel); });
            sel.val(d.node);
            d.node = sel.val() || "";
            sel.on("change", function () { d.node = sel.val(); });
            label("Where to");
            var src = $("<select>").css({ width: "100%" }).appendTo(body);
            [["static", "A place chosen here"], ["payload", "msg.payload (a target's name, @page, or home)"]].forEach(function (o) { $("<option>", { value: o[0] }).text(o[1]).appendTo(src); });
            src.val(d.toSource);
            var to = $("<select>").css({ width: "100%", "margin-top": "6px" }).appendTo(body);
            $("<option>", { value: "" }).text("Home (where it is in the tree)").appendTo(to);
            $("<option>", { value: "@page" }).text("The page (above every frame)").appendTo(to);
            targets().forEach(function (t) { $("<option>", { value: t }).text("Target: " + t).appendTo(to); });
            if (d.to && d.to !== "@page" && targets().indexOf(d.to) === -1) $("<option>", { value: d.to }).text("Target: " + d.to + " (not on any surface)").appendTo(to);
            to.val(d.to);
            to.toggle(d.toSource !== "payload");
            src.on("change", function () { d.toSource = src.val(); to.toggle(d.toSource !== "payload"); });
            to.on("change", function () { d.to = to.val(); });
        }
    });
}
