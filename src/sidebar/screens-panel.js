import { state, getActiveScreen, makeScreen, markDirty } from "../state.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

export function refreshLogicCanvasIfActive() {
    if (state.activeCanvasTab === "logic") renderLogicCanvas();
}

export function renderScreenList() {
    if (!state.screenListEl) return;
    state.screenListEl.empty();

    state.screenListEl.css({
        border: "1px solid var(--red-ui-secondary-border-color, #ccc)",
        "border-radius": "4px",
        background: "var(--red-ui-secondary-background, #fff)",
        "max-height": "220px",
        "min-height": "90px",
        "overflow-y": "auto",
        "overflow-x": "hidden",
        padding: "4px",
        "box-sizing": "border-box",
        width: "100%",
        "box-shadow": "inset 0 1px 2px rgba(0,0,0,0.03)"
    });

    state.screens.forEach(function (screen) {
        var isActive = screen.id === state.activeScreenId && state.editingMode !== "template";
        var row = window.$("<div>", { "class": "nexa-screen-row" }).css({
            padding: "4px 6px",
            "border-radius": "3px",
            "margin-bottom": "2px",
            display: "flex",
            "align-items": "center",
            cursor: "pointer",
            background: isActive ? "var(--red-ui-list-item-selected-background, #e3f2fd)" : "transparent",
            border: isActive ? "1px solid #90caf9" : "1px solid transparent",
            "font-size": "12px",
            "user-select": "none",
            transition: "background 0.15s, border-color 0.15s"
        }).appendTo(state.screenListEl);

        // Enable / Disable status toggle icon
        window.$("<span>", {
            style: "cursor: pointer; width: 16px; text-align: center; margin-right: 5px; flex: 0 0 16px;",
            title: screen.disabled ? "Screen is disabled (returns 404) — click to enable" : "Screen is enabled — click to disable"
        })
            .html(screen.disabled ? '<i class="fa fa-ban" style="color: #ef4444;"></i>' : '<i class="fa fa-circle" style="color: #10b981; font-size: 9px;"></i>')
            .on("click", function (e) {
                if (e && e.stopPropagation) e.stopPropagation();
                screen.disabled = !screen.disabled;
                markDirty();
                renderScreenList();
                renderScreenForm();
            })
            .appendTo(row);

        // Screen Name
        window.$("<span>", {
            style: "flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red-ui-primary-text-color, #222);" +
                (screen.disabled ? " text-decoration: line-through; opacity: 0.6;" : " font-weight: 600;")
        }).text(screen.name).appendTo(row);

        // Path badge
        if (screen.path) {
            window.$("<span>", {
                style: "font-size: 10px; color: #64748b; background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; margin-right: 4px; flex: 0 0 auto;"
            }).text(screen.path).appendTo(row);
        }

        if (screen.disabled) {
            window.$("<span>", {
                style: "font-size: 9px; color: #ef4444; background: #fee2e2; padding: 1px 4px; border-radius: 3px; font-weight: 600; margin-right: 4px; flex: 0 0 auto;"
            }).text("DISABLED").appendTo(row);
        }

        // Open Screen in new tab
        window.$("<button>", {
            type: "button",
            class: "red-ui-button red-ui-button-small",
            title: "Open deployed screen in new tab (" + (screen.path || "/screen") + ")",
            style: "padding: 1px 6px; font-size: 10px; height: 20px; line-height: 18px; color: #1976d2; display: inline-flex; align-items: center; gap: 3px; margin-right: 4px; flex: 0 0 auto;"
        }).html('<i class="fa fa-external-link"></i> Open')
            .on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                var baseUrl = (window.RED && window.RED.settings && window.RED.settings.httpNodeRoot) || "/";
                if (!baseUrl.endsWith("/")) baseUrl += "/";
                var cleanPath = (screen.path || "").replace(/^\/+/, "");
                var fullUrl = baseUrl + "nexa/" + cleanPath;
                window.open(fullUrl, "_blank");
            })
            .appendTo(row);

        // Delete Screen button
        if (state.screens.length > 1) {
            window.$("<a>", {
                href: "#",
                title: "Delete screen",
                class: "red-ui-button red-ui-button-small",
                style: "padding: 1px 5px; font-size: 10px; color: #d32f2f; flex: 0 0 auto;"
            }).html('<i class="fa fa-trash"></i>').on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
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
    if (!screen || state.editingMode === "template") return;

    function row(label, field, value, type) {
        var r = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.screenFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "var(--red-ui-secondary-text-color, #64748b)" }).text(label).appendTo(r);
        var input = window.$("<input>", { type: type || "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(value).appendTo(r);
        input.on("change", function () {
            var v = type === "number" ? (parseInt(input.val(), 10) || 0) : input.val();
            screen[field] = v;
            if (field === "name" || field === "path") renderScreenList();
            markDirty();
            renderActiveScreen();
        });
        return input;
    }

    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", "margin-bottom": "8px", color: "var(--red-ui-primary-text-color, #333)" }).text("Screen Settings").appendTo(state.screenFormEl);
    row("Name", "name", screen.name);
    row("URL path", "path", screen.path);
    row("Width (px)", "width", screen.width, "number");
    row("Height (px)", "height", screen.height, "number");
    row("Grid size (px)", "gridSize", screen.gridSize, "number");

    var checksWrap = window.$("<div>").css({ "margin-top": "6px", display: "flex", "flex-direction": "column", gap: "6px" }).appendTo(state.screenFormEl);

    var snapRow = window.$("<label>").css({ display: "flex", "align-items": "center", gap: "6px", "font-size": "11px", color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer" }).appendTo(checksWrap);
    var snapInput = window.$("<input>", { type: "checkbox" }).prop("checked", screen.snap !== false).appendTo(snapRow);
    window.$("<span>").text("Snap to grid").appendTo(snapRow);
    snapInput.on("change", function () {
        screen.snap = snapInput.is(":checked");
        markDirty();
    });

    var enableRow = window.$("<label>").css({ display: "flex", "align-items": "center", gap: "6px", "font-size": "11px", color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer" }).appendTo(checksWrap);
    var enableInput = window.$("<input>", { type: "checkbox" }).prop("checked", !screen.disabled).appendTo(enableRow);
    window.$("<span>").text("Enable screen (live page at URL path)").appendTo(enableRow);
    enableInput.on("change", function () {
        screen.disabled = !enableInput.is(":checked");
        markDirty();
        renderScreenList();
    });
}

export function selectScreenFromSidebar(id) {
    state.editingMode = "screen";
    state.activeTemplateId = null;
    state.activeScreenId = id;
    renderScreenList();
    renderScreenForm();
    renderActiveScreen();
    refreshLogicCanvasIfActive();
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
