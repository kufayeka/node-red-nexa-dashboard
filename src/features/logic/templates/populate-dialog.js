import { markDirty, getActiveScreen, Tree, Layout, state } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";

// The "Populate" Logic node (the repeater, see src/runtime/
// runPopulate): a template repeated, one copy per item of an array, into the
// frame(s) of the Layout node(s) it is wired to. Each copy gets the item in the
// param the template declares, and `index`; its own Logic runs per copy, and an
// event from inside it carries msg.item / msg.index.
var MODES = [
    ["replace", "Replace the list (kept / updated / added / removed by key)"],
    ["append", "Append (always adds)"], ["prepend", "Prepend (always adds)"],
    ["upsert", "Update by key (add when new)"],
    ["remove", "Remove by key"], ["clear", "Clear"]
];

function frameLabel(f) {
    return (f.name || "Frame") + " #" + f.id.slice(-4) + "  ·  " + (Layout.hasAutoLayout(f) ? { horizontal: "row", vertical: "column", grid: "grid" }[Layout.layoutOf(f).mode] : "no auto layout") + "  ·  " + Tree.kids(f).length + " children";
}

// The "Layout" Logic node: one frame of this surface. A Populate wired into it fills it.
export function openLayoutNodeEditor(node) {
    var screen = getActiveScreen();
    var frames = screen ? Tree.allNodes(screen).filter(function (n) { return n.type === "@frame"; }) : [];
    var chosen = node.props.container || "";
    window.RED.tray.show({
        id: "nexa-logic-layout-editor",
        title: "Configure Layout Node",
        width: 420,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            { text: "Save", "class": "primary", click: function () { node.props.container = chosen; markDirty(); renderLogicCanvas(); window.RED.tray.close(); } }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("A frame of this screen as a Logic node. Wire a Populate node into it: the copies go into this frame. Its output sends what a copy sends to its host (a \"Send to Host\" node in the template), with msg.item, msg.index and msg.output. Tip: select the frame on the canvas — its chip lights up in the Events tab.").appendTo(body);
            var sel = window.$("<select>").css({ width: "100%" }).appendTo(body);
            if (!frames.length) window.$("<option>", { value: "" }).text("(no frame on this surface)").appendTo(sel);
            frames.forEach(function (f) { window.$("<option>", { value: f.id }).text(frameLabel(f)).appendTo(sel); });
            sel.val(chosen);
            chosen = sel.val() || "";
            sel.on("change", function () { chosen = sel.val(); });
        }
    });
}

export function openPopulateNodeEditor(node) {
    var templates = (state.templates || []).filter(function (t) { return !(state.editingMode === "template" && t.id === state.activeTemplateId); });
    var d = { template: node.props.template || "", mode: node.props.mode || "replace", key: node.props.key === undefined ? "id" : node.props.key,
        valueSource: node.props.valueSource || "payload", msgPath: node.props.msgPath || "payload.items", value: node.props.value, fill: !!node.props.fill,
        virtualize: !!node.props.virtualize, itemParam: node.props.itemParam };
    // the template declares its params; each card's item goes into the one chosen here
    function paramsOf(tid) { var t = templates.filter(function (x) { return x.id === tid; })[0]; return (t && t.params || []).map(function (p) { return p.name; }).filter(Boolean); }

    window.RED.tray.show({
        id: "nexa-logic-populate-editor",
        title: "Configure Populate Node",
        width: 480,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    Object.keys(d).forEach(function (k) { node.props[k] = d[k]; });
                    delete node.props.container;   // where it goes: the Layout node(s) it is wired to
                    if (d.valueSource !== "static") delete node.props.value;
                    if (d.valueSource !== "msg") delete node.props.msgPath;
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("Repeats a template, one copy per item, into the Layout node(s) it is wired to. Each copy gets its item in the template param chosen below ({param.field} inside) and {index}; the template's own Logic runs per copy (e.g. a button → HTTP Request with body {param}), and an event from inside a copy gives msg.item / msg.index.")
                .appendTo(body);
            var label = function (text) { return window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888", margin: "8px 0 4px" }).text(text).appendTo(body); };
            var select = function (key, options, onChange) {
                var sel = window.$("<select>").css({ width: "100%" }).appendTo(body);
                options.forEach(function (o) { window.$("<option>", { value: o[0] }).text(o[1]).appendTo(sel); });
                sel.val(d[key]);
                if (!sel.val() && options[0]) { sel.val(options[0][0]); d[key] = options[0][0]; }
                sel.on("change", function () { d[key] = sel.val(); if (onChange) onChange(); });
                return sel;
            };
            label("Template (one copy per item)");
            select("template", templates.length ? templates.map(function (t) { return [t.id, t.name + (t.kind === "component" ? " (Component)" : "")]; }) : [["", "(no templates yet)"]], function () { d.itemParam = undefined; fillParams(); });
            label("Pass each item into the template's param");
            var paramSel = window.$("<select>").css({ width: "100%" }).appendTo(body).on("change", function () { d.itemParam = paramSel.val(); });
            var paramHint = window.$("<div>").css({ "font-size": "11px", color: "#b00", "margin-top": "4px" }).appendTo(body);
            function fillParams() {
                paramSel.empty();
                var names = paramsOf(d.template);
                if (names.indexOf(d.itemParam) === -1) d.itemParam = names[0];
                names.forEach(function (n) { window.$("<option>", { value: n }).text(n + "   → in the template: {" + n + ".field}").appendTo(paramSel); });
                paramSel.val(d.itemParam || "");
                paramSel.toggle(names.length > 0);
                paramHint.text(names.length ? "" : "This template declares no params yet: add one in the Templates tab (e.g. product), then bind {product.name} inside it.");
            }
            fillParams();
            label("Mode");
            select("mode", MODES);
            label("Key (the item field that identifies it, e.g. id; a string / number item — an image URL — is its own key)");
            window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(d.key).appendTo(body).on("change", function () { d.key = this.value.trim(); });
            label("Items");
            var srcSel = select("valueSource", [["payload", "msg.payload"], ["msg", "A msg property…"], ["static", "A fixed list (JSON)"]], function () { sync(); });
            var path = window.$("<input>", { type: "text", placeholder: "payload.data.items" }).css({ width: "100%", "box-sizing": "border-box", "margin-top": "6px" })
                .val(d.msgPath).appendTo(body).on("change", function () { d.msgPath = this.value.trim(); });
            var json = window.$("<textarea>", { rows: 4, placeholder: '[{"id": 1, "name": "Kopi", "price": 45000}]' }).css({ width: "100%", "box-sizing": "border-box", "font-family": "monospace", "margin-top": "6px" })
                .val(d.value !== undefined ? JSON.stringify(d.value, null, 1) : "").appendTo(body)
                .on("change", function () { try { d.value = this.value.trim() ? JSON.parse(this.value) : []; window.$(this).css("border-color", ""); } catch (e) { window.$(this).css("border-color", "#d00"); } });
            var fillRow = window.$("<label>").css({ display: "flex", gap: "6px", "align-items": "center", "margin-top": "10px", "font-size": "12px" }).appendTo(body);
            window.$("<input>", { type: "checkbox" }).prop("checked", d.fill).appendTo(fillRow).on("change", function () { d.fill = this.checked; });
            window.$("<span>").text("Each copy fills the frame's width (or once, on the template: On the live page → Width: Fill)").appendTo(fillRow);
            var virtRow = window.$("<label>").css({ display: "flex", gap: "6px", "align-items": "flex-start", "margin-top": "8px", "font-size": "12px" }).appendTo(body);
            window.$("<input>", { type: "checkbox" }).prop("checked", d.virtualize).appendTo(virtRow).on("change", function () { d.virtualize = this.checked; });
            window.$("<span>").html("Virtualize: only the copies in view are drawn, for thousands of items. The frame scrolls; every copy has the template's size.<br><span style=\"color:#888\">A copy's own variables reset when it scrolls out: keep such state in the item or a screen / app variable.</span>").appendTo(virtRow);
            function sync() { path.toggle(d.valueSource === "msg"); json.toggle(d.valueSource === "static"); }
            sync();
            srcSel.trigger("blur");
        }
    });
}
