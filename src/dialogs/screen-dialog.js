import { markDirty, getApp } from "../state.js";
import * as BP from "../model/breakpoints.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { applyConstraints } from "../canvas/constraints.js";
import { renderScreenList } from "../sidebar/screens-panel.js";

var DEVICES = [
    ["", "Custom size"],
    ["1920x1080", "Full HD 1920 × 1080"],
    ["1366x768", "Laptop 1366 × 768"],
    ["1280x800", "HMI panel 10\" 1280 × 800"],
    ["1024x768", "HMI panel 1024 × 768"],
    ["800x480", "HMI panel 7\" 800 × 480"],
    ["1180x820", "Tablet landscape 1180 × 820"],
    ["820x1180", "Tablet portrait 820 × 1180"],
    ["390x844", "Phone 390 × 844"]
];

var HELP = {
    fixed: function (w, h) { return "Shown at exactly " + w + " × " + h + " px — for a known panel / device."; },
    fit: "Everything scales together so the whole screen fits any window.",
    fitWidth: "Scales to the window's width; taller content scrolls — good for web pages.",
    fill: "The screen takes the window's size. Nothing scales: set constraints (left / right / scale…) on top-level items and use frames with auto layout. Customize scale per breakpoint below."
};

export function openScreenPropertiesDialog(screen) {
    if (!screen) return;

    var initial = {
        name: screen.name || "",
        path: screen.path || "",
        width: screen.width || 1280,
        height: screen.height || 800,
        displayMode: screen.displayMode || "fixed",
        scaleFactor: screen.scaleFactor != null ? screen.scaleFactor : 1,
        breakpointScales: screen.breakpointScales ? JSON.parse(JSON.stringify(screen.breakpointScales)) : {},
        gridSize: screen.gridSize != null ? screen.gridSize : 8,
        snap: screen.snap !== false,
        disabled: !!screen.disabled
    };

    var current = Object.assign({}, initial);

    window.RED.tray.show({
        id: "nexa-screen-properties-dialog",
        title: "Screen Properties: " + (screen.name || "Screen"),
        width: 500,
        buttons: [
            {
                text: "Cancel",
                click: function () {
                    window.RED.tray.close();
                }
            },
            {
                text: "Save",
                "class": "primary",
                click: function () {
                    var oldSize = { w: screen.width, h: screen.height };
                    screen.name = current.name.trim() || screen.name;
                    screen.path = current.path.trim();
                    screen.width = Math.max(10, parseInt(current.width, 10) || 1280);
                    screen.height = Math.max(10, parseInt(current.height, 10) || 800);
                    if (current.displayMode === "fixed") delete screen.displayMode;
                    else screen.displayMode = current.displayMode;
                    if (current.displayMode === "fill") {
                        screen.scaleFactor = current.scaleFactor;
                        if (current.breakpointScales && Object.keys(current.breakpointScales).length > 0) {
                            screen.breakpointScales = current.breakpointScales;
                        } else {
                            delete screen.breakpointScales;
                        }
                    } else {
                        delete screen.scaleFactor;
                        delete screen.breakpointScales;
                    }
                    screen.gridSize = Math.max(1, parseInt(current.gridSize, 10) || 8);
                    screen.snap = !!current.snap;
                    screen.disabled = !!current.disabled;

                    if (screen.width !== oldSize.w || screen.height !== oldSize.h) {
                        applyConstraints(null, screen.components || [], oldSize, { w: screen.width, h: screen.height });
                    }

                    markDirty();
                    renderScreenList();
                    renderActiveScreen();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "16px 20px" });

            // Info / Header
            window.$("<div>").css({
                "margin-bottom": "16px", padding: "10px 14px", background: "#f0f9ff",
                border: "1px solid #bae6fd", "border-radius": "6px", "font-size": "12px",
                color: "#0369a1", "line-height": "1.45"
            }).html('<strong><i class="fa fa-desktop"></i> Screen Configuration</strong><br>Configure screen dimensions, public URL path, responsive scaling mode, and canvas grid options.').appendTo(body);

            function createRow(label, inputEl) {
                var r = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
                window.$("<label>").css({
                    display: "block", "font-size": "11px", "font-weight": "600",
                    "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)"
                }).text(label).appendTo(r);
                inputEl.appendTo(r);
                return r;
            }

            // Name
            var nameInp = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(current.name);
            nameInp.on("input change", function () { current.name = nameInp.val(); });
            createRow("Name", nameInp);

            // URL Path
            var pathInp = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(current.path);
            pathInp.on("input change", function () { current.path = pathInp.val(); });
            createRow("URL path", pathInp);

            // Device Presets
            var presetSel = window.$("<select>").css({ width: "100%", "box-sizing": "border-box" });
            DEVICES.forEach(function (d) { window.$("<option>", { value: d[0] }).text(d[1]).appendTo(presetSel); });
            presetSel.val(current.width + "x" + current.height);
            if (!presetSel.val()) presetSel.val("");
            createRow("Device Preset", presetSel);

            // Width & Height (2-column row)
            var dimRow = window.$("<div>").css({ display: "flex", gap: "12px", "margin-bottom": "12px" }).appendTo(body);
            var wCol = window.$("<div>").css({ flex: "1 1 50%" }).appendTo(dimRow);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "#475569" }).text("Width (px)").appendTo(wCol);
            var widthInp = window.$("<input>", { type: "number", min: 10 }).css({ width: "100%", "box-sizing": "border-box" }).val(current.width).appendTo(wCol);

            var hCol = window.$("<div>").css({ flex: "1 1 50%" }).appendTo(dimRow);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "#475569" }).text("Height (px)").appendTo(hCol);
            var heightInp = window.$("<input>", { type: "number", min: 10 }).css({ width: "100%", "box-sizing": "border-box" }).val(current.height).appendTo(hCol);

            presetSel.on("change", function () {
                var m = /^(\d+)x(\d+)$/.exec(presetSel.val());
                if (!m) return;
                current.width = Number(m[1]);
                current.height = Number(m[2]);
                widthInp.val(current.width);
                heightInp.val(current.height);
                syncModeHelp();
            });

            widthInp.on("input change", function () {
                current.width = Number(widthInp.val()) || 1280;
                presetSel.val(current.width + "x" + current.height);
                if (!presetSel.val()) presetSel.val("");
                syncModeHelp();
            });

            heightInp.on("input change", function () {
                current.height = Number(heightInp.val()) || 800;
                presetSel.val(current.width + "x" + current.height);
                if (!presetSel.val()) presetSel.val("");
                syncModeHelp();
            });

            // On the live page
            var modeSel = window.$("<select>").css({ width: "100%", "box-sizing": "border-box" });
            [
                ["fixed", "Exact size (this device), centred"],
                ["fit", "Scale to fit the window (keep proportions)"],
                ["fitWidth", "Scale to the window width (scroll down)"],
                ["fill", "Fill the window (responsive, by constraints)"]
            ].forEach(function (o) { window.$("<option>", { value: o[0] }).text(o[1]).appendTo(modeSel); });
            modeSel.val(current.displayMode || "fixed");

            var modeHelp = window.$("<div>").css({ "font-size": "11px", color: "#64748b", "margin-top": "4px", "line-height": "1.4" });

            // Scale factor section (visible when fill is selected)
            var scaleRow = window.$("<div>").css({ "margin-top": "8px", display: "none" });
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "#475569" }).text("Base scale factor").appendTo(scaleRow);
            var scaleWrap = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "10px" }).appendTo(scaleRow);
            var scaleRange = window.$("<input>", { type: "range", min: "0.25", max: "3", step: "0.05" }).css({ flex: "1" }).val(current.scaleFactor).appendTo(scaleWrap);
            var scaleNum = window.$("<input>", { type: "number", min: "0.1", max: "5", step: "0.05" }).css({ width: "60px", "text-align": "center" }).val(current.scaleFactor).appendTo(scaleWrap);
            window.$("<div>").css({ "font-size": "10px", color: "#94a3b8", "margin-top": "3px", "margin-bottom": "8px" }).text("Default scale across all screens (1.0 = 100%)").appendTo(scaleRow);

            function syncScaleVis() {
                scaleRow.css("display", modeSel.val() === "fill" ? "block" : "none");
            }
            syncScaleVis();

            scaleRange.on("input change", function () {
                current.scaleFactor = parseFloat(scaleRange.val()) || 1;
                scaleNum.val(current.scaleFactor);
            });
            scaleNum.on("input change", function () {
                current.scaleFactor = parseFloat(scaleNum.val()) || 1;
                scaleRange.val(current.scaleFactor);
            });

            // Breakpoint scales list
            window.$("<div>").css({ "font-size": "11px", "font-weight": "600", color: "#475569", "margin-bottom": "2px" }).text("Scale per breakpoint").appendTo(scaleRow);
            window.$("<div>").css({ "font-size": "10px", color: "#94a3b8", "margin-bottom": "6px" }).text("Set custom scale for specific screen sizes (leave blank to inherit base scale)").appendTo(scaleRow);
            var bpListEl = window.$("<div>").css({ display: "flex", "flex-direction": "column", gap: "4px" }).appendTo(scaleRow);

            if (!current.breakpointScales) current.breakpointScales = {};
            var app = getApp();
            var bps = BP.breakpointsOf(app);
            bps.forEach(function (bp) {
                var row = window.$("<div>").css({
                    display: "flex", "align-items": "center", "justify-content": "space-between",
                    padding: "3px 6px", background: "#f8fafc", "border-radius": "4px", border: "1px solid #e2e8f0"
                }).appendTo(bpListEl);

                var labelWrap = window.$("<div>").appendTo(row);
                window.$("<span>").css({ "font-weight": "600", "font-size": "11px", color: "#334155" }).text(bp.id).appendTo(labelWrap);
                var range = BP.rangeOf(app, bp.id);
                var info = (bp.device ? bp.device + " · " : "") + range;
                window.$("<span>").css({ "font-size": "10px", color: "#64748b", "margin-left": "6px" }).text(info).appendTo(labelWrap);

                var inputWrap = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "4px" }).appendTo(row);
                var curVal = current.breakpointScales[bp.id];
                var inp = window.$("<input>", { type: "number", step: "0.05", min: "0.1", max: "5", placeholder: "Base" })
                    .css({ width: "55px", "text-align": "center", height: "22px", "font-size": "11px" })
                    .val(curVal !== undefined && curVal !== null ? curVal : "")
                    .appendTo(inputWrap);
                window.$("<span>").css({ "font-size": "10px", color: "#94a3b8" }).text("x").appendTo(inputWrap);

                inp.on("change input", function () {
                    var v = inp.val().trim();
                    if (v === "") {
                        delete current.breakpointScales[bp.id];
                    } else {
                        var n = parseFloat(v);
                        if (isFinite(n) && n > 0) current.breakpointScales[bp.id] = n;
                        else delete current.breakpointScales[bp.id];
                    }
                });
            });

            function syncModeHelp() {
                var h = HELP[modeSel.val()];
                modeHelp.text(typeof h === "function" ? h(current.width, current.height) : (h || ""));
            }
            syncModeHelp();

            modeSel.on("change", function () {
                current.displayMode = modeSel.val();
                syncModeHelp();
                syncScaleVis();
            });

            var modeContainer = window.$("<div>");
            modeSel.appendTo(modeContainer);
            modeHelp.appendTo(modeContainer);
            scaleRow.appendTo(modeContainer);
            createRow("On the live page", modeContainer);

            // Grid size
            var gridInp = window.$("<input>", { type: "number", min: 1, max: 64 }).css({ width: "100%", "box-sizing": "border-box" }).val(current.gridSize);
            gridInp.on("input change", function () { current.gridSize = Number(gridInp.val()) || 8; });
            createRow("Grid size (px)", gridInp);

            // Checks (Snap to grid, Enable screen)
            var checksWrap = window.$("<div>").css({
                "margin-top": "14px", "padding-top": "12px",
                "border-top": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
                display: "flex", "flex-direction": "column", gap: "10px"
            }).appendTo(body);

            var snapRow = window.$("<label>").css({
                display: "flex", "align-items": "center", gap: "8px", "font-size": "12px",
                color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer"
            }).appendTo(checksWrap);
            var snapInput = window.$("<input>", { type: "checkbox" }).prop("checked", current.snap).appendTo(snapRow);
            window.$("<span>").text("Snap to grid").appendTo(snapRow);
            snapInput.on("change", function () { current.snap = snapInput.is(":checked"); });

            var enableRow = window.$("<label>").css({
                display: "flex", "align-items": "center", gap: "8px", "font-size": "12px",
                color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer"
            }).appendTo(checksWrap);
            var enableInput = window.$("<input>", { type: "checkbox" }).prop("checked", !current.disabled).appendTo(enableRow);
            window.$("<span>").text("Enable screen (live page at URL path)").appendTo(enableRow);
            enableInput.on("change", function () { current.disabled = !enableInput.is(":checked"); });
        }
    });
}
