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
        width: "100%",
        display: "flex",
        "flex-direction": "column",
        gap: "6px",
        "box-sizing": "border-box"
    });

    state.screens.forEach(function (screen) {
        var isActive = screen.id === state.activeScreenId && state.editingMode !== "template";
        var row = window.$("<div>", { "class": "nexa-screen-row" }).css({
            padding: "8px 10px",
            "border-radius": "5px",
            display: "flex",
            "flex-wrap": "wrap",
            "align-items": "center",
            cursor: "pointer",
            background: isActive ? "var(--red-ui-list-item-selected-background, #e0f2fe)" : "var(--red-ui-secondary-background, #ffffff)",
            border: isActive ? "1px solid #7dd3fc" : "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
            "box-shadow": isActive ? "0 1px 3px rgba(2,132,199,0.12)" : "0 1px 2px rgba(0,0,0,0.02)",
            "font-size": "12px",
            "user-select": "none",
            gap: "4px",
            transition: "all 0.15s ease"
        }).appendTo(state.screenListEl);

        // --- ROW 1: Status Icon + Screen Name + Disabled Badge ---
        // Enable / Disable status toggle icon
        window.$("<span>", {
            style: "cursor: pointer; width: 14px; text-align: center; margin-right: 4px; flex: 0 0 14px;",
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
            style: "flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red-ui-primary-text-color, #222);" +
                (screen.disabled ? " text-decoration: line-through; opacity: 0.6;" : " font-weight: 600;")
        }).text(screen.name).appendTo(row);

        if (screen.disabled) {
            window.$("<span>", {
                style: "font-size: 9px; color: #ef4444; background: #fee2e2; padding: 1px 4px; border-radius: 3px; font-weight: 600; flex: 0 0 auto;"
            }).text("DISABLED").appendTo(row);
        }

        // --- ROW 2: /url path ---
        window.$("<div>", {
            style: "width: 100%; flex: 0 0 100%; font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 4px; padding: 2px 0; overflow: hidden;"
        }).html('<i class="fa fa-globe" style="font-size: 10px; color: #94a3b8;"></i> <span style="background: rgba(0,0,0,0.04); padding: 1px 5px; border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + (screen.path ? (screen.path.startsWith("/") ? screen.path : "/" + screen.path) : "/screen") + '</span>').appendTo(row);

        // --- ROW 3: Actions (Open | Delete) ---
        // Open Screen button
        window.$("<button>", {
            type: "button",
            class: "red-ui-button red-ui-button-small",
            title: "Open deployed screen in new tab (" + (screen.path || "/screen") + ")",
            style: "flex: 1 1 auto; height: 22px; line-height: 20px; font-size: 11px; color: #0284c7; display: inline-flex; align-items: center; justify-content: center; gap: 4px;"
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
                style: "flex: 0 0 auto; height: 22px; line-height: 20px; padding: 0 8px; font-size: 11px; color: #ef4444; display: inline-flex; align-items: center; justify-content: center;"
            }).html('<i class="fa fa-trash"></i>').on("click", function (e) {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                removeScreen(screen.id);
            }).appendTo(row);
        }

        row.on("click", function () { selectScreenFromSidebar(screen.id); });
    });

    if (!state.screens.length) {
        window.$("<div>", { style: "padding: 16px 8px; text-align: center; color: #94a3b8; font-size: 11px;" })
            .text("No screens yet.")
            .appendTo(state.screenListEl);
    }
}

export function renderScreenForm() {
    if (!state.screenFormEl) return;
    var screen = getActiveScreen();
    state.screenFormEl.empty();
    if (!screen || state.editingMode === "template") {
        window.$("<div>", { style: "text-align: center; color: var(--red-ui-secondary-text-color, #94a3b8); padding: 32px 16px; font-size: 12px;" })
            .html('<i class="fa fa-desktop" style="font-size: 24px; color: #cbd5e1; display: block; margin-bottom: 8px;"></i>Select a screen from the list on the left to edit its properties.')
            .appendTo(state.screenFormEl);
        return;
    }

    var header = window.$("<div>").css({
        "font-weight": "bold",
        "font-size": "13px",
        "margin-bottom": "14px",
        "padding-bottom": "8px",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
        color: "var(--red-ui-primary-text-color, #1e293b)",
        display: "flex",
        "align-items": "center",
        gap: "6px"
    }).html('<i class="fa fa-sliders" style="color: #0284c7;"></i> Screen Properties').appendTo(state.screenFormEl);

    function row(label, field, value, type) {
        var r = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.screenFormEl);
        window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" }).text(label).appendTo(r);
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

    row("Name", "name", screen.name);
    row("URL path", "path", screen.path);
    row("Width (px)", "width", screen.width, "number");
    row("Height (px)", "height", screen.height, "number");
    row("Grid size (px)", "gridSize", screen.gridSize, "number");

    var checksWrap = window.$("<div>").css({
        "margin-top": "12px",
        "padding-top": "10px",
        "border-top": "1px solid var(--red-ui-secondary-border-color, #f1f5f9)",
        display: "flex",
        "flex-direction": "column",
        gap: "8px"
    }).appendTo(state.screenFormEl);

    var snapRow = window.$("<label>").css({ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer" }).appendTo(checksWrap);
    var snapInput = window.$("<input>", { type: "checkbox" }).prop("checked", screen.snap !== false).appendTo(snapRow);
    window.$("<span>").text("Snap to grid").appendTo(snapRow);
    snapInput.on("change", function () {
        screen.snap = snapInput.is(":checked");
        markDirty();
    });

    var enableRow = window.$("<label>").css({ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px", color: "var(--red-ui-primary-text-color, #333)", cursor: "pointer" }).appendTo(checksWrap);
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
