import { markDirty } from "../state.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { renderScreenList } from "../sidebar/screens-panel.js";

export function openComponentTemplatePropertiesDialog(template) {
    if (!template) return;

    var current = {
        name: template.name || "",
        identifier: template.identifier || "",
        width: template.width || 320,
        height: template.height || 240,
        gridSize: template.gridSize != null ? template.gridSize : 8,
        snap: template.snap !== false
    };

    window.RED.tray.show({
        id: "nexa-component-template-properties-dialog",
        title: "Component Template Properties: " + (template.name || "Component Template"),
        width: 480,
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
                    template.name = current.name.trim() || template.name;
                    template.identifier = current.identifier.trim();
                    template.width = Math.max(10, parseInt(current.width, 10) || 320);
                    template.height = Math.max(10, parseInt(current.height, 10) || 240);
                    template.gridSize = Math.max(1, parseInt(current.gridSize, 10) || 8);
                    template.snap = !!current.snap;
                    markDirty();
                    renderScreenList();
                    renderActiveScreen();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "16px 20px" });

            // Info box
            window.$("<div>").css({
                "margin-bottom": "14px", padding: "10px 12px", background: "#f0fdf4",
                border: "1px solid #bbf7d0", "border-radius": "6px", "font-size": "11px",
                color: "#166534", "line-height": "1.45"
            }).html('<strong><i class="fa fa-puzzle-piece"></i> Component Template</strong><br>This canvas is an isolated preview stage for a single component. When populated or rendered into a container, only the single component inside is rendered directly without extra canvas wrapper frames.').appendTo(body);

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

            // Identifier
            var idInp = window.$("<input>", { type: "text", placeholder: "e.g. gaugeWidget" }).css({ width: "100%", "box-sizing": "border-box" }).val(current.identifier);
            idInp.on("input change", function () { current.identifier = idInp.val(); });
            createRow("Identifier", idInp);

            // Width & Height (2 cols)
            var dimRow = window.$("<div>").css({ display: "flex", gap: "12px", "margin-bottom": "12px" }).appendTo(body);
            var wCol = window.$("<div>").css({ flex: "1 1 50%" }).appendTo(dimRow);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "#475569" }).text("Preview Width (px)").appendTo(wCol);
            var widthInp = window.$("<input>", { type: "number", min: 10 }).css({ width: "100%", "box-sizing": "border-box" }).val(current.width).appendTo(wCol);

            var hCol = window.$("<div>").css({ flex: "1 1 50%" }).appendTo(dimRow);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "#475569" }).text("Preview Height (px)").appendTo(hCol);
            var heightInp = window.$("<input>", { type: "number", min: 10 }).css({ width: "100%", "box-sizing": "border-box" }).val(current.height).appendTo(hCol);

            widthInp.on("input change", function () { current.width = Number(widthInp.val()) || 320; });
            heightInp.on("input change", function () { current.height = Number(heightInp.val()) || 240; });

            // Grid size
            var gridInp = window.$("<input>", { type: "number", min: 1, max: 64 }).css({ width: "100%", "box-sizing": "border-box" }).val(current.gridSize);
            gridInp.on("input change", function () { current.gridSize = Number(gridInp.val()) || 8; });
            createRow("Grid size (px)", gridInp);

            // Snap to grid
            var snapRow = window.$("<label>").css({
                display: "flex", "align-items": "center", gap: "8px", "font-size": "12px",
                color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer", "margin-top": "10px"
            }).appendTo(body);
            var snapInp = window.$("<input>", { type: "checkbox" }).prop("checked", current.snap).appendTo(snapRow);
            window.$("<span>").text("Snap to grid").appendTo(snapRow);
            snapInp.on("change", function () { current.snap = snapInp.is(":checked"); });
        }
    });
}
