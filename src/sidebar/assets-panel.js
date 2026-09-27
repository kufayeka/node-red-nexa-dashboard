// --- Assets tab: the app's images (png, jpg, svg, webp, gif, avif) -------------
// Import (button or drop files here), search, rename (references follow), delete,
// copy {asset:name}; drag one onto the canvas for an Image component showing it.
// Stored on the server (lib/assets.js), used by name: {asset:icons/motor-on}.
import { state, markDirty, Tree } from "../state.js";
import { redrawCanvas } from "../canvas/canvas-ui.js";
import { loadAssets, uploadAssets, renameAsset, deleteAsset, assetLimits } from "../assets-client.js";

var query = "";
var subscribed = false;

function sdk() { return window.NexaSDK || null; }

function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

// every string prop (at any depth: list rows too) of every node on every screen and template
function eachSurface(fn) {
    (state.screens || []).forEach(fn);
    (state.templates || []).forEach(fn);
}
function mapStrings(v, fn) {
    if (typeof v === "string") return fn(v);
    if (Array.isArray(v)) return v.map(function (x) { return mapStrings(x, fn); });
    if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = mapStrings(v[k], fn); }); return o; }
    return v;
}
function refersTo(s, name) { return s.indexOf("{asset:" + name + "}") !== -1; }
export function countAssetRefs(name) {
    var n = 0;
    eachSurface(function (surface) {
        Tree.allNodes(surface).forEach(function (node) {
            mapStrings(node.props || {}, function (s) { if (refersTo(s, name)) n++; return s; });
        });
    });
    return n;
}
function renameRefs(from, to) {
    var n = 0;
    eachSurface(function (surface) {
        Tree.allNodes(surface).forEach(function (node) {
            if (!node.props) return;
            node.props = mapStrings(node.props, function (s) {
                if (!refersTo(s, from)) return s;
                n++;
                return s.split("{asset:" + from + "}").join("{asset:" + to + "}");
            });
        });
    });
    if (n) markDirty();
    return n;
}

function notify(text, type) { if (window.RED && window.RED.notify) window.RED.notify(text, { type: type || "compact", timeout: 3000 }); }

export function renderAssetsPanel() {
    var pane = state.assetsPane;
    if (!pane) return;
    if (!subscribed && sdk() && sdk().onAssetsChange) {
        subscribed = true;
        sdk().onAssetsChange(function () { if (state.assetsPane && state.assetsPane.is(":visible")) draw(); redrawCanvas(); });
    }
    draw();
    loadAssets();
}

function draw() {
    var pane = state.assetsPane;
    pane.empty();
    var $ = window.$;

    var bar = $("<div>").css({ display: "flex", gap: "6px", "align-items": "center", "margin-bottom": "8px" }).appendTo(pane);
    var file = $("<input>", { type: "file", multiple: true, accept: "image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/avif,.svg" }).hide().appendTo(bar);
    $("<button>", { type: "button", "class": "red-ui-button red-ui-button-small" }).html('<i class="fa fa-upload"></i> Import…').appendTo(bar).on("click", function () { file.click(); });
    var search = $("<input>", { type: "text", placeholder: "Search…" }).css({ flex: "1 1 auto", "min-width": "0" }).val(query).appendTo(bar);
    search.on("input", function () { query = this.value; drawGrid(); search.focus(); });
    file.on("change", function () { var f = Array.from(this.files || []); this.value = ""; importFiles(f); });

    var drop = $("<div>").css({
        border: "1px dashed var(--red-ui-secondary-border-color, #bbb)", "border-radius": "6px", padding: "10px",
        "text-align": "center", "font-size": "11px", color: "#888", "margin-bottom": "8px"
    }).html("Drop images here (png, jpg, svg, webp, gif, avif · up to " + Math.round(assetLimits.maxBytes / 1048576) + " MB)<br>Name folders with /, e.g. <code>icons/motor-on</code>").appendTo(pane);
    drop.on("dragover", function (e) { e.preventDefault(); drop.css("background", "#fff3e0"); })
        .on("dragleave", function () { drop.css("background", ""); })
        .on("drop", function (e) { e.preventDefault(); drop.css("background", ""); importFiles(Array.from((e.originalEvent.dataTransfer || {}).files || [])); });

    var grid = $("<div>", { "class": "nexa-assets-grid" }).css({ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(96px, 1fr))", gap: "8px" }).appendTo(pane);
    $("<div>").css({ "font-size": "11px", color: "#888", "margin-top": "10px", "line-height": "1.5" })
        .html("Drag an image onto the canvas for an Image component. In a prop: <code>{asset:name}</code>, or bind a variable that holds the name — e.g. <code>{param1.image}</code>.").appendTo(pane);

    function importFiles(files) {
        if (!files.length) return;
        var folder = query.indexOf("/") !== -1 ? query.slice(0, query.lastIndexOf("/")) : "";
        uploadAssets(files, folder).then(function (added) { if (added.length) notify("Imported " + added.length + " image" + (added.length > 1 ? "s" : "")); });
    }

    function drawGrid() {
        grid.empty();
        var q = query.trim().toLowerCase();
        var list = (sdk() ? sdk().listAssets() : []).filter(function (a) { return !q || a.name.toLowerCase().indexOf(q) !== -1; })
            .sort(function (a, b) { return a.name.localeCompare(b.name); });
        if (!list.length) {
            $("<div>").css({ "grid-column": "1 / -1", color: "#999", "font-size": "12px", padding: "12px 0" }).text(q ? "No image matches." : "No images yet.").appendTo(grid);
            return;
        }
        list.forEach(function (a) {
            var big = a.size > assetLimits.warnBytes || (a.w && Math.max(a.w, a.h) > assetLimits.warnPx);
            var tile = $("<div>", { "class": "nexa-asset-tile", "data-type-id": "@asset:" + a.name, title: a.name + (a.w ? " · " + a.w + " × " + a.h : "") + " · " + kb(a.size) }).css({
                border: "1px solid var(--red-ui-secondary-border-color, #ddd)", "border-radius": "6px", padding: "4px",
                background: "#fff", cursor: "grab", display: "flex", "flex-direction": "column", gap: "3px", "min-width": "0"
            }).appendTo(grid);
            $("<div>").css({
                height: "64px", display: "flex", "align-items": "center", "justify-content": "center", overflow: "hidden", "border-radius": "4px",
                background: "repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 12px 12px"
            }).append($("<img>", { src: a.url, alt: "", loading: "lazy" }).attr("draggable", "false").css({ "max-width": "100%", "max-height": "100%", "object-fit": "contain", "pointer-events": "none" })).appendTo(tile);
            var name = $("<div>").css({ "font-size": "11px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }).text(a.name).appendTo(tile);
            var meta = $("<div>").css({ display: "flex", "align-items": "center", gap: "4px", "font-size": "10px", color: "#888" }).appendTo(tile);
            $("<span>").css({ flex: "1 1 auto", "min-width": "0", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" })
                .text((a.type || "").replace("image/", "").replace("svg+xml", "svg") + " · " + kb(a.size)).appendTo(meta);
            if (big) $("<i>", { "class": "fa fa-exclamation-triangle", title: "Big: a smaller file loads faster on a page" }).css({ color: "#d97706" }).appendTo(meta);
            function act(icon, title, fn) { $("<i>", { "class": "fa " + icon, title: title }).css({ cursor: "pointer", padding: "0 2px" }).appendTo(meta).on("mousedown", function (e) { e.stopPropagation(); }).on("click", function (e) { e.stopPropagation(); fn(); }); }
            act("fa-clipboard", "Copy {asset:" + a.name + "}", function () {
                var text = "{asset:" + a.name + "}";
                if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { notify("Copied " + text); });
            });
            act("fa-pencil", "Rename", function () {
                var next = window.prompt("Rename (folders with /)", a.name);
                if (!next || (next = next.trim()) === a.name) return;
                renameAsset(a.id, next).then(function () {
                    var n = renameRefs(a.name, next);
                    notify("Renamed" + (n ? "; " + n + " reference" + (n > 1 ? "s" : "") + " updated" : ""));
                }, function (e) { notify(e.message, "error"); });
            });
            act("fa-trash", "Delete", function () {
                var uses = countAssetRefs(a.name);
                if (!window.confirm("Delete \"" + a.name + "\"?" + (uses ? "\n" + uses + " prop" + (uses > 1 ? "s use" : " uses") + " it: they will show nothing." : ""))) return;
                deleteAsset(a.id).then(function () { notify("Deleted " + a.name); }, function (e) { notify(e.message, "error"); });
            });
            name.on("dblclick", function () { meta.find(".fa-pencil").trigger("click"); });
            // onto the canvas: an Image component showing it (editor-tray.js's artboard drop).
            // (the thumbnail is draggable="false" + pointer-events none: no native image drag)
            tile.css({ "user-select": "none" });
            tile.draggable({
                helper: "clone", appendTo: "#red-ui-editor", revert: "invalid", zIndex: 10000,
                start: function (e, ui) { if (ui && ui.helper) ui.helper.css({ width: "96px", opacity: 0.85, "pointer-events": "none" }); }
            });
        });
    }
    drawGrid();
}
