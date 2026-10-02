import { getActiveScreen, markDirty, Tree, Layout } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";

// The "Open" / "Close" Logic nodes of a dialog / drawer (a frame with an overlay, see
// src/model/layout.js overlayOf; src/runtime/ openOverlay / closeOverlay).
//   Open   opens it (on top of any open one); its OUTPUT fires when it closes:
//          msg.payload = the result, msg.closedBy = backdrop | esc | timer | node
//   Close  closes it — or, with none chosen, the one on top — with msg.payload as the result

export function overlaysOf(screen) {
    return screen ? Tree.allNodes(screen).filter(function (n) { return !!Layout.overlayOf(n); }) : [];
}
export function overlayLabel(n) {
    var o = Layout.overlayOf(n);
    return (n.name || (o && o.kind === "drawer" ? "Drawer" : "Dialog")) + " #" + n.id.slice(-4);
}

export function openOverlayNodeEditor(node) {
    var screen = getActiveScreen();
    var list = overlaysOf(screen);
    var d = { overlay: node.overlay || "", valueSource: node.valueSource || "payload" };
    var close = node.type === "overlay-close";
    window.RED.tray.show({
        id: "nexa-logic-overlay-editor",
        title: close ? "Configure Close Node" : "Configure Open Node",
        width: 440,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            { text: "Save", "class": "primary", click: function () {
                node.overlay = d.overlay;
                if (close) node.valueSource = d.valueSource;
                markDirty(); renderLogicCanvas(); window.RED.tray.close();
            } }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px", "line-height": "1.45" })
                .text(close
                    ? "Closes a dialog / drawer. The Open node that opened it continues with msg.payload = the result (below), msg.closedBy = \"node\"."
                    : "Opens a dialog / drawer on top of any open one. This node's output fires when it closes: msg.payload = the result (a Close node's), msg.closedBy = backdrop / esc / timer / node. The message it was opened with is in its On Open event.")
                .appendTo(body);
            var sel = window.$("<select>").css({ width: "100%" }).appendTo(body);
            if (close) window.$("<option>", { value: "" }).text("The one on top (the last opened)").appendTo(sel);
            if (!list.length && !close) window.$("<option>", { value: "" }).text("(no dialog / drawer here: Frame → Overlay → Show as)").appendTo(sel);
            list.forEach(function (n) { window.$("<option>", { value: n.id }).text(overlayLabel(n)).appendTo(sel); });
            sel.val(d.overlay);
            d.overlay = sel.val() || "";
            sel.on("change", function () { d.overlay = sel.val(); });
            if (close) {
                window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888", margin: "12px 0 4px" }).text("Result").appendTo(body);
                var rs = window.$("<select>").css({ width: "100%" }).appendTo(body);
                [["payload", "msg.payload (e.g. the form's data)"], ["none", "None (null: cancelled)"]].forEach(function (o) { window.$("<option>", { value: o[0] }).text(o[1]).appendTo(rs); });
                rs.val(d.valueSource).on("change", function () { d.valueSource = rs.val(); });
            }
        }
    });
}
