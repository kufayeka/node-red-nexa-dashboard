// --- bind(key): connects an <nx-*> widget in an inspector to a property ------
//   inspector: ({ p, ui }) => html`
//       <nx-number ${bind("decimals")} label="Decimals" min="-1" max="10"></nx-number>
//       <nx-tag ${bind("inputs.value")}></nx-tag>`
// The widget gets the value, the label / help / limits declared for that
// property (attributes you write yourself win), the reset / bind buttons,
// validation, and its nx-change is written back (with undo in the editor).
// Keys: a property name, "inputs.<name>" / "outputs.<name>" for a tag.
//
// bind() only works while an inspector is being rendered (the property kit
// sets the context); the context does the actual decorating.
import { noChange } from "lit";
import { directive, Directive, PartType } from "lit/directive.js";

var current = null;

/** Run `fn` with `ctx` as the inspector bind() talks to (used by the property kit). */
export function withInspector(ctx, fn) {
    var prev = current;
    current = ctx;
    try { return fn(); } finally { current = prev; }
}

class BindDirective extends Directive {
    constructor(partInfo) {
        super(partInfo);
        if (partInfo.type !== PartType.ELEMENT) throw new Error("[nexa] bind() goes on an element: <nx-text ${bind(\"key\")}>");
    }
    render() {
        return noChange;
    }
    update(part, args) {
        var ctx = args[0];
        if (ctx) ctx.decorate(part.element, args[1], args[2] || {});
        return noChange;
    }
}

var bindDirective = directive(BindDirective);

export function bind(key, options) {
    if (!current) console.warn("[nexa] bind(\"" + key + "\") used outside an inspector");
    return bindDirective(current, key, options);
}
