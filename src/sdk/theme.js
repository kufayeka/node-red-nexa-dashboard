// The app's theme for components (src/model/theme.js): its tokens in the current mode.
//   theme.token("colors.primary.solid")   -> "#2563eb"   (light) / its dark value
//   theme.cssVar("colors.bg.subtle")      -> "var(--nexa-colors-bg-subtle)"  (in CSS: follows the mode by itself)
//   theme.mode()                          -> "light" | "dark"
//   theme.list("fontSizes")               -> [{ path, category, light, dark, semantic }]
//   theme.onChange(fn)                    -> unsubscribe; fn({ theme, mode }) on a new theme / mode
// A prop set to {token:<path>} arrives in this.p already resolved (the host does it).
//
// The editor and the deployed page set it (setTheme). One registry per page
// (window.NexaTheme), whichever bundle asks.
import { DEFAULT_THEME, resolveToken, tokenVar, listTokens, themeOf } from "../model/theme.js";

function reg() {
    var w = window;
    if (!w.NexaTheme) w.NexaTheme = { theme: null, mode: "light", listeners: [] };
    var r = w.NexaTheme;
    if (!r.theme && w.__NEXA_APP__) r.theme = themeOf(w.__NEXA_APP__);
    return r;
}

/** The host: a new theme (the app's, themeOf) and / or mode. Components are told. */
export function setTheme(theme, mode) {
    var r = reg();
    if (theme) r.theme = theme;
    if (mode) r.mode = mode === "dark" ? "dark" : "light";
    r.listeners.slice().forEach(function (fn) { try { fn({ theme: r.theme, mode: r.mode }); } catch (e) { console.error("[nexa] theme listener failed:", e); } });
}

export var theme = {
    token: function (path) { var r = reg(); return resolveToken(r.theme || DEFAULT_THEME, path, r.mode); },
    cssVar: function (path) { return tokenVar(path); },
    mode: function () { return reg().mode; },
    list: function (category) { return listTokens(reg().theme || DEFAULT_THEME, category); },
    current: function () { return reg().theme || DEFAULT_THEME; },
    onChange: function (fn) {
        var r = reg();
        r.listeners.push(fn);
        return function () { var i = r.listeners.indexOf(fn); if (i !== -1) r.listeners.splice(i, 1); };
    }
};
