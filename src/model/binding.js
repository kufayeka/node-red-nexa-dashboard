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
// one registry per page, shared by every bundle that carries this module (editor, page, SDK)
var G = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {};
var KINDS = G.__nexaSourceKinds || (G.__nexaSourceKinds = {});

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

/** Every binding list in a value (a prop, the fields of its list items). */
export function bindingListsIn(v, out) {
    out = out || [];
    if (isBindingList(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(function (x) { bindingListsIn(x, out); });
    else if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) Object.keys(v).forEach(function (k) { bindingListsIn(v[k], out); });
    return out;
}

/**
 * What the binding lists in a value read, as the legacy strings the existing pipelines index:
 * "{sparkplug:address}" per tag, "{name}" per variable (a type member's tag is found through it).
 */
export function bindingCandidates(v) {
    var out = [];
    bindingListsIn(v).forEach(function (list) {
        tagRefsOf(list).forEach(function (t) { if (t.provider === "sparkplug") out.push("{sparkplug:" + t.address + "}"); });
        list.$bind.forEach(function (s) {
            var refs = s.src === "expr" ? referencesOf(s.ref) : [s];
            refs.forEach(function (r) {
                var k = KINDS[r.src];
                if (k && k.variable) out.push("{" + firstSegment(r.ref) + "}");
            });
        });
    });
    return out;
}

/**
 * Where a write to a binding list goes: its first writable source (a tag, a screen / app / shared
 * variable), as the legacy string the write paths take ("{sparkplug:…}", "{name}"); null = none.
 */
export function writeTargetOf(value) {
    if (!isBindingList(value)) return typeof value === "string" ? value : null;
    for (var i = 0; i < value.$bind.length; i++) {
        var s = value.$bind[i], k = KINDS[s.src];
        if (!k || !s.ref) continue;
        if (k.tag) return "{" + (k.provider || s.src) + ":" + s.ref + "}";
        if (k.variable && k.variable !== "param") return "{" + s.ref + "}";
    }
    return null;
}

/** Whether a prop value reads the message (an Update Component node feeds it). */
export function readsMessage(value) {
    if (!isBindingList(value) && !isLegacyBinding(value)) return bindingListsIn(value).some(readsMessage);
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

// ---- reading the sources from scope chains (the editor's and the page's) ----------------------
// A scope chain is prototype objects: containers -> the surface (screen / template instance) ->
// the app layer -> the shared layer (-> the page's root with $route). The app and shared layers
// are marked (markScopeLayer) so a reader finds them in either the editor's or the page's chain.
export function markScopeLayer(scope, layer) {
    if (scope && typeof scope === "object") Object.defineProperty(scope, "__nexaLayer", { value: layer, enumerable: false, configurable: true });
    return scope;
}

function layerOf(scope, layer) {
    for (var s = scope; s; s = Object.getPrototypeOf(s)) if (Object.prototype.hasOwnProperty.call(s, "__nexaLayer") && s.__nexaLayer === layer) return s;
    return null;
}

function readPath(root, path) {
    var segs = String(path || "").match(/[^.[\]]+/g) || [];
    var cur = root;
    for (var i = 0; i < segs.length; i++) {
        if (cur === null || cur === undefined) return undefined;
        cur = cur[segs[i]];
    }
    return cur;
}

function firstSegment(path) { return (String(path || "").match(/[^.[\]]+/) || [""])[0]; }

/**
 * A read(src, ref) for resolveValue, from a node's scope chain.
 *   o.scope           the node's nearest scope
 *   o.msg             the message an Update Component node sent it (or null)
 *   o.tag(provider, address)   a tag's value now (null / "???" when it has none)
 *   o.address(text)   a tag address with {variables} in it -> the address
 *   o.deref(text)     a variable whose value is itself a binding (a type member's tag) -> its value
 * screen / param: the nearest declaration below the app layer; app / shared: that layer's own;
 * var: the nearest anywhere (the legacy "{name}").
 */
export function scopeReader(o) {
    var app = layerOf(o.scope, "app"), shared = layerOf(o.scope, "shared");
    function nearest(ref, belowApp) {
        var name = firstSegment(ref);
        for (var s = o.scope; s; s = Object.getPrototypeOf(s)) {
            if (belowApp && (s === app || s === shared)) return undefined;
            if (Object.prototype.hasOwnProperty.call(s, name)) return readPath(s, ref);
        }
        return undefined;
    }
    function own(layer, ref) {
        return layer && Object.prototype.hasOwnProperty.call(layer, firstSegment(ref)) ? readPath(layer, ref) : undefined;
    }
    return function read(src, ref) {
        var v;
        if (src === "screen" || src === "param") v = nearest(ref, true);
        else if (src === "app") v = own(app, ref);
        else if (src === "shared") v = own(shared, ref);
        else if (src === "var") v = nearest(ref, false);
        else if (src === "msg") v = o.msg ? (ref ? readPath(o.msg, String(ref).replace(/^msg\.?/, "")) : o.msg) : undefined;
        else {
            var k = KINDS[src];
            if (!k || !k.tag || !o.tag) return undefined;
            return o.tag(k.provider || src, o.address ? o.address(ref) : ref);
        }
        return v && typeof v === "object" && typeof v.__nexaBinding === "string" && o.deref ? o.deref(v.__nexaBinding) : v;
    };
}

/** Whether a value holds a binding list anywhere (a prop, a field of a list item). */
export function containsBindingList(v) {
    if (isBindingList(v)) return true;
    if (Array.isArray(v)) return v.some(containsBindingList);
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
        for (var k in v) if (containsBindingList(v[k])) return true;
    }
    return false;
}

function resolveDeep(v, read) {
    if (isBindingList(v)) return resolveValue(v, read).value;
    if (!containsBindingList(v)) return v;
    if (Array.isArray(v)) return v.map(function (x) { return resolveDeep(x, read); });
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = resolveDeep(v[k], read); });
    return o;
}

/**
 * Resolves every binding list in `props` (a prop, or a field of a list item; the legacy strings
 * are left to the caller's own pipeline): -> a copy with their values, or `props` itself when it
 * has none.
 */
export function resolveBindingProps(props, read) {
    var out = null;
    Object.keys(props || {}).forEach(function (k) {
        if (!containsBindingList(props[k])) return;
        if (!out) out = Object.assign({}, props);
        out[k] = resolveDeep(props[k], read);
    });
    return out || props;
}
