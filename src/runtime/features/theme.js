/**
 * @file src/runtime/features/theme.js
 * @description Theme engine for Nexa runtime. Injects design tokens as CSS custom properties
 * and manages dark/light/system color modes across runtime scopes.
 */

import { writeVariable } from "../state/variable.js";
import { state } from "../state.js";
import { propsMention, refreshComponentRender } from "../mounting/render.js";
import { walkNodes } from "../mounting/slots.js";

export var THEME = { theme: null, mode: "light", pref: "light", media: null };
if (typeof window !== "undefined") window.__NEXA_THEME__ = THEME;
export var COLOR_MODE_KEY = "nexa:colorMode";

export function startTheme(screen, app) {
    var M = window.NexaModel;
    if (!M || !M.themeOf) return;
    THEME.theme = M.themeOf(app);
    var into = document.head || document.documentElement;
    var style = typeof document.getElementById === "function" ? document.getElementById("nexa-theme-css") : null;
    if (!style && into && typeof into.appendChild === "function") {
        style = document.createElement("style");
        style.id = "nexa-theme-css";
        into.appendChild(style);
    }
    if (style) style.textContent = M.themeCss(THEME.theme, ":root", 'html[data-nexa-mode="dark"]');
    var stored = null;
    try {
        stored = window.localStorage && window.localStorage.getItem(COLOR_MODE_KEY);
    } catch (e) { /* localStorage access safe */ }
    applyColorMode(screen, stored || THEME.theme.defaultMode || "light", false);
}

export function systemMode() {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyColorMode(screen, pref, keep) {
    pref = pref === "dark" || pref === "system" ? pref : "light";
    THEME.pref = pref;
    var mode = pref === "system" ? systemMode() : pref;

    if (pref === "system" && !THEME.media && typeof window.matchMedia === "function") {
        THEME.media = window.matchMedia("(prefers-color-scheme: dark)");
        var onOs = function () {
            if (THEME.pref === "system") writeVariable(screen, state.currentAppScope, "$colorMode", "system");
        };
        if (THEME.media.addEventListener) THEME.media.addEventListener("change", onOs);
        else if (THEME.media.addListener) THEME.media.addListener(onOs);
    }
    if (keep) {
        try { window.localStorage.setItem(COLOR_MODE_KEY, pref); } catch (e) { /* ignore */ }
    }
    var changed = THEME.mode !== mode;
    THEME.mode = mode;
    if (document.documentElement && typeof document.documentElement.setAttribute === "function") {
        document.documentElement.setAttribute("data-nexa-mode", mode);
    }
    if (window.NexaSDK && window.NexaSDK.setTheme) window.NexaSDK.setTheme(THEME.theme, mode);
    if (state.currentAppScope && !keep) state.currentAppScope.$colorMode = mode;
    if (changed && screen && screen.components) {
        walkNodes(screen.components, function (c) {
            if (c.props && propsMention(c.props, "{token:")) refreshComponentRender(screen, c);
        });
    }
    return mode;
}
