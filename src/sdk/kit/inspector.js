// --- The inspector: a property tree over one editor pane (prop-tree/view.js) -----
// renderInspector(container, { meta, props, set, preview, persistKey, responsive })
//   meta     the component's normalized metadata (def.nexa, see src/sdk/schema.js)
//   props    its stored props (read here; every change goes through set)
//   set(key, value)      commit one prop (the editor adds undo / dirty / re-render)
//   preview(key, value)  design-time only (the state switcher); defaults to set
//   responsive           optional, the host's values per breakpoint (the editor's
//                        canvas/breakpoints-ui.js responsiveHost): every field gets a
//                        📱 button and, when used, its breakpoint chips
// Returns { update(), destroy(), root, select(id), selected(), search(q) }
// (ids: a prop's key, "list#2" an item, "list#2.field" an item's field, "@Group" a group).
//
// Every bound field (⛓, and a tag input) also edits its fallback: the value shown
// while the binding has none (props.__fallback[key]). Nothing to write for either:
// bind(key) does it.
//
// Every component gets the same inspector, from its schema: prop.group / prop.section
// make the tree, visibleWhen / perState show or hide a prop, prop.editor names a plugin's
// own editor (prop-tree/editors.js). There is no handwritten panel (a def's `inspector`
// is ignored). Re-renders are batched into a microtask; Lit only touches what changed,
// so focus and the caret survive.
import { html, nothing, render } from "lit";
import { str } from "./base.js";
import { createTreeView } from "./prop-tree/view.js";
import { isBindingList, toBindingList } from "../../model/binding.js";

var warnedInspector = {};

function clone(v) {
    return v === null || v === undefined || typeof v !== "object" ? v : JSON.parse(JSON.stringify(v));
}

function same(a, b) {
    return str(a) === str(b);
}

// A value on a breakpoint chip: short.
function shortValue(v) {
    if (v === undefined || v === null) return "";
    if (typeof v === "boolean") return v ? "on" : "off";
    if (Array.isArray(v)) return v.length + "×";
    if (typeof v === "object") {
        if ("t" in v && "r" in v && "b" in v && "l" in v) return v.t === v.r && v.r === v.b && v.b === v.l ? String(v.t) : [v.t, v.r, v.b, v.l].join(" ");
        if ("x" in v && "y" in v) return v.x + "·" + v.y;
        return "{…}";
    }
    var s = String(v);
    return s.length > 10 ? s.slice(0, 9) + "…" : s;
}

// "{provider:address}" / "{param}" as the whole value, or embedded in text.
function isBinding(v) {
    // a whole {asset:name} is the picked image itself (nx-asset's own value), not a binding
    return typeof v === "string" && /\{[^{}]+\}/.test(v) && !/^\{(asset|token):[^{}]+\}$/.test(v.trim());
}

// Types whose widget can switch to a binding (Static | Binding: a priority list of sources).
var BINDABLE_BY_TOGGLE = { number: 1, range: 1, boolean: 1, enum: 1, color: 1, string: 1, text: 1, asset: 1, json: 1 };

/**
 * A field's value as a binding list to show, or null (static): a list as it is, a legacy
 * binding string ("{speed}", "{sparkplug:…}", "Line {x}") converted, its fallback the static.
 */
export function shownBinding(value, fallback) {
    if (isBindingList(value)) return value;
    if (!isBinding(value)) return null;
    var b = toBindingList(value, fallback);
    return { $bind: b.sources, static: b.static };
}

/** The Static | Binding switch of a field: toStatic() / toBinding() commit the change. */
export function modeSwitch(isBound, toStatic, toBinding) {
    return html`<span class="nx-bl-mode" role="group" aria-label="Static or binding">
        <button type="button" class="nx-bl-static-btn ${isBound ? "" : "nx-on"}" title="A fixed value" @click="${(e) => { e.stopPropagation(); if (isBound) toStatic(); }}">Static</button>
        <button type="button" class="nx-bl-bind-btn ${isBound ? "nx-on" : ""}" title="The first source with a value, in priority order; the static value last" @click="${(e) => { e.stopPropagation(); if (!isBound) toBinding(); }}">Binding</button>
    </span>`;
}

/** Built-in checks + prop.validate(value, p) -> message | null. */
export function validateProp(prop, value, p) {
    var empty = value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
    if (prop.required && empty) return "Required";
    // a theme token ({token:spacing.4}) is a number the theme gives
    if ((prop.type === "number" || prop.type === "range") && !empty && !isBinding(value) && !/^\{token:[^{}]+\}$/.test(String(value).trim())) {
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
    var respOpen = {};             // keys whose breakpoint chips are shown (📱)
    var respSel = {};              // key -> the breakpoint its control edits
    var asyncCache = {};           // ui.async results
    var root = document.createElement("div");
    root.className = "nx-kit nx-inspector";
    container.appendChild(root);

    // opts.props: the object, or a function returning it (the node's props may be replaced)
    var props = function () { return (typeof opts.props === "function" ? opts.props() : opts.props) || {}; };
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

    function actionsFor(prop, value, bound, resp) {
        var btns = [];
        if (resp) {
            btns.push(html`<button type="button" class="nx-icon-btn nx-bp-toggle ${resp.shown ? "nx-on" : ""}" title="${resp.anySet ? "Responsive: set per breakpoint (clear them to go back to one value)" : resp.shown ? "Responsive: one value again" : "Responsive: a value per breakpoint (xs … 3xl)"}"
                @click="${() => { respOpen[prop.key] = !resp.shown; if (!respOpen[prop.key]) delete respSel[prop.key]; update(); }}"><i class="fa fa-mobile"></i></button>`);
        }
        if (!prop.noReset && !same(value, prop.default)) {
            btns.push(html`<button type="button" class="nx-icon-btn" title="Reset to default" @click="${() => { clearFallback(prop.key); set(prop.key, clone(prop.default)); }}"><i class="fa fa-undo"></i></button>`);
        }
        if (BINDABLE_BY_TOGGLE[prop.type] && (prop.bindable || bound)) {
            btns.push(modeSwitch(!!bound,
                function () { clearFallback(prop.key); set(prop.key, bound.static !== undefined ? clone(bound.static) : clone(prop.default)); },
                function () { set(prop.key, { $bind: [], static: clone(value === undefined ? prop.default : value) }); }));
        }
        return btns.length ? html`${btns}` : nothing;
    }

    // a legacy binding's fallback moves into the list's static: its old entry goes
    function clearFallback(key) {
        var fb = props().__fallback;
        if (!fb || !(key in fb)) return;
        var next = Object.assign({}, fb);
        delete next[key];
        opts.set("__fallback", Object.keys(next).length ? next : undefined);
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

        // a value per breakpoint (📱): the chips; the control edits the one picked
        var R = opts.responsive, resp = null;
        if (R && !prop.noResponsive && R.canVary(key)) {
            var bands = R.list(), active = R.active();
            var anySet = bands.some(function (b) { return R.has(key, b.id); });
            var shown = !!respOpen[key] || anySet;
            var sel = respSel[key] && bands.some(function (b) { return b.id === respSel[key]; }) ? respSel[key] : active;
            resp = { shown: shown, anySet: anySet, sel: sel, active: active };
            if (shown) {
                var at = function (id) { var v = R.valueAt(key, id); return v === undefined ? prop.default : v; };
                value = at(sel);
                el.responsive = {
                    items: bands.map(function (b) { return { id: b.id, name: b.name, range: b.range, design: b.design, set: R.has(key, b.id), selected: b.id === sel, value: shortValue(at(b.id)) }; }),
                    pick: function (id) { respSel[key] = id; update(); },
                    clear: function (id) { R.clearAt(key, id); update(); }
                };
            } else el.responsive = null;
        } else el.responsive = null;

        // an attribute written in the template wins over the schema
        Object.keys(SCHEMA_ATTRS).forEach(function (name) {
            if (prop[name] !== undefined && !el.hasAttribute(SCHEMA_ATTRS[name])) el[name] = prop[name];
        });
        // options from the schema: a list, or a function returning one (or a Promise of one:
        // loaded once per inspector, [] until then)
        var options = prop.options;
        if (typeof options === "function") {
            var loadOptions = options;
            options = (ui.async("options:" + key, function () { return loadOptions(props()); }) || []).map(function (o) {
                return o !== null && typeof o === "object" ? { value: o.value, label: o.label !== undefined ? o.label : String(o.value), icon: o.icon } : { value: o, label: String(o) };
            });
        }
        if (options && options.length && (el._nxOwnOptions || !el.options || !el.options.length)) {
            el.options = options;
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

        // bound: a binding priority list (a legacy binding string is shown as one); its static
        // value is the widget's own control, below the list
        var fallbacks = p.__fallback || {};
        var bound = BINDABLE_BY_TOGGLE[prop.type] && (prop.bindable || isBindingList(value)) ? shownBinding(value, fallbacks[key]) : null;
        var shown = bound ? (bound.static === undefined ? prop.default : bound.static) : value;
        var message = validateProp(prop, shown, p);
        el.value = prop.type === "json" && shown !== null && shown !== undefined && typeof shown !== "string" ? JSON.stringify(shown, null, 2) : shown;
        el.binding = bound;
        el.fallback = !!bound || (opts.fallbacks !== false && prop.type === "tag" && prop.access !== "write");
        if (prop.type === "tag") el.fallbackValue = fallbacks[key];
        // theme tokens: a colour takes the colour tokens; another prop names its categories (tokens: "fontSizes")
        el.tokens = prop.tokens !== undefined ? prop.tokens || "" : prop.type === "color" ? "colors" : "";
        el.modified = !prop.noReset && !same(value, prop.default);
        el.invalid = !!message;
        el.message = message || "";
        el.actions = actionsFor(prop, value, bound, resp);
        if (prop.state && !el.hasAttribute("badge")) el.badge = prop.state === currentState() ? "previewing" : "";
        if (typeof prop.enabledWhen === "function") el.disabled = !prop.enabledWhen(p);
        var commit = function (v) {
            // another breakpoint than the one being edited: kept as that breakpoint's value
            if (resp && resp.shown && resp.sel !== resp.active) { R.setAt(key, resp.sel, v); update(); return; }
            set(key, v);
        };
        wire(el, function (v) {
            if (prop.type === "json" && typeof v === "string") { try { v = v.trim() ? JSON.parse(v) : null; } catch (e) { /* kept as text: shown invalid */ } }
            // the list changed: a legacy string becomes a list now (its fallback is in the static)
            if (bound && isBindingList(v)) clearFallback(key);
            commit(v);
        });
        wireFallback(el, function (v) {
            if (prop.type === "json" && typeof v === "string") { try { v = v.trim() ? JSON.parse(v) : null; } catch (e) { /* kept as text */ } }
            if (bound) {   // the list's static value
                clearFallback(key);
                commit({ $bind: bound.$bind.slice(), static: v });
                return;
            }
            var next = Object.assign({}, props().__fallback || {});
            if (v === undefined || v === null || v === "") delete next[key]; else next[key] = v;
            set("__fallback", Object.keys(next).length ? next : undefined);
        });
    }

    function wireFallback(el, handler) {
        el._nxFallback = handler;
        if (el._nxFallbackWired) return;
        el._nxFallbackWired = true;
        el.addEventListener("nx-fallback", function (e) {
            if (e.target !== el) return;
            e.stopPropagation();
            if (el._nxFallback) el._nxFallback(e.detail.value);
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

    // ---- helpers of the tree view ------------------------------------------------------------
    var ui = {
        /** The preview-state chips (states of the component), above the tree. */
        stateSwitcher: function () {
            return previewStates().length > 1 ? html`<nx-state-switcher icon="fa fa-eye" ${bind("__previewState")}></nx-state-switcher>` : nothing;
        },
        /** A value loaded once by `loader()` (may return a Promise), `fallback` ([]) until then (async options). */
        async: function (cacheKey, loader, fallback) {
            if (!(cacheKey in asyncCache)) {
                asyncCache[cacheKey] = fallback !== undefined ? fallback : [];
                Promise.resolve().then(loader).then(function (v) { asyncCache[cacheKey] = v; update(); })
                    .catch(function (e) { console.error("[nexa] options of " + cacheKey + ":", e); });
            }
            return asyncCache[cacheKey];
        }
    };

    // ---- the widgets ------------------------------------------------------------------------------
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
                return plainWidget(f, v, function (nv) { setItem(function (cur) { return Object.assign({}, cur, { [k]: nv }); }); });
            });
            return item.row ? html`<nx-row cols="${cells.length}">${cells}</nx-row>` : cells;
        }
        return plainWidget(Object.assign({ label: "" }, item), value, setItem);
    }

    // A list item's field: bindable like a prop (Static | Binding) unless field.bindable === false.
    function plainWidget(f, v, onChange) {
        var b = BINDABLE_BY_TOGGLE[f.type || "string"] && f.bindable !== false ? shownBinding(v) : null;
        var acts = BINDABLE_BY_TOGGLE[f.type || "string"] && f.bindable !== false
            ? modeSwitch(!!b, function () { onChange(b.static !== undefined ? clone(b.static) : clone(f.default)); },
                function () { onChange({ $bind: [], static: clone(v === undefined ? f.default : v) }); })
            : nothing;
        if (b) v = b.static === undefined ? f.default : b.static;
        var ch = function (e) { e.stopPropagation(); onChange(e.detail.value); };
        // bound: the control below the list edits its static value
        var fb = function (e) { e.stopPropagation(); onChange({ $bind: b.$bind.slice(), static: e.detail.value }); };
        switch (f.type) {
            case "number": return html`<nx-number .value="${v}" label="${f.label || ""}" .min="${f.min}" .max="${f.max}" .step="${f.step}" unit="${f.unit || ""}" .binding="${b}" ?fallback="${!!b}" .actions="${acts}" @nx-change="${ch}" @nx-fallback="${fb}"></nx-number>`;
            case "boolean": return html`<nx-checkbox .value="${v}" label="${f.label || ""}" .binding="${b}" ?fallback="${!!b}" .actions="${acts}" @nx-change="${ch}" @nx-fallback="${fb}"></nx-checkbox>`;
            case "enum": return html`<nx-select .value="${v}" .options="${(f.options || []).map(function (o) { return typeof o === "object" ? o : { value: o, label: String(o) }; })}" label="${f.label || ""}" .binding="${b}" ?fallback="${!!b}" .actions="${acts}" @nx-change="${ch}" @nx-fallback="${fb}"></nx-select>`;
            case "color": return html`<nx-color .value="${v}" label="${f.label || ""}" .binding="${b}" ?fallback="${!!b}" .actions="${acts}" @nx-change="${ch}" @nx-fallback="${fb}"></nx-color>`;
            case "tag": return html`<nx-tag .value="${v}" label="${f.label || ""}" access="${f.access || ""}" .providers="${f.providers || null}" @nx-change="${ch}"></nx-tag>`;
            case "asset": return html`<nx-asset .value="${v}" label="${f.label || ""}" .binding="${b}" ?fallback="${!!b}" .actions="${acts}" @nx-change="${ch}" @nx-fallback="${fb}"></nx-asset>`;
            default: return html`<nx-text .value="${v}" label="${f.label || ""}" ?mono="${f.mono}" placeholder="${f.placeholder || ""}" .binding="${b}" ?fallback="${!!b}" .actions="${acts}" @nx-change="${ch}" @nx-fallback="${fb}"></nx-text>`;
        }
    }

    function enumStyle(prop) {
        if (prop.style) return prop.style;
        if (typeof prop.options === "function") return "select";
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
            case "asset": return html`<nx-asset ${b}></nx-asset>`;
            case "align": return html`<nx-align ${b}></nx-align>`;
            case "spacing": return html`<nx-spacing ${b}></nx-spacing>`;
            case "list": return html`<nx-list ${b}></nx-list>`;
            default: return html`<nx-text ${b} addon-before="${prop.prefix || ""}" addon-after="${prop.suffix || ""}"></nx-text>`;
        }
    }

    if (typeof meta.inspector === "function" && !warnedInspector[meta.id]) {
        warnedInspector[meta.id] = true;
        console.warn("[nexa] " + meta.id + ": `inspector` is no longer used — every component gets the property tree (use group / section / visibleWhen / editor on the props)");
    }

    var tree = createTreeView({
        meta: meta, props: props, persist: persist, responsive: opts.responsive,
        set: function (key, value) { set(key, value); },
        preview: function (key, value) { preview(key, value); },
        update: function () { update(); },
        field: function (key) { return autoField(key); },
        decorate: function (el, key) { decorate(el, key); },
        itemWidget: function (sch, value, setItem) { return itemControl(sch, value, setItem); },
        plainWidget: function (f, v, onChange) { return plainWidget(f, v, onChange); },
        validate: validateProp,
        state: currentState,
        stateSwitcher: function () { return ui.stateSwitcher(); },
        openDialog: openDialog
    });

    function view() {
        if (opts.responsive && typeof opts.responsive.begin === "function") opts.responsive.begin();
        return withCtx(function () { return tree.view(); });
    }

    function draw() {
        render(view(), root);
        tree.afterRender(root);
    }

    var queued = false;
    function update() {
        if (queued) return;
        queued = true;
        queueMicrotask(function () {
            queued = false;
            if (root.parentNode) draw();
        });
    }

    draw();
    return {
        update: update,
        destroy: function () { tree.destroy(); render(nothing, root); if (root.parentNode) root.parentNode.removeChild(root); },
        root: root,
        /** Pick a node of the tree (a prop's key, "list#2", "list#2.field", "@Group"). */
        select: function (id, o) { tree.select(id, o); },
        selected: function () { return tree.selected(); },
        search: function (q) { tree.search(q); }
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
