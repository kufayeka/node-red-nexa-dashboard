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

export function buildTypeTypedInput(container, currentType, onChange) {
    var normType = normalizeParamType(currentType);
    var input = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).appendTo(container);
    var typeOptions = [
        { value: "string", label: "string", icon: "fa fa-font" },
        { value: "number", label: "number", icon: "fa fa-hashtag" },
        { value: "boolean", label: "boolean", icon: "fa fa-toggle-on" },
        { value: "object", label: "object", icon: "fa fa-code" },
        { value: "array", label: "array", icon: "fa fa-list" },
        { value: "color", label: "color", icon: "fa fa-paint-brush" }
    ];
    if (typeof input.typedInput === "function") {
        input.typedInput({
            types: [
                {
                    value: "type",
                    icon: "fa fa-sliders",
                    options: typeOptions
                }
            ]
        });
        input.typedInput("value", normType);
        input.on("change", function () {
            var val = input.typedInput("value");
            onChange(val);
        });
    } else {
        var select = window.$("<select>").css({ width: "100%", "box-sizing": "border-box" }).appendTo(container);
        PARAM_TYPES.forEach(function (t) {
            window.$("<option>", { value: t }).text(t).prop("selected", normType === t).appendTo(select);
        });
        select.on("change", function () { onChange(select.val()); });
    }
    return input;
}

// The type-specific widget backed by Node-RED's native RED.typedInput
// (matching Asset Manager's standard: single-select type options and typed
// value input with [type, "str", "json"]).
function buildTypedWidget(row, type, currentValue, onChange) {
    var t = normalizeParamType(type);
    var input = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).appendTo(row);

    if (typeof input.typedInput === "function") {
        var defType = "str";
        if (t === "number") defType = "num";
        else if (t === "boolean") defType = "bool";
        else if (t === "object" || t === "array") defType = "json";

        var types = [defType, "str", "json"];
        if (defType === "json") types = ["json", "str"];

        input.typedInput({ types: types });
        input.typedInput("type", defType);

        var initialVal = "";
        if (currentValue !== undefined && currentValue !== null) {
            if (typeof currentValue === "object") {
                try { initialVal = JSON.stringify(currentValue); } catch (e) { initialVal = ""; }
            } else {
                initialVal = String(currentValue);
            }
        }
        input.typedInput("value", initialVal);

        input.on("change", function () {
            var cType = input.typedInput("type");
            var raw = input.typedInput("value");
            var parsedVal = raw;

            if (cType === "num") {
                parsedVal = parseFloat(raw) || 0;
            } else if (cType === "bool") {
                parsedVal = raw === "true" || raw === true || raw === "1";
            } else if (cType === "json") {
                try { parsedVal = JSON.parse(raw); } catch (e) { parsedVal = raw; }
            } else {
                if (typeof raw === "string" && WHOLE_BINDING_RE.test(raw.trim())) {
                    parsedVal = raw;
                } else if (t === "number") {
                    parsedVal = parseFloat(raw) || 0;
                } else if (t === "boolean") {
                    parsedVal = raw === "true" || raw === true;
                } else {
                    parsedVal = raw;
                }
            }
            onChange(parsedVal);
        });
        return input;
    }

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
// Uses Node-RED typedInput for rich type selection and binding path inputs.
export function buildParamValueInput(row, type, currentValue, onChange, allowBinding) {
    return buildTypedWidget(row, type, currentValue, onChange);
}

