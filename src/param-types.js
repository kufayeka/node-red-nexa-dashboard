// --- Shared typed-param helpers -------------------------------------------
// Used by both the Templates tab's param declaration UI (templates-panel.js)
// and the Properties panel's per-instance override fields (properties-panel.js)
// so the two stay in sync as types are added.
export var PARAM_TYPES = ["string", "number", "boolean", "object", "array", "color"];

var WHOLE_BINDING_RE = /^\{[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*\}$/;

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

export function mapParamTypeToTypedInputType(paramType) {
    var t = normalizeParamType(paramType);
    if (t === "number") return "num";
    if (t === "boolean") return "bool";
    if (t === "object" || t === "array") return "json";
    return "str";
}

export function mapTypedInputTypeToParamType(typedInputType, rawValue) {
    if (typedInputType === "num") return "number";
    if (typedInputType === "bool") return "boolean";
    if (typedInputType === "json") {
        try {
            var parsed = JSON.parse(rawValue);
            if (Array.isArray(parsed)) return "array";
        } catch (e) {}
        return "object";
    }
    return "string";
}

export function parseTypedInputValue(typedInputType, rawValue) {
    if (typedInputType === "num") {
        return parseFloat(rawValue) || 0;
    }
    if (typedInputType === "bool") {
        return rawValue === "true" || rawValue === true || rawValue === "1";
    }
    if (typedInputType === "json") {
        try {
            return JSON.parse(rawValue);
        } catch (e) {
            return rawValue;
        }
    }
    return rawValue;
}

// Builds a native Node-RED typedInput widget configured with types ['str', 'num', 'bool', 'json'].
// Automatically determines the param type from the selected typedInput type, matching the
// pattern used in Node-RED rules and asset-multi-write.
export function buildTypedInputWidget(container, initialType, initialValue, onChange) {
    var input = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).appendTo(container);
    var tiType = mapParamTypeToTypedInputType(initialType);
    var types = ["str", "num", "bool", "json"];

    var initialText = "";
    if (initialValue !== undefined && initialValue !== null) {
        if (typeof initialValue === "object") {
            try { initialText = JSON.stringify(initialValue); } catch (e) { initialText = ""; }
        } else {
            initialText = String(initialValue);
        }
    }

    if (typeof input.typedInput === "function") {
        input.typedInput({
            default: tiType,
            types: types
        });
        input.typedInput("type", tiType);
        input.typedInput("value", initialText);

        input.on("change", function () {
            var chosenTiType = input.typedInput("type");
            var raw = input.typedInput("value");
            var parsedVal = parseTypedInputValue(chosenTiType, raw);
            var determinedParamType = mapTypedInputTypeToParamType(chosenTiType, raw);
            onChange(parsedVal, determinedParamType, chosenTiType);
        });
    } else {
        // Fallback for mock/test environments
        input.val(initialText);
        input.on("change", function () {
            var raw = input.val();
            var parsed = raw;
            var detType = initialType || "string";
            try {
                if (raw === "true" || raw === "false") {
                    parsed = raw === "true";
                    detType = "boolean";
                } else if (!isNaN(Number(raw)) && raw.trim() !== "") {
                    parsed = Number(raw);
                    detType = "number";
                } else if (raw.startsWith("{") || raw.startsWith("[")) {
                    parsed = JSON.parse(raw);
                    detType = Array.isArray(parsed) ? "array" : "object";
                }
            } catch (e) {}
            onChange(parsed, detType, detType);
        });
    }
    return input;
}

export function buildParamValueInput(row, type, currentValue, onChange) {
    return buildTypedInputWidget(row, type, currentValue, function (parsedVal, detType) {
        onChange(parsedVal, detType);
    });
}
