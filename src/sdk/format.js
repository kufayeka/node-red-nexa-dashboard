// Number formatting / parsing for Nexa fields (and any SDK component that
// shows numbers). Pure functions. Moved here from
// @kufayeka/nexa-component-fields/dist/field-format.js; the SDK bundle still
// publishes it as window.NexaFieldFormat for older plugins.
//
// Options (all optional):
//   decimals            number of decimals; -1 = as the value comes (no rounding)
//   decimalSeparator    "." (default) or ","
//   thousandsSeparator  "" (default, none), ",", ".", " " or "'"
function opts(o) {
    o = o || {};
    var dec = o.decimalSeparator === "," ? "," : ".";
    var th = typeof o.thousandsSeparator === "string" ? o.thousandsSeparator : "";
    if (th === dec) th = ""; // "1.234.5" would be unreadable
    var d = Number(o.decimals);
    return { decimals: Number.isFinite(d) ? Math.max(-1, Math.min(10, Math.floor(d))) : -1, decimalSeparator: dec, thousandsSeparator: th };
}

function toNumber(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v === null || v === undefined) return NaN;
    var s = String(v).trim();
    return s === "" ? NaN : Number(s);
}

// Plain decimal digits for a number (no exponent notation up to 1e21).
function plain(n, decimals) {
    if (decimals >= 0) return n.toFixed(decimals);
    var s = String(n);
    if (/e-/i.test(s)) s = n.toFixed(20).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""); // 1e-7 -> 0.0000001
    return s;
}

/** Display text: rounding + thousands and decimal separators. Non-numbers pass through as text. */
function formatNumber(value, o) {
    o = opts(o);
    var n = toNumber(value);
    if (!Number.isFinite(n)) return value === null || value === undefined ? "" : String(value);
    var s = plain(n, o.decimals);
    var neg = s.charAt(0) === "-";
    if (neg) s = s.slice(1);
    var parts = s.split(".");
    var intPart = parts[0];
    var frac = parts.length > 1 ? parts[1] : "";
    if (o.thousandsSeparator) intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, o.thousandsSeparator);
    if (neg && /^0*$/.test(intPart.replace(/\D/g, "")) && /^0*$/.test(frac)) neg = false; // no "-0,00"
    return (neg ? "-" : "") + intPart + (frac ? o.decimalSeparator + frac : "");
}

/** Text to edit: the rounded value, the decimal separator, NO thousands separator. */
function editText(value, o) {
    o = opts(o);
    return formatNumber(value, { decimals: o.decimals, decimalSeparator: o.decimalSeparator, thousandsSeparator: "" });
}

/**
 * Parses what the operator typed. Accepts the configured separators and,
 * because a numpad often types "." whatever the locale, a SINGLE "." or
 * "," is always read as the decimal point; a separator that appears more
 * than once is read as thousands ("1.234.567"). Returns
 * { ok, value, empty, reason }.
 */
function parseNumber(text, o) {
    var strict = !!(o && o.strict);
    o = opts(o);
    var t = String(text === null || text === undefined ? "" : text);
    if (strict && o.thousandsSeparator) t = t.split(o.thousandsSeparator).join("");
    t = t.replace(/[\s ']/g, "");
    if (t === "") return { ok: false, empty: true, reason: "empty" };
    if (strict) {
        // grouped while typing (liveGroup): only the configured separators exist
        if (o.decimalSeparator === ",") { if (t.indexOf(".") !== -1) return { ok: false, reason: "not a number" }; t = t.replace(",", "."); }
        else if (t.indexOf(",") !== -1) return { ok: false, reason: "not a number" };
        if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return { ok: false, reason: "not a number" };
        return { ok: true, value: Number(t) };
    }
    var dots = (t.match(/\./g) || []).length;
    var commas = (t.match(/,/g) || []).length;
    if (dots && commas) {
        // both kinds: the configured decimal separator is the decimal point
        var other = o.decimalSeparator === "," ? "." : ",";
        t = t.split(other).join("");
        if (o.decimalSeparator === ",") t = t.replace(",", ".");
    } else if (dots > 1 || commas > 1) {
        t = t.replace(/[.,]/g, ""); // repeated: thousands separators
    } else if (commas === 1) {
        t = t.replace(",", ".");
    }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return { ok: false, reason: "not a number" };
    var n = Number(t);
    if (!Number.isFinite(n)) return { ok: false, reason: "not a number" };
    return { ok: true, value: n };
}

/**
 * Checks a parsed number against the field settings.
 * s: { integer, min, max, decimals } (min/max: number, "" / null = none)
 * Returns { ok, value, reason } -- value rounded to `decimals` when >= 0.
 */
function validateNumber(parsed, s) {
    s = s || {};
    if (!parsed || !parsed.ok) return { ok: false, reason: parsed && parsed.reason ? parsed.reason : "not a number" };
    var n = parsed.value;
    if (s.integer && !Number.isInteger(n)) return { ok: false, reason: "whole number required" };
    var d = Number(s.decimals);
    if (!s.integer && Number.isFinite(d) && d >= 0) n = Number(n.toFixed(Math.min(10, Math.floor(d))));
    var min = limit(s.min), max = limit(s.max);
    if (min !== null && n < min) return { ok: false, reason: "minimum is " + min };
    if (max !== null && n > max) return { ok: false, reason: "maximum is " + max };
    return { ok: true, value: n };
}

function limit(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Thousands grouping WHILE typing. Called after every input with the new
 * text, the caret position and the character just typed (InputEvent.data).
 * Returns { text, caret }: sign, digits and one decimal separator, the
 * integer part grouped, leading zeros dropped, and the caret after the
 * same digit it was after.
 * A "." or "," the operator types is the decimal point (the grouping is
 * inserted here, never typed), so the numpad key works in every setting;
 * a second decimal point is ignored.
 */
function liveGroup(text, caret, inserted, o) {
    o = opts(o);
    var dec = o.decimalSeparator, th = o.thousandsSeparator;
    var s = String(text === null || text === undefined ? "" : text);
    caret = Math.max(0, Math.min(s.length, caret === undefined || caret === null ? s.length : caret));
    if (!th) return { text: s, caret: caret };
    var typedAt = (inserted === "." || inserted === ",") && caret > 0 && s.charAt(caret - 1) === inserted ? caret - 1 : -1;
    var existing = -1;
    for (var i = 0; i < s.length; i++) {
        if (i !== typedAt && s.charAt(i) === dec) { existing = i; break; }
    }
    var decAt = existing >= 0 ? existing : typedAt;
    // significant tokens, each remembering whether it was before the caret
    var tokens = [];
    for (var j = 0; j < s.length; j++) {
        var c = s.charAt(j);
        var kind = null;
        if ((c === "-" || c === "+") && tokens.length === 0) kind = "sign";
        else if (c >= "0" && c <= "9") kind = "digit";
        else if (j === decAt) kind = "dec";
        if (kind) tokens.push({ kind: kind, ch: kind === "dec" ? dec : c, before: j < caret });
    }
    // leading zeros of the integer part ("007" -> "7", but "0" and "0,5" stay)
    var start = tokens.length && tokens[0].kind === "sign" ? 1 : 0;
    while (tokens.length > start + 1 && tokens[start].kind === "digit" && tokens[start].ch === "0" && tokens[start + 1].kind === "digit") tokens.splice(start, 1);
    var decIndex = -1;
    for (var k = 0; k < tokens.length; k++) if (tokens[k].kind === "dec") { decIndex = k; break; }
    var intTokens = tokens.slice(start, decIndex >= 0 ? decIndex : tokens.length);
    var out = "", newCaret = 0, count = 0;
    var sigBefore = tokens.filter(function (t) { return t.before; }).length;
    function put(str, significant) {
        out += str;
        if (significant) { count++; if (count <= sigBefore) newCaret = out.length; }
    }
    if (start) put(tokens[0].ch, true);
    intTokens.forEach(function (t, idx) {
        if (idx > 0 && (intTokens.length - idx) % 3 === 0) out += th;
        put(t.ch, true);
    });
    if (decIndex >= 0) for (var m = decIndex; m < tokens.length; m++) put(tokens[m].ch, true);
    if (sigBefore === 0) newCaret = 0;
    return { text: out, caret: newCaret };
}

export { formatNumber, editText, parseNumber, validateNumber, toNumber, liveGroup };
export default { formatNumber: formatNumber, editText: editText, parseNumber: parseNumber, validateNumber: validateNumber, toNumber: toNumber, liveGroup: liveGroup };
