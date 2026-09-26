// --- defineComponent({...}) -> normalized metadata ---------------------------
// Everything a component declares is normalized here once, and the result
// (def.nexa) is what the editor, the property kit and the runtime read:
//   meta.props        every stored prop: `properties` + one tag prop per input /
//                     output + the base `css` + one CSS prop per state
//   meta.inputs       [{ name, key, label, multiple, throttle, providers, type }]
//   meta.outputs      [{ name, key, label, fallback (an input's key), providers, type }]
//   meta.eventList / meta.actionList / meta.stateList / meta.partList
// Tag props are stored under `prop` when given (kept stable for saved
// screens, e.g. "readTag"), otherwise "input<Name>" / "output<Name>".

var LEGACY_TYPE = {
    string: "text", text: "text", number: "number", range: "number", boolean: "checkbox",
    enum: "text", color: "color", css: "css", code: "text", tag: "text", json: "text", list: "text"
};

var TYPE_DEFAULT = {
    string: "", text: "", number: 0, range: 0, boolean: false, enum: "", color: "",
    css: "", code: "", tag: "", json: null, list: []
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
        help: def.help || ""
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
    var styleable = def.css !== undefined || meta.partList.length > 0 || meta.stateList.some(function (s) { return s.selector; });
    if (styleable && !props.css) {
        props.css = { type: "css", default: def.css || "", group: "Style", label: "Base CSS", help: "Scoped to this component. Shared layout, font, border." };
    }
    meta.partList.forEach(function (pt) {
        var key = stateCssKey(pt.name);
        if (props[key]) throw new Error("[nexa] " + def.id + ": part \"" + pt.name + "\" collides with the property \"" + key + "\"");
        props[key] = { type: "css", default: pt.css, group: "Style", label: pt.label + " CSS", part: pt.name };
    });
    meta.stateList.forEach(function (s) {
        if (!s.selector) return;
        var key = stateCssKey(s.name);
        if (props[key] && props[key].part) throw new Error("[nexa] " + def.id + ": state \"" + s.name + "\" and a part share the CSS prop \"" + key + "\"");
        if (!props[key]) props[key] = { type: "css", default: s.css, group: "Style", label: s.label + " CSS", state: s.name };
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
 * Base CSS, then every part's CSS, then every state's CSS (so states win a
 * tie) — each wrapped in its selector, or used as-is if it holds "{".
 */
export function buildStylesheet(meta, props) {
    var base = props.css !== undefined && props.css !== "" ? props.css : (meta.css || "");
    var out = [base];
    var add = function (name, selector) {
        var block = props[stateCssKey(name)];
        if (block === undefined || block === null || String(block).trim() === "") return;
        block = String(block);
        out.push(block.indexOf("{") !== -1 ? block : selector + " {\n" + block + "\n}");
    };
    (meta.partList || []).forEach(function (pt) { add(pt.name, pt.selector); });
    meta.stateList.forEach(function (s) { if (s.selector) add(s.name, s.selector); });
    return out.join("\n");
}

/** Props saved by an older version of the component, brought up to meta.version. */
export function migrateProps(meta, props) {
    var from = Number(props && props.__v) || 1;
    if (!meta.migrate || from >= meta.version) return props;
    var next = meta.migrate(clone(props) || {}, from) || props;
    next.__v = meta.version;
    return next;
}
