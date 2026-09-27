import { markDirty, getActiveScreen, Tree, Layout, state } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

// The "Populate" Logic node (the repeater, see lib/nexa-runtime-client.js
// runPopulate): a container (a row / column / grid frame) filled with a
// template, one card per item of an array. Each card gets the params `item`
// (its object) and `index`; its own Logic runs per card, and an event from
// inside it carries msg.item / msg.index.
var MODES = [
    ["replace", "Replace the list (kept / updated / added / removed by key)"],
    ["append", "Append"], ["prepend", "Prepend"],
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
    var chosen = node.container || "";
    window.RED.tray.show({
        id: "nexa-logic-layout-editor",
        title: "Configure Layout Node",
        width: 420,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            { text: "Save", "class": "primary", click: function () { node.container = chosen; markDirty(); renderLogicCanvas(); window.RED.tray.close(); } }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("A frame of this screen as a Logic node. Wire a Populate node into it: the cards go into this frame. Tip: select the frame on the canvas — its chip lights up in the Events tab.").appendTo(body);
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
    var screen = getActiveScreen();
    var frames = screen ? Tree.allNodes(screen).filter(function (n) { return n.type === "@frame"; }) : [];
    var templates = (state.templates || []).filter(function (t) { return !(state.editingMode === "template" && t.id === state.activeTemplateId); });
    var d = { container: node.container || "", template: node.template || "", mode: node.mode || "replace", key: node.key === undefined ? "id" : node.key,
        valueSource: node.valueSource || "payload", msgPath: node.msgPath || "payload.items", value: node.value, fill: !!node.fill,
        itemParam: node.itemParam };
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
                    Object.keys(d).forEach(function (k) { node[k] = d[k]; });
                    if (d.valueSource !== "static") delete node.value;
                    if (d.valueSource !== "msg") delete node.msgPath;
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("Fills a container with a template, one card per item. Inside the template, bind {item.name}, {index}; the template's own Logic runs per card (e.g. Buy → HTTP Request with body {item}), and an event from inside a card gives msg.item / msg.index.")
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
            label("Container — where the cards go");
            select("container", [["", "The Layout node(s) this is wired to  (recommended)"]].concat(frames.map(function (f) { return [f.id, frameLabel(f)]; })));
            label("Template (one card per item)");
            select("template", templates.length ? templates.map(function (t) { return [t.id, t.name]; }) : [["", "(no templates yet)"]], function () { d.itemParam = undefined; fillParams(); });
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
            label("Key (the item field that identifies it, e.g. id; empty = by position)");
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
            window.$("<span>").text("Cards fill the container's width (a list / table row)").appendTo(fillRow);
            function sync() { path.toggle(d.valueSource === "msg"); json.toggle(d.valueSource === "static"); }
            sync();
            srcSel.trigger("blur");
        }
    });
}
