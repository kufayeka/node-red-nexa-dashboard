// --- The app's theme: design tokens, the way UI libraries (Chakra, Panda, Tailwind) do it ---
// Nexa's defaults: IBM Carbon's palettes, grays and type (IBM Plex), a little softened (radius 4).
// Tokens are named values, in categories:
//   colors         palettes (gray, blue… each 50 … 950) + white / black
//   fonts, fontSizes, fontWeights, lineHeights, letterSpacings
//   spacing, radii, shadows, durations, zIndex
// Semantic tokens name what a value is FOR, with a light and a dark value, usually a
// reference to a token:  bg.subtle = { light: "{colors.gray.50}", dark: "{colors.gray.950}" }
// Every palette also has its own semantic tokens (a component's colorPalette):
//   colors.<palette>.solid / contrast / fg / muted / subtle / emphasized / focusRing / border
// and colors.primary.* is the app's primary palette (theme.primary, "blue" by default).
//
// A token is used anywhere as {token:<path>} (a prop, a frame's fill, a gap…) and on the
// page as a CSS variable: colors.bg.subtle -> var(--nexa-colors-bg-subtle).
// project.theme holds the app's own categories (each one replaces the default's) — see
// themeOf. Light / dark: the mode (the app's $colorMode variable on the page).

// Nexa's palettes: IBM Carbon's (10 … 100 as 50 … 950; 600 is the colour's main step, the
// "solid" a button fills with), yellow / orange shifted so 600 is their signal colour.
var PALETTES = {
    gray: ["#f4f4f4", "#e0e0e0", "#c6c6c6", "#a8a8a8", "#8d8d8d", "#6f6f6f", "#525252", "#393939", "#262626", "#161616", "#0b0b0b"],
    red: ["#fff1f1", "#ffd7d9", "#ffb3b8", "#ff8389", "#fa4d56", "#ea3640", "#da1e28", "#a2191f", "#750e13", "#520408", "#2d0709"],
    orange: ["#fff2e8", "#ffd9be", "#ffb784", "#ff9d57", "#ff832b", "#f57316", "#eb6200", "#ba4e00", "#8a3800", "#5e2900", "#3e1a00"],
    yellow: ["#fcf4d6", "#fdf0b5", "#fddc69", "#f7d138", "#f1c21b", "#e5b400", "#d2a106", "#b28600", "#8e6a00", "#684e00", "#302400"],
    green: ["#defbe6", "#a7f0ba", "#6fdc8c", "#42be65", "#24a148", "#1f9140", "#198038", "#0e6027", "#044317", "#022d0d", "#071908"],
    teal: ["#d9fbfb", "#9ef0f0", "#3ddbd9", "#08bdba", "#009d9a", "#008d8a", "#007d79", "#005d5d", "#004144", "#022b30", "#081a1c"],
    blue: ["#edf5ff", "#d0e2ff", "#a6c8ff", "#78a9ff", "#4589ff", "#2a76fe", "#0f62fe", "#0043ce", "#002d9c", "#001d6c", "#001141"],
    cyan: ["#e5f6ff", "#bae6ff", "#82cfff", "#33b1ff", "#1192e8", "#0a82d6", "#0072c3", "#00539a", "#003a6d", "#012749", "#061727"],
    purple: ["#f6f2ff", "#e8daff", "#d4bbff", "#be95ff", "#a56eff", "#9756fd", "#8a3ffc", "#6929c4", "#491d8b", "#31135e", "#1c0f30"],
    pink: ["#fff0f7", "#ffd6e8", "#ffafd2", "#ff7eb6", "#ee5396", "#df3d83", "#d02670", "#9f1853", "#740937", "#510224", "#2a0a18"]
};
export var SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
function shadesOf(list) { var o = {}; SHADES.forEach(function (s, i) { o[s] = list[i]; }); return o; }

function sem(light, dark) { return { light: light, dark: dark === undefined ? light : dark }; }
// Carbon's White (light) and Gray 100 (dark) themes: layers of gray, a strong bottom border for fields
var DEFAULT_SEMANTIC = {
    "bg": sem("{colors.white}", "{colors.gray.900}"),
    "bg.subtle": sem("{colors.gray.50}", "{colors.gray.800}"),
    "bg.muted": sem("{colors.gray.100}", "{colors.gray.700}"),
    "bg.emphasized": sem("{colors.gray.200}", "{colors.gray.600}"),
    "bg.inverted": sem("{colors.gray.900}", "{colors.gray.50}"),
    "bg.panel": sem("{colors.white}", "{colors.gray.800}"),
    "bg.error": sem("{colors.red.50}", "{colors.red.950}"),
    "bg.warning": sem("{colors.yellow.50}", "{colors.yellow.950}"),
    "bg.success": sem("{colors.green.50}", "{colors.green.950}"),
    "bg.info": sem("{colors.blue.50}", "{colors.blue.950}"),
    "fg": sem("{colors.gray.900}", "{colors.gray.50}"),
    "fg.muted": sem("{colors.gray.600}", "{colors.gray.200}"),
    "fg.subtle": sem("{colors.gray.300}", "{colors.gray.500}"),
    "fg.inverted": sem("{colors.white}", "{colors.gray.900}"),
    "fg.error": sem("{colors.red.600}", "{colors.red.300}"),
    "fg.warning": sem("{colors.yellow.800}", "{colors.yellow.400}"),
    "fg.success": sem("{colors.green.600}", "{colors.green.300}"),
    "fg.info": sem("{colors.blue.700}", "{colors.blue.300}"),
    "border": sem("{colors.gray.200}", "{colors.gray.700}"),
    "border.muted": sem("{colors.gray.100}", "{colors.gray.800}"),
    "border.subtle": sem("{colors.gray.50}", "{colors.gray.800}"),
    "border.emphasized": sem("{colors.gray.400}", "{colors.gray.500}"),
    "border.inverted": sem("{colors.gray.900}", "{colors.gray.50}"),
    "border.error": sem("{colors.red.600}", "{colors.red.400}"),
    "border.warning": sem("{colors.yellow.400}", "{colors.yellow.400}"),
    "border.success": sem("{colors.green.400}", "{colors.green.400}"),
    "border.info": sem("{colors.blue.600}", "{colors.blue.400}")
};

// IBM Plex (the Nexa UI plugin ships it), else the system's
var STACK = "'IBM Plex Sans', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export var DEFAULT_THEME = {
    defaultMode: "light",           // light | dark | system (the viewer's OS setting)
    primary: "blue",                // colors.primary.* = this palette's
    palettes: (function () { var o = {}; Object.keys(PALETTES).forEach(function (k) { o[k] = shadesOf(PALETTES[k]); }); return o; })(),
    semantic: DEFAULT_SEMANTIC,
    fonts: { heading: STACK, body: STACK, mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" },
    // px (numbers): font sizes, spacing, radii
    fontSizes: { "2xs": 10, xs: 12, sm: 14, md: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 28, "4xl": 32, "5xl": 42, "6xl": 54, "7xl": 60 },
    fontWeights: { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 },
    lineHeights: { none: 1, shorter: 1.25, short: 1.375, moderate: 1.5, tall: 1.625, taller: 2 },
    letterSpacings: { tighter: "-0.02em", tight: "-0.01em", normal: "0", wide: "0.01em", wider: "0.027em", widest: "0.1em" },
    spacing: { "0": 0, "0.5": 2, "1": 4, "1.5": 6, "2": 8, "2.5": 10, "3": 12, "3.5": 14, "4": 16, "5": 20, "6": 24, "7": 28, "8": 32, "9": 36, "10": 40, "12": 48, "14": 56, "16": 64, "20": 80, "24": 96, "32": 128, "40": 160 },
    // sharp, a little softened: md = 4
    radii: { none: 0, "2xs": 1, xs: 2, sm: 2, md: 4, lg: 6, xl: 8, "2xl": 12, "3xl": 16, "4xl": 24, full: 9999 },
    shadows: {
        xs: "0 1px 2px rgba(0,0,0,0.1)",
        sm: "0 1px 3px rgba(0,0,0,0.15)",
        md: "0 2px 6px rgba(0,0,0,0.2)",
        lg: "0 4px 12px rgba(0,0,0,0.25)",
        xl: "0 8px 24px rgba(0,0,0,0.3)",
        "2xl": "0 16px 48px rgba(0,0,0,0.35)",
        inner: "inset 0 1px 2px rgba(0,0,0,0.1)"
    },
    // Carbon's motion: fast-01 … slow-02
    durations: { fastest: "70ms", faster: "110ms", fast: "150ms", moderate: "240ms", slow: "400ms", slower: "700ms", slowest: "900ms" },
    zIndex: { hide: -1, base: 0, docked: 10, dropdown: 1000, sticky: 1100, banner: 1200, overlay: 1300, modal: 1400, popover: 1500, toast: 1700, tooltip: 1800 }
};

/** The categories of tokens (colors are the palettes + white / black + the semantic ones). */
export var TOKEN_CATEGORIES = ["colors", "fonts", "fontSizes", "fontWeights", "lineHeights", "letterSpacings", "spacing", "radii", "shadows", "durations", "zIndex"];
// on the page these are px
var PX = { fontSizes: true, spacing: true, radii: true };
var BASE_COLORS = { white: "#ffffff", black: "#000000", transparent: "transparent", current: "currentColor" };
var PALETTE_ROLES = ["solid", "contrast", "fg", "muted", "subtle", "emphasized", "focusRing", "border"];

function clone(v) { return v === undefined || v === null || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v)); }

/** The app's theme: the defaults, each category the app has replaced by its own. */
export function themeOf(app) {
    var own = (app && app.theme) || {};
    var t = clone(DEFAULT_THEME);
    Object.keys(own).forEach(function (k) {
        if (own[k] === undefined || own[k] === null) return;
        t[k] = clone(own[k]);
    });
    if (!t.palettes || !Object.keys(t.palettes).length) t.palettes = clone(DEFAULT_THEME.palettes);
    if (!t.palettes[t.primary]) t.primary = t.palettes.blue ? "blue" : Object.keys(t.palettes)[0];
    return t;
}

// ---- palettes from one colour -----------------------------------------------------------
function hexToHsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    var n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    return "#" + [f(0), f(8), f(4)].map(function (x) { var v = Math.round(x * 255).toString(16); return v.length < 2 ? "0" + v : v; }).join("");
}
// each shade: how far from the base colour (500) towards white (50 … 400) or black (600 … 950)
var TOWARDS = [0.93, 0.83, 0.66, 0.46, 0.24, 0, 0.18, 0.36, 0.54, 0.7, 0.86];
/** A palette (50 … 950) from its 500: lighter and darker steps of the same hue. */
export function generatePalette(base) {
    var hsl = hexToHsl(base);
    if (!hsl) return null;
    var out = {};
    SHADES.forEach(function (s, i) {
        if (i === 5) { out[s] = String(base).toLowerCase(); return; }
        var l = i < 5 ? hsl.l + (97 - hsl.l) * TOWARDS[i] : hsl.l - (hsl.l - 8) * TOWARDS[i];
        // a little less saturated at the light end, like the hand-made palettes
        var sat = i < 5 ? Math.min(100, hsl.s * (0.8 + i * 0.04)) : hsl.s;
        out[s] = hslToHex(hsl.h, sat, l);
    });
    return out;
}

// ---- the tokens -----------------------------------------------------------------------------
// a palette's own semantic tokens (Chakra's colorPalette), by shade, light / dark
function paletteRole(name, role) {
    var p = "{colors." + name + ".";
    if (name === "gray") {
        return { solid: sem(p + "900}", "{colors.white}"), contrast: sem("{colors.white}", "{colors.black}"), fg: sem(p + "800}", p + "200}"),
            muted: sem(p + "200}", p + "800}"), subtle: sem(p + "100}", p + "900}"), emphasized: sem(p + "300}", p + "700}"),
            focusRing: sem(p + "800}", p + "200}"), border: sem(p + "200}", p + "800}") }[role];
    }
    return { solid: sem(p + "600}", p + "600}"), contrast: sem(name === "yellow" ? "{colors.black}" : "{colors.white}"),
        fg: sem(p + "700}", p + "300}"), muted: sem(p + "200}", p + "800}"), subtle: sem(p + "100}", p + "900}"),
        emphasized: sem(p + "300}", p + "700}"), focusRing: sem(p + "500}", p + "500}"), border: sem(p + "500}", p + "400}") }[role];
}

/** Every token of the theme, flat: [{ path, category, light, dark, semantic }] (values may be references). */
export function listTokens(theme, category) {
    var t = theme || DEFAULT_THEME, out = [];
    function add(path, cat, light, dark, semantic) { if (!category || category === cat) out.push({ path: path, category: cat, light: light, dark: dark === undefined ? light : dark, semantic: !!semantic }); }
    Object.keys(BASE_COLORS).forEach(function (k) { add("colors." + k, "colors", BASE_COLORS[k]); });
    Object.keys(t.semantic || {}).forEach(function (k) { var v = t.semantic[k] || {}; add("colors." + k, "colors", v.light, v.dark, true); });
    var palettes = t.palettes || {};
    var names = Object.keys(palettes).concat(palettes[t.primary] ? ["primary"] : []);
    names.forEach(function (name) {
        var real = name === "primary" ? t.primary : name;
        SHADES.forEach(function (s) { if (palettes[real] && palettes[real][s]) add("colors." + name + "." + s, "colors", name === "primary" ? "{colors." + real + "." + s + "}" : palettes[real][s]); });
        PALETTE_ROLES.forEach(function (role) { var r = paletteRole(real, role); add("colors." + name + "." + role, "colors", r.light, r.dark, true); });
    });
    TOKEN_CATEGORIES.forEach(function (cat) {
        if (cat === "colors") return;
        Object.keys(t[cat] || {}).forEach(function (k) { add(cat + "." + k, cat, t[cat][k]); });
    });
    return out;
}

var cache = { theme: null, index: null };
function indexOf(theme) {
    if (cache.theme === theme && cache.index) return cache.index;
    var ix = {};
    listTokens(theme).forEach(function (tk) { ix[tk.path] = tk; });
    cache.theme = theme; cache.index = ix;
    return ix;
}

var REF_RE = /\{([A-Za-z0-9_.\-]+)\}/g;
/** A token's value in a mode (light / dark), references followed; undefined: no such token. */
export function resolveToken(theme, path, mode) {
    var ix = indexOf(theme || DEFAULT_THEME);
    var seen = 0;
    function value(p) {
        var tk = ix[p];
        if (!tk) return undefined;
        var v = mode === "dark" ? tk.dark : tk.light;
        return follow(v);
    }
    function follow(v) {
        if (typeof v !== "string" || v.indexOf("{") === -1 || ++seen > 20) return v;
        var whole = /^\{([A-Za-z0-9_.\-]+)\}$/.exec(v.trim());
        if (whole) return value(whole[1]);
        return v.replace(REF_RE, function (m, p) { var r = value(p); return r === undefined ? m : String(r); });
    }
    return value(path);
}

/** The CSS variable of a token: colors.bg.subtle -> --nexa-colors-bg-subtle. */
export function tokenVarName(path) {
    return "--nexa-" + String(path).replace(/\./g, "-").replace(/[^A-Za-z0-9_-]/g, "_");
}
export function tokenVar(path) { return "var(" + tokenVarName(path) + ")"; }
function cssValue(cat, v) { return PX[cat] && typeof v === "number" ? v + "px" : String(v); }

/** The theme as CSS variables: `root` gets every token (light), `dark` the ones that differ. */
export function themeCss(theme, root, dark) {
    var t = theme || DEFAULT_THEME;
    var light = [], darkRules = [];
    listTokens(t).forEach(function (tk) {
        var l = resolveToken(t, tk.path, "light"), d = resolveToken(t, tk.path, "dark");
        if (l === undefined) return;
        light.push(tokenVarName(tk.path) + ": " + cssValue(tk.category, l) + ";");
        if (d !== undefined && String(d) !== String(l)) darkRules.push(tokenVarName(tk.path) + ": " + cssValue(tk.category, d) + ";");
    });
    return (root || ":root") + " { " + light.join(" ") + " }\n" + (dark || '[data-nexa-mode="dark"]') + " { " + darkRules.join(" ") + " }";
}

// ---- {token:path} in values ----------------------------------------------------------------
var TOKEN_RE = /\{token:([A-Za-z0-9_.\-]+)\}/g;
var WHOLE_TOKEN_RE = /^\{token:([A-Za-z0-9_.\-]+)\}$/;
export function isTokenRef(v) { return typeof v === "string" && WHOLE_TOKEN_RE.test(v.trim()); }
export function tokenPathOf(v) { var m = typeof v === "string" && WHOLE_TOKEN_RE.exec(v.trim()); return m ? m[1] : null; }
export function mentionsToken(v) { return typeof v === "string" && v.indexOf("{token:") !== -1; }
/** A value with its {token:…} replaced by their values in `mode` (a whole one keeps its type). */
export function resolveTokenValue(v, theme, mode) {
    if (!mentionsToken(v)) return v;
    var whole = WHOLE_TOKEN_RE.exec(v.trim());
    if (whole) { var r = resolveToken(theme, whole[1], mode); return r === undefined ? v : r; }
    return v.replace(TOKEN_RE, function (m, p) { var r = resolveToken(theme, p, mode); return r === undefined ? m : String(r); });
}
/** Props with every {token:…} resolved (the same object when none mentions one). */
export function resolveTokenProps(props, theme, mode) {
    var out = null;
    Object.keys(props || {}).forEach(function (k) {
        if (!mentionsToken(props[k])) return;
        if (!out) out = Object.assign({}, props);
        out[k] = resolveTokenValue(props[k], theme, mode);
    });
    return out || props;
}
/** For CSS (a frame's fill, gap…): {token:x} -> var(--nexa-x), so a mode change needs no redraw. */
export function tokenCss(v) {
    if (!mentionsToken(v)) return v;
    return v.replace(TOKEN_RE, function (m, p) { return tokenVar(p); });
}

// ---- the current theme (the editor / the page set it) -------------------------------------
var current = { theme: DEFAULT_THEME, mode: "light" };
export function setTheme(theme, mode) {
    if (theme) current.theme = theme;
    if (mode) current.mode = mode === "dark" ? "dark" : "light";
    return current;
}
export function currentTheme() { return current; }
