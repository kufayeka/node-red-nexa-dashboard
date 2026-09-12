// --- Shared typed-param helpers -------------------------------------------
// Used by both the Templates tab's param declaration UI (templates-panel.js)
// and the Properties panel's per-instance override fields (properties-panel.js)
// so the two stay in sync as types are added. See "Phase 3 revision, typed
// params" and "declarative nested param passing" in the plan.
export var PARAM_TYPES = ["string", "number", "boolean", "object", "array", "color"];

// Same whole-string {path} pattern component-renderer.js's resolveBindableValue
// uses — matches e.g. {a}, {a.b.c}, {a[0].b.c}. Duplicated here (rather than
// imported) since this is a UI-only "does this look like a binding" check —
// component-renderer.js does the actual resolving, at render/mount time.
var WHOLE_BINDING_RE = /^\{[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*\}$/;

// Old saved data may still say "text"/"checkbox" (the original, smaller type
// set) — treat those as aliases so nothing breaks; new authoring only ever
// writes the canonical names above.
export function normalizeParamType(type) {
    if (type === "text") return "string";
    if (type === "checkbox") return "boolean";
    return PARAM_TYPES.indexOf(type) !== -1 ? type : "string";
}

export function defaultValueForType(type) {
    switch (normalizeParamType(type)) {
        case "number": return 0;
        case "boolean": return false;
        case "object": return {};
        case "array": return [];
        case "color": return "#000000";
        default: return "";
    }
}

// The plain, type-specific widget (no binding awareness) — object/array get
// a JSON textarea (invalid JSON is rejected with a notify and the field
// snaps back rather than silently corrupting the param).
function buildTypedWidget(row, type, currentValue, onChange) {
    var t = normalizeParamType(type);
    var input;
    if (t === "boolean") {
        input = window.$("<input>", { type: "checkbox" }).prop("checked", !!currentValue).appendTo(row);
        input.on("change", function () { onChange(input.is(":checked")); });
    } else if (t === "object" || t === "array") {
        var text;
        try {
            text = JSON.stringify(currentValue !== undefined ? currentValue : (t === "array" ? [] : {}), null, 2);
        } catch (e) {
            text = t === "array" ? "[]" : "{}";
        }
        input = window.$("<textarea>", { placeholder: t === "array" ? "[1, 2, 3]" : '{"key": "value"}' })
            .css({ width: "100%", "box-sizing": "border-box", height: "70px", "font-family": "monospace", "font-size": "11px" })
            .val(text).appendTo(row);
        input.on("change", function () {
            try {
                var parsed = JSON.parse(input.val());
                text = input.val();
                onChange(parsed);
            } catch (e) {
                if (window.RED && window.RED.notify) {
                    window.RED.notify("Invalid JSON for this parameter — keeping the previous value", { type: "warning", timeout: 3000 });
                }
                input.val(text);
            }
        });
    } else if (t === "color") {
        input = window.$("<input>", { type: "color" }).val(currentValue || "#000000").appendTo(row);
        input.on("change", function () { onChange(input.val()); });
    } else if (t === "number") {
        input = window.$("<input>", { type: "number" }).css({ width: "100%", "box-sizing": "border-box" }).val(currentValue).appendTo(row);
        input.on("change", function () { onChange(parseFloat(input.val()) || 0); });
    } else {
        input = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(currentValue).appendTo(row);
        input.on("change", function () { onChange(input.val()); });
    }
    return input;
}

// Renders the value widget for one param field into `row`, seeded with
// `currentValue`, calling onChange(newValue) whenever the user edits it.
// When `allowBinding` (default true), adds a small "Bind to another param"
// checkbox that swaps in a plain text field for typing a {path} expression
// (e.g. {a} or {a.b[0].c}) instead of the type's normal widget — this is how
// a nested template instance's param gets declaratively wired to its parent
// scope's own param (see resolveBindableValue/resolveInstanceParamState in
// component-renderer.js), no Logic-node wiring required. Declaring a
// template's own default value (templates-panel.js) passes allowBinding:false
// — a default is a literal fallback, not something with a parent scope to
// bind against.
export function buildParamValueInput(row, type, currentValue, onChange, allowBinding) {
    if (allowBinding === false) {
        return buildTypedWidget(row, type, currentValue, onChange);
    }
    var isBound = typeof currentValue === "string" && WHOLE_BINDING_RE.test(currentValue.trim());
    var widgetContainer = window.$("<div>").appendTo(row);
    var bindRow = window.$("<label>", { "class": "nexa-param-bind-toggle" })
        .css({ display: "flex", "align-items": "center", gap: "4px", "font-size": "10px", color: "#888", "margin-bottom": "3px" })
        .appendTo(row);
    var bindCheckbox = window.$("<input>", { type: "checkbox" }).prop("checked", isBound).css({ margin: "0" }).appendTo(bindRow);
    bindRow.append("Bind to another param (e.g. {a} or {a.b[0].c})");

    function renderWidget(bound) {
        widgetContainer.empty();
        if (bound) {
            var input = window.$("<input>", { type: "text", placeholder: "{paramName.path}" })
                .css({ width: "100%", "box-sizing": "border-box" })
                .val(isBound ? currentValue : "").appendTo(widgetContainer);
            input.on("change", function () { onChange(input.val()); });
        } else {
            buildTypedWidget(widgetContainer, type, isBound ? defaultValueForType(type) : currentValue, onChange);
        }
    }
    bindCheckbox.on("change", function () { renderWidget(bindCheckbox.is(":checked")); });
    renderWidget(isBound);
    return widgetContainer;
}
