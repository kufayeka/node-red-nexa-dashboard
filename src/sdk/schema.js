// --- defineComponent({...}) -> normalized metadata ---------------------------
// Everything a component declares is normalized here once, and the result
// (def.nexa) is what the editor, the property kit and the runtime read:
//   meta.props        every stored prop: `properties` + one tag prop per input / output.
//                     Custom CSS fields only when the component declares them (type "css",
//                     optionally `part` / `state` / `selector`; cssFields() writes them for you).
//   meta.inputs       [{ name, key, label, multiple, throttle, providers, type }]
//   meta.outputs      [{ name, key, label, fallback (an input's key), providers, type }]
//   meta.eventList / meta.actionList / meta.stateList / meta.partList
// Tag props are stored under `prop` when given (kept stable for saved
// screens, e.g. "readTag"), otherwise "input<Name>" / "output<Name>".

var LEGACY_TYPE = {
    string: "text", text: "text", number: "number", range: "number", boolean: "checkbox",
    enum: "text", color: "color", css: "css", code: "text", tag: "text", json: "text", list: "text", asset: "text"
};

var TYPE_DEFAULT = {
    string: "", text: "", number: 0, range: 0, boolean: false, enum: "", color: "",
    css: "", code: "", tag: "", json: null, list: [], asset: ""
};

export function humanize(key) {
    var s = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export function stateCssKey(stateName) {
    return "css" + capitalize(String(stateName));
}

export function clone(v) {
    if (v === null || v === undefined || typeof v !== "object") return v;
    return JSON.parse(JSON.stringify(v));
}

export function normalizeProp(key, p) {
    p = Object.assign({}, p);
    if (!p.type) p.type = typeof p.default === "number" ? "number" : typeof p.default === "boolean" ? "boolean" : Array.isArray(p.default) ? "list" : "string";
    if (!("default" in p)) p.default = clone(TYPE_DEFAULT[p.type] !== undefined ? TYPE_DEFAULT[p.type] : "");
    if (!p.label) p.label = humanize(key);
    if (p.bindable === undefined) p.bindable = p.type !== "tag" && p.type !== "list" && p.type !== "css" && p.type !== "code";
    if (p.type === "enum" && Array.isArray(p.options)) {
        p.options = p.options.map(function (o) {
            if (o !== null && typeof o === "object") return { value: o.value, label: o.label !== undefined ? o.label : String(o.value), icon: o.icon };
            return { value: o, label: String(o) };
        });
    }
    p.key = key;
    return p;
}

function ioList(map, dir) {
    return Object.keys(map || {}).map(function (name) {
        var io = map[name] || {};
        return {
            name: name,
            key: io.prop || (dir + capitalize(name)),
            label: io.label || humanize(name) + (dir === "input" ? " (read)" : " (write)"),
            help: io.help || "",
            multiple: !!io.multiple,
            throttle: Number(io.throttle) > 0 ? Number(io.throttle) : 0,
            providers: io.providers || null,      // null = every registered provider
            type: io.type || "any",
            required: !!io.required,
            fallback: io.fallback || null         // outputs: the input written to when this one is empty
        };
    });
}

// `slots`: the component holds other nodes — a list ([{ name, label }] or names), or a
// function of the props (one slot per tab of a Tabs). Normalized to fn(props) -> list.
function slotsFn(decl) {
    if (!decl) return null;
    var fn = typeof decl === "function" ? decl : function () { return decl; };
    return function (p) {
        var list;
        try { list = fn(p || {}); } catch (e) { list = []; }
        var seen = {};
        return (Array.isArray(list) ? list : []).map(function (x) {
            return x !== null && typeof x === "object" ? x : { name: x };
        }).filter(function (x) {
            if (x.name === undefined || x.name === null || x.name === "") return false;
            var k = String(x.name);
            if (seen[k]) return false;
            seen[k] = true;
            return true;
        }).map(function (x) {
            return { name: String(x.name), label: x.label !== undefined && x.label !== null && x.label !== "" ? String(x.label) : String(x.name), layout: x.layout };
        });
    };
}

export function buildMeta(def) {
    if (!def || !def.id) throw new Error("[nexa] defineComponent: `id` is required");
    var meta = {
        id: def.id,
        label: def.label || def.id,
        category: def.category || "General",
        icon: def.icon || "fa fa-cube",
        size: def.size || { w: 100, h: 60 },
        capabilities: Object.assign({ resizable: true, rotatable: true, flippable: true, lockable: true }, def.capabilities || {}),
        version: Number(def.version) > 0 ? Number(def.version) : 1,
        migrate: typeof def.migrate === "function" ? def.migrate : null,
        css: def.css,
        preview: def.preview || null,
        editor: def.editor || {},
        assets: def.assets || null,
        state: def.state || {},
        inspector: def.inspector || null,
        help: def.help || "",
        slots: slotsFn(def.slots)
    };

    meta.inputs = ioList(def.inputs, "input");
    meta.outputs = ioList(def.outputs, "output");
    meta.outputs.forEach(function (o) {
        if (!o.fallback) return;
        var inp = meta.inputs.filter(function (i) { return i.name === o.fallback; })[0];
        o.fallbackKey = inp ? inp.key : null;
    });
    // Components with tags have their own tag fields: no generic "Tag Watch".
    meta.hideSparkplugWatch = def.hideTagWatch !== undefined ? !!def.hideTagWatch : (meta.inputs.length + meta.outputs.length > 0);

    var props = {};
    meta.inputs.forEach(function (io) {
        props[io.key] = { type: io.multiple ? "list" : "tag", access: "read", label: io.label, help: io.help, providers: io.providers,
            required: io.required, io: "input", ioName: io.name, item: io.multiple ? { type: "tag", access: "read", providers: io.providers } : undefined,
            default: io.multiple ? [] : "", group: "Data" };
    });
    meta.outputs.forEach(function (io) {
        props[io.key] = { type: io.multiple ? "list" : "tag", access: "write", label: io.label, help: io.help, providers: io.providers,
            required: io.required, io: "output", ioName: io.name, item: io.multiple ? { type: "tag", access: "write", providers: io.providers } : undefined,
            default: io.multiple ? [] : "", group: "Data" };
    });
    Object.keys(def.properties || {}).forEach(function (k) {
        if (props[k]) throw new Error("[nexa] " + def.id + ": property \"" + k + "\" collides with an input / output prop");
        props[k] = def.properties[k];
    });

    meta.stateList = Object.keys(def.states || {}).map(function (name) {
        var s = def.states[name] || {};
        return { name: name, label: s.label || humanize(name), selector: s.selector || null, css: s.css || "", color: s.color || null, preview: s.preview !== false };
    });
    // Parts: pieces of the view with their own CSS (a label, a helper line):
    // parts: { label: { selector: ".x-label", css: "font-weight: 600;", label: "Label" } } -> prop cssLabel.
    meta.partList = Object.keys(def.parts || {}).map(function (name) {
        var pt = def.parts[name] || {};
        if (!pt.selector) throw new Error("[nexa] " + def.id + ": part \"" + name + "\" needs a selector");
        return { name: name, label: pt.label || humanize(name), selector: pt.selector, css: pt.css || "" };
    });
    // a declared CSS field may target a part / a state: check it exists
    Object.keys(props).forEach(function (k) {
        var pr = props[k];
        if (!pr || pr.type !== "css") return;
        if (pr.part && !meta.partList.some(function (pt) { return pt.name === pr.part; })) throw new Error("[nexa] " + def.id + ": CSS field \"" + k + "\" targets the part \"" + pr.part + "\", which `parts` doesn't declare");
        if (pr.state && !meta.stateList.some(function (st) { return st.name === pr.state && st.selector; })) throw new Error("[nexa] " + def.id + ": CSS field \"" + k + "\" targets the state \"" + pr.state + "\", which `states` doesn't declare (with a selector)");
    });

    meta.props = {};
    Object.keys(props).forEach(function (k) { meta.props[k] = normalizeProp(k, props[k]); });

    meta.eventList = Object.keys(def.events || {}).map(function (name) {
        var e = def.events[name] || {};
        if (typeof e === "string") e = { label: e };
        return { name: name, label: e.label || ("On " + name), payload: e.payload || null, help: e.help || "" };
    });
    meta.actionList = Object.keys(def.actions || {}).map(function (name) {
        var a = def.actions[name] || {};
        return { name: name, label: a.label || humanize(name), params: a.params || null, help: a.help || "" };
    });
    return meta;
}

/**
 * The fields of a Logic node a plugin defines (defineLogicNode's `properties`), normalized like a
 * component's, in the shape the property kit's inspector takes: the editor builds the node's
 * dialog from it.
 */
export function buildFieldsMeta(id, properties) {
    var meta = { id: id, props: {}, inputs: [], outputs: [], stateList: [], partList: [], eventList: [], actionList: [] };
    Object.keys(properties || {}).forEach(function (k) { meta.props[k] = normalizeProp(k, properties[k]); });
    return meta;
}

export function defaultValues(meta) {
    var out = {};
    Object.keys(meta.props).forEach(function (k) { out[k] = clone(meta.props[k].default); });
    return out;
}

export function legacyDefaults(meta) {
    var out = {};
    Object.keys(meta.props).forEach(function (k) {
        var p = meta.props[k];
        out[k] = { value: clone(p.default), type: LEGACY_TYPE[p.type] || "text" };
    });
    return out;
}

/**
 * The component's stylesheet: its own `css` (or the base CSS field when the user filled it),
 * then each declared part / selector CSS field, then each state CSS field (states win a tie).
 * A field's text is wrapped in its selector, or used as-is when it holds "{".
 */
export function buildStylesheet(meta, props) {
    var base = null, scoped = [], states = [];
    Object.keys(meta.props).forEach(function (k) {
        var pr = meta.props[k];
        if (pr.type !== "css") return;
        if (pr.state) states.push(pr);
        else if (pr.part || pr.selector) scoped.push(pr);
        else if (!base) base = pr;
    });
    var baseText = base && props[base.key] !== undefined && props[base.key] !== "" ? props[base.key] : (meta.css || "");
    var out = [baseText];
    var selectorOf = function (pr) {
        if (pr.selector) return pr.selector;
        if (pr.part) { var pt = (meta.partList || []).filter(function (x) { return x.name === pr.part; })[0]; return pt && pt.selector; }
        var st = meta.stateList.filter(function (x) { return x.name === pr.state; })[0];
        return st && st.selector;
    };
    scoped.concat(states).forEach(function (pr) {
        var block = props[pr.key];
        if (block === undefined || block === null || String(block).trim() === "") return;
        block = String(block);
        var sel = selectorOf(pr);
        out.push(block.indexOf("{") !== -1 || !sel ? block : sel + " {\n" + block + "\n}");
    });
    return out.join("\n");
}

/**
 * Custom CSS fields, for a component that wants them in its inspector (they are not added
 * on their own any more): spread them into `properties`.
 *   properties: { ...cssFields({ parts: PARTS, group: "Custom CSS" }) }
 * opts: base (true | false | default text; true = a "Base CSS" field), parts / states (the same
 * maps as the component's `parts` / `states`), group, keys stay css / css<Part> / css<State>
 * (what screens saved before kept).
 */
export function cssFields(opts) {
    opts = opts || {};
    var group = opts.group || "Style";
    var out = {};
    if (opts.base !== false) {
        out.css = { type: "css", default: typeof opts.base === "string" ? opts.base : "", group: group, label: "Base CSS",
            help: "Scoped to this component. Shared layout, font, border." };
    }
    Object.keys(opts.parts || {}).forEach(function (name) {
        var pt = opts.parts[name] || {};
        out[stateCssKey(name)] = { type: "css", default: pt.css || "", group: group, label: (pt.label || humanize(name)) + " CSS", part: name };
    });
    Object.keys(opts.states || {}).forEach(function (name) {
        var st = opts.states[name] || {};
        if (!st.selector) return;
        var key = stateCssKey(name);
        if (out[key]) throw new Error("[nexa] cssFields: state \"" + name + "\" and a part share the key \"" + key + "\"");
        out[key] = { type: "css", default: st.css || "", group: group, label: (st.label || humanize(name)) + " CSS", state: name };
    });
    return out;
}

/** Props saved by an older version of the component, brought up to meta.version. */
export function migrateProps(meta, props) {
    var from = Number(props && props.__v) || 1;
    if (!meta.migrate || from >= meta.version) return props;
    var next = meta.migrate(clone(props) || {}, from) || props;
    next.__v = meta.version;
    return next;
}
