// --- A number for people: one format spec for axes, tooltips, legends, fields -----------------
// formatValue(value, spec, unit) -> text. spec (every key optional):
//   notation    "standard" (as it is) | "compact" (1.2K 3.4M 5B 6T) | "si" (engineering: k M G T,
//               m µ n under 1) | "scientific" (1.23e6)
//   decimals    "auto" | 0…10              auto: as it is (standard, up to 6), 3 significant (compact / si)
//   minDecimals / maxDecimals              a range instead (trailing zeros kept up to the min)
//   thousands   true | false               the thousands separator (standard notation)
//   separators  "locale" (the page's language) | "dot" (1,234.5) | "comma" (1.234,5) | "custom"
//   decimalSep / thousandsSep              with "custom"
//   unitAt      "after" | "before" | "none"
// With notation "si" and an SI unit ("kW", "mA", "GHz", "ms"…), the unit itself is scaled:
// 1 500 kW -> "1.5 MW", 0.002 s -> "2 ms". Another unit gets the prefix letter: 1 500 rpm -> "1.5k rpm".

var SI_UP = ["", "k", "M", "G", "T", "P", "E"];
var SI_DOWN = ["", "m", "µ", "n", "p"];
var COMPACT = ["", "K", "M", "B", "T"];
var PREFIX = { k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, m: 1e-3, "µ": 1e-6, u: 1e-6, n: 1e-9, p: 1e-12 };
// units an SI prefix scales (a prefix in front of these is read as a prefix)
var SI_BASES = ["W", "Wh", "VA", "VAr", "var", "V", "A", "Ah", "Hz", "g", "s", "m", "Pa", "bar", "B", "J", "L", "l", "Ω", "ohm", "F", "H", "N", "lm", "lx"];

var localeSeps = null;
function pageSeparators() {
    if (localeSeps) return localeSeps;
    localeSeps = { decimal: ".", group: "," };
    try {
        var lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
        var parts = new Intl.NumberFormat(lang).formatToParts(12345.6);
        parts.forEach(function (p) {
            if (p.type === "decimal") localeSeps.decimal = p.value;
            if (p.type === "group") localeSeps.group = p.value === " " || p.value === " " ? " " : p.value;
        });
    } catch (e) { /* keep the default */ }
    return localeSeps;
}

function separators(spec) {
    var s = spec.separators || "locale";
    if (s === "dot") return { decimal: ".", group: "," };
    if (s === "comma") return { decimal: ",", group: "." };
    if (s === "custom") return { decimal: spec.decimalSep || ".", group: spec.thousandsSep === undefined ? "," : spec.thousandsSep };
    return pageSeparators();
}

/** "kW" -> { factor: 1000, base: "W" }; a unit that is not an SI one -> null. */
export function splitSiUnit(unit) {
    unit = String(unit || "");
    if (!unit) return null;
    if (SI_BASES.indexOf(unit) !== -1) return { factor: 1, base: unit };
    var p = unit.charAt(0), rest = unit.slice(1);
    if (PREFIX[p] && SI_BASES.indexOf(rest) !== -1) return { factor: PREFIX[p], base: rest };
    return null;
}

function digits(x, spec, significant) {
    var d = spec.decimals;
    if (d !== undefined && d !== "auto" && d !== "" && isFinite(Number(d))) return { min: Number(d), max: Number(d) };
    var min = isFinite(Number(spec.minDecimals)) && spec.minDecimals !== "" && spec.minDecimals !== undefined ? Number(spec.minDecimals) : 0;
    var max = isFinite(Number(spec.maxDecimals)) && spec.maxDecimals !== "" && spec.maxDecimals !== undefined ? Number(spec.maxDecimals) : null;
    if (max === null) {
        if (significant) {
            var a = Math.abs(x);
            max = a >= 100 ? 0 : a >= 10 ? 1 : 2;
        } else max = 6;
    }
    return { min: Math.min(min, max), max: Math.max(min, max) };
}

function fixed(x, dg, seps, group) {
    var p = Math.pow(10, dg.max);
    var r = Math.round(x * p) / p;
    var t = r.toFixed(dg.max);
    // trailing zeros past the minimum go
    if (dg.max > dg.min && t.indexOf(".") !== -1) {
        var keep = t.indexOf(".") + 1 + dg.min;
        var end = t.length;
        while (end > keep && t.charAt(end - 1) === "0") end--;
        t = t.slice(0, end);
        if (t.charAt(t.length - 1) === ".") t = t.slice(0, -1);
    }
    var neg = t.charAt(0) === "-";
    if (neg) t = t.slice(1);
    var dot = t.indexOf(".");
    var ip = dot === -1 ? t : t.slice(0, dot), fp = dot === -1 ? "" : t.slice(dot + 1);
    if (group && seps.group) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, seps.group);
    var out = ip + (fp ? seps.decimal + fp : "");
    if (neg && /[1-9]/.test(out)) out = "-" + out;
    return out;
}

function withUnit(text, unit, spec) {
    if (!unit || spec.unitAt === "none") return text;
    return spec.unitAt === "before" ? unit + " " + text : text + " " + unit;
}

/**
 * The number and its (scaled) unit apart: { text: "1.5", unit: "MW" } — for "before / after the
 * value" texts that go between them.
 */
export function formatParts(value, spec, unit) {
    var s = Object.assign({}, spec || {}, { unitAt: "after" });
    var u = unit ? String(unit) : "";
    var si = (s.notation === "si") && splitSiUnit(u);
    if (!u) return { text: formatValue(value, s, ""), unit: "" };
    if (si) {
        var full = formatValue(value, s, u), cut = full.lastIndexOf(" ");
        return cut === -1 ? { text: full, unit: "" } : { text: full.slice(0, cut), unit: full.slice(cut + 1) };
    }
    return { text: formatValue(value, Object.assign({}, s, { unitAt: "none" }), u), unit: u };
}

export function formatValue(value, spec, unit) {
    spec = spec || {};
    if (value === null || value === undefined || value === "") return "";
    var x = typeof value === "number" ? value : Number(value);
    if (!isFinite(x)) return typeof value === "number" ? "—" : String(value);
    var seps = separators(spec);
    var notation = spec.notation || "standard";
    var group = spec.thousands !== false;

    if (notation === "scientific") {
        var dg = digits(x, spec, true);
        var e = x.toExponential(Math.max(dg.max, 0));
        var m = e.split("e");
        return withUnit(fixed(Number(m[0]), dg, seps, false) + "e" + Number(m[1]), unit, spec);
    }

    if (notation === "compact" || notation === "si") {
        var u = unit ? String(unit) : "";
        var si = notation === "si" ? splitSiUnit(u) : null;
        var v = si ? x * si.factor : x;
        var a = Math.abs(v), sfx = "", step = 0;
        if (notation === "compact") {
            while (a >= 1000 && step < COMPACT.length - 1) { a /= 1000; v /= 1000; step++; }
            sfx = COMPACT[step];
        } else if (a >= 1000) {
            while (a >= 1000 && step < SI_UP.length - 1) { a /= 1000; v /= 1000; step++; }
            sfx = SI_UP[step];
        } else if (a > 0 && a < 1 && (si || notation === "si")) {
            while (a < 1 && step < SI_DOWN.length - 1) { a *= 1000; v *= 1000; step++; }
            sfx = SI_DOWN[step];
        }
        // a rounding up to the next step: 999.96 -> 1K
        var dg2 = digits(v, spec, true);
        var text = fixed(v, dg2, seps, false);
        if (si) return withUnit(text, sfx + si.base, spec);
        if (notation === "si") return withUnit(text + sfx, u, spec);
        return withUnit(text + sfx, u, spec);
    }

    return withUnit(fixed(x, digits(x, spec, false), seps, group), unit, spec);
}

/** The format props a component offers (one spec): a schema of its fields, for an inspector. */
export var NUMBER_FORMAT_FIELDS = {
    notation: { type: "enum", label: "Notation", default: "standard",
        options: [{ value: "standard", label: "As it is (1,234.5)" }, { value: "compact", label: "Short (1.2K, 3.4M, 5B)" },
            { value: "si", label: "Engineering (k, M, G; 1.5 MW, 2 ms)" }, { value: "scientific", label: "Scientific (1.23e6)" }] },
    decimals: { type: "enum", label: "Decimals", default: "auto",
        options: [{ value: "auto", label: "Automatic" }, { value: "0", label: "0" }, { value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }] },
    thousands: { type: "boolean", label: "Thousands separator", default: true },
    separators: { type: "enum", label: "Separators", default: "locale",
        options: [{ value: "locale", label: "The page's language" }, { value: "dot", label: "1,234.5" }, { value: "comma", label: "1.234,5" }] },
    unitAt: { type: "enum", label: "Unit", default: "after", options: [{ value: "after", label: "After (12 kW)" }, { value: "before", label: "Before ($ 12)" }, { value: "none", label: "Hidden" }] }
};
