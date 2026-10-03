// --- Breakpoints tab: the app's breakpoints (src/model/breakpoints.js) -------------
// Bands of window widths, the Tailwind way (xs sm md lg xl 2xl 3xl): each starts at
// its "from" width, up to the next one. A screen is designed in the band of its own
// width (★ on the canvas bar); the others adjust it (a field's 📱 / the canvas bar).
// The list is the app's (project.breakpoints; empty = the defaults), edited as one
// property-kit list (like the Types tab): add, delete, and each row's name, where it
// starts, the width the editor previews it at (a device) and a label. Renaming keeps
// a breakpoint's id, so what was set for it stays.
import { state, markDirty, getApp, getActiveScreen } from "../state.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { leaveBreakpoint } from "../canvas/breakpoints-ui.js";
import * as BP from "../model/breakpoints.js";

function lit() { return window.NEXA_LIT; }
// the device a preview width stands for (a preset of that width)
function deviceAt(w) { var d = BP.DEVICE_PRESETS.filter(function (x) { return x.w === Number(w); })[0]; return d ? d.name : ""; }

function slug(name, taken) {
    var base = String(name || "bp").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "bp";
    var id = base, n = 1;
    while (taken.indexOf(id) !== -1) id = base + "-" + (++n);
    return id;
}

// "iPhone 15 · 393" … : the preview widths offered (and the current one, when it is none of them)
function previewOptions(current) {
    var seen = {};
    var out = BP.DEVICE_PRESETS.map(function (d) { seen[d.w] = true; return { value: d.w, label: d.w + " · " + d.name.replace(/\s*\(.*\)$/, "") }; });
    if (current && !seen[current]) out.unshift({ value: current, label: current + " px" });
    return out.sort(function (a, b) { return a.value - b.value; });
}

export function renderBreakpointsPanel() {
    var pane = state.breakpointsPane;
    if (!pane) return;
    pane.empty();
    if (!window.NexaKit || !lit()) {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("The Breakpoints tab needs the Nexa property kit.").appendTo(pane);
        return;
    }
    var html = lit().html;
    var app = getApp();
    var view = function () {
        return { bps: BP.breakpointsOf(app).slice().reverse().map(function (b) {
            return { id: b.id, name: b.name, min: b.min, preview: BP.previewWidthOf(app, b.id), device: b.device || "" };
        }) };
    };
    var current = view();
    var screen = getActiveScreen();
    // problems with the list (shown on its row and in its pane)
    var problems = function () {
        var mins = {}, names = {}, out = [];
        (app.breakpoints && app.breakpoints.length ? app.breakpoints : []).forEach(function (b) {
            if (mins[b.min]) out.push("two breakpoints start at " + b.min + " px");
            if (names[b.name]) out.push("\"" + b.name + "\" twice");
            mins[b.min] = names[b.name] = true;
        });
        return out.join(" · ") || null;
    };
    var meta = {
        id: "@breakpoints", stateList: [], inputs: [], outputs: [],
        groupOrder: ["Breakpoints", "Ranges"],
        props: {
            bps: { key: "bps", type: "list", group: "Breakpoints", label: "Breakpoints (widest first)", default: [], noReset: true, noun: "breakpoint", itemLabel: "name",
                validate: problems,
                help: "Bands of window widths, like Tailwind's sm md lg xl: each one starts at its \"From\" width, up to the next. A screen is designed in the band of its own width (★ on the canvas bar); every other band can change a field (its 📱) or anything (the canvas bar). Desktop-first: a narrower band inherits from the next wider one.",
                item: { row: true, fields: {
                    name: { type: "string", label: "Name", default: "" },
                    min: { type: "number", label: "From px", default: 0, min: 0 },
                    preview: { type: "enum", label: "Preview (device)", default: 390, options: previewOptions(0) } } } },
            design: { key: "design", type: "action", group: "Breakpoints", label: "This screen", noReset: true, hidden: !screen,
                summary: function () { return screen ? BP.designBreakpoint(app, screen) : ""; },
                info: function () { return screen ? (screen.name || "This screen") + " (" + screen.width + " px) is designed in " + BP.designBreakpoint(app, screen) + "." : ""; },
                help: "On the live page: {$breakpoint} is the band in use (\"md\", …); an On Breakpoint Change event fires when it changes." },
            reset: { key: "reset", type: "action", group: "Breakpoints", label: "Defaults", noReset: true,
                info: "xs 0 · sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536 · 3xl 1920",
                buttons: [{ label: "Reset to the defaults", icon: "fa fa-undo", run: function () {
                    if (app.breakpoints && app.breakpoints.length && !window.confirm("Go back to the default breakpoints (xs 0 · sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536 · 3xl 1920)? What was set for a breakpoint whose name is not among them is no longer used.")) return;
                    app.breakpoints = [];
                    changed(true);
                } }] },
            ranges: { key: "ranges", type: "action", group: "Ranges", label: "Ranges", noReset: true,
                summary: function () { return BP.breakpointsOf(app).length + " bands"; },
                info: function () {
                    return html`${BP.breakpointsOf(app).slice().reverse().map(function (b) {
                        var d = deviceAt(BP.previewWidthOf(app, b.id));
                        return html`<div><b>${b.name}</b>: ${BP.rangeOf(app, b.id)} · shown at ${BP.previewWidthOf(app, b.id)} px${d ? " (" + d + ")" : ""}</div>`;
                    })}`;
                } }
        }
    };
    // the preview options of each row: the presets and the row's own width
    meta.props.bps.item.fields.preview.options = previewOptions(0).concat(current.bps.map(function (b) { return { value: b.preview, label: b.preview + " px" }; }))
        .filter(function (o, i, all) { return all.findIndex(function (x) { return x.value === o.value; }) === i; })
        .sort(function (a, b) { return a.value - b.value; });

    var host = window.$("<div>").appendTo(pane).get(0);
    var handle = window.NexaKit.renderInspector(host, {
        meta: meta, props: current, persistKey: "nexa-breakpoints",
        set: function (key, rows) {
            if (key !== "bps") return;
            var taken = [];
            var next = (rows || []).map(function (r, i) {
                var name = String(r.name || "").trim();
                var id = r.id || slug(name || ("bp" + (i + 1)), taken.concat((rows || []).map(function (x) { return x.id; }).filter(Boolean)));
                taken.push(id);
                var b = { id: id, name: name || id, min: Math.max(0, Math.round(Number(r.min) || 0)) };
                if (Number(r.preview) > 0) b.preview = Number(r.preview);
                var d = deviceAt(b.preview);
                if (d) b.device = d; else if (r.device) b.device = String(r.device).trim();
                return b;
            });
            // a new row without a "from": after the widest one
            next.forEach(function (b, i) {
                if (!rows[i].id && !b.min) b.min = Math.max.apply(null, next.map(function (x) { return x.min; }).concat([0])) + 320;
            });
            if (!next.length) return;
            if (!next.some(function (b) { return b.min === 0; })) next.slice().sort(function (a, b) { return a.min - b.min; })[0].min = 0;
            app.breakpoints = next;
            changed(false);
            Object.keys(current).forEach(function (k) { delete current[k]; });
            Object.assign(current, view());
            handle.update();
        }
    });

    function changed(rebuild) {
        leaveBreakpoint();      // the canvas goes back to the design: the bands just changed
        markDirty();
        renderActiveScreen();
        if (rebuild) renderBreakpointsPanel();
    }
}
