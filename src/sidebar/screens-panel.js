import { state, getActiveScreen, makeScreen, markDirty } from "../state.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

export function renderScreenList() {
    if (!state.screenListEl) return;
    state.screenListEl.empty();
    state.screens.forEach(function (screen) {
        var row = window.$("<div>", { "class": "nexa-screen-row" }).css({
            padding: "6px 8px", cursor: "pointer", "border-radius": "3px",
            display: "flex", "justify-content": "space-between", "align-items": "center",
            background: screen.id === state.activeScreenId ? "#d0e2ff" : "transparent"
        }).appendTo(state.screenListEl);

        window.$("<span>").text(screen.name).appendTo(row);

        if (state.screens.length > 1) {
            window.$("<a>", { href: "#", title: "Delete screen" }).html("&times;").css({ color: "#999" }).on("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                removeScreen(screen.id);
            }).appendTo(row);
        }

        row.on("click", function () { selectScreenFromSidebar(screen.id); });
    });
}

export function renderScreenForm() {
    if (!state.screenFormEl) return;
    var screen = getActiveScreen();
    state.screenFormEl.empty();
    if (!screen) return;

    function row(label, field, value, type) {
        var r = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.screenFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text(label).appendTo(r);
        var input = window.$("<input>", { type: type || "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(value).appendTo(r);
        input.on("change", function () {
            var v = type === "number" ? (parseInt(input.val(), 10) || 0) : input.val();
            screen[field] = v;
            if (field === "name") renderScreenList();
            markDirty();
            renderActiveScreen();
        });
        return input;
    }

    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", "margin-bottom": "8px" }).text("Screen Settings").appendTo(state.screenFormEl);
    row("Name", "name", screen.name);
    row("URL path", "path", screen.path);
    row("Width (px)", "width", screen.width, "number");
    row("Height (px)", "height", screen.height, "number");
    row("Grid size (px)", "gridSize", screen.gridSize, "number");

    var snapRow = window.$("<div>").appendTo(state.screenFormEl);
    var snapInput = window.$("<input>", { type: "checkbox" }).prop("checked", screen.snap).css({ "margin-right": "6px" });
    snapInput.on("change", function () {
        screen.snap = snapInput.is(":checked");
        markDirty();
    });
    window.$("<label>").css({ "font-size": "11px", color: "#888" }).append(snapInput).append("Snap to grid").appendTo(snapRow);
}

export function selectScreenFromSidebar(id) {
    // Picking a screen implies "work on this screen" — leave template-editing
    // mode if it was active, same as addScreenFromSidebar below.
    state.editingMode = "screen";
    state.activeTemplateId = null;
    state.activeScreenId = id;
    renderScreenList();
    renderScreenForm();
    renderActiveScreen();
    refreshLogicCanvasIfActive();
}

export function refreshLogicCanvasIfActive() {
    if (state.activeCanvasTab === "logic") renderLogicCanvas();
}

export function addScreenFromSidebar() {
    state.editingMode = "screen";
    state.activeTemplateId = null;
    var screen = makeScreen({});
    state.screens.push(screen);
    state.activeScreenId = screen.id;
    renderScreenList();
    renderScreenForm();
    renderActiveScreen();
    refreshLogicCanvasIfActive();
    markDirty();
}

export function removeScreen(id) {
    if (state.screens.length <= 1) return;
    var wasActive = id === state.activeScreenId;
    state.screens = state.screens.filter(function (s) { return s.id !== id; });
    if (wasActive) state.activeScreenId = state.screens[0].id;
    renderScreenList();
    renderScreenForm();
    if (wasActive) {
        renderActiveScreen();
        refreshLogicCanvasIfActive();
    }
    markDirty();
}
