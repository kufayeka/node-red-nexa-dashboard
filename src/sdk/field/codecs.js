// --- Field codecs: how a field's value is parsed, shown and edited ---------
// A codec is a plain object of PURE, synchronous functions (no fetch, no side
// effects), plus the props it needs (they show up in the inspector):
//   kind         "number" | "text"            (what a JS value it writes)
//   props        { key: propSchema }          contributed to the field's props
//   parse(text, p)     -> { ok: true, value } | { ok: false, reason } | { ok: false, empty: true }
//   format(value, p)   -> string              shown while not editing
//   editText(value, p) -> string              the text an edit starts with
//   equals(a, b, p)    -> boolean             "already that value" / tag confirmed the write
//   live(p)            -> null | { format(text, caret, inserted) -> { text, caret }, separator }
//   inputMode(p)       -> virtual keyboard hint ("decimal", "numeric", "text")
//   align              default text alignment
// Register your own with NEXA.defineCodec(name, codec) (see sdk/component.js).
import F from "../format.js";

var codecs = {};

export function defineCodec(name, codec) {
    if (!name || !codec || typeof codec.parse !== "function") throw new Error("[nexa] defineCodec(name, { parse, format, ... })");
    codecs[name] = Object.assign({
        kind: "text",
        props: {},
        format: function (v) { return v === undefined || v === null ? "" : String(v); },
        editText: function (v) { return v === undefined || v === null ? "" : String(v); },
        equals: function (a, b) { return String(a) === String(b); },
        live: function () { return null; },
        inputMode: function () { return "text"; },
        align: "left"
    }, codec);
    return codecs[name];
}

export function getCodec(name) {
    var c = codecs[name || "text"];
    if (!c) throw new Error("[nexa] unknown codec \"" + name + "\" — register it with NEXA.defineCodec()");
    return c;
}

// ---- numbers -------------------------------------------------------------------

function numberOptions(p, integer) {
    return {
        integer: integer,
        decimals: integer ? 0 : (p.decimals === "" || p.decimals === undefined ? 2 : Number(p.decimals)),
        decimalSeparator: p.decimalSeparator === "," ? "," : ".",
        thousandsSeparator: typeof p.thousandsSeparator === "string" ? p.thousandsSeparator : "",
        min: p.min, max: p.max
    };
}

// Thousands grouping while typing: on when a thousands separator is set,
// unless "groupWhileTyping" is switched off.
function groupsWhileTyping(p, integer) {
    var o = numberOptions(p, integer);
    return !!(o.thousandsSeparator && o.thousandsSeparator !== o.decimalSeparator && p.groupWhileTyping !== false);
}

var NUMBER_FORMAT_PROPS = {
    decimalSeparator: {
        type: "enum", default: ".", group: "Number Format", label: "Decimal separator", style: "select",
        options: [{ value: ".", label: "Dot  ( 12.5 )" }, { value: ",", label: "Comma  ( 12,5 )" }],
        help: "Typing: a single \".\" or \",\" is always read as the decimal point (numpad)."
    },
    thousandsSeparator: {
        type: "enum", default: "", group: "Number Format", label: "Thousands separator", style: "select",
        options: [
            { value: "", label: "None  ( 1234567 )" }, { value: ",", label: "Comma  ( 1,234,567 )" },
            { value: ".", label: "Dot  ( 1.234.567 )" }, { value: " ", label: "Space  ( 1 234 567 )" },
            { value: "'", label: "Apostrophe  ( 1'234'567 )" }
        ]
    },
    groupWhileTyping: {
        type: "boolean", default: true, group: "Number Format", label: "Group thousands while typing",
        help: "The separator is inserted as the operator types (caret kept); a typed \".\" or \",\" is then always the decimal point. Off: the separator is only shown when not editing.",
        visibleWhen: function (p) { return !!p.thousandsSeparator; }
    },
    min: { type: "number", default: "", group: "Number Format", label: "Minimum", placeholder: "none", help: "Typed values below are rejected (Invalid)." },
    max: { type: "number", default: "", group: "Number Format", label: "Maximum", placeholder: "none", help: "Typed values above are rejected (Invalid)." }
};

function numberCodec(integer) {
    var props = {};
    if (!integer) {
        props.decimals = {
            type: "number", default: 2, min: -1, max: 10, step: 1, group: "Number Format", label: "Decimals",
            help: "Shown and written with this many decimals. -1 = as the value comes (no rounding)."
        };
    }
    Object.keys(NUMBER_FORMAT_PROPS).forEach(function (k) { props[k] = NUMBER_FORMAT_PROPS[k]; });
    return {
        kind: "number",
        align: "right",
        props: props,
        parse: function (text, p) {
            var o = numberOptions(p, integer);
            // grouped while typing: the separators are exactly the configured ones
            var parsed = F.parseNumber(text, groupsWhileTyping(p, integer) ? Object.assign({ strict: true }, o) : o);
            if (parsed.empty) return { ok: false, empty: true, reason: "empty" };
            return F.validateNumber(parsed, o);
        },
        format: function (v, p) {
            return F.formatNumber(v, numberOptions(p, integer));
        },
        editText: function (v, p) {
            if (!Number.isFinite(F.toNumber(v))) return "";
            var o = numberOptions(p, integer);
            return groupsWhileTyping(p, integer) ? F.formatNumber(v, o) : F.editText(v, o);
        },
        equals: function (a, b) {
            return F.toNumber(a) === F.toNumber(b);
        },
        live: function (p) {
            if (!groupsWhileTyping(p, integer)) return null;
            var o = numberOptions(p, integer);
            return {
                format: function (text, caret, inserted) { return F.liveGroup(text, caret, inserted, o); },
                separator: o.thousandsSeparator // Backspace / Delete step over it
            };
        },
        inputMode: function () { return integer ? "numeric" : "decimal"; }
    };
}

defineCodec("int", numberCodec(true));
defineCodec("float", numberCodec(false));

// ---- text ------------------------------------------------------------------------

defineCodec("text", {
    kind: "text",
    props: {
        maxLength: { type: "number", default: "", min: 0, step: 1, group: "Text Input", label: "Max length", placeholder: "no limit" },
        pattern: {
            type: "string", default: "", mono: true, group: "Text Input", label: "Pattern (regular expression)",
            placeholder: "e.g. [A-Z]{2}-\\d{4}", help: "The whole text must match; otherwise Invalid."
        },
        patternMessage: {
            type: "string", default: "", group: "Text Input", label: "Pattern message", placeholder: "does not match the required format",
            visibleWhen: function (p) { return !!p.pattern; }
        }
    },
    parse: function (text, p) {
        var t = String(text === undefined || text === null ? "" : text);
        var max = Number(p.maxLength);
        if (max > 0 && t.length > max) return { ok: false, reason: "maximum " + max + " characters" };
        if (p.pattern) {
            var re;
            try { re = new RegExp("^(?:" + p.pattern + ")$"); } catch (e) { re = null; }
            if (re && !re.test(t)) return { ok: false, reason: p.patternMessage || "does not match the required format" };
        }
        return { ok: true, value: t };
    },
    equals: function (a, b) { return String(a) === String(b); }
});
