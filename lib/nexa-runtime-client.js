// Mounts one deployed screen's component tree into #nexa-runtime-artboard,
// AND runs its screen.logic graph — this is the deployed-page counterpart
// of the Pages editor's own execution engine (runLogicGraph/fireLifecycle/
// fireUiEvent in src/), reimplemented here in plain vanilla JS (no jQuery —
// this file ships to public, unauthenticated pages) against the actual
// rendered DOM instead of the editor's canvas. Deliberately a plain,
// chrome-free version of the editor's own renderComponent()/isLayerVisible()
// — no drag, no resize/rotate handles, no selection outline, since there's
// nothing to edit here, only to run. Same render()/onBind() component
// contract either way.
//
// Reusable Screen Templates ("@template" component instances, see Phase 3 of
// the plan) add exactly one new idea here: mounting recursively FLATTENS
// every instance's own Logic graph (at any nesting depth) into ONE shared,
// namespaced {nodes, wires} graph before anything runs — see mountAndFlatten
// and mountScreen below. That's the ONLY change needed to make nesting safe
// with many instances: runLogicGraph/continuePropagation/fireLifecycle/
// fireUiEvent themselves are completely unmodified from before templates
// existed — they just walk whatever flat graph they're handed, unaware that
// most of it was folded in from instances rather than authored directly on
// this screen.
(function () {
    // Mirrors state.js's getLayerRenderState/isLayerVisible/shouldRenderLayer
    // (editor side) — same 3-state model (show/hide/remove), same
    // most-restrictive-ancestor-wins rule, same "hide still gets a DOM node,
    // remove doesn't" split. A deployed page never re-mounts wholesale the
    // way the editor's renderActiveScreen() does, so the Layer Control node
    // (see runLogicGraph's "layer-control" branch and applyLayerControl
    // below) has to reconcile the live DOM itself when a layer's state
    // changes after the initial mount, instead of getting a fresh draw for
    // free.
    var LAYER_STATE_RANK = { show: 0, hide: 1, remove: 2 };
    function getLayerRenderStateIn(layers, layerId) {
        layers = layers || [];
        var layer = layers.filter(function (l) { return l.id === layerId; })[0];
        var effective = "show";
        while (layer) {
            var layerState = layer.state || (layer.visible === false ? "hide" : "show");
            if (LAYER_STATE_RANK[layerState] > LAYER_STATE_RANK[effective]) effective = layerState;
            var parentId = layer.parentId;
            layer = parentId ? layers.filter(function (l) { return l.id === parentId; })[0] : null;
        }
        return effective;
    }

    function isLayerVisibleIn(layers, layerId) {
        return getLayerRenderStateIn(layers, layerId) === "show";
    }

    function shouldRenderLayerIn(layers, layerId) {
        return getLayerRenderStateIn(layers, layerId) !== "remove";
    }

    function findComponent(screen, id) {
        return (screen.components || []).filter(function (c) { return c.id === id; })[0];
    }

    function findLogicNode(screen, id) {
        return ((screen.logic && screen.logic.nodes) || []).filter(function (n) { return n.id === id; })[0];
    }

    function findTemplateById(templates, id) {
        return (templates || []).filter(function (t) { return t.id === id; })[0];
    }

    // Off by default on deployed pages — nobody wants a live SCADA screen
    // spamming devtools. window.NEXA_LOGIC_VERBOSE = true from the console
    // flips it on for debugging a specific page. Debug nodes print either
    // way, unaffected by this.
    var logicVerbose = !!window.NEXA_LOGIC_VERBOSE;
    function logicTrace() {
        if (!logicVerbose) return;
        var args = ["[nexa-logic]"].concat(Array.prototype.slice.call(arguments));
        console.log.apply(console, args);
    }

    function getComponentTransform(comp) {
        var transform = "rotate(" + (comp.rotation || 0) + "deg)";
        if (comp.flipH || comp.flipV) {
            var sx = comp.flipH ? -1 : 1;
            var sy = comp.flipV ? -1 : 1;
            transform += " scale(" + sx + "," + sy + ")";
        }
        return transform;
    }

    // --- "@lit-component": same mechanism as the editor's identical helpers
    // in src/canvas/component-renderer.js (compileLitComponentClass /
    // renderLitComponentInstance / getNexaLitBase), ported verbatim to
    // vanilla JS — see that file's comments for the full rationale. Lit is
    // loaded as window.NEXA_LIT by a separate <script src="/nexa/_lit-vendor.js">
    // (see lib/nexa-plugin.js's renderScreenHtml), since this file can't
    // `import "lit"` (no bundler on a deployed page).
    var litClassCache = {};

    function hashLitSource(str) {
        var h = 0;
        str = str || "";
        for (var i = 0; i < str.length; i++) {
            h = (h * 31 + str.charCodeAt(i)) | 0;
        }
        return (h >>> 0).toString(36);
    }

    // Deliberately VISUAL-ONLY reuse of the template-mounting machinery for a
    // Lit Component's own this.mountTemplate(...) call (see getNexaLitBase
    // below) — mirrors mountAndFlatten's structure but skips folding the
    // embedded template's Logic graph into effectiveScreen.logic and skips
    // __paramStates bookkeeping. This is called dynamically, from INSIDE a
    // Lit component's own lifecycle, well after the screen's one-time
    // fireLifecycle("onload")/setUpInjectNodes pass has already run — Logic
    // nodes folded in this late would never fire, so this doesn't pretend to
    // support that. Drop the Template via the palette normally if you need
    // its own Logic (onload/ui-event/param-input/etc.) to actually run.
    function mountTemplateVisual(parentEl, comp, ownerLayers, templates, namespace, visitedTemplateIds, screenForCtx, paramState) {
        var el = document.createElement("div");
        el.setAttribute("data-id", namespace);
        el.style.position = "absolute";
        el.style.left = (comp.x || 0) + "px";
        el.style.top = (comp.y || 0) + "px";
        el.style.width = comp.w + "px";
        el.style.height = comp.h + "px";
        el.style.transform = getComponentTransform(comp);
        el.style.boxSizing = "border-box";
        el.style.display = isLayerVisibleIn(ownerLayers, comp.layerId) ? "" : "none";
        parentEl.appendChild(el);

        if (comp.type === "@template") {
            var template = findTemplateById(templates, comp.templateId);
            if (!template) { el.textContent = "(missing template)"; return; }
            if (visitedTemplateIds.indexOf(comp.templateId) !== -1) {
                el.textContent = "(circular template reference: " + template.name + ")";
                return;
            }
            var innerVisited = visitedTemplateIds.concat([comp.templateId]);
            var instanceParamState = resolveInstanceParamState(comp, template, paramState);
            var scaleX = template.width ? (comp.w / template.width) : 1;
            var scaleY = template.height ? (comp.h / template.height) : 1;
            var inner = document.createElement("div");
            inner.style.position = "absolute";
            inner.style.left = "0";
            inner.style.top = "0";
            inner.style.width = template.width + "px";
            inner.style.height = template.height + "px";
            inner.style.transformOrigin = "0 0";
            inner.style.transform = "scale(" + scaleX + "," + scaleY + ")";
            el.appendChild(inner);
            (template.components || []).forEach(function (innerComp) {
                mountTemplateVisual(inner, innerComp, template.layers, templates, namespace + "::" + innerComp.id, innerVisited, screenForCtx, instanceParamState);
            });
            return;
        }

        var namespacedComp = buildComponentClone(comp, namespace);
        if (comp.type === "@lit-component") {
            renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, paramState), makeCtx(screenForCtx, namespacedComp));
            return;
        }
        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        if (typeDef && typeof typeDef.render === "function") {
            try {
                typeDef.render(el, interpolateProps(comp.props || {}, paramState), makeCtx(screenForCtx, namespacedComp));
            } catch (e) {
                el.textContent = "(render error: " + e.message + ")";
            }
        } else {
            el.textContent = "(unknown component: " + comp.type + ")";
        }
    }

    function findTemplateByIdOrName(templates, idOrName) {
        return findTemplateById(templates, idOrName) ||
            (templates || []).filter(function (t) { return t.name === idOrName || t.identifier === idOrName; })[0];
    }

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
                    var templates = window.__NEXA_TEMPLATES__ || [];
                    var template = findTemplateByIdOrName(templates, templateIdOrName);
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
                    var fakeComp = { type: "@template", templateId: template.id, x: 0, y: 0, w: w, h: h, rotation: 0, paramValues: paramValues || {} };
                    mountTemplateVisual(wrapper, fakeComp, [], templates, namespace, [], this.__nexaScreen, undefined);
                }
                // Backs the Bindable Properties list's "Two-way binding"
                // checkbox — see the identical method in the editor's
                // src/canvas/component-renderer.js getNexaLitBase for the
                // full rationale (and the same "user's own updated()
                // silently wins" caveat).
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

    // Coerces a Bindable Property's raw value to its declared type — see the
    // identical helper in src/canvas/component-renderer.js for the full
    // rationale (a stale/wrongly-typed defaultValue left over from before a
    // type change, e.g. the literal string "false", is TRUTHY in plain JS
    // and silently made a boolean prop render as "always true").
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

    // Every declared Bindable Property is its OWN top-level Lit reactive
    // property (`static properties = { count: { type: Number } }`, standard
    // idiomatic Lit) — see the identical function in
    // src/canvas/component-renderer.js for why an earlier revision's
    // separate this.props.* / this.* namespaces were reverted (slower and
    // buggier in practice than plain, ordinary Lit properties).
    function compileLitComponentClass(litCode, litStyles, bindable) {
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
        var safeStyles = String(litStyles || "").replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
        var stylesDecl = litStyles ? ("static styles = css`" + safeStyles + "`;") : "";
        var defaultRender = "render(){ return html`<div style=\"color:#999;font-size:11px;padding:6px;\">(empty Lit component)</div>`; }";
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

    function renderLitComponentInstance(el, comp, props, ctx) {
        if (!window.NEXA_LIT || !window.NEXA_LIT.LitElement) {
            el.textContent = "(Lit runtime not loaded)";
            return;
        }
        var compiled = compileLitComponentClass(comp.litCode, comp.litStyles, comp.litBindable);
        if (compiled.error) {
            el.textContent = "(Lit compile error: " + compiled.error.message + ")";
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
        instance.__nexaScreen = ctx && ctx.screen;
        (comp.litBindable || []).forEach(function (p) {
            var hasOwn = props && Object.prototype.hasOwnProperty.call(props, p.name);
            instance[p.name] = coerceLitBindableValue(p.type, hasOwn ? props[p.name] : p.defaultValue);
        });
    }

    function updateComponentBox(comp) {
        var el = document.querySelector('[data-id="' + comp.id + '"]');
        if (!el) return;
        el.style.left = comp.x + "px";
        el.style.top = comp.y + "px";
        el.style.width = comp.w + "px";
        el.style.height = comp.h + "px";
        el.style.transform = getComponentTransform(comp);
    }

    function refreshComponentRender(screen, comp) {
        var el = document.querySelector('[data-id="' + comp.id + '"]');
        if (!el) return;
        // comp.__paramState (set once at mount — see mountAndFlatten) is the
        // enclosing "@template" instance's live param state, or undefined
        // for a top-level component. MUST go through interpolateProps here,
        // not resolveSparkplugProps alone: a nested component's props can
        // still contain an unsubstituted "{paramName}" at this point (e.g.
        // "{sparkplug:...::{param4}/metric}") — resolving the sparkplug
        // binding BEFORE the param substitution runs looks up the literal
        // "{param4}" text as if it were a real metric name, finds nothing,
        // and shows "???" even though the real value is available. This was
        // a real reported bug: any Sparkplug delta anywhere (this function
        // is called for every bound component on every delta, see
        // refreshAllSparkplugBoundComponents) re-corrupted the display,
        // fixed moments later by the next set-template-param tick — which
        // reads as "flickers to ??? then back" tied to param updates, when
        // the param update was actually the CURE, not the cause.
        if (comp.type === "@lit-component") {
            renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, comp.__paramState), makeCtx(screen, comp));
            return;
        }
        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        if (!typeDef || typeof typeDef.render !== "function") return;
        try {
            typeDef.render(el, interpolateProps(comp.props || {}, comp.__paramState), makeCtx(screen, comp));
        } catch (e) {
            el.textContent = "(render error: " + e.message + ")";
        }
    }

    // x/y/w/h/rotation/flipH/flipV live directly on the component, everything else is
    // a props.<key> — same split as the editor's applyUiUpdateProp.
    var LOGIC_GEOMETRY_KEYS = { x: 1, y: 1, w: 1, h: 1, rotation: 1, flipH: 1, flipV: 1 };

    function applyUiUpdateProp(screen, compId, key, value) {
        var comp = findComponent(screen, compId);
        if (!comp) return;
        if (LOGIC_GEOMETRY_KEYS[key]) {
            comp[key] = value;
            updateComponentBox(comp);
            return;
        }
        comp.props = comp.props || {};
        comp.props[key] = value;

        // A "@lit-component" has no typeDef/onBind to look up — Lit's own
        // reactivity handles the re-render once the property is set directly
        // on the mounted custom element instance, so neither onBind nor a
        // full refreshComponentRender() is needed here.
        if (comp.type === "@lit-component") {
            var litEl = document.querySelector('[data-id="' + comp.id + '"]');
            var litInstance = litEl && litEl.firstElementChild;
            if (litInstance) {
                var bindableDef = (comp.litBindable || []).filter(function (p) { return p.name === key; })[0];
                litInstance[key] = bindableDef ? coerceLitBindableValue(bindableDef.type, value) : value;
            }
            return;
        }

        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        if (!typeDef) return;
        var el = document.querySelector('[data-id="' + comp.id + '"]');
        if (typeDef.onBind && el) {
            try { typeDef.onBind(el, "props." + key, value); } catch (e) { /* one component's bug shouldn't break the page */ }
            return;
        }
        refreshComponentRender(screen, comp);
    }

    // Backs the consolidated "Update Component" logic node — merges the
    // node's own static config, then a plain-object msg.payload (so a
    // Function node can just do `msg.payload = {text: "hi"}` without
    // knowing about a separate `.properties` field), then the explicit
    // msg.properties (wins over both) — same contract as the editor's
    // applyUiUpdateMulti.
    function applyUiUpdateMulti(screen, compId, staticConfig, payloadProps, msgProperties) {
        var overrides = {};
        var cfg = staticConfig || {};
        Object.keys(cfg).forEach(function (k) {
            if (cfg[k] !== undefined && cfg[k] !== "") overrides[k] = cfg[k];
        });
        var fromPayload = payloadProps || {};
        Object.keys(fromPayload).forEach(function (k) {
            if (fromPayload[k] !== undefined) overrides[k] = fromPayload[k];
        });
        var live = msgProperties || {};
        Object.keys(live).forEach(function (k) {
            if (live[k] !== undefined) overrides[k] = live[k];
        });
        Object.keys(overrides).forEach(function (k) { applyUiUpdateProp(screen, compId, k, overrides[k]); });
    }

    // Used directly by a plain "ui-update" node — applies a msg to one
    // concrete component's properties.
    function runUiUpdateNode(screen, node, msg) {
        var payloadProps = null;
        var comp = findComponent(screen, node.compId);
        var compProps = (comp && comp.props) || {};

        if (msg && msg.payload !== undefined && msg.payload !== null) {
            if (typeof msg.payload === "object" && !Array.isArray(msg.payload)) {
                payloadProps = Object.assign({}, msg.payload);
            } else {
                // Primitive payload: map intelligently based on component capabilities
                if ("fill" in compProps && !("text" in compProps)) {
                    payloadProps = { fill: msg.payload };
                } else {
                    payloadProps = { text: msg.payload };
                }
            }
        }

        // Top-level properties on msg (e.g. msg.fill, msg.stroke, msg.color, msg.text, msg.rotation, msg.x, msg.y, msg.w, msg.h)
        var directPropKeys = ["fill", "stroke", "color", "text", "rotation", "x", "y", "w", "h", "opacity"];
        directPropKeys.forEach(function (k) {
            if (msg && msg[k] !== undefined) {
                payloadProps = payloadProps || {};
                if (payloadProps[k] === undefined) payloadProps[k] = msg[k];
            }
        });

        applyUiUpdateMulti(screen, node.compId, node.config, payloadProps, msg && msg.properties);
    }

    // --- Sparkplug live-value binding for a deployed page. Mirrors src/
    // canvas/sparkplug-live.js's editor-side cache/grammar exactly (same
    // "{sparkplug:<groupId>::<edgeNodeId>::<deviceId>::<metricName>}" syntax,
    // same "::" field separator, same reasoning: a Sparkplug metric NAME can
    // itself contain "/", so that can't double as this syntax's own field
    // separator) — duplicated here rather than shared, same as every other
    // piece of editor logic this file already mirrors verbatim, since this
    // is plain vanilla JS with no bundler/import available at runtime.
    //
    // RED.comms (the editor's own live-push channel) can never reach this
    // page — it's scoped to the authenticated admin Socket.IO connection
    // only. Instead this uses the plain Server-Sent-Events stream
    // lib/nexa-plugin.js exposes at RUNTIME_PREFIX + "/_sparkplug-stream",
    // fed by nodes/nexa-sparkplug.js's own live tree — native EventSource,
    // no client library to ship.
    var SPARKPLUG_BINDING_PREFIX = "sparkplug:";
    var sparkplugCache = {}; // refKey -> {value, isNull, online}
    // True from the moment the SSE stream drops until a fresh snapshot has
    // been re-absorbed after it reconnects. EventSource itself auto-
    // reconnects at the transport level for free — the actual bug this
    // guards against was that NOTHING re-synced application state once it
    // did: a value that changed while disconnected stayed frozen at its
    // last-known reading, indistinguishable from a genuinely live one,
    // until that exact metric happened to change again (or the page was
    // reloaded). Real reported behavior, not hypothetical.
    var sparkplugConnectionLost = false;

    function parseSparkplugBindingPath(raw) {
        if (typeof raw !== "string") return null;
        var trimmed = raw.trim();
        if (trimmed.charAt(0) !== "{" || trimmed.charAt(trimmed.length - 1) !== "}") return null;
        var inner = trimmed.slice(1, -1);
        if (inner.indexOf(SPARKPLUG_BINDING_PREFIX) !== 0) return null;
        var parts = inner.slice(SPARKPLUG_BINDING_PREFIX.length).split("::");
        if (parts.length < 4) return null;
        var metricName = parts.slice(3).join("::");
        if (!parts[0] || !parts[1] || !metricName) return null;
        return { groupId: parts[0], edgeNodeId: parts[1], deviceId: parts[2] || null, metricName: metricName };
    }

    function sparkplugRefKey(ref) {
        return ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "") + "::" + ref.metricName;
    }

    function formatSparkplugValue(ref) {
        // A dropped connection makes EVERY cached value suspect at once
        // (we have no idea what changed while disconnected) — showing
        // "???" here rather than the last-known reading is the actual fix
        // for "stays the same forever if it goes stale/disconnects".
        if (sparkplugConnectionLost) return "???";
        var entry = sparkplugCache[sparkplugRefKey(ref)];
        if (!entry || !entry.online || entry.isNull || entry.value === undefined || entry.value === null) return "???";
        return String(entry.value);
    }

    // Same contract as the editor's resolveSparkplugProps: resolves every
    // "{sparkplug:...}" string prop, unconditionally (not gated on
    // paramState — this binding's source is this module's own global
    // cache, not any per-template-instance scope), returning the SAME
    // object back untouched when nothing in it is a sparkplug binding.
    function resolveSparkplugProps(props) {
        var out = null;
        var keys = Object.keys(props || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = props[k];
            if (typeof v !== "string") continue;
            var ref = parseSparkplugBindingPath(v);
            if (!ref) continue;
            if (!out) out = Object.assign({}, props);
            out[k] = formatSparkplugValue(ref);
        }
        return out || props;
    }

    // Components bound to a Sparkplug metric, so a live update only needs
    // to re-render THOSE, not walk the whole tree on every tick. Built at
    // page load (registerSparkplugBoundComponentsFrom, called right after
    // mountScreen flattens everything) AND re-built whenever any template
    // param changes post-mount (see updateInstanceParam) — a nested
    // component's OWN prop string can embed a per-instance param INSIDE a
    // sparkplug binding, e.g. "{sparkplug:G::E::{lantai}/a}" (see
    // resolveBindableValue's own comment), so its real, concrete refKey
    // depends on comp.__paramState and isn't fixed for the component's
    // whole lifetime the way a plain top-level binding's is.
    var sparkplugBoundComponents = []; // [{screen, comp}] -- used for "everything might have changed" cases (resync, connection lost)
    var sparkplugBindingIndex = {}; // refKey -> [{screen, comp}, ...] -- used for a normal, targeted delta
    function registerSparkplugBoundComponentsFrom(effectiveScreen) {
        sparkplugBoundComponents = [];
        sparkplugBindingIndex = {};
        (effectiveScreen.components || []).forEach(function (comp) {
            var props = comp.props || {};
            var isBound = false;
            Object.keys(props).forEach(function (k) {
                var v = props[k];
                if (typeof v !== "string") return;
                // Same two-pass resolution order interpolateProps itself
                // uses at render time: substitute this instance's OWN
                // "{paramName}" placeholders first (a no-op when
                // comp.__paramState is undefined, i.e. a top-level
                // component — resolveBindableValue returns raw unchanged),
                // THEN parse the result as a sparkplug binding. Indexing
                // straight off the raw, unsubstituted string here was a
                // real regression: every clone of the same template shares
                // the identical literal "{sparkplug:...{lantai}/a}" text,
                // so they'd all collide under one bogus key that could
                // never match any real incoming metric name — only the
                // clone(s) that happened to share it would ever be found,
                // and the rest silently stopped updating.
                var resolved = resolveBindableValue(v, comp.__paramState);
                var ref = parseSparkplugBindingPath(resolved);
                if (!ref) return;
                isBound = true;
                var key = sparkplugRefKey(ref);
                if (!sparkplugBindingIndex[key]) sparkplugBindingIndex[key] = [];
                sparkplugBindingIndex[key].push({ screen: effectiveScreen, comp: comp });
            });
            if (isBound) sparkplugBoundComponents.push({ screen: effectiveScreen, comp: comp });
        });
    }
    function refreshAllSparkplugBoundComponents() {
        sparkplugBoundComponents.forEach(function (entry) {
            refreshComponentRender(entry.screen, entry.comp);
        });
    }

    // Batches targeted refreshes across possibly several SSE messages
    // arriving within the same tick (a burst of MQTT deltas) into ONE
    // index lookup + render pass per animation frame, instead of a
    // synchronous DOM write per individual delta — see
    // applySparkplugDelta's own comment for why that used to jank a
    // canvas-heavy screen under high-frequency updates.
    var sparkplugDirtyKeys = null; // plain object used as a set: key -> true
    var sparkplugFlushScheduled = false;

    function flushDirtySparkplugComponents() {
        sparkplugFlushScheduled = false;
        var keys = sparkplugDirtyKeys;
        sparkplugDirtyKeys = null;
        if (!keys) return;
        var refreshedIds = {}; // a component bound to >1 changed tag only re-renders once
        Object.keys(keys).forEach(function (key) {
            (sparkplugBindingIndex[key] || []).forEach(function (entry) {
                if (refreshedIds[entry.comp.id]) return;
                refreshedIds[entry.comp.id] = true;
                refreshComponentRender(entry.screen, entry.comp);
            });
        });
    }

    function markSparkplugKeysDirty(keys) {
        if (!keys.length) return;
        if (!sparkplugDirtyKeys) sparkplugDirtyKeys = {};
        keys.forEach(function (key) { sparkplugDirtyKeys[key] = true; });
        if (sparkplugFlushScheduled) return;
        sparkplugFlushScheduled = true;
        var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
        raf(flushDirtySparkplugComponents);
    }

    // Every incoming delta used to synchronously re-render EVERY bound
    // component on the page (refreshAllSparkplugBoundComponents), regardless
    // of which single tag it actually carried — fine for occasional updates,
    // but a real problem for a screen with many bound components under a
    // high-frequency data source: each delta forced a full re-render pass,
    // and a burst of them forced one right after another with no batching,
    // synchronously blocking the main thread between animation frames.
    // Now only the component(s) actually bound to a CHANGED key are
    // touched (via sparkplugBindingIndex), batched to once per frame (via
    // markSparkplugKeysDirty) — see flushDirtySparkplugComponents.
    function applySparkplugDelta(delta) {
        if (!delta) return;
        var changedKeys = [];
        if (delta.type === "death") {
            var nodePrefix = delta.groupId + "::" + delta.edgeNodeId + "::";
            var devicePrefix = delta.deviceId ? nodePrefix + delta.deviceId + "::" : null;
            Object.keys(sparkplugCache).forEach(function (key) {
                if (devicePrefix ? key.indexOf(devicePrefix) !== 0 : key.indexOf(nodePrefix) !== 0) return;
                if (sparkplugCache[key].online) {
                    sparkplugCache[key].online = false;
                    changedKeys.push(key);
                }
            });
        } else {
            (delta.metrics || []).forEach(function (m) {
                var key = delta.groupId + "::" + delta.edgeNodeId + "::" + (delta.deviceId || "") + "::" + m.name;
                sparkplugCache[key] = { value: m.value, isNull: m.isNull, online: true };
                changedKeys.push(key);
            });
        }
        markSparkplugKeysDirty(changedKeys);
    }

    function absorbSparkplugSnapshot(tree) {
        sparkplugCache = {};
        Object.keys(tree || {}).forEach(function (groupId) {
            Object.keys(tree[groupId]).forEach(function (edgeNodeId) {
                var edgeNode = tree[groupId][edgeNodeId];
                Object.keys(edgeNode.nodeMetrics || {}).forEach(function (name) {
                    var m = edgeNode.nodeMetrics[name];
                    sparkplugCache[groupId + "::" + edgeNodeId + "::" + "::" + name] = { value: m.value, isNull: m.isNull, online: edgeNode.online };
                });
                Object.keys(edgeNode.devices || {}).forEach(function (deviceId) {
                    var device = edgeNode.devices[deviceId];
                    Object.keys(device.metrics || {}).forEach(function (name) {
                        var m = device.metrics[name];
                        sparkplugCache[groupId + "::" + edgeNodeId + "::" + deviceId + "::" + name] = { value: m.value, isNull: m.isNull, online: edgeNode.online && device.online };
                    });
                });
            });
        });
    }

    function setUpSparkplugLiveBinding() {
        // Not available in the hand-rolled DOM-shim test harness (see
        // test/mock-runtime-client.js and friends) — a real browser always
        // has this; skipping there just means those tests exercise
        // everything EXCEPT the live-binding wiring itself, same as they
        // already skip anything else genuinely browser-only.
        if (typeof window.XMLHttpRequest !== "function") return;
        var prefix = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";

        // Re-fetches the full current tree and re-absorbs it, clearing
        // sparkplugConnectionLost once it lands. Called on the FIRST
        // connect and on EVERY automatic reconnect (see source.onopen
        // below) — a delta stream alone can never recover what it missed
        // while disconnected, so every reconnect needs a fresh resync, not
        // just the very first page load.
        function fetchSnapshotAndRefresh() {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", prefix + "/_sparkplug-snapshot", true);
            xhr.onload = function () {
                if (xhr.status === 200) {
                    try { absorbSparkplugSnapshot(JSON.parse(xhr.responseText)); } catch (e) { /* leave cache as-is -- still marked stale below until this succeeds */ }
                }
                sparkplugConnectionLost = false;
                refreshAllSparkplugBoundComponents();
            };
            // Left BOTH request-level failure (onerror) and an HTTP error
            // status silently retried by the next reconnect/onopen — no
            // separate retry loop needed here, since the SSE stream itself
            // is the thing driving whether we're even trying right now.
            xhr.send();
        }

        if (typeof window.EventSource !== "function") {
            // No live updates possible on a truly ancient browser — still
            // show one real snapshot instead of a permanent "???".
            fetchSnapshotAndRefresh();
            return;
        }

        var source = new window.EventSource(prefix + "/_sparkplug-stream");
        // Fires on the very first successful connect AND after every
        // automatic reconnect — exactly the two moments a resync is needed.
        source.onopen = fetchSnapshotAndRefresh;
        source.onmessage = function (evt) {
            try { applySparkplugDelta(JSON.parse(evt.data)); } catch (e) { /* a malformed/keepalive event is simply ignored */ }
        };
        // Server-pushed "resync" (a distinct named event, not the default
        // "message") means the connection settings config node
        // (kufayeka-nexa-sparkplug) got redeployed out from under this
        // still-open stream — see lib/nexa-plugin.js's own resyncCheck.
        // The new instance starts with a completely empty tree, so this
        // page's cache needs a full refetch, not just more deltas layered
        // onto stale pre-redeploy data.
        source.addEventListener("resync", fetchSnapshotAndRefresh);
        source.onerror = function () {
            // EventSource is either about to auto-retry (readyState
            // CONNECTING) or has given up for good (readyState CLOSED,
            // rare — only after a fatal, non-retryable response). Either
            // way, everything currently cached is now unverified — surface
            // that as "???" immediately instead of continuing to show a
            // frozen last-known value that LOOKS just as live as before.
            if (!sparkplugConnectionLost) {
                sparkplugConnectionLost = true;
                refreshAllSparkplugBoundComponents();
            }
        };
    }

    // Matches a whole {path} expression — a leading identifier followed by
    // any mix of ".prop" and "[index]" segments, e.g. {a}, {a.b.c}, {a[0].b}.
    var INTERPOLATION_RE = /\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*)\}/g;
    // Same path grammar, anchored to match the WHOLE string with nothing
    // else around it — this is what distinguishes "the value itself IS a
    // binding" (resolves to the actual value, any type) from "a binding
    // embedded in a bigger string" (always stringified) in resolveBindableValue.
    var WHOLE_BINDING_RE = /^\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*)\}$/;

    // Walks a dotted/bracketed path ("a.b[0].c") against `root`, for typed
    // object/array params. Array indices work the same as property names
    // once split apart — obj["0"] reads the same element as obj[0]. Ported
    // verbatim from the editor's identical helper in component-renderer.js.
    function resolvePath(root, path) {
        var segments = path.match(/[^.[\]]+/g) || [];
        var cur = root;
        for (var i = 0; i < segments.length; i++) {
            if (cur === null || cur === undefined) return undefined;
            cur = cur[segments[i]];
        }
        return cur;
    }

    // The one place a string gets checked against a param/paramValue scope —
    // used for BOTH component prop interpolation and a nested instance's own
    // paramValues (see "declarative nested param passing" in the plan). A
    // string that's EXACTLY one {path} expression (nothing else around it)
    // resolves to the ACTUAL value at that path, any type — this is what
    // lets a param typed "object"/"array" receive a whole structure, not
    // just a stringified fragment. A string with a {path} embedded in more
    // text always stringifies, same as before. An unresolvable path (root
    // name not in scope, or a later segment missing) is left exactly as-is.
    function resolveBindableValue(raw, scope) {
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

    // {path} interpolation on every string prop — an unresolvable path (the
    // root name isn't a declared param, or a later segment doesn't exist) is
    // left exactly as-is, so a literal brace in an unrelated prop, or a
    // typo, can never silently render as "undefined" or corrupt the string.
    // "{sparkplug:...}" bindings are ALSO always resolved here, regardless
    // of paramState — see resolveSparkplugProps's own comment for why (this
    // binding's source is the module-level sparkplugCache, not any one
    // component's enclosing template-instance scope).
    function interpolateProps(props, paramState) {
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
    // analogue): template-declared defaults, overridden by this ONE
    // instance's own paramValues — EXCEPT a paramValue that is itself a
    // {path} binding, which is resolved against `enclosingParamState` (the
    // template/screen that directly OWNS this instance) instead of being
    // used literally — this is the declarative "pass a parent's param down
    // into a nested instance" mechanism, no Logic-node wiring required. Only
    // ever one level: a nested instance's OWN paramValues bind against ITS
    // immediate parent's params, never inherited further than that (matches
    // Subflow env vars' own non-inherited scoping) — but see
    // cascadeBoundChildParams below for how a change still reaches deeper
    // nesting when it needs to, through repeated one-level resolution.
    function resolveInstanceParamState(comp, template, enclosingParamState) {
        var paramState = {};
        (template.params || []).forEach(function (p) { paramState[p.name] = p.defaultValue; });
        Object.keys(comp.paramValues || {}).forEach(function (name) {
            var raw = comp.paramValues[name];
            paramState[name] = (typeof raw === "string" && raw.indexOf("{") !== -1) ? resolveBindableValue(raw, enclosingParamState) : raw;
        });
        return paramState;
    }

    // True if `id` is a DIRECT child of the instance namespaced
    // `namespacedInstanceId` — i.e. exactly one more "::" segment, not
    // belonging to some further-nested instance inside THIS one (which has
    // its own independent, non-inherited param state and must not be
    // touched when only the outer instance's param changes).
    function belongsDirectlyToInstance(id, namespacedInstanceId) {
        var prefix = namespacedInstanceId + "::";
        if (id.indexOf(prefix) !== 0) return false;
        return id.slice(prefix.length).indexOf("::") === -1;
    }

    // Re-renders every DIRECT leaf component of one instance against its
    // updated paramState — a full render() call rather than onBind, since an
    // interpolation change can touch multiple props at once depending on
    // which ones reference {name}, unlike a single-key ui-update.
    function reapplyInterpolationForInstance(screen, namespacedInstanceId, paramState) {
        screen.components.forEach(function (comp) {
            if (comp.type === "@template") return; // its own nested instance owns its own state
            if (!belongsDirectlyToInstance(comp.id, namespacedInstanceId)) return;
            var el = document.querySelector('[data-id="' + comp.id + '"]');
            if (!el) return;
            if (comp.type === "@lit-component") {
                renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, paramState), makeCtx(screen, comp));
                return;
            }
            var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
            if (!typeDef || typeof typeDef.render !== "function") return;
            try {
                typeDef.render(el, interpolateProps(comp.props || {}, paramState), makeCtx(screen, comp));
            } catch (e) {
                el.textContent = "(render error: " + e.message + ")";
            }
        });
    }

    // Fires every "param-input" node belonging DIRECTLY to one instance
    // (Subflow-Input analogue — see LOGIC_NODE_KINDS in state.js) with that
    // instance's current param snapshot as msg.payload.
    function fireParamInputForInstance(screen, namespacedInstanceId, paramState) {
        screen.logic.nodes.filter(function (n) {
            return n.type === "param-input" && belongsDirectlyToInstance(n.id, namespacedInstanceId);
        }).forEach(function (n) {
            runLogicGraph(screen, n, cloneMsg({ payload: paramState }));
        });
    }

    // The one place a param's value actually changes post-mount — called
    // directly by the "set-template-param" node, AND recursively by
    // cascadeBoundChildParams below when a change needs to reach a nested
    // instance whose OWN paramValues declaratively bind (via {path}, see
    // resolveBindableValue) into this instance's params. Both origins get
    // identical treatment: apply, re-render this instance's interpolated
    // props, re-fire its own "param-input" node(s), then check whether any
    // DIRECT nested child needs to react too.
    function updateInstanceParam(screen, namespacedInstanceId, paramName, newValue) {
        var paramState = screen.__paramStates && screen.__paramStates[namespacedInstanceId];
        if (!paramState) {
            logicTrace("updateInstanceParam: unknown instance", namespacedInstanceId);
            return;
        }
        paramState[paramName] = newValue;
        reapplyInterpolationForInstance(screen, namespacedInstanceId, paramState);
        fireParamInputForInstance(screen, namespacedInstanceId, paramState);
        cascadeBoundChildParams(screen, namespacedInstanceId, paramState);
        // A changed param can change what a "{sparkplug:...{someParam}...}"
        // binding actually resolves to (see registerSparkplugBoundComponentsFrom's
        // own comment) — rebuild the index off the now-current paramState so
        // a later live tag update still finds the right component(s). Cheap
        // (string scans only) and rare compared to the tag-change rate this
        // index mainly optimizes for.
        registerSparkplugBoundComponentsFrom(screen);
    }

    // Finds this instance's own template, scans its DIRECT "@template"
    // children (deeper nesting is handled by this same function recursing
    // via updateInstanceParam, one level at a time — no chain-walking code,
    // just repeated one-hop resolution), and for each child param whose
    // paramValues is a {path} binding into `paramState` (this instance's,
    // i.e. that child's immediate parent), re-resolves it — if the resolved
    // value actually changed, pushes it down via updateInstanceParam, which
    // naturally re-renders/re-fires/cascades further for that child too.
    // This is what makes a live change to an OUTER param (e.g. from a
    // "set-template-param" targeting THIS instance) reach an already-mounted
    // nested instance's bound param without needing its own explicit wiring.
    function cascadeBoundChildParams(screen, namespacedInstanceId, paramState) {
        var instComp = findComponent(screen, namespacedInstanceId);
        if (!instComp) return;
        var template = findTemplateById(screen.__templates, instComp.templateId);
        if (!template) return;
        (template.components || []).forEach(function (childComp) {
            if (childComp.type !== "@template") return;
            var childNamespacedId = namespacedInstanceId + "::" + childComp.id;
            var childParamState = screen.__paramStates && screen.__paramStates[childNamespacedId];
            if (!childParamState) return; // defensive — should always be mounted if it's in template.components
            Object.keys(childComp.paramValues || {}).forEach(function (name) {
                var raw = childComp.paramValues[name];
                if (typeof raw !== "string" || raw.indexOf("{") === -1) return; // literal, not a binding — nothing to recompute
                var resolved = resolveBindableValue(raw, paramState);
                if (resolved !== childParamState[name]) {
                    updateInstanceParam(screen, childNamespacedId, name, resolved);
                }
            });
        });
    }

    // Deep clones messages so mutations in one downstream wire or branch
    // cannot corrupt parallel fan-out branches or parent events.
    function cloneMsg(msg, seen) {
        if (msg === null || typeof msg !== "object") return msg;
        try {
            if (typeof structuredClone === "function") {
                return structuredClone(msg);
            }
        } catch (e) { /* fallback if contains functions or non-serializables */ }
        try {
            return JSON.parse(JSON.stringify(msg));
        } catch (e) { /* fallback if circular or unstringifiable */ }

        seen = seen || new WeakMap();
        if (seen.has(msg)) return seen.get(msg);
        var copy = Array.isArray(msg) ? [] : {};
        seen.set(msg, copy);
        for (var key in msg) {
            if (Object.prototype.hasOwnProperty.call(msg, key)) {
                var val = msg[key];
                copy[key] = (val && typeof val === "object") ? cloneMsg(val, seen) : val;
            }
        }
        return copy;
    }

    // A genuine runaway cycle would otherwise recurse/reschedule forever
    // and pin the tab — see the matching comment in the plan file for why
    // this cap exists and why it's not exactly real Node-RED semantics.
    // IMPORTANT: `budget` is a single object threaded through the WHOLE
    // cascade — sync recursion AND every async Function node's .then()
    // continuation all increment the SAME budget.steps. An earlier version
    // used a fresh per-call counter (or a per-call queue with its own local
    // counter); since EVERY function node is now wrapped to support await
    // (see below) and therefore ALWAYS returns a promise, that meant each
    // async hop started a brand-new counter at 0 — a cycle running entirely
    // through async nodes never once reached the cap and looped forever.
    // Sharing one object is what actually bounds the total work across an
    // arbitrarily-async chain, not just within one synchronous burst.
    var LOGIC_MAX_STEPS = 2000;

    function continuePropagation(screen, node, outMsg, budget) {
        if (outMsg === null || outMsg === undefined) {
            logicTrace(node.type, node.id, "returned null/undefined - stopping here");
            return;
        }
        var outWires = ((screen.logic && screen.logic.wires) || []).filter(function (w) { return w.from === node.id; });
        logicTrace(node.type, node.id, "-> propagating to", outWires.length, "wire(s)");
        outWires.forEach(function (w) {
            var targetNode = findLogicNode(screen, w.to);
            if (!targetNode) return;
            // Real fan-out: every wire gets an isolated cloned message
            runLogicGraph(screen, targetNode, cloneMsg(outMsg), budget);
        });
    }

    // Real fan-in/fan-out: a node with two incoming wires from the same
    // cascade runs TWICE, once per arriving message, same as real Node-RED
    // (no per-firing dedup, which an earlier version had specifically to
    // stop cycles, but which also silently ate legitimate fan-in).
    // `budget` is created fresh only by the initial caller (fireLifecycle/
    // fireUiEvent/the inject timer below) and threaded through every
    // recursive/async step after that — see the big comment above.
    function runLogicGraph(screen, node, msg, budget) {
        budget = budget || { steps: 0 };
        if (!node) { logicTrace("runLogicGraph: a wire points at a node that no longer exists"); return; }
        if (++budget.steps > LOGIC_MAX_STEPS) {
            console.error("[nexa-logic] stopped after " + LOGIC_MAX_STEPS + " steps - this looks like an unbounded loop in the wiring");
            return;
        }
        logicTrace("running", node.type, node.id, "with msg =", msg);
        var outMsg = msg;
        if (node.type === "function") {
            try {
                // Function receives its own cloned copy so mutations don't escape
                var fnInput = cloneMsg(msg);
                var result = new Function("msg", "return (async function(){ " + (node.code || "return msg;") + " })();")(fnInput);
                result.then(function (resolved) {
                    continuePropagation(screen, node, resolved, budget);
                }).catch(function (e) {
                    console.error("[nexa-logic] function node " + node.id + " rejected:", e);
                });
                return; // propagation happens later via the .then() above
            } catch (e) {
                console.error("[nexa-logic] function node " + node.id + " threw:", e);
                return;
            }
        } else if (node.type === "ui-update") {
            runUiUpdateNode(screen, node, msg);
        } else if (node.type === "set-template-param") {
            // node.instanceId is already the correctly-namespaced target —
            // mountAndFlatten rewrites `instanceId` on every cloned logic
            // node exactly like `compId`, so a node authored inside a
            // template's own canvas targeting one of ITS nested instances
            // already carries the full path by the time it gets here.
            // updateInstanceParam also cascades into any DIRECT nested child
            // instance whose OWN paramValues declaratively bind (via {path})
            // into this one — see cascadeBoundChildParams.
            updateInstanceParam(screen, node.instanceId, node.paramName, msg && msg.payload);
        } else if (node.type === "debug") {
            console.log("[nexa-logic debug]", msg);
        } else if (node.type === "reload") {
            window.location.reload();
        } else if (node.type === "open-url") {
            var rawTarget = (msg && typeof msg.payload === "string" && msg.payload) || (msg && (msg.url || msg.endpoint)) || node.url;
            var mode = (msg && msg.mode) || node.mode || "replace";
            var newTab = (msg && typeof msg.newTab === "boolean") ? msg.newTab : node.newTab;
            if (rawTarget) {
                var target = String(rawTarget).trim();
                var finalUrl = target;

                if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(target) || /^\/\//.test(target)) {
                    finalUrl = target;
                } else if (/^(localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/.*)?$/i.test(target)) {
                    finalUrl = "http://" + target;
                } else if (/^www\./i.test(target) || /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(target)) {
                    finalUrl = "https://" + target;
                } else if (mode === "endpoint") {
                    if (target.charAt(0) === "/") {
                        var base = window.location.pathname.startsWith("/nexa") ? "/nexa" : "";
                        var sub = target.startsWith("/nexa") ? target.slice(5) : target;
                        finalUrl = base + sub;
                    } else {
                        var pathParts = window.location.pathname.split("/").filter(Boolean);
                        if (pathParts.length > 0) pathParts.pop();
                        pathParts.push(target);
                        finalUrl = "/" + pathParts.join("/");
                    }
                }

                if (newTab) window.open(finalUrl, "_blank");
                else window.location.href = finalUrl;
            }
        } else if (node.type === "layer-control") {
            // msg.payload (an array) wins over the node's own static
            // `states` field, same "msg overrides static config" convention
            // as open-url's msg.url/node.url above.
            var layerUpdates = (msg && Array.isArray(msg.payload)) ? msg.payload : (node.states || []);
            applyLayerControlUpdates(screen, layerUpdates);
        }
        continuePropagation(screen, node, outMsg, budget);
    }

    function fireLifecycle(screen, type) {
        if (!screen || !screen.logic) { logicTrace("fireLifecycle(" + type + "): no logic graph on this screen"); return; }
        var matches = screen.logic.nodes.filter(function (n) { return n.type === type; });
        logicTrace("fireLifecycle(" + type + "): " + matches.length + " matching node(s)");
        matches.forEach(function (n) { runLogicGraph(screen, n, cloneMsg({ payload: null })); });
    }

    function fireUiEvent(screen, compId, eventName, payload) {
        if (!screen || !screen.logic) { logicTrace("fireUiEvent: no logic graph on this screen"); return; }
        var matches = screen.logic.nodes.filter(function (n) { return n.type === "ui-event" && n.compId === compId && n.event === eventName; });
        logicTrace("fireUiEvent(" + eventName + ") for component " + compId + ": " + matches.length + " matching node(s)");
        matches.forEach(function (n) {
            var initialPayload = (payload !== undefined && payload !== null && typeof payload === "object") ? cloneMsg(payload) : payload;
            runLogicGraph(screen, n, cloneMsg({ event: eventName, payload: initialPayload }));
        });
    }

    function makeCtx(screen, comp) {
        return {
            // comp.id is already the full namespaced path by the time makeCtx
            // is called (buildComponentClone sets clone.id = namespacedId) —
            // exposed here so a "@lit-component"'s own this.mountTemplate(...)
            // call (see getNexaLitBase) can root its embedded template's
            // namespace under THIS instance's real path.
            namespace: comp.id,
            screen: screen,
            emit: function (eventName, payload) {
                console.log("[nexa] component event", comp.type, comp.id, eventName, payload);
                fireUiEvent(screen, comp.id, eventName, payload);
            },
            // Backs a Bindable Property's "Two-way binding" checkbox (see
            // getNexaLitBase's updated() above) — `comp` here is already the
            // namespaced CLONE mountAndFlatten pushed into
            // effectiveScreen.components, but .props is a shallow copy
            // (buildComponentClone), i.e. the SAME object reference as the
            // original screen.components[i].props, so this mutation is
            // visible wherever else that original comp is still read.
            setBindableValue: function (name, value) {
                comp.props = comp.props || {};
                comp.props[name] = value;
            }
        };
    }

    function buildComponentClone(comp, namespacedId) {
        var clone = {};
        for (var k in comp) {
            if (Object.prototype.hasOwnProperty.call(comp, k)) clone[k] = comp[k];
        }
        clone.id = namespacedId;
        return clone;
    }

    // Recursively mounts `comp` (from whichever surface currently owns it —
    // `ownerLayers` is that surface's own layers array, for visibility) into
    // `parentEl`, pushing a namespaced clone into `effectiveScreen.components`
    // and, for a "@template" instance, folding that template's own Logic
    // graph into `effectiveScreen.logic` (ids/compId/instanceId all rewritten
    // under this instance's namespace) before recursing into its children.
    // `visitedTemplateIds` is the defensive cycle guard — the palette's
    // drop-time templateContains() check (editor-side) is the primary
    // prevention; this is the backstop for hand-edited or future-buggy data
    // actually reaching a deployed page.
    function mountAndFlatten(parentEl, comp, ownerLayers, templates, namespace, visitedTemplateIds, effectiveScreen, paramState) {
        // Idempotent by namespace: a "remove"-state layer's component is
        // still registered here (so a Logic node can still find/re-mount it
        // by id) but skips the DOM below — and the Layer Control node (see
        // applyLayerControlUpdates/reconcileTopLevelLayerRender) can call
        // this SAME function again later to draw it fresh once its layer
        // comes back to show/hide, without double-pushing into
        // effectiveScreen.components or double-folding a "@template"
        // instance's Logic graph a second time.
        var namespacedComp = effectiveScreen.components.filter(function (c) { return c.id === namespace; })[0];
        var firstMount = !namespacedComp;
        if (firstMount) {
            namespacedComp = buildComponentClone(comp, namespace);
            // Captured so a LATER re-render (refreshComponentRender, driven
            // by an incoming Sparkplug delta rather than this initial
            // mount) can still correctly run template-param substitution
            // before sparkplug resolution — see refreshComponentRender's
            // own comment for the bug this fixes. A reference, not a copy:
            // updateInstanceParam mutates the SAME paramState object in
            // place, so this stays live without any extra sync.
            namespacedComp.__paramState = paramState;
            effectiveScreen.components.push(namespacedComp);
        }

        if (!shouldRenderLayerIn(ownerLayers, comp.layerId)) return;

        var el = document.createElement("div");
        el.setAttribute("data-id", namespace);
        el.style.position = "absolute";
        el.style.left = comp.x + "px";
        el.style.top = comp.y + "px";
        el.style.width = comp.w + "px";
        el.style.height = comp.h + "px";
        el.style.transform = getComponentTransform(comp);
        el.style.boxSizing = "border-box";
        el.style.display = isLayerVisibleIn(ownerLayers, comp.layerId) ? "" : "none";
        parentEl.appendChild(el);

        if (comp.type === "@template") {
            var template = findTemplateById(templates, comp.templateId);
            if (!template) {
                el.textContent = "(missing template)";
                return;
            }
            if (visitedTemplateIds.indexOf(comp.templateId) !== -1) {
                el.textContent = "(circular template reference: " + template.name + ")";
                return;
            }
            var innerVisited = visitedTemplateIds.concat([comp.templateId]);
            // This instance's own param state (Subflow env-vars analogue) —
            // computed fresh, NOT inherited from whatever paramState this
            // "@template" component itself was rendered under (there is no
            // cross-level inheritance — see resolveInstanceParamState).
            var instanceParamState = resolveInstanceParamState(comp, template, paramState);
            effectiveScreen.__paramStates[namespace] = instanceParamState;
            var scaleX = template.width ? (comp.w / template.width) : 1;
            var scaleY = template.height ? (comp.h / template.height) : 1;
            var inner = document.createElement("div");
            inner.style.position = "absolute";
            inner.style.left = "0";
            inner.style.top = "0";
            inner.style.width = template.width + "px";
            inner.style.height = template.height + "px";
            inner.style.transformOrigin = "0 0";
            inner.style.transform = "scale(" + scaleX + "," + scaleY + ")";
            el.appendChild(inner);

            if (firstMount) {
                (template.logic.nodes || []).forEach(function (n) {
                    var clone = {};
                    for (var k in n) clone[k] = n[k];
                    clone.id = namespace + "::" + n.id;
                    if (clone.compId !== undefined) clone.compId = namespace + "::" + clone.compId;
                    if (clone.instanceId !== undefined) clone.instanceId = namespace + "::" + clone.instanceId;
                    effectiveScreen.logic.nodes.push(clone);
                });
                (template.logic.wires || []).forEach(function (w) {
                    effectiveScreen.logic.wires.push({ id: namespace + "::" + w.id, from: namespace + "::" + w.from, to: namespace + "::" + w.to });
                });
            }

            (template.components || []).forEach(function (innerComp) {
                mountAndFlatten(inner, innerComp, template.layers, templates, namespace + "::" + innerComp.id, innerVisited, effectiveScreen, instanceParamState);
            });
            return;
        }

        if (comp.type === "@lit-component") {
            renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, paramState), makeCtx(effectiveScreen, namespacedComp));
            return;
        }

        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        if (typeDef && typeof typeDef.render === "function") {
            try {
                typeDef.render(el, interpolateProps(comp.props || {}, paramState), makeCtx(effectiveScreen, namespacedComp));
            } catch (e) {
                el.textContent = "(render error: " + e.message + ")";
            }
        } else {
            el.textContent = "(unknown component: " + comp.type + ")";
        }
    }

    // Backs the "layer-control" Logic node — applies a batch of
    // [{name, state}] updates (`state` one of "show"/"hide"/"remove") to
    // this screen's OWN top-level layers, by name. Deliberately does not
    // reach into a "@template" instance's own nested layers (their
    // `namespacedComp.id` contains "::") — see the "top-level only for now"
    // scope note on reconcileTopLevelLayerRender below.
    function applyLayerControlUpdates(effectiveScreen, updates) {
        if (!effectiveScreen.layers || !Array.isArray(updates)) return;
        var changed = false;
        updates.forEach(function (u) {
            if (!u || typeof u.name !== "string" || ["show", "hide", "remove"].indexOf(u.state) === -1) return;
            var layer = effectiveScreen.layers.filter(function (l) { return l.name === u.name; })[0];
            if (!layer || layer.state === u.state) return;
            layer.state = u.state;
            changed = true;
        });
        if (changed) reconcileTopLevelLayerRender(effectiveScreen);
    }

    // Unlike the editor (renderActiveScreen always empties and redraws the
    // whole artboard from scratch — see canvas-ui.js), a deployed page mounts
    // ONCE up front, so a layer's state changing later has to be reconciled
    // against the live DOM by hand: drop the DOM node for anything that just
    // became "remove", flip display for "hide"/"show", and re-mount (via
    // mountAndFlatten, which is idempotent by namespace — see its own
    // comment) anything coming OUT of "remove" that has no DOM node yet.
    //
    // Top-level only for now: only entries in effectiveScreen.components
    // with no "::" in their id (i.e. not living inside some "@template"
    // instance's own nested layers) are considered.
    function reconcileTopLevelLayerRender(effectiveScreen) {
        var artboard = document.getElementById("nexa-runtime-artboard");
        if (!artboard) return;
        effectiveScreen.components.forEach(function (comp) {
            if (comp.id.indexOf("::") !== -1) return;
            var el = document.querySelector('[data-id="' + comp.id + '"]');
            if (!shouldRenderLayerIn(effectiveScreen.layers, comp.layerId)) {
                if (el && el.parentNode) el.parentNode.removeChild(el);
                return;
            }
            if (!el) {
                mountAndFlatten(artboard, comp, effectiveScreen.layers, effectiveScreen.__templates, comp.id, [], effectiveScreen, undefined);
                return;
            }
            el.style.display = isLayerVisibleIn(effectiveScreen.layers, comp.layerId) ? "" : "none";
        });
    }

    function setUpInjectNodes(effectiveScreen) {
        // "Inject" nodes are sources with no incoming trigger (like
        // onload/ui-event) — they start their own timer instead, same idea
        // as Node-RED's own inject node's "repeat" option. This naturally
        // includes every instance's own (namespaced) inject nodes too, since
        // they're already folded into effectiveScreen.logic.nodes by the
        // time this runs.
        effectiveScreen.logic.nodes.filter(function (n) { return n.type === "inject"; }).forEach(function (n) {
            function getPayload() {
                var ptype = n.payloadType || (n.payload !== undefined ? "str" : "date");
                if (ptype === "json") {
                    try { return JSON.parse(n.payload); } catch (e) { return {}; }
                } else if (ptype === "num") {
                    return parseFloat(n.payload) || 0;
                } else if (ptype === "str") {
                    return n.payload !== undefined ? String(n.payload) : "Hello";
                }
                return Date.now();
            }
            function triggerInject() {
                var p = getPayload();
                var msg = { payload: cloneMsg(p) };
                if (typeof p === "object" && p !== null) {
                    if (p.text !== undefined) msg.text = p.text;
                } else {
                    msg.text = String(p);
                }
                runLogicGraph(effectiveScreen, n, cloneMsg(msg));
            }

            var intervalMs = parseInt(n.intervalMs, 10);
            if (isNaN(intervalMs)) intervalMs = 5000;
            if (intervalMs > 0) {
                setInterval(triggerInject, Math.max(100, intervalMs));
            }
            if (n.once) {
                setTimeout(triggerInject, Math.max(50, n.onceDelay || 100));
            }
        });
    }

    function mountScreen(screen, templates) {
        var artboard = document.getElementById("nexa-runtime-artboard");
        if (!artboard || !screen) return;

        // The flattened graph starts with the screen's own top-level Logic
        // (unnamespaced — these ids are already correct as authored) and
        // accumulates every "@template" instance's own graph as
        // mountAndFlatten recurses through screen.components below.
        var effectiveScreen = { components: [], logic: { nodes: [], wires: [] } };
        effectiveScreen.__templates = templates || [];
        // Top-level layers only (see applyLayerControlUpdates/
        // reconcileTopLevelLayerRender — the "Layer Control" node only
        // targets a screen's own layers, not one nested inside a
        // "@template" instance) — same array reference as `screen.layers`
        // so the Layer Control node's mutations are immediately visible
        // wherever else `screen` itself is still read.
        effectiveScreen.layers = screen.layers;
        // Keyed by namespaced instance id -> that instance's live param
        // state object (mutated in place by "set-template-param" — see
        // runLogicGraph — and read by every interpolated render() call).
        effectiveScreen.__paramStates = {};
        (screen.logic && screen.logic.nodes || []).forEach(function (n) { effectiveScreen.logic.nodes.push(n); });
        (screen.logic && screen.logic.wires || []).forEach(function (w) { effectiveScreen.logic.wires.push(w); });

        (screen.components || []).forEach(function (comp) {
            mountAndFlatten(artboard, comp, screen.layers, effectiveScreen.__templates, comp.id, [], effectiveScreen, undefined);
        });

        // Now that every component (including ones flattened in from
        // "@template" instances, at any nesting depth) exists in
        // effectiveScreen.components, find which ones are Sparkplug-bound
        // and start the live value stream that keeps them updated.
        registerSparkplugBoundComponentsFrom(effectiveScreen);
        setUpSparkplugLiveBinding();

        // Subflow-Input analogue: every instance's "param-input" node(s) get
        // their initial snapshot once, right after the whole tree is mounted
        // (so every instance, at any nesting depth, already exists) and
        // before onload/onrender — matches params being "just there" from
        // the start, the way Subflow env vars are, while still going through
        // the same node-wiring path a live update later uses.
        Object.keys(effectiveScreen.__paramStates).forEach(function (namespacedInstanceId) {
            fireParamInputForInstance(effectiveScreen, namespacedInstanceId, effectiveScreen.__paramStates[namespacedInstanceId]);
        });

        // A deployed page has no "open the tray"/"switch screens" moment the
        // way the editor does — the page load itself IS both of those at
        // once, so onload and onrender both fire here, once, for the WHOLE
        // flattened graph — which already includes every instance's own
        // onload/onrender nodes at any nesting depth, with no special-casing
        // needed: they're just more nodes of those types in one flat array.
        fireLifecycle(effectiveScreen, "onload");
        fireLifecycle(effectiveScreen, "onrender");
        window.addEventListener("beforeunload", function () { fireLifecycle(effectiveScreen, "onclose"); });

        setUpInjectNodes(effectiveScreen);
    }

    if (window.__NEXA_SCREEN__) {
        mountScreen(window.__NEXA_SCREEN__, window.__NEXA_TEMPLATES__ || []);
    }
})();
