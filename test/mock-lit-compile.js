// Sanity-checks compileLitComponentClass's own STRING-ASSEMBLY logic in
// isolation (backtick/${ escaping in user CSS, the `static properties`
// declaration syntax for each param type, the empty-code default) against a
// FAKE base class standing in for the real LitElement — this does not need
// Lit/a browser DOM at all, since it only tests whether the generated JS
// source is syntactically valid and behaves as intended, not whether Lit
// itself then renders it. Also covers coerceLitBindableValue in isolation —
// the fix for a real reported bug: a boolean Bindable Property whose
// defaultValue was left as a stale/wrongly-typed value (e.g. the literal
// string "false", which is TRUTHY in plain JS) rendered as "always true"
// regardless of what the Properties panel showed. The DATA MODEL / UI
// wiring (palette chip, Properties panel, Events tab) is covered separately,
// end-to-end via real UI interactions, in mock-templates-editor.js. Real
// Lit/Shadow-DOM rendering needs a live browser boot-test (no jsdom
// available here) — see the conversation notes.
//
// Design note: every Bindable Property is its OWN top-level Lit reactive
// property (this.<name>), standard idiomatic Lit — NOT a nested
// this.props.<name> object (an earlier revision tried that, then reverted
// it — slower and buggier in practice than plain Lit properties, and it
// added a concept, "internal state", that the framework no longer has: all
// state is a Bindable Property, full stop).
function litPropertyCtor(type) {
    if (type === "number") return "Number";
    if (type === "boolean") return "Boolean";
    if (type === "object") return "Object";
    if (type === "array") return "Array";
    return "String";
}
function buildClassBody(litCode, litStyles, bindable) {
    var propsDecl = "static properties = {" + (bindable || []).map(function (p) {
        return JSON.stringify(p.name) + ": { type: " + litPropertyCtor(p.type) + " }";
    }).join(",") + "};";
    var safeStyles = String(litStyles || "").replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    var stylesDecl = litStyles ? ("static styles = css`" + safeStyles + "`;") : "";
    return propsDecl + "\n" + stylesDecl + "\n" + (litCode || "render(){ return html`<div></div>`; }");
}
class FakeBase {
    constructor() { this.__props = {}; }
}
function compile(litCode, litStyles, bindable) {
    var body = buildClassBody(litCode, litStyles, bindable);
    var factory = new Function("NexaLitBase", "html", "css", "nothing",
        "return class extends NexaLitBase {" + body + "\n};");
    return factory(FakeBase, function (strings) { return strings.join(""); }, function (strings) { return strings.join(""); }, undefined);
}

// Ported verbatim from component-renderer.js/nexa-runtime-client.js.
function coerceLitBindableValue(type, value) {
    if (value === undefined || value === null) return value;
    if (type === "boolean") {
        if (typeof value === "string") return value !== "" && value !== "false" && value !== "0";
        return !!value;
    }
    if (type === "number") return typeof value === "number" ? value : (parseFloat(value) || 0);
    return value;
}

console.log("--- basic class with a bindable string prop compiles and is instantiable ---");
try {
    var K1 = compile("render(){ return html`<div>${this.label}</div>`; }", "", [{ name: "label", type: "string" }]);
    var inst1 = new K1();
    console.log("compiles + instantiates?", typeof K1 === "function" && inst1 instanceof FakeBase);
} catch (e) {
    console.log("FAILED:", e.message);
}

console.log("--- CSS containing a literal backtick AND ${...} does not break out of the surrounding template literal ---");
try {
    var trickyCss = "div::before { content: \"a `backtick` and a ${dollar-brace}\"; }";
    var K2 = compile("render(){ return html`<div></div>`; }", trickyCss, []);
    new K2();
    console.log("compiles + instantiates despite tricky CSS content?", true);
} catch (e) {
    console.log("FAILED:", e.message);
}

console.log("--- empty litCode falls back to a default render() and still compiles ---");
try {
    var K3 = compile("", "", []);
    var inst3 = new K3();
    var hasRender = typeof inst3.render === "function";
    console.log("compiles, instantiates, and has a render() method?", hasRender);
} catch (e) {
    console.log("FAILED:", e.message);
}

console.log("--- all four non-string bindable types produce valid `static properties` syntax ---");
try {
    var K4 = compile(
        "render(){ return html`<div>${this.n}/${this.b}/${this.o}/${this.a}</div>`; }",
        "",
        [{ name: "n", type: "number" }, { name: "b", type: "boolean" }, { name: "o", type: "object" }, { name: "a", type: "array" }]
    );
    new K4();
    console.log("compiles + instantiates with number/boolean/object/array declared properties?", true);
} catch (e) {
    console.log("FAILED:", e.message);
}

console.log("--- a genuinely broken user render() (syntax error) is caught as a compile error, not a process crash ---");
try {
    compile("render(){ return html`<div>", "", []); // unterminated template literal
    console.log("did NOT throw (unexpected)?", false);
} catch (e) {
    console.log("threw a catchable SyntaxError instead of crashing the process?", e instanceof SyntaxError);
}

console.log("--- coerceLitBindableValue: the actual bug fix — a stale string \"false\" default no longer renders as truthy ---");
console.log('boolean coercion: the literal string "false" becomes real false (THE reported bug)?', coerceLitBindableValue("boolean", "false") === false);
console.log('boolean coercion: an empty string becomes real false?', coerceLitBindableValue("boolean", "") === false);
console.log('boolean coercion: the string "0" becomes real false?', coerceLitBindableValue("boolean", "0") === false);
console.log('boolean coercion: the string "true" becomes real true?', coerceLitBindableValue("boolean", "true") === true);
console.log('boolean coercion: a real boolean false passes through unchanged?', coerceLitBindableValue("boolean", false) === false);
console.log('boolean coercion: a real boolean true passes through unchanged?', coerceLitBindableValue("boolean", true) === true);
console.log('number coercion: a numeric string becomes a real number?', coerceLitBindableValue("number", "42") === 42);
console.log('number coercion: an unparseable string falls back to 0, not NaN?', coerceLitBindableValue("number", "not-a-number") === 0);
console.log('string/object/array/color types pass through untouched?', coerceLitBindableValue("string", "hello") === "hello");

console.log("--- the bindable LIST is part of the compiled class's shape again (unlike the reverted this.props design) ---");
try {
    var bodyA = buildClassBody("render(){ return html`<div></div>`; }", "", [{ name: "a", type: "string" }]);
    var bodyB = buildClassBody("render(){ return html`<div></div>`; }", "", [{ name: "a", type: "string" }, { name: "b", type: "number" }]);
    console.log("a different bindable list produces a different class body?", bodyA !== bodyB);
} catch (e) {
    console.log("FAILED:", e.message);
}

console.log("ALL OK");
