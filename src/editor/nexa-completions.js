import { listKnownSparkplugBindings } from "../canvas/sparkplug-live.js";

// CM6 CompletionSource(s) for Nexa's own code dialogs. Wraps EXISTING data
// sources (listKnownSparkplugBindings, a component's own litBindable list)
// rather than reinventing the binding grammar — see sparkplug-live.js and
// component-renderer.js for the actual "{sparkplug:...}"/"{param}" parsing
// this autocomplete is just a convenience layer on top of.

// Offers "{sparkplug:G::E::D::metric}" bindings while typing "{" or partway
// through one.
export function sparkplugBindingCompletionSource(context) {
    var word = context.matchBefore(/\{[^}]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    var bindings = listKnownSparkplugBindings();
    if (!bindings.length) return null;
    return {
        from: word.from,
        options: bindings.map(function (b) {
            return { label: b.binding, displayLabel: b.label, type: "variable", detail: "sparkplug binding" };
        }),
        validFor: /^\{[^}]*$/
    };
}

// Offers "{propName}" and "this.propName" completions for a Lit component's
// own declared Bindable Properties (comp.litBindable = [{name, type, defaultValue}]).
export function litBindablePropsCompletionSource(litBindable) {
    return function (context) {
        var list = litBindable || [];
        if (!list.length) return null;

        var braceWord = context.matchBefore(/\{[\w]*/);
        var thisWord = context.matchBefore(/this\.[\w]*/);
        if (!braceWord && !thisWord) return null;

        if (thisWord) {
            return {
                from: thisWord.from + "this.".length,
                options: list.map(function (p) {
                    return { label: p.name, type: "property", detail: p.type || "string" };
                }),
                validFor: /^[\w]*$/
            };
        }
        return {
            from: braceWord.from,
            options: list.map(function (p) {
                return { label: "{" + p.name + "}", displayLabel: p.name, type: "variable", detail: p.type || "string" };
            }),
            validFor: /^\{[\w]*$/
        };
    };
}

// Combines multiple CompletionSources into one, returning the first
// non-null result (CM6's `override` option takes an array anyway, so this
// is only needed where a single function is required, e.g. per-tab wiring).
export function combineCompletionSources(sources) {
    return function (context) {
        for (var i = 0; i < sources.length; i++) {
            var result = sources[i](context);
            if (result) return result;
        }
        return null;
    };
}
