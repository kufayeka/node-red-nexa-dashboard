// --- Theme tab: the app's design tokens (src/model/theme.js) ------------------------------
// The way UI libraries define a theme: tokens (palettes 50 … 950, font sizes, spacing,
// radii, shadows…), semantic tokens (bg, fg, border… a light and a dark value, usually a
// reference like {colors.gray.50}), each palette's own (colors.<palette>.solid / subtle…)
// and the primary palette (colors.primary.*). Used anywhere as {token:<path>} — the ◆ of a
// colour / size field — and on the page as CSS variables (var(--nexa-colors-bg)).
// Each category is edited as one property-kit list; the first change makes it the app's
// own (project.theme[category]); Reset brings the defaults back.
import { state, markDirty, getApp, Theme } from "../state.js";
import { renderActiveScreen, applyEditorTheme, editorThemeMode } from "../canvas/canvas-ui.js";

function lit() { return window.NEXA_LIT; }

var SCALES = [
    { key: "fontSizes", label: "Font sizes (px)", number: true },
    { key: "fontWeights", label: "Font weights", number: true },
    { key: "lineHeights", label: "Line heights", number: true },
    { key: "letterSpacings", label: "Letter spacings" },
    { key: "fonts", label: "Fonts" },
    { key: "spacing", label: "Spacing (px)", number: true },
    { key: "radii", label: "Corner radii (px)", number: true },
    { key: "shadows", label: "Shadows" },
    { key: "durations", label: "Durations" },
    { key: "zIndex", label: "Layers (z-index)", number: true }
];

function ownTheme() {
    var app = getApp();
    if (!app.theme || typeof app.theme !== "object") app.theme = {};
    return app.theme;
}
function changed() {
    markDirty();
    applyEditorTheme();
    renderActiveScreen({ keepPanel: true });
}

export function renderThemePanel() {
    var pane = state.themePane;
    if (!pane) return;
    pane.empty();
    if (!window.NexaKit || !lit()) {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("The Theme tab needs the Nexa property kit.").appendTo(pane);
        return;
    }
    var html = lit().html;
    var theme = Theme.themeOf(getApp());
    var paletteNames = Object.keys(theme.palettes);

    var view = function () {
        var t = Theme.themeOf(getApp());
        var v = {
            defaultMode: t.defaultMode || "light",
            primary: t.primary,
            preview: editorThemeMode(t),
            palettes: Object.keys(t.palettes).map(function (n) { return { name: n, base: t.palettes[n]["500"] || "#888888" }; }),
            semantic: Object.keys(t.semantic || {}).map(function (n) { var s = t.semantic[n] || {}; return { name: n, light: String(s.light === undefined ? "" : s.light), dark: String(s.dark === undefined ? "" : s.dark) }; })
        };
        SCALES.forEach(function (sc) { v[sc.key] = Object.keys(t[sc.key] || {}).map(function (k) { return { name: k, value: sc.number ? Number(t[sc.key][k]) : String(t[sc.key][k]) }; }); });
        return v;
    };
    var current = view();
    var props = {
        sample: { key: "sample", type: "action", group: "Mode", label: "Sample", noReset: true,
            summary: function () { return editorThemeMode(Theme.themeOf(getApp())); },
            info: function () { return semanticSample(Theme.themeOf(getApp())); },
            help: "The app's design tokens. Use one anywhere with the ◆ of a colour / size field ({token:colors.primary.solid}); on the page it is a CSS variable (var(--nexa-colors-bg)) that follows the colour mode. Set Variable $colorMode (light / dark / system) switches the page." },
        defaultMode: { key: "defaultMode", type: "enum", group: "Mode", label: "The page opens in", default: "light", noReset: true, options: [
            { value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "The viewer's system setting" }] },
        primary: { key: "primary", type: "enum", group: "Mode", label: "Primary palette (colors.primary.*)", default: "blue", noReset: true, options: paletteNames.map(function (n) { return { value: n, label: n }; }) },
        preview: { key: "preview", type: "enum", group: "Mode", label: "The canvas shows", default: "light", noReset: true, options: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }],
            help: "The canvas preview only (not saved)." },
        reset: { key: "reset", type: "action", group: "Mode", label: "Defaults", noReset: true,
            buttons: [{ label: "Reset the theme to the defaults", icon: "fa fa-undo", run: function () {
                if (!window.confirm("Go back to the default theme? Your palettes, semantic colours and scales are replaced by the defaults.")) return;
                getApp().theme = null;
                changed();
                renderThemePanel();
            } }] },
        palettes: { key: "palettes", type: "list", group: "Colors", label: "Palettes", default: [], noReset: true, noun: "palette", itemLabel: "name",
            help: "Each palette is 50 … 950 from its 500: change the colour and the shades follow. Every palette also has colors.<name>.solid / contrast / fg / muted / subtle / emphasized / focusRing / border, light and dark.",
            item: { row: true, fields: {
            name: { type: "string", label: "Palette", default: "" }, base: { type: "color", label: "500 (its colour)", default: "#6366f1" } } } },
        shades: { key: "shades", type: "action", group: "Colors", label: "Shades", noReset: true,
            summary: function () { return Object.keys(Theme.themeOf(getApp()).palettes).length + " palettes"; },
            info: function () { return strips(Theme.themeOf(getApp())); } },
        semantic: { key: "semantic", type: "list", group: "Semantic", label: "Semantic colours", default: [], noReset: true, noun: "colour", itemLabel: "name",
            help: "What a colour is for, light and dark: a colour (#1e293b) or a token ({colors.gray.900}). Name \"bg.subtle\" is the token colors.bg.subtle.",
            item: { fields: {
            name: { type: "string", label: "Name (colors.…)", default: "", placeholder: "e.g. brand.accent" },
            light: { type: "string", label: "Light", default: "{colors.gray.500}", mono: true },
            dark: { type: "string", label: "Dark", default: "{colors.gray.400}", mono: true } } } }
    };
    var TYPE_SCALES = ["fonts", "fontSizes", "fontWeights", "lineHeights", "letterSpacings"];
    SCALES.forEach(function (sc) {
        props[sc.key] = { key: sc.key, type: "list", group: TYPE_SCALES.indexOf(sc.key) !== -1 ? "Type" : "Space & shape", label: sc.label, default: [], noReset: true,
            noun: "token", itemLabel: "name", item: { row: true, fields: {
            name: { type: "string", label: "Name", default: "" }, value: sc.number ? { type: "number", label: "Value", default: 0 } : { type: "string", label: "Value", default: "" } } } };
    });

    function strips(t) {
        return Object.keys(t.palettes).map(function (n) {
            return html`<div class="nexa-theme-strip" data-palette="${n}" style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="flex:0 0 56px;font-size:11px;font-family:monospace">${n}</span>
                <span style="flex:1 1 auto;display:flex;height:14px;border-radius:3px;overflow:hidden;border:1px solid rgba(0,0,0,.1)">${Theme.SHADES.map(function (s) { return html`<span title="colors.${n}.${s} ${t.palettes[n][s]}" style="flex:1;background:${t.palettes[n][s]}"></span>`; })}</span>
            </div>`;
        });
    }
    function semanticSample(t) {
        var mode = editorThemeMode(t);
        var get = function (p) { return Theme.resolveToken(t, p, mode); };
        return html`<div style="border:1px solid ${get("colors.border")};background:${get("colors.bg")};color:${get("colors.fg")};border-radius:6px;padding:8px;font-size:12px;margin-bottom:8px">
            <div style="font-weight:600;margin-bottom:4px">Sample (${mode})</div>
            <div style="color:${get("colors.fg.muted")}">fg.muted text on bg</div>
            <div style="display:flex;gap:6px;margin-top:6px">
                <span style="background:${get("colors.primary.solid")};color:${get("colors.primary.contrast")};padding:2px 8px;border-radius:4px">primary.solid</span>
                <span style="background:${get("colors.primary.subtle")};color:${get("colors.primary.fg")};padding:2px 8px;border-radius:4px">primary.subtle</span>
                <span style="background:${get("colors.bg.muted")};border:1px solid ${get("colors.border.emphasized")};padding:2px 8px;border-radius:4px">bg.muted</span>
            </div>
        </div>`;
    }

    var meta = { id: "@theme", stateList: [], inputs: [], outputs: [], props: props, groupOrder: ["Mode", "Colors", "Semantic", "Type", "Space & shape"] };

    var host = window.$("<div>").appendTo(pane).get(0);
    var handle = window.NexaKit.renderInspector(host, {
        meta: meta, props: current, persistKey: "nexa-theme", fallbacks: false,
        set: function (key, v) {
            var own = ownTheme(), t = Theme.themeOf(getApp());
            if (key === "preview") { state.themePreview = v; applyEditorTheme(); renderActiveScreen({ keepPanel: true }); }
            else if (key === "defaultMode" || key === "primary") { own[key] = v; changed(); }
            else if (key === "palettes") {
                var next = {};
                (v || []).forEach(function (r, i) {
                    var name = String(r.name || "").trim().replace(/[^A-Za-z0-9_-]/g, "") || ("palette" + (i + 1));
                    var old = t.palettes[name];
                    // the same 500: its shades as they are (the hand-made defaults); another: generated
                    next[name] = old && String(old["500"]).toLowerCase() === String(r.base).toLowerCase() ? old : (Theme.generatePalette(r.base) || old || Theme.generatePalette("#888888"));
                });
                if (!Object.keys(next).length) return;
                own.palettes = next;
                if (!next[own.primary || t.primary]) own.primary = Object.keys(next)[0];
                changed();
            } else if (key === "semantic") {
                var sem = {};
                (v || []).forEach(function (r) { var n = String(r.name || "").trim(); if (n) sem[n] = { light: r.light, dark: r.dark === "" ? r.light : r.dark }; });
                own.semantic = sem;
                changed();
            } else {
                var sc = SCALES.filter(function (x) { return x.key === key; })[0];
                if (!sc) return;
                var out = {};
                (v || []).forEach(function (r) { var n = String(r.name || "").trim(); if (n) out[n] = sc.number ? Number(r.value) || 0 : String(r.value || ""); });
                own[key] = out;
                changed();
            }
            Object.keys(current).forEach(function (k) { delete current[k]; });
            Object.assign(current, view());
            handle.update();
        }
    });
}
