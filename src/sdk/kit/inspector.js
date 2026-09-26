// --- The inspector: a component's `inspector` template, or an automatic one -----
// renderInspector(container, { meta, props, set, preview, persistKey })
//   meta     the component's normalized metadata (def.nexa, see src/sdk/schema.js)
//   props    its stored props (read here; every change goes through set)
//   set(key, value)      commit one prop (the editor adds undo / dirty / re-render)
//   preview(key, value)  design-time only (the state switcher); defaults to set
// Returns { update(), destroy(), root }.
//
// The component writes its panel itself:
//   inspector: ({ p, ui, bind }) => html`
//       <nx-tabs>
//         <nx-tab label="Data"><nx-tag ${bind("inputs.value")}></nx-tag></nx-tab>
//         <nx-tab label="Style">${ui.stateSwitcher()}<nx-code ${bind("css")}></nx-code></nx-tab>
//       </nx-tabs>`
// `p` = current props (show / hide parts with plain template logic),
// `bind(key)` = connect a widget to a prop ("inputs.x" / "outputs.x" for tags),
// `ui` = helpers (see makeUi). Without `inspector`, props are laid out by `group`.
// Re-renders are batched into a microtask; Lit only touches what changed, so
// focus and the caret survive.
import { html, nothing, render } from "lit";
import { str } from "./base.js";

function clone(v) {
    return v === null || v === undefined || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v));
}

function same(a, b) {
    return str(a) === str(b);
}

// "{provider:address}" / "{param}" as the whole value, or embedded in text.
function isBinding(v) {
    return typeof v === "string" && /\{[^{}]+\}/.test(v);
}

// Types whose widget can switch to a tag / parameter binding (⛓).
var BINDABLE_BY_TOGGLE = { number: 1, range: 1, boolean: 1, enum: 1, color: 1 };

/** Built-in checks + prop.validate(value, p) -> message | null. */
export function validateProp(prop, value, p) {
    var empty = value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
    if (prop.required && empty) return "Required";
    if ((prop.type === "number" || prop.type === "range") && !empty && !isBinding(value)) {
        var n = Number(value);
        if (!Number.isFinite(n)) return "Not a number";
        if (prop.min !== undefined && prop.min !== null && n < prop.min) return "Minimum is " + prop.min;
        if (prop.max !== undefined && prop.max !== null && n > prop.max) return "Maximum is " + prop.max;
    }
    if (prop.type === "json" && typeof value === "string" && value.trim()) {
        try { JSON.parse(value); } catch (e) { return "Invalid JSON: " + e.message; }
    }
    if (prop.type === "tag" && typeof value === "string" && value.trim() && window.NexaSDK) {
        var t = window.NexaSDK.parseTag(value);
        if (t && !t.valid && t.known) return "Not a valid " + t.provider + " address";
    }
    if (typeof prop.validate === "function") {
        var r = prop.validate(value, p);
        if (r) return String(r);
    }
    return null;
}

// The attributes a widget takes from its prop schema — only where the
// template author didn't write that attribute themselves.
var SCHEMA_ATTRS = {
    label: "label", help: "help", placeholder: "placeholder", icon: "icon",
    min: "min", max: "max", step: "step", unit: "unit", rows: "rows",
    access: "access", mono: "mono", language: "language", addLabel: "add-label"
};

export function renderInspector(container, opts) {
    if (container && container.jquery) container = container.get(0);
    var meta = opts.meta;
    var persist = opts.persistKey || meta.id || "component";
    var bindMode = {};             // keys switched to "bound" by ⛓ before a binding was typed
    var asyncCache = {};           // ui.async results
    var root = document.createElement("div");
    root.className = "nx-kit nx-inspector";
    container.appendChild(root);

    var props = function () { return opts.props || {}; };
    var set = function (key, value) { opts.set(key, value); update(); };
    var preview = function (key, value) { (opts.preview || opts.set)(key, value); update(); };

    function keyOf(k) {
        var m = /^(inputs|outputs)\.(.+)$/.exec(k);
        if (!m) return k;
        var list = m[1] === "inputs" ? meta.inputs : meta.outputs;
        var io = list.filter(function (i) { return i.name === m[2]; })[0];
        if (!io) throw new Error("[nexa] bind(\"" + k + "\"): " + meta.id + " has no such " + m[1].slice(0, -1));
        return io.key;
    }

    function previewStates() {
        return (meta.stateList || []).filter(function (s) { return s.preview !== false; });
    }

    function currentState() {
        var list = previewStates();
        var v = props().__previewState;
        return list.some(function (s) { return s.name === v; }) ? v : (list[0] && list[0].name);
    }

    function actionsFor(prop, value, bound) {
        var btns = [];
        if (prop.bindable && BINDABLE_BY_TOGGLE[prop.type]) {
            btns.push(html`<button type="button" class="nx-icon-btn ${bound ? "nx-on" : ""}" title="${bound ? "Bound — click for a static value" : "Bind to a tag or template parameter"}"
                @click="${() => {
                    if (bound) { delete bindMode[prop.key]; set(prop.key, clone(prop.default)); }
                    else { bindMode[prop.key] = true; update(); }
                }}"><i class="fa fa-link"></i></button>`);
        }
        if (!prop.noReset && !same(value, prop.default)) {
            btns.push(html`<button type="button" class="nx-icon-btn" title="Reset to default" @click="${() => { delete bindMode[prop.key]; set(prop.key, clone(prop.default)); }}"><i class="fa fa-undo"></i></button>`);
        }
        return btns.length ? html`${btns}` : nothing;
    }

    // What bind(key) does to the widget it sits on, on every render.
    function decorate(el, rawKey, o) {
        if (rawKey === "__previewState") {
            el.states = previewStates();
            el.value = currentState();
            if (!el.hasAttribute("label") && !el.label) el.label = "Preview state (editor only)";
            wire(el, function (v) { preview("__previewState", v); });
            return;
        }
        var key = keyOf(rawKey);
        var prop = meta.props[key];
        if (!prop) { console.warn("[nexa] bind(\"" + rawKey + "\"): " + meta.id + " has no property \"" + key + "\""); return; }
        if (o) prop = Object.assign({}, prop, o);
        var p = props();
        var value = p[key] === undefined ? prop.default : p[key];

        // an attribute written in the template wins over the schema
        Object.keys(SCHEMA_ATTRS).forEach(function (name) {
            if (prop[name] !== undefined && !el.hasAttribute(SCHEMA_ATTRS[name])) el[name] = prop[name];
        });
        // options from the schema, unless the template binds its own (.options=${...}, e.g. ui.async)
        if (prop.options && prop.options.length && (el._nxOwnOptions || !el.options || !el.options.length)) {
            el.options = prop.options;
            el._nxOwnOptions = true;
        }
        if (prop.providers && el.providers === undefined) el.providers = prop.providers;
        if (prop.type === "list" && el.localName === "nx-list") {
            if (!el.renderItem || el._nxOwnItems) {
                var item = prop.item || { type: "string" };
                el.renderItem = function (it, _index, setItem) { return itemControl(item, it, setItem); };
                el.newItem = function () { return clone(item.default !== undefined ? item.default : (item.fields ? defaultsOf(item.fields) : "")); };
                el._nxOwnItems = true;
            }
        }

        var bound = !!BINDABLE_BY_TOGGLE[prop.type] && prop.bindable && (isBinding(value) || !!bindMode[key]);
        var message = validateProp(prop, value, p);
        el.value = prop.type === "json" && value !== null && typeof value !== "string" ? JSON.stringify(value, null, 2) : value;
        el.binding = bound ? (isBinding(value) ? value : "") : null;   // entering bind mode from a static value: empty picker
        el.modified = !prop.noReset && !same(value, prop.default);
        el.invalid = !!message;
        el.message = message || "";
        el.actions = actionsFor(prop, value, bound);
        if (prop.state && !el.hasAttribute("badge")) el.badge = prop.state === currentState() ? "previewing" : "";
        if (typeof prop.enabledWhen === "function") el.disabled = !prop.enabledWhen(p);
        wire(el, function (v) {
            if (prop.type === "json" && typeof v === "string") { try { v = v.trim() ? JSON.parse(v) : null; } catch (e) { /* kept as text: shown invalid */ } }
            set(key, v);
        });
    }

    // One nx-change listener per element; it always calls the latest handler.
    function wire(el, handler) {
        el._nxHandler = handler;
        if (el._nxWired) return;
        el._nxWired = true;
        el.addEventListener("nx-change", function (e) {
            if (e.target !== el) return;
            e.stopPropagation();
            if (el._nxHandler) el._nxHandler(e.detail.value);
        });
    }

    var ctx = { decorate: decorate };
    var bind = function (key, o) { return window.NexaSDK.bind(key, o); };

    function withCtx(fn) {
        return window.NexaSDK && window.NexaSDK._withInspector ? window.NexaSDK._withInspector(ctx, fn) : fn();
    }

    // ---- ui helpers (the `ui` argument of an inspector) ---------------------------------
    var ui = {
        /** The preview-state chips (states of the component). */
        stateSwitcher: function () {
            return previewStates().length > 1 ? html`<nx-state-switcher icon="fa fa-eye" ${bind("__previewState")}></nx-state-switcher>` : nothing;
        },
        /** The widget the automatic layout would use for a prop. */
        field: function (key, o) { return autoField(key, o); },
        alert: function (text, tone) { return html`<nx-alert tone="${tone || "info"}" text="${text}"></nx-alert>`; },
        badge: function (text, tone) { return html`<nx-badge tone="${tone || ""}" text="${text}"></nx-badge>`; },
        /** Options (or any value) loaded once by `loader()` (may return a Promise); [] until then. */
        async: function (cacheKey, loader, fallback) {
            if (!(cacheKey in asyncCache)) {
                asyncCache[cacheKey] = fallback !== undefined ? fallback : [];
                Promise.resolve().then(loader).then(function (v) { asyncCache[cacheKey] = v; update(); })
                    .catch(function (e) { console.error("[nexa] ui.async(" + cacheKey + "):", e); });
            }
            return asyncCache[cacheKey];
        },
        /** A modal dialog; resolves the button's value (null = closed). */
        dialog: function (d) { return openDialog(d || {}); },
        action: function (label, fn, o) {
            return html`<button type="button" class="nx-btn ${(o && o.block) ? "nx-block" : ""}" @click="${fn}">${o && o.icon ? html`<i class="${o.icon}"></i>` : nothing} ${label}</button>`;
        },
        /** Re-render the inspector (e.g. after changing your own closure state). */
        refresh: function () { update(); }
    };

    // ---- the automatic inspector ------------------------------------------------------------
    function defaultsOf(fields) {
        var o = {};
        Object.keys(fields).forEach(function (k) { o[k] = clone(fields[k].default !== undefined ? fields[k].default : ""); });
        return o;
    }

    // A widget for a schema that is NOT a stored prop (a list item / a list item's field).
    function itemControl(item, value, setItem) {
        if (item.fields) {
            var cells = Object.keys(item.fields).map(function (k) {
                var f = Object.assign({ label: k }, item.fields[k]);
                var v = value && value[k] !== undefined ? value[k] : f.default;
                return plainWidget(f, v, function (nv) { setItem(Object.assign({}, value, { [k]: nv })); });
            });
            return item.row ? html`<nx-row cols="${cells.length}">${cells}</nx-row>` : cells;
        }
        return plainWidget(Object.assign({ label: "" }, item), value, setItem);
    }

    function plainWidget(f, v, onChange) {
        var ch = function (e) { e.stopPropagation(); onChange(e.detail.value); };
        switch (f.type) {
            case "number": return html`<nx-number .value="${v}" label="${f.label || ""}" .min="${f.min}" .max="${f.max}" .step="${f.step}" unit="${f.unit || ""}" @nx-change="${ch}"></nx-number>`;
            case "boolean": return html`<nx-checkbox .value="${v}" label="${f.label || ""}" @nx-change="${ch}"></nx-checkbox>`;
            case "enum": return html`<nx-select .value="${v}" .options="${(f.options || []).map(function (o) { return typeof o === "object" ? o : { value: o, label: String(o) }; })}" label="${f.label || ""}" @nx-change="${ch}"></nx-select>`;
            case "color": return html`<nx-color .value="${v}" label="${f.label || ""}" @nx-change="${ch}"></nx-color>`;
            case "tag": return html`<nx-tag .value="${v}" label="${f.label || ""}" access="${f.access || ""}" .providers="${f.providers || null}" @nx-change="${ch}"></nx-tag>`;
            default: return html`<nx-text .value="${v}" label="${f.label || ""}" ?mono="${f.mono}" placeholder="${f.placeholder || ""}" @nx-change="${ch}"></nx-text>`;
        }
    }

    function enumStyle(prop) {
        if (prop.style) return prop.style;
        var o = prop.options || [];
        return o.length <= 3 && o.every(function (x) { return String(x.label).length <= 8; }) ? "segmented" : "select";
    }

    // The widget for a stored prop, bound to it.
    function autoField(key, o) {
        var prop = meta.props[key];
        if (!prop) return nothing;
        var p = props();
        if (typeof prop.visibleWhen === "function" && !prop.visibleWhen(p)) return nothing;
        if (prop.perState && prop.perState !== currentState()) return nothing;
        var b = bind(key, o);
        switch (prop.type) {
            case "text": return html`<nx-textarea ${b}></nx-textarea>`;
            case "number": return html`<nx-number ${b}></nx-number>`;
            case "range": return html`<nx-slider ${b}></nx-slider>`;
            case "boolean": return prop.style === "toggle" ? html`<nx-toggle ${b}></nx-toggle>` : html`<nx-checkbox ${b}></nx-checkbox>`;
            case "enum": {
                var s = enumStyle(prop);
                if (s === "segmented") return html`<nx-segmented ${b} ?icons-only="${prop.iconsOnly}"></nx-segmented>`;
                if (s === "combobox") return html`<nx-combobox ${b} .free="${!!prop.free}"></nx-combobox>`;
                return html`<nx-select ${b}></nx-select>`;
            }
            case "color": return html`<nx-color ${b}></nx-color>`;
            case "css": return html`<nx-code ${b} language="css" placeholder="(default)"></nx-code>`;
            case "code": return html`<nx-code ${b} language="${prop.lang || "javascript"}"></nx-code>`;
            case "json": return html`<nx-code ${b} language="json"></nx-code>`;
            case "tag": return html`<nx-tag ${b}></nx-tag>`;
            case "list": return html`<nx-list ${b}></nx-list>`;
            default: return html`<nx-text ${b} addon-before="${prop.prefix || ""}" addon-after="${prop.suffix || ""}"></nx-text>`;
        }
    }

    function autoInspector() {
        var groups = [], byName = {};
        Object.keys(meta.props).forEach(function (k) {
            var prop = meta.props[k];
            if (prop.hidden) return;
            var g = prop.group || "General";
            if (!byName[g]) { byName[g] = { name: g, keys: [] }; groups.push(byName[g]); }
            byName[g].keys.push(k);
        });
        var body = function (g) {
            var cells = g.keys.map(function (k) { return autoField(k); }).filter(function (c) { return c !== nothing; });
            return g.name === "Style" ? html`${ui.stateSwitcher()}${cells}` : cells;
        };
        if (groups.length <= 2) {
            return html`${groups.map(function (g) {
                return html`<nx-section heading="${g.name}" persist-key="${persist + ":" + g.name}">${body(g)}</nx-section>`;
            })}`;
        }
        return html`<nx-tabs persist-key="${persist}">${groups.map(function (g) {
            return html`<nx-tab label="${g.name}">${body(g)}</nx-tab>`;
        })}</nx-tabs>`;
    }

    function view() {
        return withCtx(function () {
            if (typeof meta.inspector === "function") return meta.inspector({ p: props(), ui: ui, bind: bind, meta: meta });
            return autoInspector();
        });
    }

    var queued = false;
    function update() {
        if (queued) return;
        queued = true;
        queueMicrotask(function () {
            queued = false;
            if (root.parentNode) render(view(), root);
        });
    }

    render(view(), root);
    return {
        update: update,
        destroy: function () { render(nothing, root); if (root.parentNode) root.parentNode.removeChild(root); },
        root: root
    };
}

// ---- ui.dialog ---------------------------------------------------------------------------
// { title, content: Lit template | string, buttons: [{ label, value, primary }] } -> Promise<value | null>
export function openDialog(d) {
    return new Promise(function (resolve) {
        var host = document.createElement("div");
        host.className = "nx-kit nx-dialog-backdrop";
        document.body.appendChild(host);
        var close = function (v) {
            render(nothing, host);
            host.remove();
            document.removeEventListener("keydown", onKey, true);
            resolve(v === undefined ? null : v);
        };
        var onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(null); } };
        document.addEventListener("keydown", onKey, true);
        var buttons = d.buttons || [{ label: "Cancel", value: null }, { label: "OK", value: true, primary: true }];
        render(html`<div class="nx-dialog" role="dialog" aria-modal="true" aria-label="${d.title || ""}">
            ${d.title ? html`<div class="nx-dialog-title">${d.title}</div>` : nothing}
            <div class="nx-dialog-body">${d.content || nothing}</div>
            <div class="nx-dialog-foot">${buttons.map(function (b) {
                return html`<button type="button" class="nx-btn ${b.primary ? "nx-primary" : ""}" @click="${function () { close(typeof b.value === "function" ? b.value(host) : b.value); }}">${b.label}</button>`;
            })}</div>
        </div>`, host);
        host.addEventListener("mousedown", function (e) { if (e.target === host) close(null); });
    });
}
