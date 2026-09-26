// Mounts one deployed screen's component tree into #nexa-runtime-artboard,
// AND runs its screen.logic graph — this is the deployed-page counterpart
// of the Pages editor's own execution engine (runLogicGraph/fireLifecycle/
// fireUiEvent in src/), reimplemented here in plain vanilla JS (no jQuery —
// this file ships to public, unauthenticated pages) against the actual
// rendered DOM instead of the editor's canvas. Deliberately a plain,
// chrome-free version of the editor's own renderComponent()/isNodeVisible()
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
    // Node visibility — the same model as the editor (src/model/tree.js
    // effectiveVisibility): every node has `visibility` show / hide / remove,
    // the most restrictive of the node and its ancestors wins; "hide" still
    // gets a DOM node (display:none), "remove" does not. Screens saved before
    // the node tree (flat components + layers) are migrated by the screen
    // worker (lib/nexa-model.js), so this file only ever sees the tree.
    // A deployed page mounts once, so the Layer Control node (see
    // applyLayerControlUpdates) reconciles the live DOM by hand.
    var VIS_RANK = { show: 0, hide: 1, remove: 2 };
    function combineVisibility(inherited, node) {
        var own = (node && node.visibility) || "show";
        return VIS_RANK[own] > VIS_RANK[inherited || "show"] ? own : (inherited || "show");
    }
    function isContainerNode(node) {
        return !!node && (node.type === "@group" || node.type === "@frame");
    }
    // Every node of a surface's tree, parents before children. Does not enter
    // "@template" instances (their template is a surface of its own).
    function walkNodes(list, fn, parent) {
        (list || []).forEach(function (n) {
            fn(n, parent || null);
            if (isContainerNode(n)) walkNodes(n.children, fn, n);
        });
    }
    // Ids are unique per surface, so a container adds no namespace segment:
    // a child's namespace is its container's prefix (the template instance
    // path, "" at the screen) plus its own id.
    function childNamespace(parentNamespace, child) {
        var i = parentNamespace.lastIndexOf("::");
        return (i === -1 ? "" : parentNamespace.slice(0, i + 2)) + child.id;
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
    // loaded as window.NEXA_LIT by a separate <script src="/nexa/_sdk.js">
    // (see lib/screen-worker.js's renderScreenHtml), since this file can't
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
    function mountTemplateVisual(parentEl, comp, inheritedVis, templates, namespace, visitedTemplateIds, screenForCtx, paramState) {
        var vis = combineVisibility(inheritedVis, comp);
        if (vis === "remove") return;
        var el = document.createElement("div");
        el.setAttribute("data-id", namespace);
        el.style.position = "absolute";
        el.style.left = (comp.x || 0) + "px";
        el.style.top = (comp.y || 0) + "px";
        el.style.width = comp.w + "px";
        el.style.height = comp.h + "px";
        el.style.transform = getComponentTransform(comp);
        el.style.boxSizing = "border-box";
        el.style.display = vis === "show" ? "" : "none";
        parentEl.appendChild(el);

        if (isContainerNode(comp)) {
            (comp.children || []).forEach(function (child) {
                mountTemplateVisual(el, child, vis, templates, childNamespace(namespace, child), visitedTemplateIds, screenForCtx, paramState);
            });
            return;
        }

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
                mountTemplateVisual(inner, innerComp, "show", templates, namespace + "::" + innerComp.id, innerVisited, screenForCtx, instanceParamState);
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
            if (typeof typeDef.migrateProps === "function") namespacedComp.props = typeDef.migrateProps(namespacedComp.props || {});
            try {
                typeDef.render(el, interpolateProps(namespacedComp.props || {}, paramState), makeCtx(screenForCtx, namespacedComp));
            } catch (e) {
                el.textContent = "(render error: " + e.message + ")";
            }
        } else {
            el.textContent = "(unknown component: " + comp.type + ")";
            el.setAttribute("data-nexa-unknown", comp.type);
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
                    mountTemplateVisual(wrapper, fakeComp, "show", templates, namespace, [], this.__nexaScreen, undefined);
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

    // An SDK component's `actions` (defineComponent): the def's invoke()
    // runs the view's method of that name.
    function runComponentAction(screen, compId, action, params) {
        var comp = findComponent(screen, compId);
        var typeDef = comp && window.NEXA && window.NEXA.getComponent(comp.type);
        var el = comp && document.querySelector('[data-id="' + comp.id + '"]');
        if (!typeDef || typeof typeDef.invoke !== "function" || !el) {
            console.warn("[nexa-logic] action \"" + action + "\": component " + compId + " has no actions");
            return;
        }
        try { typeDef.invoke(el, action, params); } catch (e) { console.error("[nexa-logic] action \"" + action + "\" failed:", e); }
    }

    // Used directly by a plain "ui-update" node — applies a msg to one
    // concrete component's properties.
    function runUiUpdateNode(screen, node, msg) {
        // {action: "reset", payload: {...}} calls an SDK component's declared action
        if (msg && typeof msg === "object" && typeof msg.action === "string" && msg.action) {
            runComponentAction(screen, node.compId, msg.action, msg.payload);
            return;
        }
        var payloadProps = null;
        var comp = findComponent(screen, node.compId);
        var compProps = (comp && comp.props) || {};

        var rawPayload = msg;
        if (msg && typeof msg === "object" && !Array.isArray(msg) && ("payload" in msg)) {
            rawPayload = msg.payload;
        }

        // Key a primitive payload was merely GUESSED into (text/fill) — an
        // explicit top-level msg.<key> below must win over that guess, or
        // e.g. {payload: true, text: "OFF"} renders "true" instead of "OFF".
        var guessedKey = null;
        if (rawPayload !== undefined && rawPayload !== null) {
            if (typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
                payloadProps = Object.assign({}, rawPayload);
            } else {
                // Primitive payload: map intelligently based on component capabilities
                guessedKey = ("fill" in compProps && !("text" in compProps)) ? "fill" : "text";
                payloadProps = {};
                payloadProps[guessedKey] = rawPayload;
            }
        }

        // Top-level properties on msg (e.g. msg.fill, msg.stroke, msg.color, msg.text, msg.rotation, msg.x, msg.y, msg.w, msg.h)
        if (msg && typeof msg === "object") {
            var directPropKeys = ["fill", "stroke", "color", "text", "rotation", "x", "y", "w", "h", "opacity"];
            directPropKeys.forEach(function (k) {
                if (msg[k] !== undefined) {
                    payloadProps = payloadProps || {};
                    if (payloadProps[k] === undefined || k === guessedKey) payloadProps[k] = msg[k];
                }
            });
        }

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
            if (Array.isArray(v)) {
                // an SDK component's `multiple` input: an array of tag bindings
                if (!v.some(function (x) { return parseSparkplugBindingPath(x); })) continue;
                if (!out) out = Object.assign({}, props);
                out[k] = v.map(function (x) { var r = parseSparkplugBindingPath(x); return r ? formatSparkplugValue(r) : x; });
                continue;
            }
            if (typeof v !== "string") continue;
            var ref = parseSparkplugBindingPath(v);
            if (!ref) continue;
            if (!out) out = Object.assign({}, props);
            out[k] = formatSparkplugValue(ref);
        }
        return out || props;
    }

    // Write-back for the "Sparkplug Write"/"Sparkplug Write Multi" Logic
    // nodes (see runLogicGraph) — POSTs to lib/nexa-plugin.js's own
    // RUNTIME_PREFIX + "/_sparkplug-write" endpoint, which forwards to
    // nodes/nexa-sparkplug.js's writeMetrics() (a real DCMD/NCMD publish).
    // Returns a Promise so callers can chain onto Logic's own async node
    // convention (see the "function" node's .then()/.catch() above) rather
    // than needing their own callback plumbing.
    function sendSparkplugWrite(groupId, edgeNodeId, deviceId, metrics) {
        if (io.ws && io.opened && io.ws.readyState === 1) return sendSparkplugWriteIo(groupId, edgeNodeId, deviceId, metrics);
        return sendSparkplugWriteHttp(groupId, edgeNodeId, deviceId, metrics);
    }

    function sendSparkplugWriteHttp(groupId, edgeNodeId, deviceId, metrics) {
        return new Promise(function (resolve, reject) {
            if (typeof window.XMLHttpRequest !== "function") {
                reject(new Error("XMLHttpRequest not available in this environment"));
                return;
            }
            var prefix = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";
            var xhr = new XMLHttpRequest();
            xhr.open("POST", prefix + "/_sparkplug-write", true);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    var parsed = {};
                    try { parsed = JSON.parse(xhr.responseText); } catch (e) { /* tolerate a non-JSON 2xx */ }
                    if (parsed && parsed.ok === false) {
                        reject(new Error("Sparkplug write was not published (Nexa Sparkplug connection not connected?)"));
                        return;
                    }
                    resolve(parsed);
                } else {
                    reject(new Error("Sparkplug write failed: HTTP " + xhr.status));
                }
            };
            xhr.onerror = function () { reject(new Error("Sparkplug write request failed (network error)")); };
            xhr.send(JSON.stringify({ groupId: groupId, edgeNodeId: edgeNodeId, deviceId: deviceId || null, metrics: metrics }));
        });
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
            var isBound = false;
            var candidates = [];
            if (comp.sparkplugBinding && typeof comp.sparkplugBinding === "string") {
                candidates.push(comp.sparkplugBinding);
            }
            var props = comp.props || {};
            Object.keys(props).forEach(function (k) {
                var v = props[k];
                if (typeof v === "string") candidates.push(v);
                else if (Array.isArray(v)) v.forEach(function (x) { if (typeof x === "string") candidates.push(x); }); // `multiple` inputs
            });
            candidates.forEach(function (v) {
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
                var already = sparkplugBindingIndex[key].some(function (e) { return e.comp.id === comp.id; });
                if (!already) {
                    sparkplugBindingIndex[key].push({ screen: effectiveScreen, comp: comp, ref: ref });
                }
            });
            if (isBound) sparkplugBoundComponents.push({ screen: effectiveScreen, comp: comp });
        });
        ioSyncSubscription();
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
                if (!refreshedIds[entry.comp.id]) {
                    refreshedIds[entry.comp.id] = true;
                    refreshComponentRender(entry.screen, entry.comp);
                }
                var cached = sparkplugCache[key];
                var payload = {
                    value: cached ? cached.value : undefined,
                    type: cached ? cached.type : undefined,
                    isNull: cached ? cached.isNull : false,
                    timestamp: cached ? cached.timestamp : undefined,
                    tag: key,
                    metric: entry.ref ? entry.ref.metricName : (key.split("::")[3] || key),
                    groupId: entry.ref ? entry.ref.groupId : (key.split("::")[0] || ""),
                    edgeNodeId: entry.ref ? entry.ref.edgeNodeId : (key.split("::")[1] || ""),
                    deviceId: (entry.ref && entry.ref.deviceId) || (key.split("::")[2] || null),
                    properties: cached ? (cached.properties || null) : null,
                    metadata: cached ? (cached.metadata || null) : null
                };
                fireUiEvent(entry.screen, entry.comp.id, "sparkplug-change", payload);
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
                sparkplugCache[key] = {
                    value: m.value,
                    type: m.type,
                    isNull: m.isNull,
                    online: true,
                    timestamp: m.timestamp,
                    properties: m.properties || null,
                    metadata: m.metadata || null,
                    engUnit: m.engUnit || null
                };
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
                    sparkplugCache[groupId + "::" + edgeNodeId + "::" + "::" + name] = {
                        value: m.value,
                        type: m.type,
                        isNull: m.isNull,
                        online: edgeNode.online,
                        timestamp: m.timestamp,
                        properties: m.properties || null,
                        metadata: m.metadata || null,
                        engUnit: m.engUnit || null
                    };
                });
                Object.keys(edgeNode.devices || {}).forEach(function (deviceId) {
                    var device = edgeNode.devices[deviceId];
                    Object.keys(device.metrics || {}).forEach(function (name) {
                        var m = device.metrics[name];
                        sparkplugCache[groupId + "::" + edgeNodeId + "::" + deviceId + "::" + name] = {
                            value: m.value,
                            type: m.type,
                            isNull: m.isNull,
                            online: edgeNode.online && device.online,
                            timestamp: m.timestamp,
                            properties: m.properties || null,
                            metadata: m.metadata || null,
                            engUnit: m.engUnit || null
                        };
                    });
                });
            });
        });
    }

    // --- Nexa IO: EtherNet/IP-style implicit + explicit over ONE WebSocket
    // (server side + full wire format: lib/io/ioProtocol.js, lib/io/ioHub.js).
    //   implicit: binary frames every RPI with only the tags this page uses
    //             that changed; the server skips cycles for a backed-up
    //             client, so a slow link sees fewer but always-current values
    //   explicit: {"t":"w"} write -> {"t":"ack"} with a 5s timeout
    // Falls back to SSE + HTTP POST if the socket never opens (old browser,
    // proxy without WebSocket support) or when the page is opened with ?io=sse.
    var IO_WRITE_TIMEOUT_MS = 5000;
    var IO_V = { OFFLINE: 0, NULL: 1, FALSE: 2, TRUE: 3, INT32: 4, FLOAT64: 5, STRING: 6, JSON: 7 };
    var io = {
        ws: null, opened: false, hb: 1000, lastRx: 0, watchdog: null,
        layout: [],            // idx -> {key, type, engUnit, properties, metadata}
        keysSig: null, pending: {}, nextId: 1,
        everOpened: false, failures: 0, backoff: 1000, reconnectTimer: null
    };
    var ioDecoder = typeof window.TextDecoder === "function" ? new window.TextDecoder("utf-8") : null;

    function ioSubscribedKeys() { return Object.keys(sparkplugBindingIndex).sort(); }

    function ioSyncSubscription() {
        var keys = ioSubscribedKeys();
        var sig = keys.join("\n");
        if (sig === io.keysSig) return;
        io.keysSig = sig;
        if (io.ws && io.opened && io.ws.readyState === 1) io.ws.send(JSON.stringify({ t: "sub", keys: keys }));
    }

    function ioRpiMs() {
        var q = window.__NEXA_QUERY__ || {};
        var screen = window.__NEXA_SCREEN__ || {};
        return Number(q.rpi) || Number(screen.ioRpiMs) || 20;
    }

    function ioMarkLost() {
        if (!sparkplugConnectionLost) {
            sparkplugConnectionLost = true;
            refreshAllSparkplugBoundComponents();
        }
    }

    function ioRejectPending(reason) {
        Object.keys(io.pending).forEach(function (id) {
            var p = io.pending[id];
            clearTimeout(p.timer);
            p.reject(new Error(reason));
        });
        io.pending = {};
    }

    function sendSparkplugWriteIo(groupId, edgeNodeId, deviceId, metrics) {
        return new Promise(function (resolve, reject) {
            var id = io.nextId++;
            var timer = setTimeout(function () {
                delete io.pending[id];
                reject(new Error("Sparkplug write timed out (no ack within " + IO_WRITE_TIMEOUT_MS + "ms)"));
            }, IO_WRITE_TIMEOUT_MS);
            io.pending[id] = { resolve: resolve, reject: reject, timer: timer };
            io.ws.send(JSON.stringify({
                t: "w", id: id, g: groupId, e: edgeNodeId, d: deviceId || null,
                m: metrics.map(function (m) { return { n: m.name, v: m.value }; })
            }));
        });
    }

    function ioUtf8(bytes) {
        if (ioDecoder) return ioDecoder.decode(bytes);
        var s = "";
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    }

    // Binary implicit frame — layout documented in lib/io/ioProtocol.js.
    function ioApplyFrame(buffer) {
        var dv = new DataView(buffer);
        if (dv.getUint8(0) !== 1) return;
        var full = (dv.getUint8(1) & 1) === 1;
        var count = dv.getUint16(2, true);
        var baseTs = dv.getFloat64(4, true);
        var o = 12;
        var changed = [];
        for (var i = 0; i < count; i++) {
            var idx = dv.getUint16(o, true); o += 2;
            var tb = dv.getUint8(o); o += 1;
            var t = tb & 0x7F;
            var ts;
            if (tb & 0x80) { ts = baseTs + dv.getInt32(o, true); o += 4; }
            var value = null;
            if (t === IO_V.FALSE) value = false;
            else if (t === IO_V.TRUE) value = true;
            else if (t === IO_V.INT32) { value = dv.getInt32(o, true); o += 4; }
            else if (t === IO_V.FLOAT64) { value = dv.getFloat64(o, true); o += 8; }
            else if (t === IO_V.STRING) { var n = dv.getUint16(o, true); o += 2; value = ioUtf8(new Uint8Array(buffer, o, n)); o += n; }
            else if (t === IO_V.JSON) { var jn = dv.getUint32(o, true); o += 4; try { value = JSON.parse(ioUtf8(new Uint8Array(buffer, o, jn))); } catch (e) { value = null; } o += jn; }
            var L = io.layout[idx];
            if (!L) continue;
            sparkplugCache[L.key] = {
                value: value, type: L.type, isNull: t === IO_V.NULL, online: t !== IO_V.OFFLINE,
                timestamp: ts, properties: L.properties, metadata: L.metadata, engUnit: L.engUnit
            };
            changed.push(L.key);
        }
        if (full && sparkplugConnectionLost) {
            sparkplugConnectionLost = false;
            refreshAllSparkplugBoundComponents();
        }
        markSparkplugKeysDirty(changed);
    }

    function ioHandleText(msg) {
        if (msg.t === "opened") {
            io.opened = true;
            io.hb = Number(msg.hb) || 1000;
        } else if (msg.t === "layout") {
            (msg.add || []).forEach(function (a) {
                io.layout[a[0]] = { key: a[1], type: a[2], engUnit: a[3], properties: a[4], metadata: a[5] };
            });
        } else if (msg.t === "ack") {
            var p = io.pending[msg.id];
            if (!p) return;
            delete io.pending[msg.id];
            clearTimeout(p.timer);
            if (msg.ok) p.resolve({ ok: true });
            else p.reject(new Error("Sparkplug write was not published: " + (msg.err || "unknown error")));
        }
    }

    // Tears the socket down WITHOUT waiting for its close handshake (on a
    // dead link that can take minutes), then schedules a reconnect.
    function ioTeardown(reason, onGiveUp, prefix) {
        var ws = io.ws;
        if (!ws) return;
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try { ws.close(); } catch (e) { /* already closed */ }
        io.ws = null;
        io.opened = false;
        if (io.watchdog) { clearInterval(io.watchdog); io.watchdog = null; }
        ioRejectPending("Nexa IO connection lost (" + reason + ")");
        ioMarkLost();
        if (!io.everOpened && ++io.failures >= 3) { onGiveUp(); return; }
        io.reconnectTimer = setTimeout(function () { ioConnect(prefix, onGiveUp); }, io.backoff);
        io.backoff = Math.min(io.backoff * 2, 10000);
    }

    function ioConnect(prefix, onGiveUp) {
        var loc = window.location || {};
        var url = (loc.protocol === "https:" ? "wss:" : "ws:") + "//" + loc.host + prefix + "/_io";
        var ws;
        try { ws = new window.WebSocket(url); } catch (e) { onGiveUp(); return; }
        ws.binaryType = "arraybuffer";
        io.ws = ws;
        io.opened = false;
        ws.onopen = function () {
            io.everOpened = true;
            io.failures = 0;
            io.backoff = 1000;
            io.lastRx = Date.now();
            io.layout = [];
            var keys = ioSubscribedKeys();
            io.keysSig = keys.join("\n");
            ws.send(JSON.stringify({ t: "open", rpi: ioRpiMs(), keys: keys }));
            // Watchdog: the server sends at least an empty frame every hb ms.
            io.watchdog = setInterval(function () {
                if (Date.now() - io.lastRx > Math.max(3 * io.hb, 3000)) ioTeardown("watchdog timeout", onGiveUp, prefix);
            }, 500);
        };
        ws.onmessage = function (evt) {
            io.lastRx = Date.now();
            if (typeof evt.data === "string") {
                var msg;
                try { msg = JSON.parse(evt.data); } catch (e) { return; }
                ioHandleText(msg);
            } else {
                try { ioApplyFrame(evt.data); } catch (e) { /* truncated/malformed frame: next full or delta frame repairs it */ }
            }
        };
        ws.onclose = function () { ioTeardown("closed", onGiveUp, prefix); };
        ws.onerror = function () { /* onclose follows */ };
    }

    function setUpSparkplugLiveBinding() {
        var ioPrefix = window.__NEXA_RUNTIME_PREFIX__ || "/nexa";
        var forceSse = ((window.__NEXA_QUERY__ || {}).io === "sse");
        if (typeof window.WebSocket === "function" && !forceSse) {
            ioConnect(ioPrefix, setUpSparkplugSse);
            return;
        }
        setUpSparkplugSse();
    }

    function setUpSparkplugSse() {
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
        walkNodes(template.components, function (childComp) {
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
        } else if (node.type === "sparkplug-write") {
            // v1 SCOPE LIMIT: node.tag must be a fully concrete
            // "{sparkplug:group::edge::device::metric}" binding — unlike a
            // component's OWN sparkplug-bound prop (see
            // registerSparkplugBoundComponentsFrom), a Logic node cloned
            // into a nested "@template" instance carries no __paramState of
            // its own today, so a tag embedding "{someParam}" can't be
            // resolved here yet. Use a concrete tag, or place the write node
            // directly on the screen (not inside a template) for now.
            var writeRef = parseSparkplugBindingPath(node.tag);
            if (!writeRef) {
                console.error("[nexa-logic] sparkplug-write node " + node.id + ": \"" + node.tag + "\" is not a valid {sparkplug:...} binding");
                return;
            }
            sendSparkplugWrite(writeRef.groupId, writeRef.edgeNodeId, writeRef.deviceId, [{ name: writeRef.metricName, value: msg && msg.payload }])
                .then(function () { continuePropagation(screen, node, outMsg, budget); })
                .catch(function (e) { console.error("[nexa-logic] sparkplug-write node " + node.id + " failed:", e); });
            return; // propagation happens later via the .then() above
        } else if (node.type === "sparkplug-write-multi") {
            // Entirely msg-driven (no static per-tag config) — msg.writes:
            // [{tag: "{sparkplug:...}", value}, ...]. Grouped by (groupId,
            // edgeNodeId, deviceId) before sending, same grouping
            // @kufayeka/node-red-asset-engine's own sparkplug-edge-node.js
            // uses for an outgoing DDATA — a DCMD/NCMD is always scoped to
            // exactly one Edge Node/Device, so a batch spanning several
            // becomes one publish per group, not one per tag.
            var writes = (msg && Array.isArray(msg.writes)) ? msg.writes : [];
            if (!writes.length) {
                console.error("[nexa-logic] sparkplug-write-multi node " + node.id + ": msg.writes must be a non-empty array of {tag, value}");
                return;
            }
            var writeGroups = {};
            var invalidTags = [];
            writes.forEach(function (w) {
                var ref = w && parseSparkplugBindingPath(w.tag);
                if (!ref) { invalidTags.push(w && w.tag); return; }
                var key = ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "");
                if (!writeGroups[key]) writeGroups[key] = { groupId: ref.groupId, edgeNodeId: ref.edgeNodeId, deviceId: ref.deviceId, metrics: [] };
                writeGroups[key].metrics.push({ name: ref.metricName, value: w.value });
            });
            if (invalidTags.length) {
                console.error("[nexa-logic] sparkplug-write-multi node " + node.id + ": ignoring invalid tag(s):", invalidTags);
            }
            var groupKeys = Object.keys(writeGroups);
            if (!groupKeys.length) return;
            Promise.all(groupKeys.map(function (key) {
                var g = writeGroups[key];
                return sendSparkplugWrite(g.groupId, g.edgeNodeId, g.deviceId, g.metrics);
            })).then(function () {
                continuePropagation(screen, node, outMsg, budget);
            }).catch(function (e) {
                console.error("[nexa-logic] sparkplug-write-multi node " + node.id + " failed:", e);
            });
            return; // propagation happens later via the .then() above
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
            var initialMsg = { event: eventName, payload: initialPayload };
            if (payload && typeof payload === "object") {
                if (payload.value !== undefined) initialMsg.value = payload.value;
                if (payload.tag !== undefined) initialMsg.tag = payload.tag;
                if (payload.timestamp !== undefined) initialMsg.timestamp = payload.timestamp;
            }
            runLogicGraph(screen, n, cloneMsg(initialMsg));
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
            mode: "runtime",
            screen: screen,
            emit: function (eventName, payload) {
                //console.log("[nexa] component event", comp.type, comp.id, eventName, payload);
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
            },
            // A component's props arrive in render() already RESOLVED (a
            // "{sparkplug:...}" prop is replaced by its live value), so a
            // component that writes back to its OWN bound tag (e.g. the
            // Latch/Momentary buttons' readTag/writeTag) needs the raw
            // binding text — plus a way to write it without Logic wiring.
            getRawProps: function () {
                return comp.props || {};
            },
            // Generic tag write for SDK components (src/sdk/tags.js): the prop
            // holds "{provider:address}"; Sparkplug goes out the existing
            // write path, any other provider through its own write().
            writeTag: function (propKey, value) {
                var raw = (comp.props || {})[propKey];
                if (typeof raw === "string" && comp.__paramState) raw = resolveBindableValue(raw, comp.__paramState);
                var sref = parseSparkplugBindingPath(raw);
                if (sref) return sendSparkplugWrite(sref.groupId, sref.edgeNodeId, sref.deviceId, [{ name: sref.metricName, value: value }]);
                var sdk = window.NexaSDK;
                var t = sdk && sdk.parseTag(raw);
                if (!t) return Promise.reject(new Error("props." + propKey + " is not a tag: " + JSON.stringify(raw)));
                var provider = sdk.getTagProvider(t.provider);
                if (provider && typeof provider.write === "function") return Promise.resolve(provider.write(t.ref, value, t));
                return Promise.reject(new Error("tag provider \"" + t.provider + "\" can't write on a deployed page"));
            },
            writeSparkplugProp: function (propKey, value) {
                var raw = (comp.props || {})[propKey];
                if (typeof raw === "string" && comp.__paramState) raw = resolveBindableValue(raw, comp.__paramState);
                var ref = parseSparkplugBindingPath(raw);
                if (!ref) return Promise.reject(new Error("props." + propKey + " is not a valid {sparkplug:...} binding: " + JSON.stringify(raw)));
                return sendSparkplugWrite(ref.groupId, ref.edgeNodeId, ref.deviceId, [{ name: ref.metricName, value: value }]);
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

    // Recursively mounts `comp` (a node of whichever surface owns it;
    // `inheritedVis` is the effective visibility of its ancestors) into
    // `parentEl` (before `beforeEl` when given), pushing a namespaced clone
    // into `effectiveScreen.components` and, for a "@template" instance,
    // folding that template's own Logic graph into `effectiveScreen.logic`
    // (ids/compId/instanceId all rewritten under this instance's namespace)
    // before recursing into its children. An "@group" / "@frame" node is a
    // positioned element its children are mounted into (their x / y are
    // relative to it). `visitedTemplateIds` is the defensive cycle guard --
    // the palette's drop-time templateContains() check (editor-side) is the
    // primary prevention; this is the backstop for hand-edited data.
    function mountAndFlatten(parentEl, comp, inheritedVis, templates, namespace, visitedTemplateIds, effectiveScreen, paramState, beforeEl) {
        // Idempotent by namespace: a "remove"d node is still registered here
        // (so a Logic node can still find it by id) but gets no DOM -- and the
        // Layer Control node (see applyLayerControlUpdates) calls this SAME
        // function again later to draw it once it comes back to show/hide,
        // without double-pushing into effectiveScreen.components or
        // double-folding a "@template" instance's Logic graph.
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

        var vis = combineVisibility(inheritedVis, comp);
        if (vis === "remove") {
            // register what is inside too, so Logic can address it while removed
            if (isContainerNode(comp)) {
                walkNodes(comp.children, function (n) {
                    var ns = childNamespace(namespace, n);
                    if (effectiveScreen.components.some(function (c) { return c.id === ns; })) return;
                    var clone = buildComponentClone(n, ns);
                    clone.__paramState = paramState;
                    effectiveScreen.components.push(clone);
                });
            }
            return;
        }

        var el = document.createElement("div");
        el.setAttribute("data-id", namespace);
        el.style.position = "absolute";
        el.style.left = comp.x + "px";
        el.style.top = comp.y + "px";
        el.style.width = comp.w + "px";
        el.style.height = comp.h + "px";
        el.style.transform = getComponentTransform(comp);
        el.style.boxSizing = "border-box";
        el.style.display = vis === "show" ? "" : "none";
        if (beforeEl && beforeEl.parentNode === parentEl) parentEl.insertBefore(el, beforeEl);
        else parentEl.appendChild(el);

        if (isContainerNode(comp)) {
            el.setAttribute("data-nexa-container", comp.type);
            if (comp.name) el.setAttribute("data-name", comp.name);
            (comp.children || []).forEach(function (child) {
                mountAndFlatten(el, child, vis, templates, childNamespace(namespace, child), visitedTemplateIds, effectiveScreen, paramState);
            });
            return;
        }

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
                mountAndFlatten(inner, innerComp, "show", templates, namespace + "::" + innerComp.id, innerVisited, effectiveScreen, instanceParamState);
            });
            return;
        }

        if (comp.type === "@lit-component") {
            renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, paramState), makeCtx(effectiveScreen, namespacedComp));
            return;
        }

        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        if (typeDef && typeof typeDef.render === "function") {
            if (typeof typeDef.migrateProps === "function") namespacedComp.props = typeDef.migrateProps(namespacedComp.props || {});
            try {
                typeDef.render(el, interpolateProps(namespacedComp.props || {}, paramState), makeCtx(effectiveScreen, namespacedComp));
            } catch (e) {
                el.textContent = "(render error: " + e.message + ")";
            }
        } else {
            el.textContent = "(unknown component: " + comp.type + ")";
            el.setAttribute("data-nexa-unknown", comp.type);
        }
    }

    // Backs the "layer-control" Logic node -- applies a batch of
    // [{name, state}] updates (`state` one of "show"/"hide"/"remove") to the
    // nodes of this screen's OWN tree with that name (normally the groups a
    // pre-tree screen's layers were migrated to). Deliberately does not reach
    // into a "@template" instance's own tree.
    function applyLayerControlUpdates(effectiveScreen, updates) {
        var tree = effectiveScreen.__tree;
        if (!tree || !Array.isArray(updates)) return;
        var changed = false;
        updates.forEach(function (u) {
            if (!u || typeof u.name !== "string" || ["show", "hide", "remove"].indexOf(u.state) === -1) return;
            walkNodes(tree.components, function (n) {
                if (n.name !== u.name || (n.visibility || "show") === u.state) return;
                if (u.state === "show") delete n.visibility; else n.visibility = u.state;
                changed = true;
            });
        });
        if (changed) reconcileVisibility(effectiveScreen);
    }

    // Unlike the editor (renderActiveScreen redraws the whole artboard), a
    // deployed page mounts ONCE, so a visibility change is reconciled against
    // the live DOM: drop the element of anything now "remove"d (its subtree
    // goes with it), flip display for hide/show, and mount (in its stacking
    // place) anything coming back out of "remove".
    function reconcileVisibility(effectiveScreen) {
        var artboard = document.getElementById("nexa-runtime-artboard");
        if (!artboard) return;
        function elOf(ns) { return document.querySelector('[data-id="' + ns + '"]'); }
        (function visit(list, parentEl, inherited) {
            (list || []).forEach(function (node, i) {
                var vis = combineVisibility(inherited, node);
                var el = elOf(node.id);
                if (vis === "remove") {
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                    return;
                }
                if (!el) {
                    var before = null;
                    for (var j = i + 1; j < list.length && !before; j++) before = elOf(list[j].id);
                    mountAndFlatten(parentEl, node, inherited, effectiveScreen.__templates, node.id, [], effectiveScreen, undefined, before);
                    return;
                }
                el.style.display = vis === "show" ? "" : "none";
                if (isContainerNode(node)) visit(node.children, el, vis);
            });
        })(effectiveScreen.__tree.components, artboard, "show");
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
        // The screen's own tree -- what the Layer Control node changes the
        // visibility of (see applyLayerControlUpdates).
        effectiveScreen.__tree = screen;
        // Keyed by namespaced instance id -> that instance's live param
        // state object (mutated in place by "set-template-param" — see
        // runLogicGraph — and read by every interpolated render() call).
        effectiveScreen.__paramStates = {};
        (screen.logic && screen.logic.nodes || []).forEach(function (n) { effectiveScreen.logic.nodes.push(n); });
        (screen.logic && screen.logic.wires || []).forEach(function (w) { effectiveScreen.logic.wires.push(w); });

        (screen.components || []).forEach(function (comp) {
            mountAndFlatten(artboard, comp, "show", effectiveScreen.__templates, comp.id, [], effectiveScreen, undefined);
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

        // A component plugin that registers after the page was drawn (ES-module
        // plugins run after this script): render its placeholders for real now.
        if (window.NEXA && typeof window.NEXA.onRegister === "function") {
            window.NEXA.onRegister(function (id) {
                var pending = document.querySelectorAll('[data-nexa-unknown="' + id + '"]');
                Array.prototype.forEach.call(pending, function (el) {
                    var comp = findComponent(effectiveScreen, el.getAttribute("data-id"));
                    if (!comp) return;
                    el.removeAttribute("data-nexa-unknown");
                    el.textContent = "";
                    refreshComponentRender(effectiveScreen, comp);
                });
            });
        }
    }

    if (window.__NEXA_SCREEN__) {
        mountScreen(window.__NEXA_SCREEN__, window.__NEXA_TEMPLATES__ || []);
    }
})();
