// --- NexaElement: the Lit base class of every component's `view` -----------
// What a view gets (see docs/SDK.md):
//   this.p                 its properties (defaults filled in; tag props resolved)
//   this.in.<input>        the value of an input tag (typed by the input's `type`;
//                          null while unknown; an array for `multiple`; throttled)
//   this.out.write(name, v)  write an output tag (falls back to its `fallback` input)
//   this.status(name)      { bound, unknown, provider, address, display, valid }
//   this.emit(event, payload)   fire a Logic event
//   this.setProp(key, v)   change one of its own properties (two-way)
//   this.mode / isEditor / previewState
//   this.size              { w, h } of the component, reactive
//   every(ms, fn) / after(ms, fn) / listen(target, type, fn) / onDestroy(fn)
//                          cleaned up automatically when the component goes away
//   mounted() / unmounted()  hooks (register timers in mounted())
//   this.ready / this.assetsReady   the component's `assets` are loaded
//   this.format(value, numberOptions)  number / text formatting helper
//   base + per-state CSS from the inspector, injected into the shadow root
//   `state: {...}` of the definition: reactive internal fields (this.<name>)
//
// Subclasses that override connectedCallback / disconnectedCallback /
// updated must call super.
import { LitElement } from "lit";
import { buildStylesheet, defaultValues } from "./schema.js";
import { parseTag, getTagProvider } from "./tags.js";
import F from "./format.js";

export function isUnknown(v) {
    return v === undefined || v === null || v === "???";
}

function coerce(value, type) {
    if (isUnknown(value)) return null;
    if (type === "number") {
        var n = typeof value === "number" ? value : Number(String(value).trim());
        return String(value).trim() === "" || !Number.isFinite(n) ? null : n;
    }
    if (type === "boolean") {
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value !== 0;
        var s = String(value).trim().toLowerCase();
        if (s === "true" || s === "1" || s === "on") return true;
        if (s === "false" || s === "0" || s === "off" || s === "null") return false;
        if (s === "") return null;
        var num = Number(s);
        return isNaN(num) ? true : num !== 0;
    }
    if (type === "string") return String(value);
    return value;
}

// ---- assets: external libraries, loaded once per page -------------------------
var loadedScripts = {};
function loadScript(url) {
    if (!loadedScripts[url]) {
        loadedScripts[url] = new Promise(function (resolve, reject) {
            var s = document.createElement("script");
            s.src = url;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error("[nexa] could not load " + url)); };
            document.head.appendChild(s);
        });
    }
    return loadedScripts[url];
}
function assetUrl(meta, url) {
    try { return new URL(url, (meta.assets && meta.assets.base) || document.baseURI).href; } catch (e) { return url; }
}

export class NexaElement extends LitElement {
    static properties = {
        size: { state: true },
        assetsReady: { state: true }
    };

    constructor() {
        super();
        var meta = this.meta;
        this.p = meta ? defaultValues(meta) : {};
        this.raw = {};
        this.size = { w: 0, h: 0 };
        this._resolved = {};
        this._ctx = null;
        this._cleanups = [];
        this._inputs = {};          // input name -> the value the view sees (throttled)
        this._inputTimers = {};
        this._inputAt = {};
        this.in = this._makeInputs();
        this.out = this._makeOutputs();
        var initial = (meta && meta.state) || {};
        var self = this;
        Object.keys(initial).forEach(function (k) {
            var v = initial[k];
            self[k] = v !== null && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
        });
        this.assetsReady = !(meta && meta.assets && meta.assets.scripts && meta.assets.scripts.length);
        this.ready = this.assetsReady ? Promise.resolve() : Promise.all(meta.assets.scripts.map(function (u) { return loadScript(assetUrl(meta, u)); }))
            .then(function () { self.assetsReady = true; })
            .catch(function (e) { console.error(e); });
    }

    /** Normalized metadata (set on the class by defineComponent). */
    get meta() { return this.constructor.__nexaMeta || null; }
    get ctx() { return this._ctx; }
    get mode() {
        var c = this._ctx;
        if (c && c.mode) return c.mode;
        return c && (typeof c.writeTag === "function" || typeof c.writeSparkplugProp === "function") ? "runtime" : "editor";
    }
    get isEditor() { return this.mode === "editor"; }
    get previewState() { return this.isEditor ? this.p.__previewState : undefined; }
    get stylesheet() { return this.meta ? buildStylesheet(this.meta, this.p) : ""; }

    // ---- inputs / outputs ---------------------------------------------------------

    _inputDecl(name) {
        var d = this.meta && this.meta.inputs.filter(function (i) { return i.name === name; })[0];
        if (!d) throw new Error("[nexa] " + (this.meta ? this.meta.id : "?") + ": no input \"" + name + "\"");
        return d;
    }

    _outputDecl(name) {
        var d = this.meta && this.meta.outputs.filter(function (o) { return o.name === name; })[0];
        if (!d) throw new Error("[nexa] " + (this.meta ? this.meta.id : "?") + ": no output \"" + name + "\"");
        return d;
    }

    _makeInputs() {
        var self = this, api = {};
        ((this.meta && this.meta.inputs) || []).forEach(function (io) {
            Object.defineProperty(api, io.name, { enumerable: true, get: function () { return self._inputs[io.name]; } });
        });
        return api;
    }

    _makeOutputs() {
        var self = this;
        return {
            /** The prop a write goes to: the output's tag, else its fallback input's; null = none. */
            target: function (name) {
                var o = self._outputDecl(name);
                if (parseTag(self.raw[o.key])) return o.key;
                if (o.fallbackKey && parseTag(self.raw[o.fallbackKey])) return o.fallbackKey;
                return null;
            },
            canWrite: function (name) {
                var c = self._ctx;
                return !!(this.target(name) && c && (typeof c.writeTag === "function" || typeof c.writeSparkplugProp === "function"));
            },
            /** Resolves { local: true } when no tag is bound (a local-only component) or in the editor. */
            write: function (name, value) {
                var key = this.target(name), c = self._ctx;
                if (!key || !c) return Promise.resolve({ local: true });
                if (typeof c.writeTag === "function") return Promise.resolve(c.writeTag(key, value));
                var t = parseTag(self.raw[key]);
                if (t && t.provider === "sparkplug" && typeof c.writeSparkplugProp === "function") return Promise.resolve(c.writeSparkplugProp(key, value));
                return Promise.resolve({ local: true });
            }
        };
    }

    /** { bound, unknown, provider, address, display, valid } of an input or output. */
    status(name) {
        var decl = (this.meta.inputs.filter(function (i) { return i.name === name; })[0]) || (this.meta.outputs.filter(function (o) { return o.name === name; })[0]);
        if (!decl) throw new Error("[nexa] " + this.meta.id + ": no input / output \"" + name + "\"");
        var raw = this.raw[decl.key];
        var t = parseTag(Array.isArray(raw) ? raw[0] : raw);
        var bound = !!t || (this.isEditor && typeof raw === "string" && raw !== "");
        var isInput = this.meta.inputs.indexOf(decl) !== -1;
        return {
            bound: bound,
            unknown: isInput ? bound && (decl.multiple ? (this._inputs[name] || []).some(function (v) { return v === null; }) : this._inputs[name] === null) : false,
            provider: t ? t.provider : null,
            address: t ? t.address : null,
            display: t ? t.display : "",
            valid: !!(t && t.valid),
            providerLabel: t && getTagProvider(t.provider) ? getTagProvider(t.provider).label : ""
        };
    }

    // ---- helpers ------------------------------------------------------------------

    emit(name, payload) {
        if (this._ctx && typeof this._ctx.emit === "function") this._ctx.emit(name, payload || {});
    }

    setProp(key, value) {
        this._resolved = Object.assign({}, this._resolved, { [key]: value });
        this.p = Object.assign({}, this.p, { [key]: value });
        if (this._ctx && typeof this._ctx.setBindableValue === "function") this._ctx.setBindableValue(key, value);
        this.requestUpdate();
    }

    format(value, opts) {
        if (opts && typeof value !== "string" && typeof value !== "number") return value === null || value === undefined ? "" : String(value);
        return opts ? F.formatNumber(value, opts) : (value === null || value === undefined ? "" : String(value));
    }

    every(ms, fn) {
        var id = setInterval(fn.bind(this), ms);
        this.onDestroy(function () { clearInterval(id); });
        return id;
    }

    after(ms, fn) {
        var id = setTimeout(fn.bind(this), ms);
        this.onDestroy(function () { clearTimeout(id); });
        return id;
    }

    listen(target, type, fn, options) {
        var bound = fn.bind(this);
        target.addEventListener(type, bound, options);
        this.onDestroy(function () { target.removeEventListener(type, bound, options); });
        return bound;
    }

    onDestroy(fn) {
        this._cleanups.push(fn);
    }

    /** Hook: the component is on the page (timers, observers go here). */
    mounted() {}
    /** Hook: the component left the page (everything registered above is already cleaned up). */
    unmounted() {}
    /** Hook: props (or the ctx) just changed, before the re-render. */
    propsChanged() {}

    connectedCallback() {
        super.connectedCallback();
        var self = this;
        if (typeof ResizeObserver === "function") {
            var ro = new ResizeObserver(function (entries) {
                var r = entries[0] && entries[0].contentRect;
                if (r && (r.width !== self.size.w || r.height !== self.size.h)) self.size = { w: r.width, h: r.height };
            });
            ro.observe(this);
            this.onDestroy(function () { ro.disconnect(); });
        }
        // In the editor, parts listed in `editor.interactive` still take clicks
        // (tab headers, scrollbars) instead of selecting / dragging the component.
        var interactive = this.meta && this.meta.editor && this.meta.editor.interactive;
        if (interactive && interactive.length) {
            this.listen(this, "mousedown", function (e) {
                if (!this.isEditor) return;
                var path = e.composedPath();
                for (var i = 0; i < path.length && path[i] !== this; i++) {
                    if (path[i].matches && interactive.some(function (sel) { return path[i].matches(sel); })) { e.stopPropagation(); return; }
                }
            });
        }
        this.mounted();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        var list = this._cleanups.splice(0);
        list.forEach(function (fn) { try { fn(); } catch (e) { /* keep cleaning */ } });
        Object.keys(this._inputTimers).forEach(function (k) { clearTimeout(this._inputTimers[k]); }, this);
        this._inputTimers = {};
        this.unmounted();
    }

    // ---- host plumbing (called by the def defineComponent builds) ---------------------

    _nexaRender(props, ctx) {
        this._ctx = ctx || {};
        var raw = ctx && typeof ctx.getRawProps === "function" ? ctx.getRawProps() : null;
        this.raw = raw || props || {};
        this._resolved = props || {};
        this._applyProps();
    }

    _nexaBind(key, value) {
        this._resolved = Object.assign({}, this._resolved, { [key]: value });
        this._applyProps();
    }

    _applyProps() {
        var meta = this.meta;
        var p = meta ? defaultValues(meta) : {};
        var src = this._resolved;
        Object.keys(src).forEach(function (k) { if (src[k] !== undefined) p[k] = src[k]; });
        this.p = p;
        if (meta) this._updateInputs();
        this.propsChanged();
        this.requestUpdate();
    }

    _updateInputs() {
        var self = this, meta = this.meta;
        var preview = this.isEditor && meta.preview && meta.preview.inputs ? meta.preview.inputs : null;
        meta.inputs.forEach(function (io) {
            var v = self.p[io.key];
            var value;
            if (io.multiple) {
                value = (Array.isArray(v) ? v : []).map(function (x) { return coerce(x, io.type); });
            } else {
                var bound = !!parseTag(self.raw[io.key]);
                value = bound ? coerce(v, io.type) : null;
                if (preview && value === null && preview[io.name] !== undefined) value = preview[io.name];
            }
            if (!io.throttle) { self._inputs[io.name] = value; return; }
            // throttled: at most one change every io.throttle ms reaches the view
            var now = Date.now(), last = self._inputAt[io.name] || 0;
            if (now - last >= io.throttle && !self._inputTimers[io.name]) {
                self._inputs[io.name] = value;
                self._inputAt[io.name] = now;
                return;
            }
            self._pendingInputs = self._pendingInputs || {};
            self._pendingInputs[io.name] = value;
            if (self._inputTimers[io.name]) return;
            self._inputTimers[io.name] = setTimeout(function () {
                self._inputTimers[io.name] = null;
                self._inputs[io.name] = self._pendingInputs[io.name];
                self._inputAt[io.name] = Date.now();
                self.propsChanged(); // the view reacts to the late value like to any other change
                self.requestUpdate();
            }, Math.max(0, io.throttle - (now - last)));
        });
    }

    updated(changed) {
        if (super.updated) super.updated(changed);
        var meta = this.meta;
        var interactive = meta && meta.editor && meta.editor.interactive && meta.editor.interactive.length;
        this.style.pointerEvents = this.isEditor && !interactive ? "none" : "auto";
        if (meta && meta.props.opacity) {
            var o = this.p.opacity;
            this.style.opacity = o !== undefined && o !== "" ? Number(o) : 1;
        }
        var sheet = this.stylesheet;
        if (sheet !== this._nexaSheet) {
            if (!this._nexaStyleEl) {
                this._nexaStyleEl = document.createElement("style");
                this._nexaStyleEl.setAttribute("data-nexa", "");
                this.renderRoot.appendChild(this._nexaStyleEl);
            }
            this._nexaStyleEl.textContent = sheet;
            this._nexaSheet = sheet;
        }
        if (meta && meta.assets && meta.assets.styles && !this._nexaAssetLinks) {
            var root = this.renderRoot;
            this._nexaAssetLinks = meta.assets.styles.map(function (u) {
                var l = document.createElement("link");
                l.rel = "stylesheet";
                l.href = assetUrl(meta, u);
                root.appendChild(l);
                return l;
            });
        }
    }
}
