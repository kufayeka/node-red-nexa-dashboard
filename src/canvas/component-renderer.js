import { state, getActiveScreen, findComponent, findTemplate, findTemplateByIdOrName, templateContains, snap, genId, markDirty, groupMemberIds } from "../state.js";
import { isLayerVisible, isLayerInteractable, shouldRenderLayer } from "./layers.js";
import { isSelected, selectOnly, selectMultiple, refreshSelectionVisuals } from "./selection.js";
import { updateComponentBox } from "./selection-handles.js";
import { pushHistory } from "../history.js";
import { resolveSparkplugProps, makeSparkplugBindingPath, onSparkplugLiveUpdate, refKeyOfBindingString } from "./sparkplug-live.js";

// Re-invokes just one component's render() with its current props
export function refreshComponentRender(comp) {
    if (!state.artboardEl) return;
    var el = state.artboardEl.find('[data-id="' + comp.id + '"]');
    var node = el && el.get && el.get(0);
    if (!node) return;
    var ctx = {
        namespace: comp.id, // top-level selection, so the raw id IS the full namespace
        emit: function (eventName, payload) {
            if (window.RED && window.RED.log) window.RED.log.info("[kufayeka-nexa-dashboard] component event: " + comp.type + "#" + comp.id + " " + eventName + " " + JSON.stringify(payload));
        },
        setBindableValue: function (name, value) {
            comp.props = comp.props || {};
            comp.props[name] = value;
            markDirty();
        }
    };
    // Goes through interpolateProps (template-param substitution, THEN
    // sparkplug resolution), not resolveSparkplugProps alone — matching
    // the fix in nexa-runtime-client.js's own refreshComponentRender.
    // comp.__paramState is undefined for every component this is currently
    // ever called on (the editor's live-bound-component scan only walks
    // top-level screen.components, never recursing into a "@template"
    // instance's nested ones), so this is a no-op today — kept consistent
    // anyway so the same "{sparkplug:...::{param}/...}" corruption bug
    // nexa-runtime-client.js had can't resurface here the moment that scan
    // is ever extended to reach nested components too.
    if (comp.type === "@lit-component") {
        renderLitComponentInstance(node, comp, interpolateProps(comp.props || {}, comp.__paramState), ctx);
        return;
    }
    var typeDef = window.NEXA.getComponent(comp.type);
    if (!typeDef || typeof typeDef.render !== "function") return;
    try {
        typeDef.render(node, interpolateProps(comp.props || {}, comp.__paramState), ctx);
    } catch (e) {
        el.text("(render error: " + e.message + ")");
    }
}

// Tag (sparkplug refKey) -> [component, ...] currently bound to it, for the
// CURRENTLY ACTIVE screen only — rebuilt fresh inside flushDirtySparkplugRenders
// below rather than incrementally maintained, so it's always correct
// regardless of which screen is active or how its components were just
// edited (add/remove/rebind), at the cost of one O(components) scan per
// animation frame that actually has pending changes — cheap (string
// comparisons, no DOM) compared to the render() calls it lets us skip.
// Only scans TOP-LEVEL screen.components, same scope this live-render path
// has always had (a "@template" instance's nested components aren't
// reached — see refreshComponentRender's own comment on why that's fine
// today).
function buildSparkplugBindingIndex(screen) {
    var index = {};
    screen.components.forEach(function (comp) {
        var props = comp.props || {};
        Object.keys(props).forEach(function (k) {
            var v = props[k];
            if (typeof v !== "string") return;
            var key = refKeyOfBindingString(v);
            if (!key) return;
            if (!index[key]) index[key] = [];
            index[key].push(comp);
        });
    });
    return index;
}

// Accumulates refKeys across possibly several onSparkplugLiveUpdate
// notifications (a burst of MQTT deltas arriving within the same tick),
// then does ONE index build + ONE render pass per animation frame instead
// of a synchronous re-render per individual delta — see
// ensureSparkplugLiveRenderWired's own comment for why a burst of deltas
// would otherwise cause repeated, avoidable browser reflow/repaint.
var dirtySparkplugKeys = null; // plain object used as a set: key -> true
var sparkplugFlushScheduled = false;

function flushDirtySparkplugRenders() {
    sparkplugFlushScheduled = false;
    var keys = dirtySparkplugKeys;
    dirtySparkplugKeys = null;
    if (!keys) return;
    var screen = getActiveScreen();
    if (!screen) return;
    var index = buildSparkplugBindingIndex(screen);
    var refreshedIds = {}; // a component bound to >1 changed tag only re-renders once
    Object.keys(keys).forEach(function (key) {
        (index[key] || []).forEach(function (comp) {
            if (refreshedIds[comp.id]) return;
            refreshedIds[comp.id] = true;
            refreshComponentRender(comp);
        });
    });
}

function scheduleSparkplugFlush() {
    if (sparkplugFlushScheduled) return;
    sparkplugFlushScheduled = true;
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(flushDirtySparkplugRenders);
}

// Called once, lazily, the first time anything asks the live Sparkplug
// cache to start pushing updates (see ensureSparkplugCommsWired) — re-runs
// refreshComponentRender for just the on-screen component(s) whose refKey
// actually changed (via the reverse index above), batched to once per
// animation frame, so a bound Text label's value updates as new DDATA
// arrives without re-checking or re-rendering every OTHER bound component
// on the screen, and without one synchronous DOM write per individual
// delta in a burst. Registered once per page load (module-level), not once
// per component.
var sparkplugLiveRenderWired = false;
export function ensureSparkplugLiveRenderWired() {
    if (sparkplugLiveRenderWired) return;
    sparkplugLiveRenderWired = true;
    onSparkplugLiveUpdate(function (changedKeys) {
        if (!changedKeys || !changedKeys.length) return;
        if (!dirtySparkplugKeys) dirtySparkplugKeys = {};
        changedKeys.forEach(function (key) { dirtySparkplugKeys[key] = true; });
        scheduleSparkplugFlush();
    });
}

export function removeComponents(ids) {
    var screen = getActiveScreen();
    if (!screen) return;
    var toRemove = ids
        .map(function (id) { return screen.components.find(function (c) { return c.id === id; }); })
        .filter(function (c) { return c && !c.locked; });
    if (!toRemove.length) return;
    var removeIds = toRemove.map(function (c) { return c.id; });
    screen.components = screen.components.filter(function (c) { return removeIds.indexOf(c.id) === -1; });
    if (state.artboardEl) {
        removeIds.forEach(function (id) { state.artboardEl.find('[data-id="' + id + '"]').remove(); });
    }
    state.selectedIds = state.selectedIds.filter(function (id) { return removeIds.indexOf(id) === -1; });
    refreshSelectionVisuals();
    if (toRemove.length === 1) {
        pushHistory({ t: "delete", screenId: screen.id, comp: toRemove[0] });
    } else {
        pushHistory({ t: "multi", screenId: screen.id, events: toRemove.map(function (c) { return { t: "delete", screenId: screen.id, comp: c }; }) });
    }
    markDirty();
}

export function getComponentTransform(comp) {
    var transform = "rotate(" + (comp.rotation || 0) + "deg)";
    if (comp.flipH || comp.flipV) {
        var sx = comp.flipH ? -1 : 1;
        var sy = comp.flipV ? -1 : 1;
        transform += " scale(" + sx + "," + sy + ")";
    }
    return transform;
}

// Matches a whole {path} expression — a leading identifier followed by any
// mix of ".prop" and "[index]" segments, e.g. {a}, {a.b.c}, {a[0].b}. The
// captured group is the full path text ("a.b.c" / "a[0].b"), split apart by
// resolvePath() below.
var INTERPOLATION_RE = /\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*)\}/g;
// Same path grammar, anchored to match the WHOLE string with nothing else
// around it — distinguishes "the value itself IS a binding" (resolves to
// the actual value, any type — see resolveBindableValue) from "a binding
// embedded in a bigger string" (always stringified).
var WHOLE_BINDING_RE = /^\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*)\}$/;

// Walks a dotted/bracketed path ("a.b[0].c") against `root`, e.g. for typed
// object/array params. Array indices work the same as property names once
// split apart — obj["0"] reads the same element as obj[0]. Returns undefined
// on any missing/null step along the way, same as a plain JS property chain
// would throw for null but simply stops here instead.
function resolvePath(root, path) {
    var segments = path.match(/[^.[\]]+/g) || [];
    var cur = root;
    for (var i = 0; i < segments.length; i++) {
        if (cur === null || cur === undefined) return undefined;
        cur = cur[segments[i]];
    }
    return cur;
}

// The one place a string gets checked against a param scope — used for BOTH
// component prop interpolation and a nested instance's own paramValues (the
// declarative "pass a parent's param down into a nested instance" mechanism
// — type {x} or {x.a[0].b.c} as an instance's param value in the Properties
// panel). A string that's EXACTLY one {path} expression resolves to the
// ACTUAL value at that path, any type (so an "object"/"array"-typed param
// can receive a whole structure, not a stringified fragment). A string with
// a {path} embedded in more text always stringifies. An unresolvable path
// (root name not in scope, or a later segment missing) is left as-is.
export function resolveBindableValue(raw, scope) {
    if (typeof raw !== "string" || !scope) return raw;
    var whole = WHOLE_BINDING_RE.exec(raw.trim());
    if (whole) {
        var resolved = resolvePath(scope, whole[1]);
        return resolved === undefined ? raw : resolved;
    }
    if (raw.indexOf("{") === -1) return raw;
    return raw.replace(INTERPOLATION_RE, function (wholeMatch, path) {
        var resolved = resolvePath(scope, path);
        return resolved === undefined ? wholeMatch : String(resolved);
    });
}

// {path} interpolation on every string prop — an unresolvable path (the root
// name isn't a declared param, or a later segment doesn't exist) is left
// exactly as-is, so a literal brace in an unrelated prop, or a typo, can
// never silently render as "undefined" or corrupt the string.
//
// "{sparkplug:...}" bindings are ALSO always resolved here, regardless of
// paramState — a top-level screen component (paramState undefined) can
// still be bound to a live Sparkplug metric; that binding doesn't live in
// any per-template-instance scope the way {path} params do, it comes from
// sparkplug-live.js's own global cache.
export function interpolateProps(props, paramState) {
    var withTemplateBindings = props;
    if (paramState) {
        var out = {};
        Object.keys(props || {}).forEach(function (k) {
            var v = props[k];
            out[k] = (typeof v === "string" && v.indexOf("{") !== -1) ? resolveBindableValue(v, paramState) : v;
        });
        withTemplateBindings = out;
    }
    return resolveSparkplugProps(withTemplateBindings);
}

// A "@template" instance's per-instance param state (Subflow env-vars
// analogue): template-declared defaults, overridden by this ONE instance's
// own paramValues — EXCEPT a paramValue that is itself a {path} binding,
// which is resolved against `enclosingParamState` (the template/screen that
// directly OWNS this instance) instead of being used literally. Only ever
// one level of inheritance at a time (a nested instance binds against its
// immediate parent, never further — matches Subflow env vars' own
// non-inherited scoping); deeper nesting still works because each level
// re-resolves its OWN bindings the same way, one hop at a time.
export function resolveInstanceParamState(comp, template, enclosingParamState) {
    var paramState = {};
    (template.params || []).forEach(function (p) { paramState[p.name] = p.defaultValue; });
    Object.keys(comp.paramValues || {}).forEach(function (name) {
        var raw = comp.paramValues[name];
        paramState[name] = (typeof raw === "string" && raw.indexOf("{") !== -1) ? resolveBindableValue(raw, enclosingParamState) : raw;
    });
    return paramState;
}

// --- "@lit-component": a generic node whose Lit.js code lives on the
// instance itself (comp.litCode/litStyles/litBindable/litEvents), authored
// inline in the Properties panel — analogous to Node-RED's own Function node
// or FlowFuse Dashboard 2's ui-template, but Lit instead of Vue. Evaluated at
// render/mount time via `new Function(...)` (same trust boundary as the
// Function Logic node already in this codebase — no sandboxing), against the
// Lit runtime loaded once as window.NEXA_LIT (see src/lit-vendor.js — user
// code can't `import "lit"` since there's no bundler at this point, in
// either the editor or a deployed page).
var litClassCache = {};

// Cheap non-cryptographic string hash (DJB2-ish) — only used as a cache key
// for "has this instance's code/styles/bindable-list changed", not for
// anything security-sensitive. A collision would at worst reuse a stale
// compiled class for one edit; astronomically unlikely for this use case.
function hashLitSource(str) {
    var h = 0;
    str = str || "";
    for (var i = 0; i < str.length; i++) {
        h = (h * 31 + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
}

// A single shared base class (not the raw LitElement) so every compiled
// "@lit-component" instance gets two methods for free:
// - `emit(name, payload)` — the user's own class body calls `this.emit(...)`
//   to fire a Logic ui-event, without needing to know how ctx.emit is wired
//   underneath. Bound per-instance via `__nexaCtx`, set right after the
//   element is created (renderLitComponentInstance).
// - `mountTemplate(hostEl, templateIdOrName, paramValues, opts)` — lets a Lit
//   Component's own code embed an already-authored Screen Template (found
//   by id, name, or identifier) into a container INSIDE its own shadow DOM,
//   passing `paramValues` in exactly like a normal `@template` instance's
//   Properties-panel fields would. This is a deliberately VISUAL-ONLY reuse
//   of the template-mounting code that already backs a dropped "@template"
//   instance (renderTemplateInstance) — it does NOT fold the embedded
//   template's own Logic graph into execution (no onload/inject/ui-event
//   nodes run inside an embedded copy in v1); if you need that, drop the
//   Template normally via the palette instead of embedding it from code.
// `__nexaNamespace` (set alongside `__nexaCtx`) gives each mountTemplate call
// a namespace rooted at THIS Lit instance's own fully-qualified path, so two
// different Lit Component instances (or two different `key`s passed to
// mountTemplate on the same instance, e.g. inside a loop) never collide.
function getNexaLitBase() {
    if (!window.NEXA_LIT || !window.NEXA_LIT.LitElement) return null;
    if (!window.__nexaLitBase) {
        var LitElementBase = window.NEXA_LIT.LitElement;
        window.__nexaLitBase = class extends LitElementBase {
            emit(eventName, payload) {
                if (this.__nexaCtx && typeof this.__nexaCtx.emit === "function") {
                    this.__nexaCtx.emit(eventName, payload);
                }
            }
            mountTemplate(hostEl, templateIdOrName, paramValues, opts) {
                opts = opts || {};
                if (!hostEl) return;
                var template = findTemplateByIdOrName(templateIdOrName);
                hostEl.innerHTML = "";
                if (!template) {
                    hostEl.textContent = "(mountTemplate: unknown template \"" + templateIdOrName + "\")";
                    return;
                }
                var w = opts.width || template.width;
                var h = opts.height || template.height;
                var wrapper = document.createElement("div");
                wrapper.style.position = "relative";
                wrapper.style.width = w + "px";
                wrapper.style.height = h + "px";
                wrapper.style.overflow = "hidden";
                hostEl.appendChild(wrapper);
                var namespace = (this.__nexaNamespace || "lit-embed") + "::embed::" +
                    (opts.key !== undefined ? opts.key : template.id);
                var fakeComp = { templateId: template.id, w: w, h: h, paramValues: paramValues || {} };
                renderTemplateInstance(wrapper, fakeComp, namespace, [], undefined);
            }
            // Backs the Bindable Properties list's "Two-way binding" checkbox
            // (properties-panel.js) — compileLitComponentClass attaches
            // `static __nexaTwoWayProps` (a plain array of property names) to
            // each generated subclass; this base-class updated() is the one
            // place that has to exist for ALL of them, so a user's own code
            // never has to remember to call ctx.setBindableValue by hand the
            // way they still do for emit(). NOTE: if the user's own litCode
            // ALSO defines updated(...), theirs silently wins (same class-body
            // override behavior as the static properties/styles caveat
            // already documented above compileLitComponentClass) — call
            // super.updated(changedProps) from theirs to keep this working.
            updated(changedProps) {
                var twoWay = this.constructor.__nexaTwoWayProps;
                if (twoWay && twoWay.length && this.__nexaCtx && typeof this.__nexaCtx.setBindableValue === "function") {
                    var self = this;
                    twoWay.forEach(function (name) {
                        if (changedProps.has(name)) self.__nexaCtx.setBindableValue(name, self[name]);
                    });
                }
            }
        };
    }
    return window.__nexaLitBase;
}

// Coerces a Bindable Property's raw value to its declared type before it
// ever reaches the component. Defends against exactly the bug a stale/
// wrongly-typed defaultValue caused in practice: switching a prop's type to
// "boolean" without resetting its old (string) default left literal text
// like "false" sitting in defaultValue — and `Boolean("false")` is `true`
// in plain JS, so the prop silently rendered as "always true" no matter
// what the Properties panel showed. properties-panel.js now also resets
// defaultValue on a type change going forward; this coercion additionally
// protects any data saved before that fix existed.
function coerceLitBindableValue(type, value) {
    if (value === undefined || value === null) return value;
    if (type === "boolean") {
        if (typeof value === "string") return value !== "" && value !== "false" && value !== "0";
        return !!value;
    }
    if (type === "number") return typeof value === "number" ? value : (parseFloat(value) || 0);
    return value;
}

function litPropertyCtor(type) {
    if (type === "number") return "Number";
    if (type === "boolean") return "Boolean";
    if (type === "object") return "Object";
    if (type === "array") return "Array";
    return "String";
}

// Compiles (and caches by content hash, so re-rendering an unchanged
// instance never re-registers a custom element) a Lit component class from
// this instance's own code. Every declared Bindable Property is its OWN
// top-level Lit reactive property (`static properties = { count: { type:
// Number } }`, standard idiomatic Lit — exactly the shape a hand-written Lit
// component would use) — the user's own code reads/writes it directly as
// `this.count`. There is deliberately no separate "internal state" concept:
// every piece of state a Lit Component needs is declared as a Bindable
// Property, full stop — an earlier revision tried splitting "external"
// (this.props.x) from "internal" (this.x) state into two namespaces to stop
// an unrelated external update from resetting a value the component's own
// code had just set; that turned out slower and buggier in practice than
// the plain, ordinary Lit idiom this reverts to, so it was undone. When an
// external update (a "ui-update"/"set-template-param" Logic node) arrives,
// it sets `this.<name>` directly (see renderLitComponentInstance) — same as
// any other Lit property assignment, triggering that property's own
// reactive update, nothing more.
export function compileLitComponentClass(litCode, litStyles, bindable) {
    var Base = getNexaLitBase();
    if (!Base) return { error: new Error("Lit runtime not loaded (window.NEXA_LIT missing)") };
    var cacheKey = hashLitSource(
        (litCode || "") + "||" + (litStyles || "") + "||" +
        (bindable || []).map(function (p) { return p.name + ":" + p.type + ":" + (p.twoWay ? "1" : "0"); }).join(",")
    );
    if (litClassCache[cacheKey]) return litClassCache[cacheKey];

    var propsDecl = "static properties = {" + (bindable || []).map(function (p) {
        return JSON.stringify(p.name) + ": { type: " + litPropertyCtor(p.type) + " }";
    }).join(",") + "};";
    var twoWayDecl = "static __nexaTwoWayProps = " + JSON.stringify(
        (bindable || []).filter(function (p) { return p.twoWay; }).map(function (p) { return p.name; })
    ) + ";";
    // Backtick/${ in user CSS text would otherwise be interpreted as JS
    // template-literal syntax by the very `new Function` call compiling it.
    var safeStyles = String(litStyles || "").replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    var stylesDecl = litStyles ? ("static styles = css`" + safeStyles + "`;") : "";
    var defaultRender = "render(){ return html`<div style=\"color:#999;font-size:11px;padding:6px;\">(empty Lit component — write render() in the Properties panel)</div>`; }";
    var classBody = propsDecl + "\n" + twoWayDecl + "\n" + stylesDecl + "\n" + (litCode || defaultRender);
    var tagName = "nexa-lit-" + cacheKey;

    var Klass;
    try {
        var factory = new Function("NexaLitBase", "html", "css", "nothing",
            "return class extends NexaLitBase {" + classBody + "\n};");
        Klass = factory(Base, window.NEXA_LIT.html, window.NEXA_LIT.css, window.NEXA_LIT.nothing);
    } catch (e) {
        return { error: e };
    }
    if (!window.customElements.get(tagName)) {
        try {
            window.customElements.define(tagName, Klass);
        } catch (e) {
            return { error: e };
        }
    }
    var entry = { tagName: tagName, Klass: Klass };
    litClassCache[cacheKey] = entry;
    return entry;
}

// Creates (or, if the tag hasn't changed, reuses in place — preserving the
// Lit element's own state) the custom element inside `el`, and assigns each
// declared Bindable Property's current value directly onto the matching
// top-level `this.<name>` property. Reused by both the initial render and
// any later prop-only refresh (refreshComponentRender), so editing one
// bindable prop's value never tears down and rebuilds the whole element.
export function renderLitComponentInstance(el, comp, props, ctx) {
    if (!window.NEXA_LIT || !window.NEXA_LIT.LitElement) {
        window.$(el).empty();
        window.$("<div>").text("(Lit runtime not loaded)").css({ color: "#a00", "font-size": "11px", background: "#fee", padding: "4px" }).appendTo(el);
        return;
    }
    var compiled = compileLitComponentClass(comp.litCode, comp.litStyles, comp.litBindable);
    if (compiled.error) {
        window.$(el).empty();
        window.$("<div>").text("(Lit compile error: " + compiled.error.message + ")")
            .css({ color: "#a00", "font-size": "11px", background: "#fee", padding: "4px", "white-space": "pre-wrap" }).appendTo(el);
        return;
    }
    var existing = el.firstElementChild;
    var instance;
    if (existing && existing.tagName && existing.tagName.toLowerCase() === compiled.tagName) {
        instance = existing;
    } else {
        el.innerHTML = "";
        instance = document.createElement(compiled.tagName);
        el.appendChild(instance);
    }
    instance.__nexaCtx = ctx;
    instance.__nexaNamespace = ctx && ctx.namespace;
    (comp.litBindable || []).forEach(function (p) {
        var hasOwn = props && Object.prototype.hasOwnProperty.call(props, p.name);
        var rawVal = hasOwn ? props[p.name] : p.defaultValue;
        var coerced = coerceLitBindableValue(p.type, rawVal);
        instance[p.name] = (coerced && typeof coerced === "object") ? (Array.isArray(coerced) ? [...coerced] : Object.assign({}, coerced)) : coerced;
    });
    if (typeof instance.requestUpdate === "function") {
        instance.requestUpdate();
    }
}

// Renders a single component's own visual content into `el` — either a
// registered NEXA component's render(), or (for a "@template" instance) the
// recursive template-instance mount below. Shared by the real, interactive
// top-level renderComponent() and the inert nested-preview renderer, so a
// template instance's contents look right in the editor whether it's the
// thing you dropped or something nested three levels deep inside it.
// `paramState`, when given, is the ENCLOSING template instance's own param
// state — used only to interpolate THIS component's props; a nested
// "@template" component ignores it entirely and computes its own fresh
// state instead (see renderTemplateInstance).
function renderComponentContent(el, comp, ctx, namespace, visitedTemplateIds, paramState) {
    if (comp.type === "@template") {
        // `paramState` here is the ENCLOSING scope's state (whatever surface
        // directly owns this "@template" component) — forwarded in as the
        // new instance's enclosingParamState, for resolving any {path}
        // bindings in ITS OWN paramValues (see resolveInstanceParamState).
        renderTemplateInstance(el, comp, namespace, visitedTemplateIds || [], paramState);
        return;
    }
    if (comp.type === "@lit-component") {
        renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, paramState), ctx);
        return;
    }
    var typeDef = window.NEXA.getComponent(comp.type);
    if (typeDef && typeof typeDef.render === "function") {
        try {
            typeDef.render(el, interpolateProps(comp.props || {}, paramState), ctx);
        } catch (e) {
            window.$(el).text("(render error: " + e.message + ")").css({ color: "#a00", "font-size": "11px", background: "#fee", padding: "4px" });
        }
    } else {
        window.$(el).text("(unknown component: " + comp.type + ")").css({ color: "#a00", "font-size": "11px", background: "#fee", padding: "4px" });
    }
}

// A nested component INSIDE a template instance — rendered for looks only
// (no drag/select/mousedown wiring), since the outer instance's own wrapper
// is the thing you actually move/select/resize on the canvas. `namespacedId`
// keeps data-id lookups unique across multiple instances of the same
// template (see the runtime's identical flattening approach for why this
// matters once these need to be individually targetable).
function renderComponentPreview(parentEl, innerComp, namespacedId, visitedTemplateIds, paramState) {
    var el = window.$("<div>", { "data-id": namespacedId, "class": "nexa-component nexa-component-preview" }).css({
        position: "absolute",
        left: innerComp.x + "px",
        top: innerComp.y + "px",
        width: innerComp.w + "px",
        height: innerComp.h + "px",
        transform: getComponentTransform(innerComp),
        "box-sizing": "border-box",
        "pointer-events": "none"
    }).appendTo(parentEl);
    renderComponentContent(el.get(0), innerComp, { namespace: namespacedId, emit: function () {} }, namespacedId, visitedTemplateIds, paramState);
}

// Mounts a "@template" instance's whole component tree, scaled from the
// template's own intrinsic width/height to this instance's actual w/h.
// Recurses for any nested "@template" instance inside the template, with a
// visitedTemplateIds guard as a defensive backstop against a cycle (the
// palette's drop-time templateContains() guard in state.js is the primary
// prevention — see Phase 3 of the plan for why both exist).
export function renderTemplateInstance(el, comp, namespace, visitedTemplateIds, enclosingParamState) {
    visitedTemplateIds = visitedTemplateIds || [];
    var template = findTemplate(comp.templateId);
    if (!template) {
        window.$(el).text("(missing template)").css({ color: "#a00", "font-size": "11px", background: "#fee", padding: "4px" });
        return;
    }
    if (visitedTemplateIds.indexOf(comp.templateId) !== -1) {
        window.$(el).text("(circular template reference: " + template.name + ")").css({ color: "#a00", "font-size": "11px", background: "#fee", padding: "4px" });
        return;
    }
    var innerVisited = visitedTemplateIds.concat([comp.templateId]);
    var paramState = resolveInstanceParamState(comp, template, enclosingParamState);
    var scaleX = template.width ? (comp.w / template.width) : 1;
    var scaleY = template.height ? (comp.h / template.height) : 1;
    var inner = window.$("<div>", { "class": "nexa-template-instance-inner" }).css({
        position: "absolute", left: "0", top: "0",
        width: template.width + "px", height: template.height + "px",
        "transform-origin": "0 0",
        transform: "scale(" + scaleX + "," + scaleY + ")"
    }).appendTo(el);
    (template.components || []).forEach(function (innerComp) {
        renderComponentPreview(inner, innerComp, namespace + "::" + innerComp.id, innerVisited, paramState);
    });
}

export function renderComponent(comp) {
    var screen = getActiveScreen();
    if (!screen || !state.artboardEl) return;
    // A "remove"-state layer's components get no DOM node at all — coming
    // back out of it (via the Layers panel or a Layer Control node setting
    // the layer back to show/hide) just means the NEXT renderActiveScreen()
    // (which always rebuilds every component from scratch — see canvas-ui.js)
    // naturally draws this one fresh, so no separate "remount" path is needed.
    if (!shouldRenderLayer(comp.layerId)) return;
    // "hide" still renders (so toggling back to "show" is instant) but must
    // be locked out of selection/dragging exactly like "remove" is —
    // display:none already blocks clicks, but NOT geometry-based marquee
    // select (see selection.js), so this also has to gate the mousedown/
    // draggable wiring below, not just the CSS.
    var interactable = isLayerInteractable(comp.layerId);
    var dragStart = null;
    var el = window.$("<div>", { "data-id": comp.id, "class": "nexa-component" }).css({
        position: "absolute",
        left: comp.x + "px",
        top: comp.y + "px",
        width: comp.w + "px",
        height: comp.h + "px",
        transform: getComponentTransform(comp),
        "box-sizing": "border-box",
        cursor: (comp.locked || !interactable) ? "default" : "move",
        "user-select": "none",
        "pointer-events": interactable ? "" : "none",
        display: isLayerVisible(comp.layerId) ? "" : "none"
    }).appendTo(state.artboardEl);

    renderComponentContent(el.get(0), comp, {
        namespace: comp.id, // top-level, so the raw id IS the full namespace
        emit: function (eventName, payload) {
            if (window.RED && window.RED.log) window.RED.log.info("[kufayeka-nexa-dashboard] component event: " + comp.type + "#" + comp.id + " " + eventName + " " + JSON.stringify(payload));
        },
        setBindableValue: function (name, value) {
            comp.props = comp.props || {};
            comp.props[name] = value;
            markDirty();
        }
    }, comp.id, []);

    if (!interactable) return;

    el.on("mousedown", function (e) {
        e.stopPropagation();
        var targetIds = comp.g ? groupMemberIds(comp.g) : [comp.id];
        var alreadyAllSelected = targetIds.every(isSelected);
        if (e.shiftKey) {
            if (alreadyAllSelected) {
                state.selectedIds = state.selectedIds.filter(function (id) { return targetIds.indexOf(id) === -1; });
            } else {
                targetIds.forEach(function (id) { if (!isSelected(id)) state.selectedIds.push(id); });
            }
            refreshSelectionVisuals();
        } else if (!alreadyAllSelected) {
            selectMultiple(targetIds);
        }
    });

    if (!comp.locked) {
        var groupStart = null;
        var dragStartPage = null;
        el.draggable({
            start: function (e) {
                if (!isSelected(comp.id)) selectOnly(comp.id);
                dragStart = { x: comp.x, y: comp.y };
                dragStartPage = { x: e.pageX, y: e.pageY };
                groupStart = {};
                state.selectedIds.forEach(function (id) {
                    var c = findComponent(id);
                    if (c) groupStart[id] = { x: c.x, y: c.y };
                });
            },
            drag: function (e, ui) {
                var localLeft = dragStart.x + (e.pageX - dragStartPage.x) / state.zoomLevel;
                var localTop = dragStart.y + (e.pageY - dragStartPage.y) / state.zoomLevel;
                localLeft = snap(localLeft, screen.gridSize);
                localTop = snap(localTop, screen.gridSize);
                localLeft = Math.max(0, Math.min(localLeft, screen.width - comp.w));
                localTop = Math.max(0, Math.min(localTop, screen.height - comp.h));
                ui.position.left = localLeft;
                ui.position.top = localTop;
                if (state.selectionHandlesEl && state.selectedIds.length === 1 && state.selectedIds[0] === comp.id) {
                    state.selectionHandlesEl.css({ left: localLeft + "px", top: localTop + "px" });
                }
                var dx = localLeft - dragStart.x;
                var dy = localTop - dragStart.y;
                state.selectedIds.forEach(function (id) {
                    if (id === comp.id) return;
                    var c = findComponent(id);
                    var start = groupStart[id];
                    if (!c || !start) return;
                    c.x = start.x + dx;
                    c.y = start.y + dy;
                    updateComponentBox(c);
                });
            },
            stop: function (e) {
                var localLeft = dragStart.x + (e.pageX - dragStartPage.x) / state.zoomLevel;
                var localTop = dragStart.y + (e.pageY - dragStartPage.y) / state.zoomLevel;
                localLeft = snap(localLeft, screen.gridSize);
                localTop = snap(localTop, screen.gridSize);
                localLeft = Math.max(0, Math.min(localLeft, screen.width - comp.w));
                localTop = Math.max(0, Math.min(localTop, screen.height - comp.h));
                comp.x = localLeft;
                comp.y = localTop;
                updateComponentBox(comp);
                var moved = [];
                state.selectedIds.forEach(function (id) {
                    var c = findComponent(id);
                    var start = groupStart[id];
                    if (!c || !start) return;
                    if (start.x !== c.x || start.y !== c.y) {
                        moved.push({ id: id, from: start, to: { x: c.x, y: c.y } });
                    }
                });
                if (moved.length === 1) {
                    pushHistory({ t: "move", screenId: screen.id, id: moved[0].id, from: moved[0].from, to: moved[0].to });
                } else if (moved.length > 1) {
                    pushHistory({
                        t: "multi", screenId: screen.id,
                        events: moved.map(function (m) { return { t: "move", screenId: screen.id, id: m.id, from: m.from, to: m.to }; })
                    });
                }
                if (moved.length) markDirty();
            }
        });
    }
}

export function addComponentAt(type, artboardX, artboardY) {
    var screen = getActiveScreen();
    if (!screen) return;

    // A "@template:<id>" drop instantiates a Reusable Screen Template
    // instead of a registered NEXA component — see Phase 3 of the plan.
    if (typeof type === "string" && type.indexOf("@template:") === 0) {
        var templateId = type.slice("@template:".length);
        var template = findTemplate(templateId);
        if (!template) return;
        // Defensive backstop — the palette itself should already exclude
        // any template whose drop would close a cycle while editing a
        // template (see buildPalette()'s filter in palette-events-panel.js).
        if (state.editingMode === "template" && templateContains(templateId, state.activeTemplateId)) {
            if (window.RED && window.RED.notify) {
                window.RED.notify("Can't nest this template here — it already contains the template you're editing.", { type: "warning", timeout: 3000 });
            }
            return;
        }
        var tw = template.width, th = template.height;
        var templateComp = {
            id: genId(),
            type: "@template",
            templateId: templateId,
            x: Math.max(0, screen.snap ? snap(artboardX - tw / 2, screen.gridSize) : artboardX - tw / 2),
            y: Math.max(0, screen.snap ? snap(artboardY - th / 2, screen.gridSize) : artboardY - th / 2),
            w: tw,
            h: th,
            rotation: 0,
            locked: false,
            layerId: (screen.layers[0] || {}).id,
            props: {},
            paramValues: {} // per-instance overrides of template.params[].defaultValue — see Properties panel
        };
        screen.components.push(templateComp);
        renderComponent(templateComp);
        selectOnly(templateComp.id);
        pushHistory({ t: "add", screenId: screen.id, comp: templateComp });
        markDirty();
        return;
    }

    // Generic "Lit Component" node — one fixed palette entry (not one per
    // registered type, since there's nothing to register: the code lives on
    // the instance itself, authored per-drop in the Properties panel).
    if (type === "@lit-component") {
        var litComp = {
            id: genId(),
            type: "@lit-component",
            x: Math.max(0, screen.snap ? snap(artboardX - 110, screen.gridSize) : artboardX - 110),
            y: Math.max(0, screen.snap ? snap(artboardY - 60, screen.gridSize) : artboardY - 60),
            w: 220,
            h: 120,
            rotation: 0,
            locked: false,
            layerId: (screen.layers[0] || {}).id,
            props: {},
            litCode: "render() {\n  return html`<div>Hello from Lit</div>`;\n}",
            litStyles: ":host { display: block; font-family: sans-serif; }",
            litBindable: [], // [{ name, type, defaultValue }] -> Lit `static properties` + Properties-panel/ui-update targets
            litEvents: []    // [{ name }] -> Events tab "on <name>" chips; call this.emit(name, payload) from your code
        };
        screen.components.push(litComp);
        renderComponent(litComp);
        selectOnly(litComp.id);
        pushHistory({ t: "add", screenId: screen.id, comp: litComp });
        markDirty();
        return;
    }

    var def = window.NEXA.getComponent(type);
    if (!def) return;
    var size = def.defaultSize || { w: 100, h: 60 };
    var props = {};
    Object.keys(def.defaults || {}).forEach(function (k) {
        props[k] = def.defaults[k].value;
    });
    var comp = {
        id: genId(),
        type: type,
        x: Math.max(0, screen.snap ? snap(artboardX - size.w / 2, screen.gridSize) : artboardX - size.w / 2),
        y: Math.max(0, screen.snap ? snap(artboardY - size.h / 2, screen.gridSize) : artboardY - size.h / 2),
        w: size.w,
        h: size.h,
        rotation: 0,
        locked: false,
        layerId: (screen.layers[0] || {}).id,
        props: props
    };
    screen.components.push(comp);
    renderComponent(comp);
    selectOnly(comp.id);
    pushHistory({ t: "add", screenId: screen.id, comp: comp });
    markDirty();
}

// Drop target for a metric row dragged out of the "MQTT Sparkplug" sidebar
// tab (see src/sidebar/sparkplug-panel.js and the extended droppable() in
// editor-tray.js) — builds a "kufayeka-text-label" component with its
// `props.text` pre-seeded to a live "{sparkplug:...}" binding (see
// sparkplug-live.js's makeSparkplugBindingPath), rather than the component's
// own registered default text. Everything else about the component (size,
// selection, history, dirty-tracking) matches the generic branch of
// addComponentAt() above exactly — this is NOT a second component-creation
// path, just a different initial `props`.
var SPARKPLUG_TEXT_COMPONENT_TYPE = "kufayeka-text-label";
export function addSparkplugMetricComponentAt(ref, artboardX, artboardY) {
    var screen = getActiveScreen();
    if (!screen) return;
    var def = window.NEXA.getComponent(SPARKPLUG_TEXT_COMPONENT_TYPE);
    if (!def) {
        if (window.RED && window.RED.notify) {
            window.RED.notify("Can't create a bound Text component — \"" + SPARKPLUG_TEXT_COMPONENT_TYPE + "\" isn't registered (is @kufayeka/nexa-component-basic-shapes installed?)", { type: "error", timeout: 4000 });
        }
        return;
    }
    var size = def.defaultSize || { w: 160, h: 36 };
    var props = {};
    Object.keys(def.defaults || {}).forEach(function (k) {
        props[k] = def.defaults[k].value;
    });
    props.text = makeSparkplugBindingPath(ref);
    var comp = {
        id: genId(),
        type: SPARKPLUG_TEXT_COMPONENT_TYPE,
        x: Math.max(0, screen.snap ? snap(artboardX - size.w / 2, screen.gridSize) : artboardX - size.w / 2),
        y: Math.max(0, screen.snap ? snap(artboardY - size.h / 2, screen.gridSize) : artboardY - size.h / 2),
        w: size.w,
        h: size.h,
        rotation: 0,
        locked: false,
        layerId: (screen.layers[0] || {}).id,
        props: props
    };
    screen.components.push(comp);
    renderComponent(comp);
    selectOnly(comp.id);
    pushHistory({ t: "add", screenId: screen.id, comp: comp });
    markDirty();
}
