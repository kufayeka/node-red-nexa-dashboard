// --- Breakpoints tab: the app's breakpoints (src/model/breakpoints.js) -------------
// Bands of window widths, the Tailwind way (xs sm md lg xl 2xl 3xl): each starts at
// its "from" width, up to the next one. A screen is designed in the band of its own
// width (★ on the canvas bar); the others adjust it (a field's 📱 / the canvas bar).
// The list is the app's (project.breakpoints; empty = the defaults). Renaming keeps a
// breakpoint's id, so what was set for it stays; "Preview at" is only the width the
// editor shows it at (a device preset or any width inside the band).
import { state, markDirty, getApp, getActiveScreen } from "../state.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { leaveBreakpoint } from "../canvas/breakpoints-ui.js";
import * as BP from "../model/breakpoints.js";

function list() {
    var app = getApp();
    return app.breakpoints && app.breakpoints.length ? app.breakpoints : BP.DEFAULT_BREAKPOINTS;
}
// the first change makes the defaults the app's own list
function own() {
    var app = getApp();
    if (!Array.isArray(app.breakpoints) || !app.breakpoints.length) app.breakpoints = JSON.parse(JSON.stringify(BP.DEFAULT_BREAKPOINTS));
    return app.breakpoints;
}
function changed(rebuild) {
    leaveBreakpoint();      // the canvas goes back to the design: the bands just changed
    markDirty();
    renderActiveScreen();
    if (rebuild) renderBreakpointsPanel();
    else refreshRanges();
}
function slug(name, taken) {
    var base = String(name || "bp").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "bp";
    var id = base, n = 1;
    while (taken.indexOf(id) !== -1) id = base + "-" + (++n);
    return id;
}

var rangeCells = {};
function refreshRanges() {
    var app = getApp();
    Object.keys(rangeCells).forEach(function (id) { rangeCells[id].text(BP.rangeOf(app, id)); });
}

export function renderBreakpointsPanel() {
    var pane = state.breakpointsPane;
    if (!pane) return;
    pane.empty();
    rangeCells = {};
    var app = getApp();
    var muted = "var(--red-ui-secondary-text-color, #888)";
    window.$("<div>").css({ "font-size": "11px", color: muted, "margin-bottom": "8px", "line-height": "1.4" })
        .html("The app's breakpoints: bands of window widths (like Tailwind's <code>sm md lg xl</code>). A screen is designed in the band of its own width (<i class=\"fa fa-star\"></i> on the canvas bar); every other band can change a field — its <i class=\"fa fa-mobile\"></i> — or anything, on the canvas bar. Desktop-first: a narrower band inherits from the next wider one.")
        .appendTo(pane);
    var screen = getActiveScreen();
    if (screen) window.$("<div>").css({ "font-size": "11px", "margin-bottom": "8px" })
        .html("<b>" + window.$("<span>").text(screen.name || "This screen").html() + "</b> (" + screen.width + " px) is designed in <b>" + BP.designBreakpoint(app, screen) + "</b>.")
        .appendTo(pane);

    var table = window.$("<table>").css({ width: "100%", "border-collapse": "collapse", "font-size": "11px" }).appendTo(pane);
    window.$("<tr>").html('<th style="text-align:left">Name</th><th style="text-align:left">From (px)</th><th style="text-align:left">Range</th><th></th>')
        .css({ color: muted }).appendTo(table);
    var bps = BP.breakpointsOf(app).slice().reverse();   // widest first, like the bar
    bps.forEach(function (b) {
        var row = window.$("<tr>", { "data-breakpoint": b.id }).css({ "border-top": "1px solid var(--red-ui-secondary-border-color, #eee)" }).appendTo(table);
        var find = function () { return own().filter(function (x) { return x.id === b.id; })[0]; };
        var name = window.$("<input>", { type: "text", "class": "nexa-bp-name" }).val(b.name).css({ width: "60px" });
        name.on("change", function () {
            var v = String(name.val() || "").trim();
            if (!v) { name.val(b.name); return; }
            find().name = v;
            changed(false);
        });
        var first = b.min === 0 && bps[bps.length - 1].id === b.id;
        var min = window.$("<input>", { type: "number", min: 0, step: 1, "class": "nexa-bp-min" }).val(b.min).css({ width: "64px" }).prop("disabled", first)
            .attr("title", first ? "The narrowest breakpoint starts at 0" : "The window width it starts at");
        min.on("change", function () {
            var v = Math.round(Number(min.val()));
            if (!isFinite(v) || v <= 0 || own().some(function (x) { return x.id !== b.id && Number(x.min) === v; })) { min.val(find().min); return; }
            find().min = v;
            changed(true);   // the order may change
        });
        window.$("<td>").css({ padding: "4px 2px" }).append(name).appendTo(row);
        window.$("<td>").css({ padding: "4px 2px" }).append(min).appendTo(row);
        rangeCells[b.id] = window.$("<td>").css({ padding: "4px 2px", color: muted, "white-space": "nowrap" }).text(BP.rangeOf(app, b.id)).appendTo(row);
        var del = window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Delete this breakpoint (what was set for it is no longer used)" }).html('<i class="fa fa-trash-o"></i>')
            .prop("disabled", bps.length <= 1)
            .on("click", function () {
                var mine = own();
                mine.splice(mine.indexOf(find()), 1);
                if (!mine.some(function (x) { return Number(x.min) === 0; })) {
                    var lowest = mine.slice().sort(function (a, c) { return a.min - c.min; })[0];
                    if (lowest) lowest.min = 0;
                }
                changed(true);
            });
        window.$("<td>").css({ padding: "4px 2px", "text-align": "right" }).append(del).appendTo(row);

        // the second line: the device it stands for, and the width the editor shows it at
        var row2 = window.$("<tr>", { "data-breakpoint-preview": b.id }).appendTo(table);
        var cell = window.$("<td>", { colspan: 4 }).css({ padding: "0 2px 6px" }).appendTo(row2);
        var device = window.$("<input>", { type: "text", "class": "nexa-bp-device", placeholder: "Device (e.g. Tablet)" }).val(b.device || "").css({ width: "45%" });
        device.on("change", function () { find().device = String(device.val() || "").trim(); changed(false); });
        var preview = window.$("<select>", { "class": "nexa-bp-preview", title: "The width the editor shows this breakpoint at" }).css({ width: "52%", "margin-left": "3%" });
        var pw = BP.previewWidthOf(app, b.id);
        window.$("<option>", { value: "" }).text("Preview at " + pw + " px").appendTo(preview);
        var next = BP.breakpointsOf(app).filter(function (x) { return x.min > b.min; })[0];
        BP.DEVICE_PRESETS.filter(function (d) { return d.w >= b.min && (!next || d.w < next.min); }).forEach(function (d) {
            window.$("<option>", { value: String(d.w) }).text(d.name).appendTo(preview);
        });
        window.$("<option>", { value: "custom" }).text("Another width…").appendTo(preview);
        preview.on("change", function () {
            var v = preview.val();
            if (!v) return;
            if (v === "custom") {
                var typed = window.prompt("Preview " + b.name + " at (px, " + BP.rangeOf(app, b.id) + "):", String(pw));
                if (typed === null || !isFinite(Number(typed))) { preview.val(""); return; }
                v = typed;
            }
            find().preview = Math.round(Number(v));
            changed(true);
        });
        cell.append(device).append(preview);
    });

    var bar = window.$("<div>").css({ display: "flex", gap: "6px", "margin-top": "10px" }).appendTo(pane);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small nexa-bp-add" }).html('<i class="fa fa-plus"></i> Breakpoint').appendTo(bar)
        .on("click", function () {
            var mine = own();
            var widest = mine.slice().sort(function (a, c) { return c.min - a.min; })[0];
            var min = (widest ? Number(widest.min) : 0) + 640;
            var m = widest && /^(\d*)xl$/.exec(widest.name || "");
            var id = slug(m ? (Number(m[1] || 1) + 1) + "xl" : "bp" + (mine.length + 1), mine.map(function (x) { return x.id; }));
            mine.push({ id: id, name: id, min: min, preview: min });
            changed(true);
        });
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "xs 0 · sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536 · 3xl 1920" }).text("Reset to the defaults").appendTo(bar)
        .on("click", function () {
            if (list() !== BP.DEFAULT_BREAKPOINTS && !window.confirm("Go back to the default breakpoints? What was set for a breakpoint whose name is not among them is no longer used.")) return;
            getApp().breakpoints = [];
            changed(true);
        });
    window.$("<div>").css({ "font-size": "11px", color: muted, "margin-top": "10px", "line-height": "1.4" })
        .html("On the live page: <code>{$breakpoint}</code> is the band in use (\"md\", …); an <i>On Breakpoint Change</i> event fires when it changes.")
        .appendTo(pane);
}
