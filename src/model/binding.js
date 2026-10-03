// --- A prop's value: static, or a binding priority list ------------------------------
// One resolver for the editor AND the deployed page (and the server). A prop holds:
//   a static value                      anything that is not a binding
//   a binding priority list (stored)    { $bind: [ source, … ], static: <value> }
//   a legacy binding string             "{name}", "{sparkplug:G::E::D::M}", "{msg.x}",
//                                       "Line {line}: {sparkplug:…} rpm"   (still read as before)
// A source: { src, ref }. src is a SOURCE KIND (registry below): screen | app | shared | param |
// msg | sparkplug | expr | var (legacy: the nearest declaration) | a provider added later (opcua…).
//
// The rule (the user's): from the top, the FIRST source that has a value wins; one without a value
// (null / undefined / an unknown tag "???") falls through to the next; `static` is the last.
// 0, false and "" are values. Two sources changing together: the order decides.
//
// An expression (src "expr") is arithmetic and text over scoped references, never eval:
//   (0.5 * [screen]{var3}) / [app]{var1} + [sparkplug]{G::E::D::Speed} " rpm"
// `+` adds numbers (numeric strings too) and joins text; two values side by side are joined.
// A reference without a value makes the whole expression have none (it falls through).

// ---- the source kinds (a registry: OPC UA, SQL… register later) ---------------------------
var KINDS = {};

/**
 * registerSourceKind("opcua", { label, tag: true, provider: "opcua" })
 *   label      what the inspector shows ("OPC UA tag")
 *   tag        its ref is a tag address: subscribed like a tag, written like a tag
 *   provider   the tag provider name (the {provider:address} form)
 *   variable   its ref is a variable in this scope layer ("screen" | "app" | "shared" | "param" | "any")
 */
export function registerSourceKind(name, def) {
    KINDS[name] = Object.assign({ name: name, label: name }, def || {});
    return KINDS[name];
}
export function sourceKind(name) { return KINDS[name] || null; }
export function sourceKinds() { return Object.keys(KINDS).map(function (k) { return KINDS[k]; }); }

registerSourceKind("screen", { label: "Screen variable", variable: "screen" });
registerSourceKind("app", { label: "App variable", variable: "app" });
registerSourceKind("shared", { label: "Shared variable", variable: "shared" });
registerSourceKind("param", { label: "Template parameter", variable: "param" });
registerSourceKind("msg", { label: "Message", message: true });
registerSourceKind("sparkplug", { label: "Sparkplug tag", tag: true, provider: "sparkplug" });
registerSourceKind("expr", { label: "Expression", expression: true });
registerSourceKind("var", { label: "Variable (nearest)", variable: "any", legacy: true });

// ---- the forms --------------------------------------------------------------------------------
export function isBindingList(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.$bind);
}

var LEGACY_RE = /\{[^{}]+\}/;
/** A legacy binding string: "{…}" whole or inside text ({asset:…} / {token:…} are values). */
export function isLegacyBinding(v) {
    return typeof v === "string" && LEGACY_RE.test(v) && !/^\{(asset|token):[^{}]+\}$/.test(v.trim());
}

/** Whether a prop value is bound at all (either form). */
export function isBoundValue(v) { return isBindingList(v) || isLegacyBinding(v); }

/** "No value": falls through to the next source. */
export function hasNoValue(v) {
    return v === undefined || v === null || v === "???" || (typeof v === "number" && !isFinite(v));
}

/** A binding list with the given sources and static value. */
export function bindingList(sources, staticValue) {
    return { $bind: (sources || []).map(function (s) { return { src: s.src, ref: String(s.ref) }; }), static: staticValue };
}

// "{sparkplug:a}" -> sparkplug a; "{msg.x}" -> msg x; "{name}" -> var name; text with {…} -> expr
var WHOLE_RE = /^\{([^{}]+)\}$/;
function legacySource(text) {
    var m = WHOLE_RE.exec(String(text).trim());
    if (m) {
        var inner = m[1];
        var tag = /^([A-Za-z][\w-]*):([\s\S]+)$/.exec(inner);
        if (tag) return { src: KINDS[tag[1]] && KINDS[tag[1]].tag ? tag[1] : "sparkplug", ref: tag[2], provider: tag[1] };
        if (/^msg(\.|\[|$)/.test(inner)) return { src: "msg", ref: inner.replace(/^msg\.?/, "") };
        return { src: "var", ref: inner };
    }
    return { src: "expr", ref: templateToExpression(text) };
}

/** A legacy template ("Line {line}: {sparkplug:…} rpm") as an expression of joined parts. */
export function templateToExpression(text) {
    var out = [], re = /\{([^{}]+)\}/g, last = 0, m;
    text = String(text);
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(JSON.stringify(text.slice(last, m.index)));
        var s = legacySource(m[0]);
        out.push(s.src === "var" ? "{" + s.ref + "}" : s.src === "msg" ? "[msg]{" + s.ref + "}" : "[" + (s.provider || s.src) + "]{" + s.ref + "}");
        last = re.lastIndex;
    }
    if (last < text.length) out.push(JSON.stringify(text.slice(last)));
    return out.join(" ");
}

/**
 * Any prop value as { sources: [{src, ref}], static, legacy }: a binding list as it is, a legacy
 * string converted (its __fallback becomes static), a static value with no sources.
 */
export function toBindingList(value, fallback) {
    if (isBindingList(value)) return { sources: value.$bind.slice(), static: value.static, legacy: false };
    if (isLegacyBinding(value)) {
        var s = legacySource(value);
        return { sources: [{ src: s.src, ref: s.ref }], static: fallback, legacy: true };
    }
    return { sources: [], static: value, legacy: false };
}

// ---- resolving ------------------------------------------------------------------------------
/**
 * The value of a prop now.
 *   value    the stored prop value (any form)
 *   read     read(src, ref) -> its value, or null / undefined / "???" when it has none
 *   fallback the legacy __fallback (for a legacy string)
 * -> { value, from } (from: the index of the source used, -1 = static)
 */
export function resolveValue(value, read, fallback) {
    var b = toBindingList(value, fallback);
    for (var i = 0; i < b.sources.length; i++) {
        var s = b.sources[i];
        var v = s.src === "expr" ? evaluateExpression(s.ref, read) : read(s.src, s.ref);
        if (!hasNoValue(v)) return { value: v, from: i };
    }
    return { value: b.static, from: -1 };
}

/** Every tag a prop value reads (to subscribe): [{ provider, address }]. */
export function tagRefsOf(value) {
    var out = [];
    toBindingList(value).sources.forEach(function (s) {
        var k = KINDS[s.src];
        if (k && k.tag) out.push({ provider: k.provider || s.src, address: s.ref });
        else if (s.src === "expr") referencesOf(s.ref).forEach(function (r) {
            var rk = KINDS[r.src];
            if (rk && rk.tag) out.push({ provider: rk.provider || r.src, address: r.ref });
        });
    });
    return out;
}

/** Whether a prop value reads the message (an Update Component node feeds it). */
export function readsMessage(value) {
    return toBindingList(value).sources.some(function (s) {
        return s.src === "msg" || (s.src === "expr" && referencesOf(s.ref).some(function (r) { return r.src === "msg"; }));
    });
}

// ---- expressions: a small safe parser (no eval) -----------------------------------------------
function tokenize(text) {
    var t = [], i = 0, s = String(text);
    while (i < s.length) {
        var c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "[" || c === "{") {
            // [kind]{ref} or a bare {ref} (the nearest variable, the legacy form)
            var kind = "var";
            if (c === "[") {
                var close = s.indexOf("]", i);
                if (close === -1) throw new Error("a [kind] is not closed");
                kind = s.slice(i + 1, close).trim();
                i = close + 1;
                while (/\s/.test(s[i] || "")) i++;
                if (s[i] !== "{") throw new Error("[" + kind + "] needs {ref} after it");
            }
            var end = s.indexOf("}", i);
            if (end === -1) throw new Error("a {ref} is not closed");
            t.push({ t: "ref", src: kind === "var" ? "var" : kind, ref: s.slice(i + 1, end).trim() });
            i = end + 1;
            continue;
        }
        if (c === '"' || c === "'") {
            var j = i + 1, str = "";
            while (j < s.length && s[j] !== c) { if (s[j] === "\\" && j + 1 < s.length) { j++; } str += s[j]; j++; }
            if (j >= s.length) throw new Error("a text is not closed");
            t.push({ t: "str", v: str });
            i = j + 1;
            continue;
        }
        var num = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(s.slice(i));
        if (num) { t.push({ t: "num", v: Number(num[1]) }); i += num[1].length; continue; }
        var op = /^(==|!=|<=|>=|&&|\|\||[-+*/%()<>!?:,])/.exec(s.slice(i));
        if (op) { t.push({ t: "op", v: op[1] }); i += op[1].length; continue; }
        var id = /^[A-Za-z_][\w]*/.exec(s.slice(i));
        if (id) { t.push({ t: "id", v: id[0] }); i += id[0].length; continue; }
        throw new Error("unexpected \"" + c + "\"");
    }
    return t;
}

var FUNCS = {
    round: function (x, d) { var p = Math.pow(10, d || 0); return Math.round(x * p) / p; },
    floor: Math.floor, ceil: Math.ceil, abs: Math.abs, min: Math.min, max: Math.max, sqrt: Math.sqrt,
    fixed: function (x, d) { return Number(x).toFixed(d === undefined ? 0 : d); },
    upper: function (s) { return String(s).toUpperCase(); },
    lower: function (s) { return String(s).toLowerCase(); }
};

function parse(tokens) {
    var i = 0;
    function peek() { return tokens[i]; }
    function isOp(v) { var x = tokens[i]; return x && x.t === "op" && x.v === v; }
    function next() { return tokens[i++]; }
    function expect(v) { if (!isOp(v)) throw new Error("expected \"" + v + "\""); i++; }
    function startsValue() {
        var x = peek();
        return !!x && (x.t === "num" || x.t === "str" || x.t === "ref" || x.t === "id" || (x.t === "op" && (x.v === "(" || x.v === "!")));
    }
    function primary() {
        var x = next();
        if (!x) throw new Error("the expression ends too early");
        if (x.t === "num") return { k: "lit", v: x.v };
        if (x.t === "str") return { k: "lit", v: x.v };
        if (x.t === "ref") return { k: "ref", src: x.src, ref: x.ref };
        if (x.t === "id") {
            if (x.v === "true" || x.v === "false") return { k: "lit", v: x.v === "true" };
            if (x.v === "null") return { k: "lit", v: null };
            if (!FUNCS[x.v]) throw new Error("unknown function \"" + x.v + "\"");
            expect("(");
            var args = [];
            if (!isOp(")")) { args.push(ternary()); while (isOp(",")) { i++; args.push(ternary()); } }
            expect(")");
            return { k: "call", f: x.v, args: args };
        }
        if (x.t === "op" && x.v === "(") { var e = ternary(); expect(")"); return e; }
        throw new Error("unexpected \"" + x.v + "\"");
    }
    function unary() {
        if (isOp("-")) { i++; return { k: "neg", a: unary() }; }
        if (isOp("!")) { i++; return { k: "not", a: unary() }; }
        return primary();
    }
    function mul() {
        var a = unary();
        while (isOp("*") || isOp("/") || isOp("%")) { var o = next().v; a = { k: "bin", o: o, a: a, b: unary() }; }
        return a;
    }
    function add() {
        var a = mul();
        while (isOp("+") || isOp("-")) { var o = next().v; a = { k: "bin", o: o, a: a, b: mul() }; }
        return a;
    }
    // two values side by side are joined: [x]{a} " rpm"
    function join() {
        var a = add();
        while (startsValue() && !isOp("!")) a = { k: "join", a: a, b: add() };
        return a;
    }
    function cmp() {
        var a = join();
        while (isOp("==") || isOp("!=") || isOp("<") || isOp("<=") || isOp(">") || isOp(">=")) { var o = next().v; a = { k: "bin", o: o, a: a, b: join() }; }
        return a;
    }
    function and() { var a = cmp(); while (isOp("&&")) { i++; a = { k: "and", a: a, b: cmp() }; } return a; }
    function or() { var a = and(); while (isOp("||")) { i++; a = { k: "or", a: a, b: and() }; } return a; }
    function ternary() {
        var c = or();
        if (isOp("?")) { i++; var a = ternary(); expect(":"); return { k: "if", c: c, a: a, b: ternary() }; }
        return c;
    }
    var ast = ternary();
    if (i < tokens.length) throw new Error("unexpected \"" + (tokens[i].v || tokens[i].ref) + "\"");
    return ast;
}

var CACHE = {};
/** The parsed expression ({ ast } or { error }), cached by its text. */
export function parseExpression(text) {
    var key = String(text);
    if (CACHE[key]) return CACHE[key];
    var r;
    try { r = { ast: parse(tokenize(key)) }; } catch (e) { r = { error: e.message }; }
    CACHE[key] = r;
    return r;
}

/** The references an expression reads: [{ src, ref }]. */
export function referencesOf(text) {
    var p = parseExpression(text), out = [];
    (function walk(n) {
        if (!n) return;
        if (n.k === "ref") out.push({ src: n.src, ref: n.ref });
        ["a", "b", "c"].forEach(function (k) { if (n[k]) walk(n[k]); });
        if (n.args) n.args.forEach(walk);
    })(p.ast);
    return out;
}

var NONE = {};       // a reference without a value: the expression has none
function num(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
    return NaN;
}
function text(v) { return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); }

function evalNode(n, read) {
    switch (n.k) {
        case "lit": return n.v;
        case "ref": { var v = read(n.src, n.ref); if (hasNoValue(v)) throw NONE; return v; }
        case "neg": return -num(evalNode(n.a, read));
        case "not": return !evalNode(n.a, read);
        case "join": return text(evalNode(n.a, read)) + text(evalNode(n.b, read));
        case "and": return evalNode(n.a, read) && evalNode(n.b, read);
        case "or": return evalNode(n.a, read) || evalNode(n.b, read);
        case "if": return evalNode(n.c, read) ? evalNode(n.a, read) : evalNode(n.b, read);
        case "call": return FUNCS[n.f].apply(null, n.args.map(function (x) { return evalNode(x, read); }));
        case "bin": {
            var a = evalNode(n.a, read), b = evalNode(n.b, read);
            switch (n.o) {
                case "+": { var x = num(a), y = num(b); return isNaN(x) || isNaN(y) ? text(a) + text(b) : x + y; }
                case "-": return num(a) - num(b);
                case "*": return num(a) * num(b);
                case "/": return num(a) / num(b);
                case "%": return num(a) % num(b);
                case "==": return a == b; // eslint-disable-line eqeqeq
                case "!=": return a != b; // eslint-disable-line eqeqeq
                case "<": return num(a) < num(b);
                case "<=": return num(a) <= num(b);
                case ">": return num(a) > num(b);
                case ">=": return num(a) >= num(b);
            }
        }
    }
    return null;
}

/** The value of an expression, or null when a reference has none (or it does not parse). */
export function evaluateExpression(textOrAst, read) {
    var p = typeof textOrAst === "string" ? parseExpression(textOrAst) : { ast: textOrAst };
    if (!p.ast) return null;
    try {
        var v = evalNode(p.ast, read);
        return typeof v === "number" && !isFinite(v) ? null : v;
    } catch (e) {
        if (e === NONE) return null;
        return null;
    }
}
