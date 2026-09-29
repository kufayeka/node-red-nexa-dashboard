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
    // a node holding others: a group, a frame, or a component with slots (Tabs…: its
    // children are one frame per slot, drawn in its element — Tree.isSlotHost)
    function isContainerNode(node) {
        return isStructural(node) || isSlotHostNode(node);
    }
    function isStructural(node) {
        return !!node && (node.type === "@group" || node.type === "@frame");
    }
    function isSlotHostNode(node) {
        return !!node && node.slots === true && !isStructural(node);
    }
    // After a component with slots drew itself: its slot frames go into its element (light
    // DOM; its <slot>s place them). mountChild(hostEl, child) mounts one.
    function mountSlotFrames(el, comp, typeDef, mountChild) {
        if (!isSlotHostNode(comp) || !typeDef || typeof typeDef.slotHost !== "function") return;
        var host = typeDef.slotHost(el);
        if (!host) return;
        el.__childHost = host;
        host.__nexaNode = comp;
        (comp.children || []).forEach(function (child) { if (!child.slotUnused) mountChild(host, child); });
    }
    // Every node of a surface's tree, parents before children. Does not enter
    // "@template" instances (their template is a surface of its own).
    function walkNodes(list, fn, parent) {
        (list || []).forEach(function (n) {
            fn(n, parent || null);
            if (isContainerNode(n)) walkNodes(n.children, fn, n);
        });
    }
    // A node's box: plain absolute x / y / w / h — or, inside a frame with an
    // auto layout (or for a frame that hugs its content), what the layout
    // decides (window.NexaModel = lib/nexa-model-client.js, the same code as
    // the editor's). A frame also gets its own style and display.
    // `parentSize`: the screen's / a template's size for a root node, so its
    // constraints (Figma: left / right / center / scale…) become CSS too.
    function applyNodeBox(el, comp, parentNode, parentSize) {
        var M = window.NexaModel;
        var css = M ? M.boxCss(comp, parentNode, { constraints: true, parentSize: parentSize }) : { position: "absolute", left: (comp.x || 0) + "px", top: (comp.y || 0) + "px", width: comp.w + "px", height: comp.h + "px" };
        if (M && comp.type === "@frame") {
            var f = M.frameCss(comp, { scroll: true });
            Object.keys(f).forEach(function (k) { css[k] = f[k]; });
        }
        Object.keys(css).forEach(function (k) {
            if (typeof el.style.setProperty === "function") el.style.setProperty(k, css[k]);
            else el.style[k.replace(/-([a-z])/g, function (_m, c) { return c.toUpperCase(); })] = css[k];
        });
        if (M && comp.type === "@frame" && M.styleOf(comp).scrollbar === "hidden" && el.classList) { ensureNoScrollbarCss(); el.classList.add("nexa-no-scrollbar"); }
        var rotate = !M || M.canRotate(comp, parentNode);
        el.style.transform = rotate ? getComponentTransform(comp) : getComponentTransform({ flipH: comp.flipH, flipV: comp.flipV });
        el.style.boxSizing = "border-box";
    }

    // A template's design in `boxEl` (the instance's box, or a slide's cell): what its
    // children mount into. "constraints": the box itself — each node follows its
    // constraints against the design size; "scale" / "stretch": a layer of the design
    // size, scaled to the box (kept in step when the box resizes).
    function templateContentHost(boxEl, template, instance) {
        var M = window.NexaModel;
        var tw = Number(template.width) || 1, th = Number(template.height) || 1;
        var fitOf = M && M.templateContentFit ? function (w, h) { return M.templateContentFit(template, w, h, instance); } : function () { return null; };
        if (!fitOf(tw, th)) { boxEl.__nexaSize = { w: tw, h: th }; boxEl.__nexaSurface = true; return boxEl; }
        var layer = document.createElement("div");
        layer.style.position = "absolute";
        layer.style.left = "0";
        layer.style.top = "0";
        layer.style.width = tw + "px";
        layer.style.height = th + "px";
        layer.style.transformOrigin = "0 0";
        layer.__nexaSize = { w: tw, h: th };
        layer.__nexaSurface = true; // "on the screen" inside the template = on the template
        boxEl.appendChild(layer);
        function fit() {
            var bw = boxEl.clientWidth, bh = boxEl.clientHeight;
            if (!bw || !bh) return;
            var f = fitOf(bw, bh);
            layer.style.transform = f.transform;
            layer.style.left = f.left + "px";
            layer.style.top = f.top + "px";
        }
        fit();
        if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(boxEl);
        else (window.requestAnimationFrame || setTimeout)(fit);
        return layer;
    }

    function ensureNoScrollbarCss() {
        if (typeof document === "undefined" || !document.head || document.getElementById("nexa-no-scrollbar-css")) return;
        var s = document.createElement("style");
        s.id = "nexa-no-scrollbar-css";
        s.textContent = ".nexa-no-scrollbar::-webkit-scrollbar { display: none; } .nexa-no-scrollbar { scrollbar-width: none; }";
        document.head.appendChild(s);
    }

    // ---- "When scrolling": Fixed / Sticky ------------------------------------------------
    // A node its parent does not lay out stays put while its scroll container — the
    // nearest scrolling frame, else the page — scrolls: Fixed = where it is on the view
    // (a Bottom / Right constraint: that far from the view's bottom / right edge, a
    // footer); Sticky = it scrolls until it reaches the edge, then stays. Done with a
    // translate that undoes the scroll, so it works while the screen is scaled too
    // (display mode Fit width): the page's scroll is divided by the screen's scale.
    var pins = [], pinsQueued = false, pinsRemeasure = false, pinPageListener = false;
    function registerPin(el, comp) {
        pins.push({ el: el, comp: comp, base: el.style.transform || "" });
        if (!el.style.zIndex) el.style.zIndex = "20";
        if (!pinPageListener && typeof window.addEventListener === "function") {
            pinPageListener = true;
            window.addEventListener("scroll", function () { queuePins(false); }, { passive: true });
            window.addEventListener("resize", function () { queuePins(true); });
        }
        queuePins(true);
    }
    function queuePins(remeasure) {
        if (remeasure) pinsRemeasure = true;
        if (pinsQueued) return;
        pinsQueued = true;
        (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () {
            pinsQueued = false;
            var again = pinsRemeasure;
            pinsRemeasure = false;
            pins = pins.filter(function (p) { return p.el.isConnected; });
            if (again) pins.forEach(measurePin);
            pins.forEach(updatePin);
        });
    }
    function screenScale() {
        var art = document.getElementById("nexa-runtime-artboard");
        var w = art && art.offsetWidth;
        return w ? (art.getBoundingClientRect().width / w) || 1 : 1;
    }
    function scrollHostOf(el) {
        var art = document.getElementById("nexa-runtime-artboard");
        for (var e = el.parentElement; e && e !== art && e !== document.body; e = e.parentElement) {
            var cs = getComputedStyle(e);
            if (/(auto|scroll)/.test(cs.overflowY + " " + cs.overflowX)) return e;
        }
        return null; // the page
    }
    function measurePin(p) {
        p.el.style.transform = p.base;   // where it sits unscrolled
        p.host = scrollHostOf(p.el);
        if (p.host && !p.host.__nexaPinListener) {
            p.host.__nexaPinListener = true;
            p.host.addEventListener("scroll", function () { queuePins(false); }, { passive: true });
        }
        var c = window.NexaModel ? window.NexaModel.constraintsOf(p.comp) : { h: "left", v: "top" };
        p.bottom = c.v === "bottom";
        p.right = c.h === "right";
        p.k = screenScale();
        var r = p.el.getBoundingClientRect();
        if (p.host) {
            var hr = p.host.getBoundingClientRect();
            // its place in the host's content, in the host's own px
            p.x0 = (r.left - hr.left) / p.k + p.host.scrollLeft;
            p.y0 = (r.top - hr.top) / p.k + p.host.scrollTop;
        } else {
            p.x0 = r.left + (window.scrollX || 0);
            p.y0 = r.top + (window.scrollY || 0);
        }
    }
    function pinShift(mode, far, s, view, content, at0) {
        if (mode === "sticky") return Math.max(0, s - at0);
        // fixed: as far from the view's start (or its end) as from the content's
        return far ? Math.min(0, s + view - content) : s;
    }
    function updatePin(p) {
        var mode = p.comp.scrollBehavior, tx, ty;
        if (p.host) {
            var h = p.host;
            tx = pinShift(mode, p.right, h.scrollLeft, h.clientWidth, h.scrollWidth, p.x0);
            ty = pinShift(mode, p.bottom, h.scrollTop, h.clientHeight, h.scrollHeight, p.y0);
        } else {
            var d = document.documentElement;
            tx = pinShift(mode, p.right, window.scrollX || 0, window.innerWidth, d.scrollWidth, p.x0) / p.k;
            ty = pinShift(mode, p.bottom, window.scrollY || 0, window.innerHeight, d.scrollHeight, p.y0) / p.k;
        }
        p.el.style.transform = (tx || ty ? "translate(" + tx + "px, " + ty + "px) " : "") + p.base;
    }

    // Variables (src/model/scope.js): a scope is an object whose prototype is
    // the enclosing scope, so {name} interpolation (resolvePath reads
    // scope[name]) walks the whole lexical chain. The screen's scope is the
    // root; a container with variables opens one inside its parent's; a
    // "@template" instance's param state is a root of its own (the boundary).
    function makeScope(parent, variables) {
        if (window.NexaModel) return window.NexaModel.makeScope(parent, variables);
        var scope = Object.create(parent || null);
        (variables || []).forEach(function (v) { if (v && v.name) scope[v.name] = v.defaultValue; });
        return scope;
    }
    function hasVariables(node) {
        return !!(node && Array.isArray(node.variables) && node.variables.length);
    }

    // Ids are unique per surface, so a container adds no namespace segment:
    // a child's namespace is its container's prefix (the template instance
    // path, "" at the screen) plus its own id.
    function childNamespace(parentNamespace, child) {
        var i = parentNamespace.lastIndexOf("::");
        return (i === -1 ? "" : parentNamespace.slice(0, i + 2)) + child.id;
    }

    function findComponent(screen, id) {
        return compIndex(screen)[id];
    }
    // id -> component of a mounted screen, kept in step where components are
    // added / removed (mountAndFlatten, unmountRepeated): a lookup per node made
    // a big Populate quadratic.
    function compIndex(screen) {
        var ix = screen.__compById;
        if (!ix) {
            ix = Object.create(null);
            (screen.components || []).forEach(function (c) { if (!(c.id in ix)) ix[c.id] = c; });
            Object.defineProperty(screen, "__compById", { value: ix, writable: true, configurable: true });
        }
        return ix;
    }
    function addComponent(screen, comp) {
        screen.components.push(comp);
        var ix = compIndex(screen);
        if (!(comp.id in ix)) ix[comp.id] = comp;
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
        applyNodeBox(el, comp, parentEl.__nexaNode || null, parentEl.__nexaSize || null);
        el.style.display = vis === "show" ? (el.style.display || "") : "none";
        parentEl.appendChild(el);
        if (comp.type === "@frame" && comp.inSlot) el.setAttribute("slot", comp.inSlot);

        if (isStructural(comp)) {
            el.__nexaNode = comp;
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
            var inner = document.createElement("div");
            inner.style.position = "absolute";
            inner.style.left = "0";
            inner.style.top = "0";
            inner.style.width = "100%";
            inner.style.height = "100%";
            el.appendChild(inner);
            var contentHost = templateContentHost(inner, template, comp);
            (template.components || []).forEach(function (innerComp) {
                mountTemplateVisual(contentHost, innerComp, "show", templates, namespace + "::" + innerComp.id, innerVisited, screenForCtx, instanceParamState);
            });
            return;
        }

        var namespacedComp = buildComponentClone(comp, namespace);
        if (comp.type === "@lit-component") {
            renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, paramState, namespacedComp), makeCtx(screenForCtx, namespacedComp));
            return;
        }
        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        if (typeDef && typeof typeDef.render === "function") {
            if (el.__nexaPendingTimer) { clearTimeout(el.__nexaPendingTimer); el.__nexaPendingTimer = null; }
            if (typeof el.removeAttribute === "function") el.removeAttribute("data-nexa-unknown");
            if (typeof typeDef.migrateProps === "function") namespacedComp.props = typeDef.migrateProps(namespacedComp.props || {});
            try {
                typeDef.render(el, interpolateProps(namespacedComp.props || {}, paramState, namespacedComp), makeCtx(screenForCtx, namespacedComp));
                mountSlotFrames(el, comp, typeDef, function (host, child) {
                    mountTemplateVisual(host, child, vis, templates, childNamespace(namespace, child), visitedTemplateIds, screenForCtx, paramState);
                });
            } catch (e) {
                el.textContent = "(render error: " + e.message + ")";
            }
        } else {
            el.setAttribute("data-nexa-unknown", comp.type);
            if (typeof window !== "undefined" && window.requestAnimationFrame && typeof setTimeout === "function") {
                if (el.__nexaPendingTimer) clearTimeout(el.__nexaPendingTimer);
                el.__nexaPendingTimer = setTimeout(function () {
                    if (el.getAttribute("data-nexa-unknown") === comp.type && (!window.NEXA || !window.NEXA.getComponent(comp.type))) {
                        el.textContent = "(unknown component: " + comp.type + ")";
                    }
                }, 500);
            } else {
                el.textContent = "(unknown component: " + comp.type + ")";
            }
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
            renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, comp.__paramState, comp), makeCtx(screen, comp));
            return;
        }
        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        if (!typeDef || typeof typeDef.render !== "function") return;
        try {
            typeDef.render(el, interpolateProps(comp.props || {}, comp.__paramState, comp), makeCtx(screen, comp));
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
        // {action: "reset", payload: {...}} calls an SDK component's declared action; so does
        // the node's own "Run: <action>" (its parameters: msg.payload, else the node's)
        var act = msg && typeof msg === "object" && typeof msg.action === "string" && msg.action ? msg.action : node.action;
        if (act) {
            var pl = msg && typeof msg === "object" ? msg.payload : msg;
            var noPayload = pl === undefined || pl === null || pl === "" || (!msg.action && typeof pl === "number" && node.actionParams !== undefined);
            runComponentAction(screen, node.compId, act, noPayload ? node.actionParams : pl);
            return;
        }
        var payloadProps = null;
        var comp = findComponent(screen, node.compId);
        var compProps = (comp && comp.props) || {};
        if (comp) comp.__lastMsg = cloneMsg(msg && typeof msg === "object" ? msg : { payload: msg });
        // Props bound to the message ({msg.payload.speed}) take what they need from
        // it: no guessing (payload -> text / fill), and nothing overwrites them —
        // only the node's own configured fields apply, to the other props.
        if (propsMention(compProps, "{msg")) {
            var cfg = {};
            Object.keys(node.config || {}).forEach(function (k) {
                var bound = typeof compProps[k] === "string" && compProps[k].indexOf("{msg") !== -1;
                if (!bound) cfg[k] = node.config[k];
            });
            applyUiUpdateMulti(screen, node.compId, cfg, null, msg && msg.properties);
            refreshComponentRender(screen, comp);
            return;
        }

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
            if (ref) {
                if (!out) out = Object.assign({}, props);
                out[k] = formatSparkplugValue(ref);
                continue;
            }
            // tags inside a text (an expression): each one replaced by its value
            if (v.indexOf("{" + SPARKPLUG_BINDING_PREFIX) === -1) continue;
            var replaced = v.replace(EMBEDDED_TAG_RE, function (whole) {
                var r = parseSparkplugBindingPath(whole);
                if (!r) return whole;
                var val = formatSparkplugValue(r);
                return val === null || val === undefined ? "" : String(val);
            });
            if (replaced !== v) { if (!out) out = Object.assign({}, props); out[k] = replaced; }
        }
        return out || props;
    }
    // every tag binding inside a text
    var EMBEDDED_TAG_RE = /\{sparkplug:[^{}]+\}/g;
    function tagRefsIn(text) {
        if (typeof text !== "string") return [];
        var whole = parseSparkplugBindingPath(text);
        if (whole) return [whole];
        return (text.match(EMBEDDED_TAG_RE) || []).map(parseSparkplugBindingPath).filter(Boolean);
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
    // While a batch runs (a Populate mounting many copies), a rebuild is only
    // noted and done once at the end: one per copy made 1000 copies quadratic.
    var sparkplugIndexBatch = 0, sparkplugIndexPending = null;
    function batchSparkplugIndex(fn) {
        sparkplugIndexBatch++;
        try { return fn(); } finally {
            if (--sparkplugIndexBatch === 0 && sparkplugIndexPending) {
                var pending = sparkplugIndexPending;
                sparkplugIndexPending = null;
                registerSparkplugBoundComponentsFrom(pending);
            }
        }
    }
    function registerSparkplugBoundComponentsFrom(effectiveScreen) {
        if (sparkplugIndexBatch) { sparkplugIndexPending = effectiveScreen; return; }
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
                // a whole binding, or every tag inside a text (an expression)
                tagRefsIn(resolved).forEach(function (ref) {
                    isBound = true;
                    var key = sparkplugRefKey(ref);
                    if (!sparkplugBindingIndex[key]) sparkplugBindingIndex[key] = [];
                    var already = sparkplugBindingIndex[key].some(function (e) { return e.comp.id === comp.id; });
                    if (!already) {
                        sparkplugBindingIndex[key].push({ screen: effectiveScreen, comp: comp, ref: ref });
                    }
                });
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
    // diagnostics (read-only): the tags this page asks for — the browser console and the tests
    window.__nexaRuntime = Object.assign(window.__nexaRuntime || {}, { subscribedTags: ioSubscribedKeys });

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
            io.lastCheck = Date.now();
            io.watchdog = setInterval(function () {
                var now = Date.now();
                // this check itself ran late: the page was busy (e.g. mounting many
                // copies), not the link — the frames that arrived meanwhile are still
                // queued, so give them time instead of tearing down (every tag "???")
                if (now - io.lastCheck > 1500) io.lastRx = now;
                io.lastCheck = now;
                if (now - io.lastRx > Math.max(3 * io.hb, 3000)) ioTeardown("watchdog timeout", onGiveUp, prefix);
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
            if (resolved === undefined) return isMsgPath(whole[1]) ? "" : raw;
            // a type member with a source ({M101.Speed}): its binding, e.g. a tag
            if (resolved && typeof resolved.__nexaBinding === "string") return resolved.__nexaBinding;
            return resolved;
        }
        if (raw.indexOf("{") === -1) return raw;
        return raw.replace(INTERPOLATION_RE, function (wholeMatch, path) {
            var resolved = resolvePath(scope, path);
            if (resolved === undefined) return isMsgPath(path) ? "" : wholeMatch;
            if (resolved && typeof resolved.__nexaBinding === "string") return resolved.__nexaBinding;
            return resolved !== null && typeof resolved === "object" ? JSON.stringify(resolved) : String(resolved);
        });
    }
    // a {msg.*} binding with no message yet (or no such property) shows as empty, not as its text
    function isMsgPath(path) { return path === "msg" || path.indexOf("msg.") === 0 || path.indexOf("msg[") === 0; }

    // {path} interpolation on every string prop — an unresolvable path (the
    // root name isn't a declared param, or a later segment doesn't exist) is
    // left exactly as-is, so a literal brace in an unrelated prop, or a
    // typo, can never silently render as "undefined" or corrupt the string.
    // "{sparkplug:...}" bindings are ALSO always resolved here, regardless
    // of paramState — see resolveSparkplugProps's own comment for why (this
    // binding's source is the module-level sparkplugCache, not any one
    // component's enclosing template-instance scope).
    function interpolateProps(props, paramState, comp) {
        var withTemplateBindings = props;
        if (comp && (comp.__lastMsg || propsMention(props, "{msg"))) {
            // the Message source: {msg.payload.speed} reads the last message a Logic
            // flow sent to this component (an "Update Component" node)
            var withMsg = Object.create(paramState || null);
            withMsg.msg = comp.__lastMsg || {};
            paramState = withMsg;
        }
        if (paramState) {
            var out = {};
            Object.keys(props || {}).forEach(function (k) {
                var v = props[k];
                out[k] = (typeof v === "string" && v.indexOf("{") !== -1) ? resolveBindableValue(v, paramState) : v;
            });
            withTemplateBindings = out;
        }
        var resolved = resolveSparkplugProps(withTemplateBindings);
        // theme tokens ({token:colors.primary.solid}): their value in the current mode
        if (window.NexaModel && window.NexaModel.resolveTokenProps && propsMention(resolved, "{token:")) resolved = window.NexaModel.resolveTokenProps(resolved, THEME.theme, THEME.mode);
        // a bound prop with no value yet (no tag value, "???", no message): its fallback
        return props && props.__fallback && window.NexaModel && window.NexaModel.applyFallbacks ? window.NexaModel.applyFallbacks(props, resolved) : resolved;
    }

    function propsMention(props, text) {
        for (var k in props || {}) { if (typeof props[k] === "string" && props[k].indexOf(text) !== -1) return true; }
        return false;
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
        // on the app scope: an instance sees app variables and $route, not the screen around it
        var paramState = Object.create(CURRENT_APP_SCOPE || Object.prototype);
        // the template's own variables (an instance for a variable of a type / UDT)
        (template.variables || []).forEach(function (v) { if (v && v.name) paramState[v.name] = window.NexaModel ? window.NexaModel.variableValue(v) : v.defaultValue; });
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
            var scope = comp.__paramState || paramState;
            if (comp.type === "@lit-component") {
                renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, scope, comp), makeCtx(screen, comp));
                return;
            }
            var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
            if (!typeDef || typeof typeDef.render !== "function") return;
            try {
                typeDef.render(el, interpolateProps(comp.props || {}, scope, comp), makeCtx(screen, comp));
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

    // ---- App state (docs/STATE.md) ------------------------------------------------
    // Scope chain: { $route } -> the App (variables shared by every screen,
    // optionally persisted in localStorage / sessionStorage so they survive a
    // page change) -> the screen -> its containers. A template instance's root
    // sits on the App (the boundary hides the screen, not the app).
    // Every write goes through writeVariable: the value is set on the scope
    // that declares it, what sees it re-renders, persisted app variables are
    // saved, and "On Variable Change" nodes watching it fire.

    var PERSIST_PREFIX = "nexa:app:";
    var CURRENT_APP_SCOPE = null;
    function storeFor(kind) {
        try { return kind === "local" ? window.localStorage : kind === "session" ? window.sessionStorage : null; } catch (e) { return null; }
    }
    function makeRoute() {
        var loc = window.location || {};
        return { params: window.__NEXA_PARAMS__ || {}, query: window.__NEXA_QUERY__ || {}, path: loc.pathname || "", hash: (loc.hash || "").replace(/^#/, "") };
    }
    // the app scope, with persisted values restored (declared default otherwise)
    function makeAppScope(app) {
        var root = Object.create(null);
        root.$route = makeRoute();
        var scope = makeScope(root, app.variables);
        scope.__persist = {};
        (app.variables || []).forEach(function (v) {
            if (!v || !v.name || !storeFor(v.persist)) return;
            scope.__persist[v.name] = v.persist;
            try {
                var raw = storeFor(v.persist).getItem(PERSIST_PREFIX + v.name);
                if (raw !== null) scope[v.name] = JSON.parse(raw);
            } catch (e) { /* unreadable: the default stays */ }
        });
        return scope;
    }

    // The scope a Logic node means: scopeId "@app" = the app, "" = the surface
    // (the screen — or, for a node that came from a template, that instance's
    // root), otherwise the container that declares the variable.
    function resolveScope(screen, scopeId, nodeId) {
        var i = (nodeId || "").lastIndexOf("::");
        var instanceNs = i === -1 ? "" : nodeId.slice(0, i);
        var scopes = screen.__scopes || {};
        if (scopeId === "@app") return scopes["@app"];
        if (scopeId) return scopes[instanceNs ? instanceNs + "::" + scopeId : scopeId];
        return instanceNs ? screen.__paramStates && screen.__paramStates[instanceNs] : scopes[""];
    }
    // The scope in the chain from `scope` up that declares `name` (own property), or null.
    function ownerOf(scope, name) {
        var s = scope;
        while (s && !Object.prototype.hasOwnProperty.call(s, name)) s = Object.getPrototypeOf(s);
        return s;
    }

    function cloneValue(v) { return v !== null && typeof v === "object" ? cloneMsg(v) : v; }
    function sameValue(a, b) {
        if (a === b) return true;
        try { return a !== null && b !== null && typeof a === "object" && JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
    }

    // set / merge / append / remove / toggle / increment
    function applyOp(op, old, value) {
        switch (op) {
            case "merge": return Object.assign({}, old && typeof old === "object" && !Array.isArray(old) ? old : {}, value && typeof value === "object" ? value : {});
            case "append": return (Array.isArray(old) ? old.slice() : []).concat([value]);
            case "remove":
                if (Array.isArray(old)) return old.filter(function (x) { return !sameValue(x, value); });
                if (old && typeof old === "object") { var o = Object.assign({}, old); delete o[value]; return o; }
                return old;
            case "toggle": return !old;
            case "increment": {
                // by the value when it is a number, by 1 otherwise (e.g. a payload that is data)
                var by = typeof value === "number" ? value : (typeof value === "string" && value.trim() !== "" && isFinite(Number(value)) ? Number(value) : 1);
                return (Number(old) || 0) + by;
            }
            default: return value;
        }
    }

    function writeVariable(screen, scope, name, value, op) {
        if (!scope || typeof name !== "string" || !name) return false;
        var old = scope[name];
        var next = applyOp(op || "set", old, value);
        // the colour mode: light / dark / system (the viewer's setting), kept for this browser
        if (scope === CURRENT_APP_SCOPE && name === "$colorMode") next = applyColorMode(screen, next, true);
        scope[name] = next;
        if (scope.__persist && scope.__persist[name]) {
            try { storeFor(scope.__persist[name]).setItem(PERSIST_PREFIX + name, JSON.stringify(next)); } catch (e) { logicTrace("persist failed", name, e); }
        }
        refreshScope(screen, scope);
        if (!sameValue(old, next)) notifyWatchers(screen, scope, name, next, old);
        return true;
    }

    // "On Variable Change": fires with { payload: new, previous: old, variable }
    function notifyWatchers(screen, scope, name, next, old) {
        (screen.__varWatchers || []).slice().forEach(function (w) {
            if (w.scope === scope && w.name === name) { try { w.fn(next, old); } catch (e) { logicTrace("watcher failed", name, e); } }
        });
        (screen.logic && screen.logic.nodes || []).forEach(function (n) {
            if (n.type !== "on-variable-change" || n.name !== name) return;
            if (resolveScope(screen, n.scope, n.id) !== scope) return;
            runLogicGraph(screen, n, { payload: cloneValue(next), previous: cloneValue(old), variable: name });
        });
    }

    // a value from msg: "payload" | "static" | "msg" (node.msgPath, e.g. payload.data.items)
    function valueFromMsg(node, msg) {
        if (node.valueSource === "static") return cloneValue(node.value);
        if (node.valueSource === "msg") return resolvePath(msg, node.msgPath || "payload");
        return msg && msg.payload;
    }
    function setMsgPath(msg, path, value) {
        var segs = String(path || "payload").match(/[^.[\]]+/g) || ["payload"];
        var cur = msg;
        for (var i = 0; i < segs.length - 1; i++) {
            if (cur[segs[i]] === null || typeof cur[segs[i]] !== "object") cur[segs[i]] = {};
            cur = cur[segs[i]];
        }
        cur[segs[segs.length - 1]] = value;
    }

    // Backs the "set-variable" Logic node.
    function setVariable(screen, node, msg) {
        var scope = resolveScope(screen, node.scope, node.id);
        if (!scope) { logicTrace("set-variable: no such scope", node.scope, node.name); return; }
        writeVariable(screen, scope, node.name, valueFromMsg(node, msg), node.op);
    }

    // ---- What a Function node gets besides msg: vars, route, storage, cookies, http
    function makeBrowserApi() {
        function jsonStore(kind) {
            return {
                get: function (k) { try { var r = storeFor(kind).getItem(k); return r === null ? undefined : JSON.parse(r); } catch (e) { try { return storeFor(kind).getItem(k); } catch (e2) { return undefined; } } },
                set: function (k, v) { try { storeFor(kind).setItem(k, JSON.stringify(v)); } catch (e) { /* blocked */ } },
                remove: function (k) { try { storeFor(kind).removeItem(k); } catch (e) { /* blocked */ } }
            };
        }
        var cookies = {
            get: function (name) {
                var parts = (document.cookie || "").split(/;\s*/);
                for (var i = 0; i < parts.length; i++) {
                    var eq = parts[i].indexOf("=");
                    if (eq !== -1 && decodeURIComponent(parts[i].slice(0, eq)) === name) return decodeURIComponent(parts[i].slice(eq + 1));
                }
                return undefined;
            },
            // opts: { days, maxAge (s), path ("/"), sameSite ("Lax"), secure, domain }
            set: function (name, value, opts) {
                opts = opts || {};
                var c = encodeURIComponent(name) + "=" + encodeURIComponent(value === undefined || value === null ? "" : String(value));
                if (opts.maxAge !== undefined) c += "; Max-Age=" + Number(opts.maxAge);
                else if (opts.days !== undefined) c += "; Expires=" + new Date(Date.now() + Number(opts.days) * 864e5).toUTCString();
                c += "; Path=" + (opts.path || "/");
                if (opts.domain) c += "; Domain=" + opts.domain;
                c += "; SameSite=" + (opts.sameSite || "Lax");
                if (opts.secure) c += "; Secure";
                document.cookie = c;
            },
            remove: function (name, opts) { cookies.set(name, "", Object.assign({}, opts || {}, { maxAge: 0 })); }
        };
        // fetch with JSON in / out: resolves { ok, status, data, headers }, rejects only on a network error / timeout
        function request(method, url, body, opts) {
            opts = opts || {};
            var headers = Object.assign({}, opts.headers || {});
            var init = { method: method, headers: headers, credentials: opts.credentials || "same-origin" };
            if (body !== undefined && body !== null && method !== "GET" && method !== "HEAD") {
                if (typeof body === "string" || (typeof FormData !== "undefined" && body instanceof FormData)) init.body = body;
                else { init.body = JSON.stringify(body); if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json"; }
            }
            var ctrl = typeof AbortController === "function" ? new AbortController() : null;
            if (ctrl) init.signal = ctrl.signal;
            var timer = ctrl && opts.timeout ? setTimeout(function () { ctrl.abort(); }, opts.timeout) : null;
            return fetch(url, init).then(function (res) {
                var hdrs = {};
                if (res.headers && res.headers.forEach) res.headers.forEach(function (v, k) { hdrs[k] = v; });
                var type = (hdrs["content-type"] || "");
                return (type.indexOf("json") !== -1 ? res.json() : res.text()).catch(function () { return null; }).then(function (data) {
                    return { ok: res.ok, status: res.status, data: data, headers: hdrs };
                });
            }).finally(function () { if (timer) clearTimeout(timer); });
        }
        var http = { request: request };
        ["get", "delete", "head"].forEach(function (m) { http[m] = function (url, opts) { return request(m.toUpperCase(), url, undefined, opts); }; });
        ["post", "put", "patch"].forEach(function (m) { http[m] = function (url, body, opts) { return request(m.toUpperCase(), url, body, opts); }; });
        return { storage: { local: jsonStore("local"), session: jsonStore("session") }, cookies: cookies, http: http };
    }
    var BROWSER_API = makeBrowserApi();

    // A string of a web / data node ({line}, {$route.params.id}, {msg.payload.id}):
    // resolved against the node's scope chain, with the message on top.
    function bindText(screen, node, msg, text) {
        if (typeof text !== "string" || text.indexOf("{") === -1) return text;
        var scope = Object.create(resolveScope(screen, "", node.id) || null);
        scope.msg = msg || {};
        return resolveBindableValue(text, scope);
    }
    function parseHeaders(raw, screen, node, msg) {
        var h = {};
        if (!raw) return h;
        var obj = raw;
        if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch (e) { return h; } }
        Object.keys(obj || {}).forEach(function (k) { h[k] = String(bindText(screen, node, msg, String(obj[k]))); });
        return h;
    }

    // "http-request": method / url / headers / body (msg.payload) -> msg.payload = response
    // data, msg.statusCode, msg.headers, msg.ok (and msg.error on a network error / timeout).
    // msg.url / msg.method / msg.headers override the node's.
    function runHttpNode(screen, node, msg, done) {
        var method = String((msg && msg.method) || node.method || "GET").toUpperCase();
        var url = bindText(screen, node, msg, (msg && typeof msg.url === "string" && msg.url) || node.url || "");
        var headers = Object.assign(parseHeaders(node.headers, screen, node, msg), (msg && msg.headers && typeof msg.headers === "object") ? msg.headers : {});
        var body = node.body === "none" || method === "GET" || method === "HEAD" ? undefined
            // "binding": a text / binding resolved in the node's scope + msg — e.g. {item} in a repeated card
            : node.body === "binding" ? bindText(screen, node, msg, node.bodyText || "")
            : (msg ? msg.payload : undefined);
        var out = cloneMsg(msg || {});
        if (!url) { out.error = "no URL"; out.ok = false; done(out); return; }
        BROWSER_API.http.request(method, String(url), body, { headers: headers, timeout: Number(node.timeout) || 0, credentials: node.credentials || undefined })
            .then(function (res) {
                out.payload = res.data; out.statusCode = res.status; out.headers = res.headers; out.ok = res.ok;
                if (!res.ok) out.error = "HTTP " + res.status;
                else delete out.error;
            }, function (e) {
                out.ok = false; out.statusCode = 0; out.error = (e && e.name === "AbortError") ? "timeout" : String((e && e.message) || e);
            })
            .then(function () { done(out); });
    }

    // "storage": local / session storage, get / set / remove a key
    function runStorageNode(screen, node, msg) {
        var store = BROWSER_API.storage[node.store === "session" ? "session" : "local"];
        var key = String(bindText(screen, node, msg, node.key || ""));
        var out = cloneMsg(msg || {});
        if (!key) return out;
        if (node.action === "set") store.set(key, node.valueSource === "static" ? node.value : (msg && msg.payload));
        else if (node.action === "remove") store.remove(key);
        else setMsgPath(out, node.target || "payload", store.get(key));
        return out;
    }

    // "cookie": get / set / remove (for a login / session token and the like)
    function runCookieNode(screen, node, msg) {
        var name = String(bindText(screen, node, msg, node.name || ""));
        var out = cloneMsg(msg || {});
        if (!name) return out;
        var opts = { path: node.path || "/", sameSite: node.sameSite || "Lax", secure: !!node.secure };
        if (node.days !== undefined && node.days !== "" && node.days !== null) opts.days = Number(node.days);
        if (node.action === "set") BROWSER_API.cookies.set(name, node.valueSource === "static" ? node.value : (msg && msg.payload), opts);
        else if (node.action === "remove") BROWSER_API.cookies.remove(name, opts);
        else setMsgPath(out, node.target || "payload", BROWSER_API.cookies.get(name));
        return out;
    }

    // ---- Repeater: the "Populate" Logic node --------------------------------------
    // Fills a container (a row / column / grid frame) with a template, one card
    // per item of an array (msg.payload, a msg property or a fixed value). Each
    // card is an instance of the template with the params `item` (its object)
    // and `index`, so everything inside binds {item.name} and the card's own
    // Logic (Buy -> HTTP Request, body {item}) runs per card. The container
    // keeps the list: by key (node.key, e.g. "id") a card is updated in place,
    // not re-created. Modes: replace (keyed: kept / updated / added / removed,
    // then ordered), append, prepend, upsert, remove, clear.
    function repeatList(screen, frameNs) {
        screen.__lists = screen.__lists || {};
        return screen.__lists[frameNs] || (screen.__lists[frameNs] = { entries: [], seq: 0 });
    }
    // What identifies an item: an object's key field (node.key, e.g. "id"); a string / number
    // is its own key (an image URL); anything else gets a new one. `seen` (one run of a
    // Populate): the same key twice in the items -> "key~2", so both get a copy.
    function repeatKeyOf(node, item, list, seen) {
        var k;
        if (item !== null && typeof item === "object") k = node.key ? resolvePath(item, node.key) : undefined;
        else if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") k = item;
        var key = k === undefined || k === null || k === "" ? "auto" + (++list.seq) : String(k);
        if (seen) {
            if (seen[key]) { var n = 2; while (seen[key + "~" + n]) n++; key = key + "~" + n; }
            seen[key] = true;
        }
        return key;
    }
    function repeatNs(frameNs, key) { return frameNs + "#" + String(key).replace(/[^\w-]/g, "_"); }
    function elById(id) { return document.querySelector('[data-id="' + id + '"]'); }
    function mountRepeated(screen, node, frameNs, frameEl, entry, box) {
        var t = findTemplateById(screen.__templates, node.template);
        if (!t) { logicTrace("populate: no such template", node.template); return false; }
        var frame = findComponent(screen, frameNs);
        var scope = (screen.__scopes || {})[frameNs] || (frame && frame.__paramState) || (screen.__scopes || {})[""];
        var inst = { id: entry.ns, type: "@template", templateId: t.id, x: 0, y: 0, w: t.width || 100, h: t.height || 40,
            paramValues: { item: entry.item, index: entry.index } };
        // the item also goes into the template param the node names (e.g. "param1": {param1.data1})
        if (node.itemParam && node.itemParam !== "item") inst.paramValues[node.itemParam] = entry.item;
        // its size on the page: the template's own setting (fixed / fill, min / max)
        var sz = sizingOf(t, node);
        var lcFill = {};
        if (sz.w === "fill") lcFill.w = "fill";
        if (sz.h === "fill") lcFill.h = "fill";
        if (box) { inst.x = box.x; inst.y = box.y; if (box.w) inst.w = box.w; if (box.h) inst.h = box.h; }
        if (lcFill.w || lcFill.h) inst.layoutChild = lcFill;
        ["minW", "maxW", "minH", "maxH"].forEach(function (k) { if (sz[k] !== "" && sz[k] !== undefined && isFinite(Number(sz[k]))) inst[k] = Number(sz[k]); });
        var nodesBefore = (screen.logic.nodes || []).length;
        mountAndFlatten(frameEl, inst, "show", screen.__templates, entry.ns, [], screen, scope);
        applyTeleports(screen);
        // what the copy's own Logic starts with (its onload / onrender / params-change)
        var pre = entry.ns + "::";
        fireParamInputForInstance(screen, entry.ns, screen.__paramStates[entry.ns]);
        (screen.logic.nodes || []).slice(nodesBefore).forEach(function (n) {
            if (n.id.indexOf(pre) === 0 && (n.type === "onload" || n.type === "onrender")) runLogicGraph(screen, n, { payload: null });
        });
        entry.mounted = true;
        return true;
    }
    // ---- A carousel (a frame with layout mode "carousel"; src/model/layout.js) ---------
    // The frame keeps its box and look; a track inside it holds the slides (its
    // children, or a Populate's copies) and scrolls with CSS scroll-snap, so touch
    // and trackpads swipe natively. Arrows, dots, autoplay, keys, a mouse drag, a
    // fade; the current slide is two-way with a variable (layout.carousel.index)
    // and "On Slide Change" (a ui-event on the frame) fires with msg.index / item.
    var CAROUSEL_CSS = [
        ".nexa-carousel-track::-webkit-scrollbar { display: none; }",
        ".nexa-carousel-track { outline: none; }",
        ".nexa-carousel-arrow { position: absolute; z-index: 3; width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;",
        "  background: rgba(255,255,255,0.85); color: #1e293b; box-shadow: 0 1px 4px rgba(0,0,0,0.25); font: 18px/32px sans-serif; padding: 0; text-align: center; }",
        ".nexa-carousel-arrow:disabled { opacity: 0.35; cursor: default; }",
        ".nexa-carousel-dots { position: absolute; z-index: 3; left: 0; right: 0; bottom: 8px; display: flex; justify-content: center; gap: 6px; pointer-events: none; }",
        ".nexa-carousel-dots.nexa-v { left: auto; right: 8px; top: 0; bottom: 0; flex-direction: column; align-items: center; }",
        ".nexa-carousel-dot { pointer-events: auto; width: 8px; height: 8px; border-radius: 50%; border: none; padding: 0; cursor: pointer; background: rgba(255,255,255,0.6); box-shadow: 0 0 0 1px rgba(0,0,0,0.2); }",
        ".nexa-carousel-dot.nexa-on { background: #fff; transform: scale(1.3); }",
        ".nexa-carousel-dots.nexa-count { left: 50%; right: auto; transform: translateX(-50%); padding: 2px 10px; border-radius: 10px; background: rgba(0,0,0,0.55); color: #fff; font: 12px/18px sans-serif; pointer-events: none; }"
    ].join("\n");
    function ensureCarouselCss() {
        if (document.getElementById("nexa-carousel-css") || !document.head) return;
        var s = document.createElement("style");
        s.id = "nexa-carousel-css";
        s.textContent = CAROUSEL_CSS;
        document.head.appendChild(s);
    }
    function setupCarousel(screen, el, comp, ns, scope, c) {
        ensureCarouselCss();
        var M = window.NexaModel, L = M.layoutOf(comp);
        var horizontal = c.direction !== "vertical", fade = c.transition === "fade";
        // the frame: its box and look only; the track takes the layout
        if (el.style.display !== "none") el.style.display = "block";
        el.style.padding = "0";
        // the longhands first: clearing one after the shorthand would un-clip
        el.style.overflowX = "";
        el.style.overflowY = "";
        el.style.overflow = "hidden";
        if (!el.style.position || el.style.position === "static") el.style.position = "relative";
        var track = document.createElement("div");
        track.className = "nexa-carousel-track";
        track.setAttribute("tabindex", "0");
        var tcss = M.carouselTrackCss(comp, true);
        tcss.position = "relative"; tcss.width = "100%"; tcss.height = "100%"; tcss["box-sizing"] = "border-box";
        tcss.padding = L.padding.t + "px " + L.padding.r + "px " + L.padding.b + "px " + L.padding.l + "px";
        if (!c.swipe) { tcss.overflow = "hidden"; tcss["overflow-x"] = "hidden"; tcss["overflow-y"] = "hidden"; }
        Object.keys(tcss).forEach(function (k) { if (typeof track.style.setProperty === "function") track.style.setProperty(k, tcss[k]); else track.style[k] = tcss[k]; });
        el.appendChild(track);

        var st = { index: 0, paused: false, touching: false, ready: false };
        var owner = c.index ? ownerOf(scope, c.index) : null;
        if (owner) st.index = Math.max(0, Math.floor(Number(owner[c.index]) || 0));

        function slides() { return Array.prototype.filter.call(track.children, function (e) { return e.getAttribute && e.getAttribute("data-id") && e.style.display !== "none"; }); }
        function pages() { var n = slides().length; return fade ? Math.max(1, n) : Math.max(1, n - Math.ceil(c.perView) + 1); }
        function offsetOf(s) { var first = slides()[0]; return first ? (horizontal ? s.offsetLeft - first.offsetLeft : s.offsetTop - first.offsetTop) : 0; }
        function scrollPos() { return horizontal ? track.scrollLeft : track.scrollTop; }
        function clamp(i) {
            var n = pages();
            if (c.loop) return ((i % n) + n) % n;
            return Math.max(0, Math.min(n - 1, i));
        }
        function applyFade(i) {
            slides().forEach(function (s, k) {
                s.style.transition = "opacity 0.45s ease";
                s.style.opacity = k === i ? "1" : "0";
                s.style.pointerEvents = k === i ? "" : "none";
                s.style.zIndex = k === i ? "1" : "0";
            });
        }
        function show(i, smooth) {
            if (fade) { applyFade(i); return; }
            var s = slides()[i];
            if (!s) return;
            var pos = offsetOf(s);
            // the last pages of a perView > 1 track end at its end
            if (typeof track.scrollTo === "function") track.scrollTo(horizontal ? { left: pos, behavior: smooth ? "smooth" : "auto" } : { top: pos, behavior: smooth ? "smooth" : "auto" });
            else if (horizontal) track.scrollLeft = pos; else track.scrollTop = pos;
        }
        function setIndex(i, fromOutside) {
            if (i === st.index && st.ready) return;
            st.index = i;
            drawControls();
            if (owner && !fromOutside && Number(owner[c.index]) !== i) writeVariable(screen, owner, c.index, i);
            var slide = slides()[i];
            var sid = slide && slide.getAttribute("data-id");
            var ps = sid && screen.__paramStates && screen.__paramStates[sid];
            fireUiEvent(screen, ns, "slide-change", { index: i, value: i, item: ps && Object.prototype.hasOwnProperty.call(ps, "item") ? cloneValue(ps.item) : undefined });
        }
        function goTo(i, smooth, fromOutside) {
            i = clamp(i);
            show(i, smooth);
            setIndex(i, fromOutside);
        }

        // arrows + dots
        var prev = null, next = null, dots = null;
        if (c.arrows) {
            prev = document.createElement("button"); next = document.createElement("button");
            [prev, next].forEach(function (b, k) {
                b.type = "button";
                b.className = "nexa-carousel-arrow";
                b.setAttribute("aria-label", k ? "Next" : "Previous");
                b.textContent = horizontal ? (k ? "\u203A" : "\u2039") : (k ? "\u02C5" : "\u02C4");
                if (horizontal) { b.style.top = "50%"; b.style.marginTop = "-16px"; b.style[k ? "right" : "left"] = "8px"; }
                else { b.style.left = "50%"; b.style.marginLeft = "-16px"; b.style[k ? "bottom" : "top"] = "8px"; }
                b.addEventListener("click", function (e) { e.stopPropagation(); goTo(st.index + (k ? 1 : -1), true); });
                el.appendChild(b);
            });
        }
        if (c.dots) {
            dots = document.createElement("div");
            dots.className = "nexa-carousel-dots" + (horizontal || fade ? "" : " nexa-v");
            el.appendChild(dots);
        }
        function drawControls() {
            var n = pages();
            if (prev) { prev.disabled = !c.loop && st.index <= 0; next.disabled = !c.loop && st.index >= n - 1; prev.style.display = next.style.display = n > 1 ? "" : "none"; }
            if (!dots) return;
            // more than 10: a counter, not a row of dots
            if (n > 10) {
                dots.classList.add("nexa-count");
                while (dots.firstChild) dots.removeChild(dots.firstChild);
                dots.textContent = (st.index + 1) + " / " + n;
                dots.style.display = "";
                return;
            }
            if (dots.classList.contains("nexa-count")) { dots.classList.remove("nexa-count"); dots.textContent = ""; }
            if (dots.children.length !== n) {
                while (dots.firstChild) dots.removeChild(dots.firstChild);
                for (var k = 0; k < n; k++) (function (k) {
                    var d = document.createElement("button");
                    d.type = "button";
                    d.className = "nexa-carousel-dot";
                    d.setAttribute("aria-label", "Slide " + (k + 1));
                    d.addEventListener("click", function (e) { e.stopPropagation(); goTo(k, true); });
                    dots.appendChild(d);
                })(k);
            }
            dots.style.display = n > 1 ? "" : "none";
            Array.prototype.forEach.call(dots.children, function (d, k) { d.className = "nexa-carousel-dot" + (k === st.index ? " nexa-on" : ""); });
        }

        // the user scrolled / swiped (native): the slide it settles on (not every one on the way)
        var settleTimer = null;
        if (!fade) track.addEventListener("scroll", function () {
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(function () {
                var s = slides();
                if (!s.length) return;
                var pos = scrollPos(), best = 0, bestD = Infinity;
                s.forEach(function (x, k) { var d = Math.abs(offsetOf(x) - pos); if (d < bestD) { bestD = d; best = k; } });
                var max = horizontal ? track.scrollWidth - track.clientWidth : track.scrollHeight - track.clientHeight;
                if (pos >= max - 2) best = pages() - 1;   // at the end: the last page
                setIndex(clamp(best));
            }, 120);
        });
        // keys
        track.addEventListener("keydown", function (e) {
            var back = horizontal ? "ArrowLeft" : "ArrowUp", fwd = horizontal ? "ArrowRight" : "ArrowDown";
            if (e.key === back || e.key === fwd) { e.preventDefault(); goTo(st.index + (e.key === fwd ? 1 : -1), true); }
        });
        // a mouse drag (touch scrolls natively); a fade: a swipe of any pointer
        if (c.swipe && typeof track.addEventListener === "function") {
            var drag = null, moved = false;
            track.addEventListener("pointerdown", function (e) {
                if (!fade && e.pointerType !== "mouse") return;
                if (e.button !== undefined && e.button !== 0) return;
                drag = { x: e.clientX, y: e.clientY, pos: scrollPos(), t: Date.now() };
                moved = false;
                st.touching = true;
                if (!fade) track.style.scrollSnapType = "none";
            });
            window.addEventListener("pointermove", function (e) {
                if (!drag) return;
                var d = horizontal ? e.clientX - drag.x : e.clientY - drag.y;
                if (Math.abs(d) > 5) moved = true;
                if (!fade) { if (horizontal) track.scrollLeft = drag.pos - d; else track.scrollTop = drag.pos - d; }
            });
            window.addEventListener("pointerup", function (e) {
                if (!drag) return;
                var d = horizontal ? e.clientX - drag.x : e.clientY - drag.y;
                drag = null;
                st.touching = false;
                if (!fade) track.style.scrollSnapType = (horizontal ? "x" : "y") + " mandatory";
                if (!moved) return;
                var s = slides()[0], size = s ? (horizontal ? s.offsetWidth : s.offsetHeight) : 1;
                // far enough (or a flick): the next / previous one; else back
                var step = Math.abs(d) > size * 0.15 ? (d < 0 ? 1 : -1) : 0;
                goTo(st.index + step, true);
            });
            // a drag is not a click on what is inside
            track.addEventListener("click", function (e) { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
        }
        // autoplay: pauses while hovered / touched / the tab is hidden; wraps to the first
        if (Number(c.autoplay) > 0) {
            if (c.pauseOnHover) {
                el.addEventListener("mouseenter", function () { st.paused = true; });
                el.addEventListener("mouseleave", function () { st.paused = false; });
            }
            var timer = setInterval(function () {
                if (!el.isConnected) { clearInterval(timer); return; }
                if (st.paused || st.touching || (document.hidden === true)) return;
                goTo(st.index + 1 >= pages() ? 0 : st.index + 1, true);
            }, Math.max(500, Number(c.autoplay)));
        }
        // the variable: set elsewhere (Set Variable, a Function) -> go there
        if (owner) {
            screen.__varWatchers = screen.__varWatchers || [];
            var watcher = { scope: owner, name: c.index, fn: function (v) {
                if (!el.isConnected) { screen.__varWatchers.splice(screen.__varWatchers.indexOf(watcher), 1); return; }
                var n = Math.floor(Number(v));
                if (isFinite(n) && n !== st.index) goTo(n, true, true);
            } };
            screen.__varWatchers.push(watcher);
        }
        // the size changed: keep the current slide in place
        if (typeof ResizeObserver === "function") {
            var lastW = 0, lastH = 0;
            new ResizeObserver(function () {
                if (track.clientWidth === lastW && track.clientHeight === lastH) return;
                lastW = track.clientWidth; lastH = track.clientHeight;
                show(st.index, false);
            }).observe(track);
        }

        el.__carousel = {
            track: track,
            // after the slides changed (mounted, populated): controls, the index in range, in place
            refresh: function () {
                var i = clamp(st.index);
                st.index = i;
                drawControls();
                if (fade) applyFade(i);
                var run = function () { show(st.index, false); st.ready = true; };
                if (typeof requestAnimationFrame === "function") requestAnimationFrame(run); else run();
            },
            goTo: function (i) { goTo(i, true); },
            index: function () { return st.index; }
        };
        return track;
    }

    // ---- A zoomable frame (frame.zoom; src/model/layout.js zoomOf) --------------------------
    // Exactly the editor's canvas: the frame clips, and a viewport in it scrolls both ways
    // over a sizer as big as the zoomed content; a stage in the sizer holds the frame's
    // children and is scaled. The frame's scrollbars stay as they are — only the content
    // zooms — and their length follows the zoom; zoomed out below the view, the content
    // is centred. Ctrl + wheel (a trackpad pinch) zooms at the pointer, 20 % a step like the
    // editor; a plain wheel, a drag on the background, the middle button or one finger
    // scroll; two fingers pinch; a double click / tap goes back to the start. The toolbar
    // is the editor's: − 100% ○ + ⤢.
    var ZOOM_STEP_LIVE = 0.2;
    var ZOOM_CSS = [
        ".nexa-zoom-toolbar { position: absolute; z-index: 5; right: 16px; bottom: 16px; display: flex; align-items: center;",
        "  background: #fff; border-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.3); overflow: hidden; }",
        ".nexa-zoom-toolbar button { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; padding: 0;",
        "  border: none; background: transparent; color: #555; cursor: pointer; }",
        ".nexa-zoom-toolbar button:hover { background: #f2f2f2; }",
        ".nexa-zoom-toolbar button svg { width: 12px; height: 12px; }",
        ".nexa-zoom-toolbar .nexa-zoom-level { width: 44px; text-align: center; font: 11px sans-serif; color: #555; user-select: none; }"
    ].join("\n");
    // the editor's Font Awesome icons (fa-minus, fa-circle-o, fa-plus, fa-compress) as SVG: a page has no Font Awesome
    var ZOOM_ICONS = {
        minus: '<svg viewBox="0 0 12 12"><rect x="1" y="5" width="10" height="2" fill="currentColor"/></svg>',
        plus: '<svg viewBox="0 0 12 12"><rect x="1" y="5" width="10" height="2" fill="currentColor"/><rect x="5" y="1" width="2" height="10" fill="currentColor"/></svg>',
        reset: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
        // fa-compress: two diagonal arrows pointing in
        fit: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M1.2 10.8L5 7"/><path d="M2.4 7H5v2.6"/><path d="M10.8 1.2L7 5"/><path d="M9.6 5H7V2.4"/></svg>'
    };
    function setupZoom(el, comp, z) {
        if (!document.getElementById("nexa-zoom-css") && document.head) {
            var css = document.createElement("style"); css.id = "nexa-zoom-css"; css.textContent = ZOOM_CSS; document.head.appendChild(css);
        }
        var M = window.NexaModel;
        // the frame: its box and look, clipped (the longhands first: clearing one after the shorthand un-clips)
        if (el.style.display !== "none") el.style.display = "block";
        el.style.padding = "0";
        el.style.overflowX = ""; el.style.overflowY = "";
        el.style.overflow = "hidden";
        if (!el.style.position || el.style.position === "static") el.style.position = "relative";
        // the viewport: what scrolls (both ways); the buttons sit on the frame, so they do not scroll
        var vp = document.createElement("div");
        vp.className = "nexa-zoom-viewport" + (M.styleOf(comp).scrollbar === "hidden" ? " nexa-no-scrollbar" : "");
        if (M.styleOf(comp).scrollbar === "hidden") { ensureNoScrollbarCss(); vp.style.scrollbarWidth = "none"; }
        Object.assign(vp.style, { position: "absolute", left: "0", top: "0", right: "0", bottom: "0", overflow: "auto", touchAction: "pan-x pan-y" });
        el.appendChild(vp);
        var sizer = document.createElement("div");
        sizer.className = "nexa-zoom-sizer";
        sizer.style.position = "relative";
        vp.appendChild(sizer);
        // the stage: the frame's own layout (padding, auto layout) at its design size, scaled
        var stage = document.createElement("div");
        stage.className = "nexa-zoom-stage";
        var fcss = M.frameCss(comp, { scroll: false });
        ["background", "border", "border-radius", "overflow", "overflow-x", "overflow-y", "scrollbar-width"].forEach(function (k) { delete fcss[k]; });
        // its 100 % size: the frame's own size on the page (a Fill frame's too), set in apply()
        Object.assign(fcss, { position: "absolute", left: "0", top: "0", width: comp.w + "px", height: comp.h + "px", "box-sizing": "border-box", "transform-origin": "0 0" });
        Object.keys(fcss).forEach(function (k) { if (typeof stage.style.setProperty === "function") stage.style.setProperty(k, fcss[k]); else stage.style[k] = fcss[k]; });
        sizer.appendChild(stage);

        var st = { k: 1, ox: 0, oy: 0 };   // ox / oy: the offset that centres content smaller than the view
        var level = null;
        var changeFns = [];   // told after every zoom / layout change (a virtual list in the content redraws)
        // the view: without scrollbars when the zoomed content fits in the whole frame (then there are none)
        function view(w, h) {
            var full = { w: vp.offsetWidth || vp.clientWidth, h: vp.offsetHeight || vp.clientHeight };
            if (w !== undefined && w <= full.w && h <= full.h) return full;
            return { w: vp.clientWidth, h: vp.clientHeight };
        }
        // what is inside, at 100 % (its children may reach beyond the frame's size)
        // at 100 % the content is as big as the frame is on the page: what fills / keeps to its edges inside does
        function sizeStage() {
            var bw = el.clientWidth || comp.w, bh = el.clientHeight || comp.h;
            if (stage.style.width !== bw + "px") stage.style.width = bw + "px";
            if (stage.style.height !== bh + "px") stage.style.height = bh + "px";
        }
        function content() {
            sizeStage();
            var t = stage.style.transform; stage.style.transform = "none";
            var s = { w: Math.max(stage.scrollWidth, stage.offsetWidth, 1), h: Math.max(stage.scrollHeight, stage.offsetHeight, 1) };
            stage.style.transform = t;
            return s;
        }
        function clampK(k) { return Math.min(z.max, Math.max(z.min, Math.round(k * 1000) / 1000)); }
        // the sizer is the zoomed content (at least the view); smaller than the view: centred in it
        function apply() {
            var c = content(), w = c.w * st.k, h = c.h * st.k, v = view(w, h);
            sizer.style.width = Math.max(v.w, w) + "px";
            sizer.style.height = Math.max(v.h, h) + "px";
            st.ox = w < v.w ? (v.w - w) / 2 : 0;
            st.oy = h < v.h ? (v.h - h) / 2 : 0;
            stage.style.transform = "translate(" + st.ox + "px, " + st.oy + "px) scale(" + st.k + ")";
            if (level) level.textContent = Math.round(st.k * 100) + "%";
            changeFns.slice().forEach(function (fn) { try { fn(); } catch (e) { /* one listener must not stop the others */ } });
        }
        /** zoom to `k`, keeping the point (px, py) of the view where it is (the editor's setZoom) */
        function zoomTo(k, px, py) {
            k = clampK(k);
            var v = view();
            if (px === undefined) { px = v.w / 2; py = v.h / 2; }
            var cx = (vp.scrollLeft + px - st.ox) / st.k, cy = (vp.scrollTop + py - st.oy) / st.k;
            st.k = k;
            apply();
            vp.scrollLeft = cx * k + st.ox - px;
            vp.scrollTop = cy * k + st.oy - py;
        }
        function zoomIn() { zoomTo(st.k + ZOOM_STEP_LIVE); }
        function zoomOut() { zoomTo(st.k - ZOOM_STEP_LIVE); }
        function reset() { st.k = clampK(1); apply(); vp.scrollLeft = 0; vp.scrollTop = 0; }
        function fit() {
            var c = content(), v = view(0, 0);   // all of it in the whole frame: no scrollbars then
            st.k = clampK(Math.min(v.w / c.w, v.h / c.h));
            apply();
            vp.scrollLeft = 0; vp.scrollTop = 0;
        }
        function home() { if (z.start === "fit") fit(); else reset(); }
        // a point of the view, in the frame's own (unscaled) px, from a pointer
        function local(e) {
            var r = vp.getBoundingClientRect(), s = vp.offsetWidth ? r.width / vp.offsetWidth : 1;
            return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s, s: s };
        }
        // a click on something that takes it (a button, a field, the toolbar) is not the frame's
        function onControl(e) {
            var path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
            for (var i = 0; i < path.length && path[i] !== el; i++) {
                var t = path[i];
                if (t && t.tagName && /^(BUTTON|INPUT|TEXTAREA|SELECT|A|LABEL)$/.test(t.tagName)) return true;
                if (t && t.classList && t.classList.contains("nexa-zoom-toolbar")) return true;
            }
            return false;
        }

        // Ctrl + wheel / a pinch: zoom (the editor's step for a mouse wheel, smooth for a trackpad);
        // a plain wheel scrolls the viewport (natively; at its end the page scrolls on)
        vp.addEventListener("wheel", function (e) {
            if (!(e.ctrlKey || e.metaKey || z.wheel === "always")) return;
            e.preventDefault();
            var p = local(e);
            var small = Math.abs(e.deltaY) < 50;
            zoomTo(small ? st.k * Math.exp(-e.deltaY * 0.01) : st.k + (e.deltaY < 0 ? ZOOM_STEP_LIVE : -ZOOM_STEP_LIVE), p.x, p.y);
        }, { passive: false });

        // a drag on the background (or with the middle button) scrolls; two fingers pinch (one finger scrolls natively)
        var pointers = {}, pan = null, pinch = null, lastTap = null;
        vp.addEventListener("pointerdown", function (e) {
            if (onControl(e)) return;
            pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
            var ids = Object.keys(pointers);
            if (ids.length === 2) {
                var a = pointers[ids[0]], b = pointers[ids[1]];
                pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: st.k };
                pan = null;
                return;
            }
            var onBackground = e.target === vp || e.target === sizer || e.target === stage;
            if (e.pointerType !== "touch" && (onBackground || e.button === 1)) {
                pan = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, stp: vp.scrollTop, s: local(e).s };
                if (vp.setPointerCapture) { try { vp.setPointerCapture(e.pointerId); } catch (x) { /* not capturable */ } }
                // no text selection / native drag while scrolling by hand (it would cancel the pointer)
                e.preventDefault();
                stage.style.userSelect = "none";
            }
        });
        vp.addEventListener("dragstart", function (e) { if (pan) e.preventDefault(); });
        vp.addEventListener("pointermove", function (e) {
            if (!pointers[e.pointerId]) return;
            pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
            var ids = Object.keys(pointers);
            if (pinch && ids.length === 2) {
                var a = pointers[ids[0]], b = pointers[ids[1]];
                var mid = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
                zoomTo(pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), mid.x, mid.y);
                return;
            }
            if (!pan) return;
            vp.scrollLeft = pan.sl - (e.clientX - pan.x) / pan.s;
            vp.scrollTop = pan.stp - (e.clientY - pan.y) / pan.s;
        });
        function up(e) {
            if (!pointers[e.pointerId]) return;
            if (pan && !pinch && e.type === "pointerup") {
                vp.scrollLeft = pan.sl - (e.clientX - pan.x) / pan.s;
                vp.scrollTop = pan.stp - (e.clientY - pan.y) / pan.s;
            }
            delete pointers[e.pointerId];
            if (Object.keys(pointers).length < 2) pinch = null;
            if (!Object.keys(pointers).length) { pan = null; stage.style.userSelect = ""; }
            // a double tap (touch): back to the start
            if (e.type === "pointerup" && e.pointerType === "touch" && z.dblclick !== false) {
                var now = Date.now();
                if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) { lastTap = null; home(); }
                else lastTap = { t: now, x: e.clientX, y: e.clientY };
            }
        }
        vp.addEventListener("pointerup", up);
        vp.addEventListener("pointercancel", up);
        // a double click: back to the start (Fit / 100 %)
        if (z.dblclick !== false) vp.addEventListener("dblclick", function (e) { if (onControl(e)) return; e.preventDefault(); home(); });

        // the editor's toolbar: − 100% ○ + ⤢ (shown or hidden: "Show the zoom toolbar")
        var bar = document.createElement("div");
        bar.className = "nexa-zoom-toolbar";
        function tool(icon, title, fn) {
            var b = document.createElement("button");
            b.type = "button";
            b.title = title;
            b.setAttribute("aria-label", title);
            b.innerHTML = ZOOM_ICONS[icon];
            b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
            bar.appendChild(b);
        }
        tool("minus", "Zoom out", zoomOut);
        level = document.createElement("span");
        level.className = "nexa-zoom-level";
        bar.appendChild(level);
        tool("reset", "Reset zoom", reset);
        tool("plus", "Zoom in", zoomIn);
        tool("fit", "Zoom to fit", fit);
        bar.style.display = z.controls ? "" : "none";
        el.appendChild(bar);

        // the frame's size changed (Fill, the window): the content's 100 % size and the sizer follow
        if (typeof ResizeObserver === "function") new ResizeObserver(function () { apply(); }).observe(el);

        el.__zoom = {
            stage: stage, viewport: vp,
            // after the children are mounted: the start view, once laid out
            start: function () {
                if (typeof requestAnimationFrame === "function") requestAnimationFrame(home); else home();
            },
            zoomTo: zoomTo, zoomIn: zoomIn, zoomOut: zoomOut, fit: fit, reset: reset, home: home,
            showToolbar: function (on) { bar.style.display = on ? "" : "none"; },
            state: function () { return { k: st.k, ox: st.ox, oy: st.oy, left: vp.scrollLeft, top: vp.scrollTop }; },
            // the content changed size (a virtual list grew): the scroll length follows
            refresh: function () { apply(); },
            onChange: function (fn) { changeFns.push(fn); return function () { var i = changeFns.indexOf(fn); if (i !== -1) changeFns.splice(i, 1); }; }
        };
        return stage;
    }

    // ---- A virtual list (Populate "Virtualize"): every item is kept, but only the
    // copies in (or near) the frame's scrolled view exist. A sizer as big as all
    // copies together sits after the frame's own children; each copy in view is
    // placed in it at its own position (a column: index x (height + gap); a row:
    // along x; a grid: row x column). Scrolling mounts what comes into view and
    // unmounts what leaves it — like TanStack Virtual / a React windowed list.
    var VIRTUAL_OVERSCAN = 3; // lines drawn beyond the view, each side
    function startVirtual(screen, list, frameNs, frameEl) {
        var sizer = document.createElement("div");
        sizer.setAttribute("data-virtual-sizer", frameNs);
        sizer.style.position = "relative";
        sizer.style.flex = "none";
        // in a grid frame: across every column (else it is one cell wide, and the copies,
        // placed in its width, overlap once it is measured)
        sizer.style.gridColumn = "1 / -1";
        frameEl.appendChild(sizer);
        var frame = findComponent(screen, frameNs);
        var mode = window.NexaModel && frame ? window.NexaModel.layoutOf(frame).mode : "vertical";
        // a zoomable frame: its viewport scrolls the list (the zoomed content must not scroll itself)
        var outerEl = elById(frameNs);
        var zoom = outerEl && outerEl.__zoom && outerEl.__childHost === frameEl ? outerEl.__zoom : null;
        // else the frame is the scroll viewport: it scrolls along the list even if not set to
        if (zoom) { /* the zoom viewport scrolls */ }
        else if (mode === "horizontal") { if (!frameEl.style.overflowX || frameEl.style.overflowX === "hidden") frameEl.style.overflowX = "auto"; }
        else if (!frameEl.style.overflowY || frameEl.style.overflowY === "hidden") frameEl.style.overflowY = "auto";
        var scrollEl = zoom ? zoom.viewport : frameEl;
        var scheduled = false;
        function onScroll() {
            if (scheduled) return;
            scheduled = true;
            (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () { scheduled = false; if (list.virtual) renderVirtual(screen, list); });
        }
        if (scrollEl.addEventListener) scrollEl.addEventListener("scroll", onScroll);
        if (window.addEventListener) window.addEventListener("resize", onScroll);
        var offZoom = zoom ? zoom.onChange(onScroll) : null;
        list.virtual = { sizer: sizer, frameEl: frameEl, frameNs: frameNs, onScroll: onScroll, node: null, scrollEl: scrollEl, zoom: zoom, offZoom: offZoom };
    }
    function stopVirtual(list) {
        var v = list.virtual;
        var se = v.scrollEl || v.frameEl;
        if (se.removeEventListener) se.removeEventListener("scroll", v.onScroll);
        if (v.offZoom) v.offZoom();
        if (window.removeEventListener) window.removeEventListener("resize", v.onScroll);
        if (v.sizer.parentNode) v.sizer.parentNode.removeChild(v.sizer);
        list.virtual = null;
    }
    // where copy i goes, and the sizer's size, from the frame's layout and the template's size
    function virtualGeometry(screen, list) {
        var v = list.virtual, node = v.node;
        var t = findTemplateById(screen.__templates, node.template) || {};
        var frame = findComponent(screen, v.frameNs);
        var L = window.NexaModel && frame ? window.NexaModel.layoutOf(frame) : { mode: "vertical", gap: 0, columns: [] };
        var gap = Number(L.gap) || 0;
        var rowGap = L.rowGap !== undefined && L.rowGap !== "" ? Number(L.rowGap) || 0 : gap;
        var inner = v.sizer.clientWidth || (v.frameEl.clientWidth || 0);
        var innerH = v.sizer.clientHeight || 0;
        var w = t.width || 100, h = t.height || 40;
        var it = sizingOf(t, node);
        var M = window.NexaModel;
        var ax = M ? M.alignFraction(L.alignX) : 0, ay = M ? M.alignFraction(L.alignY) : 0;
        var g = { horizontal: L.mode === "horizontal", cols: 1, w: w, h: h, fill: false, fillH: false, offX: 0, offY: 0, inner: inner };
        if (L.mode === "grid") {
            // equal columns, like the frame's 1fr tracks; an item in its cell by the frame's alignment
            g.cols = Math.max(1, (L.columns || []).length || 1);
            var cell = inner ? (inner - gap * (g.cols - 1)) / g.cols : w;
            if (it.w === "fill" && inner) { g.w = cell; g.fill = true; }
            g.offX = Math.max(0, (cell - g.w) * ax);
            g.strideX = cell + gap; g.stride = h + rowGap;
        } else if (g.horizontal) {
            if (it.h === "fill" && innerH) { g.h = innerH; g.fillH = true; }
            g.offY = Math.max(0, (innerH - g.h) * ay);
            g.stride = w + gap;
        } else {
            if (it.w === "fill" && inner) { g.w = inner; g.fill = true; }
            g.offX = Math.max(0, (inner - g.w) * ax);
            g.stride = h + gap;
        }
        g.lines = Math.ceil(list.entries.length / g.cols);
        g.total = g.lines ? g.lines * g.stride - (g.horizontal ? gap : (L.mode === "grid" ? rowGap : gap)) : 0;
        return g;
    }
    function virtualBox(g, i) {
        if (g.horizontal) return { x: i * g.stride, y: g.offY, w: g.fill ? g.w : 0, h: g.fillH ? g.h : 0 };
        var line = Math.floor(i / g.cols), col = i % g.cols;
        return { x: col * (g.strideX || 0) + g.offX, y: line * g.stride, w: g.fill ? g.w : 0 };
    }
    function renderVirtual(screen, list) {
        batchSparkplugIndex(function () {
            var v = list.virtual;
            var g = virtualGeometry(screen, list);
            var el = v.frameEl, sizer = v.sizer;
            if (g.horizontal) { sizer.style.width = g.total + "px"; sizer.style.height = "auto"; sizer.style.minHeight = g.h + "px"; sizer.style.alignSelf = "stretch"; sizer.style.minWidth = g.total + "px"; }
            else { sizer.style.height = g.total + "px"; sizer.style.minHeight = g.total + "px"; sizer.style.width = g.cols > 1 || g.fill ? "100%" : g.w + "px"; sizer.style.alignSelf = "stretch"; }
            // in a zoomable frame: the list's length is the zoom's content — its scroll length follows
            if (v.zoom && v.lastTotal !== g.total) { v.lastTotal = g.total; v.zoom.refresh(); }
            // the view, in the sizer's own coordinates
            var se = v.scrollEl || el, start, size;
            if (v.zoom) {
                // the zoom's viewport, in the content's own (unzoomed) px
                var zs = v.zoom.state(), zk = zs.k || 1;
                start = g.horizontal ? ((se.scrollLeft || 0) - zs.ox) / zk - (sizer.offsetLeft || 0) : ((se.scrollTop || 0) - zs.oy) / zk - (sizer.offsetTop || 0);
                size = (g.horizontal ? (se.clientWidth || 0) : (se.clientHeight || 0)) / zk;
            } else {
                start = g.horizontal ? (se.scrollLeft || 0) - (sizer.offsetLeft || 0) : (se.scrollTop || 0) - (sizer.offsetTop || 0);
                size = g.horizontal ? (se.clientWidth || 0) : (se.clientHeight || 0);
            }
            if (!size) size = 20 * g.stride; // not laid out (yet): a first screenful
            var firstLine = Math.max(0, Math.floor(start / g.stride) - VIRTUAL_OVERSCAN);
            var lastLine = Math.min(g.lines - 1, Math.floor((start + size) / g.stride) + VIRTUAL_OVERSCAN);
            var from = firstLine * g.cols, to = Math.min(list.entries.length, (lastLine + 1) * g.cols);
            var want = {};
            for (var i = from; i < to; i++) want[list.entries[i].key] = true;
            // leaving the view (or gone from the list)
            (v.mountedList || []).forEach(function (e) {
                if (e.mounted && (!want[e.key] || e.dropped)) { unmountRepeated(screen, e.ns); e.mounted = false; }
            });
            var mountedList = [];
            for (var j = from; j < to; j++) {
                var e = list.entries[j];
                var box = virtualBox(g, j);
                if (!e.mounted) {
                    if (!mountRepeated(screen, v.node, v.frameNs, sizer, e, box)) continue;
                } else {
                    var ce = elById(e.ns);
                    if (ce) { ce.style.left = box.x + "px"; ce.style.top = box.y + "px"; if (box.w) ce.style.width = box.w + "px"; if (box.h) ce.style.height = box.h + "px"; }
                }
                mountedList.push(e);
            }
            v.mountedList = mountedList;
            // DOM order = list order (keyboard / screen reader order), only when it changed
            var kids = sizer.children || [], inOrder = kids.length === mountedList.length;
            for (var k = 0; inOrder && k < kids.length; k++) inOrder = kids[k].getAttribute("data-id") === mountedList[k].ns;
            if (!inOrder) mountedList.forEach(function (e) { var ce = elById(e.ns); if (ce) sizer.appendChild(ce); });
            registerSparkplugBoundComponentsFrom(screen);
            // the width it was placed in changed once laid out (a scrollbar appeared, the first
            // layout): place them again in the width there is now, once
            if (!g.horizontal && sizer.clientWidth && sizer.clientWidth !== g.inner && !v.relayout) {
                v.relayout = true;
                (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () { renderVirtual(screen, list); v.relayout = false; });
            }
        });
    }
    // how big a template's copy is on the page: the template's own setting (On the live page);
    // a Populate's "each copy fills the width" (older flows) makes its width fill too
    function sizingOf(template, node) {
        var sz = window.NexaModel && window.NexaModel.templateLiveOf ? window.NexaModel.templateLiveOf(template) : { w: "fixed", h: "fixed" };
        return node && node.fill ? Object.assign({}, sz, { w: "fill" }) : sz;
    }
    function unmountRepeated(screen, ns) {
        var el = elById(ns);
        if (el && el.parentNode) el.parentNode.removeChild(el);
        var pre = ns + "::";
        // what it teleported elsewhere goes with it
        Array.prototype.slice.call(document.querySelectorAll("[data-teleported]")).forEach(function (t) {
            var id = t.getAttribute("data-id") || "";
            if (id.indexOf(pre) !== 0) return;
            var moved = t.__overlay ? t.__overlay.layer : t;
            if (moved.parentNode) moved.parentNode.removeChild(moved);
        });
        var mine = function (id) { return id === ns || id.indexOf(pre) === 0; };
        var ix = compIndex(screen);
        for (var i = screen.components.length - 1; i >= 0; i--) if (mine(screen.components[i].id)) { delete ix[screen.components[i].id]; screen.components.splice(i, 1); }
        var nodes = screen.logic.nodes, wires = screen.logic.wires;
        for (var j = nodes.length - 1; j >= 0; j--) if (mine(nodes[j].id)) nodes.splice(j, 1);
        for (var w = wires.length - 1; w >= 0; w--) if (mine(wires[w].from) || mine(wires[w].to)) wires.splice(w, 1);
        if (screen.__paramStates) Object.keys(screen.__paramStates).forEach(function (k) { if (mine(k)) delete screen.__paramStates[k]; });
        if (screen.__scopes) Object.keys(screen.__scopes).forEach(function (k) { if (mine(k)) delete screen.__scopes[k]; });
    }
    function runPopulate(screen, node, msg) {
        return batchSparkplugIndex(function () { runPopulateNow(screen, node, msg); });
    }
    function runPopulateNow(screen, node, msg) {
        var cut = node.id.lastIndexOf("::");
        var frameNs = (cut === -1 ? "" : node.id.slice(0, cut + 2)) + node.container;
        var outerEl = elById(frameNs);
        var frameEl = outerEl && (outerEl.__childHost || outerEl);
        if (!frameEl || !node.template) { logicTrace("populate: no container / template", frameNs, node.template); return; }
        if (outerEl.__carousel && node.virtualize) { logicTrace("populate: a carousel draws every slide (Virtualize ignored)"); node = Object.assign({}, node, { virtualize: false }); }
        var list = repeatList(screen, frameNs);
        // the node a copy's "Send to Host" comes out of: the Layout node (or a Populate with its own container)
        list.ownerId = node.id;
        var virtual = !!node.virtualize;
        // switching a list between drawn-all and virtual: re-draw what is there the other way
        if (virtual !== !!list.virtual) {
            list.entries.forEach(function (e) { if (e.mounted) { unmountRepeated(screen, e.ns); e.mounted = false; } });
            if (list.virtual) stopVirtual(list);
            if (virtual) startVirtual(screen, list, frameNs, frameEl);
        }
        if (virtual) list.virtual.node = node;
        var data = valueFromMsg(node, msg);
        var items = Array.isArray(data) ? data : (data === undefined || data === null ? [] : [data]);
        var mode = node.mode || "replace";
        var byKey = {};
        var dropped = false;
        list.entries.forEach(function (e) { byKey[e.key] = e; });
        // add a copy for `item` under `key` (worked out once, by the caller)
        function add(item, atStart, key) {
            if (byKey[key]) { update(byKey[key], item); return; }
            var e = { key: key, ns: repeatNs(frameNs, key), item: item, index: atStart ? 0 : list.entries.length };
            if (atStart) list.entries.unshift(e); else list.entries.push(e);
            byKey[key] = e;
            // a virtual list draws it when it scrolls into view (renderVirtual)
            if (!virtual && !mountRepeated(screen, node, frameNs, frameEl, e)) { list.entries.splice(list.entries.indexOf(e), 1); delete byKey[key]; }
        }
        function update(e, item) {
            if (sameValue(e.item, item)) return;
            e.item = item;
            if (!e.mounted) return;
            updateInstanceParam(screen, e.ns, "item", item);
            if (node.itemParam && node.itemParam !== "item") updateInstanceParam(screen, e.ns, node.itemParam, item);
        }
        // removed from the list once at the end (one splice each made a big clear / replace quadratic)
        function drop(e) {
            if (e.mounted) { unmountRepeated(screen, e.ns); e.mounted = false; }
            e.dropped = dropped = true;
            delete byKey[e.key];
        }
        if (mode === "clear") list.entries.slice().forEach(drop);
        else if (mode === "remove") {
            items.forEach(function (it) {
                var key = it !== null && typeof it === "object" ? (node.key ? resolvePath(it, node.key) : undefined) : it;
                if (key !== undefined && byKey[String(key)]) drop(byKey[String(key)]);
            });
        } else if (mode === "upsert") {
            var seenU = {};
            items.forEach(function (it) { add(it, false, repeatKeyOf(node, it, list, seenU)); });
        } else if (mode === "append" || mode === "prepend") {
            // always new copies: a key the list already has gets its next free "key~n"
            var seenA = {};
            Object.keys(byKey).forEach(function (k) { seenA[k] = true; });
            (mode === "prepend" ? items.slice().reverse() : items).forEach(function (it) { add(it, mode === "prepend", repeatKeyOf(node, it, list, seenA)); });
        } else {
            // replace: keep / update / add / remove by key, then order as given. Objects
            // without a key field are all new; strings / numbers are their own key.
            var keep = {}, seenR = {};
            var order = items.map(function (it) {
                var key = repeatKeyOf(node, it, list, seenR);
                keep[key] = true;
                add(it, false, key);
                return byKey[key];
            }).filter(Boolean);
            list.entries.slice().forEach(function (e) { if (!keep[e.key]) drop(e); });
            list.entries = order;
        }
        if (dropped) list.entries = list.entries.filter(function (e) { return !e.dropped; });
        if (virtual) {
            list.entries.forEach(function (e, i) {
                if (e.index !== i) { e.index = i; if (e.mounted) updateInstanceParam(screen, e.ns, "index", i); }
            });
            renderVirtual(screen, list);
            return;
        }
        // positions: index params, and the cards' order after the container's own children
        list.entries.forEach(function (e, i) {
            if (e.index !== i) { e.index = i; updateInstanceParam(screen, e.ns, "index", i); }
            var el = elById(e.ns);
            if (el) frameEl.appendChild(el);
        });
        if (outerEl.__carousel) outerEl.__carousel.refresh();
        registerSparkplugBoundComponentsFrom(screen);
    }

    // "Send to Host" inside a template: the message goes OUT to where the template is used.
    // A copy a Populate made (namespace "<frame>#<key>"): out of the Layout node that made it,
    // with msg.item / msg.index. A placed instance: its "On Template Output" node(s) on the
    // surface around it. msg.output = the output's name either way.
    function sendToHost(screen, node, msg, budget) {
        var cut = node.id.lastIndexOf("::");
        if (cut === -1) { logicTrace("send to host: not inside a template instance", node.id); return; }
        var ns = node.id.slice(0, cut);
        var out = cloneMsg(msg && typeof msg === "object" ? msg : { payload: msg });
        out.output = node.output || "out";
        var last = ns.slice(ns.lastIndexOf("::") + 2 > 1 ? ns.lastIndexOf("::") + 2 : 0);
        var hash = last.indexOf("#");
        var frameNs = hash === -1 ? null : ns.slice(0, ns.length - last.length + hash);
        var list = frameNs && screen.__lists && screen.__lists[frameNs];
        if (list) {
            var ps = screen.__paramStates && screen.__paramStates[ns];
            if (ps) { out.item = cloneValue(ps.item); out.index = ps.index; }
            var owner = list.ownerId && findLogicNode(screen, list.ownerId);
            if (owner) continuePropagation(screen, owner, out, budget);
            else logicTrace("send to host: the node that populated", frameNs, "is gone");
            return;
        }
        var targets = (screen.logic.nodes || []).filter(function (n) {
            return n.type === "template-event" && n.instanceId === ns && (!n.output || n.output === out.output);
        });
        targets.forEach(function (n, i) { runLogicGraph(screen, n, i === 0 ? out : cloneMsg(out), budget); });
    }

    // `vars` for one Function node: get / set a variable by name (nearest
    // declaration from the node's surface, or an explicit scope id / "@app")
    function varsFor(screen, node) {
        var root = function () { return resolveScope(screen, "", node.id); };
        return {
            get: function (name, scopeId) { var sc = scopeId !== undefined ? resolveScope(screen, scopeId, node.id) : root(); return sc ? cloneValue(sc[name]) : undefined; },
            set: function (name, value, scopeId, op) {
                var sc = scopeId !== undefined ? resolveScope(screen, scopeId, node.id) : (ownerOf(root(), name) || root());
                return writeVariable(screen, sc, name, value, op);
            },
            update: function (name, op, value, scopeId) { return this.set(name, value, scopeId, op); }
        };
    }

    function refreshScope(screen, scope) {
        screen.components.forEach(function (comp) {
            var s = comp.__paramState;
            if (!s || !(s === scope || Object.prototype.isPrototypeOf.call(scope, s))) return;
            if (isStructural(comp)) return;
            if (comp.type === "@template") {
                var instState = screen.__paramStates && screen.__paramStates[comp.id];
                if (!instState) return;
                Object.keys(comp.paramValues || {}).forEach(function (name) {
                    var raw = comp.paramValues[name];
                    if (typeof raw !== "string" || raw.indexOf("{") === -1) return;
                    var resolved = resolveBindableValue(raw, s);
                    if (resolved !== instState[name]) updateInstanceParam(screen, comp.id, name, resolved);
                });
                return;
            }
            refreshComponentRender(screen, comp);
        });
        // a variable may be part of a tag address ({sparkplug:...::{line}/x})
        registerSparkplugBoundComponentsFrom(screen);
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
        var targets = outWires.map(function (w) { return findLogicNode(screen, w.to); }).filter(Boolean);
        // Fan-out as in Node-RED: every wire gets its own message, but the first
        // gets the original (the clones are made before anything runs) — a big
        // msg (a Populate of 100 000 items) is no longer copied on every wire
        var msgs = targets.map(function (t, i) { return i === 0 ? outMsg : cloneMsg(outMsg); });
        targets.forEach(function (targetNode, i) {
            runLogicGraph(screen, targetNode, msgs[i], budget);
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
                var fnVars = varsFor(screen, node);
                var result = new Function("msg", "vars", "route", "storage", "cookies", "http", "getVariable", "setVariable",
                    "return (async function(){ " + (node.code || "return msg;") + " })();")(
                    fnInput, fnVars, cloneValue(((screen.__scopes || {})["@app"] || {}).$route || makeRoute()),
                    BROWSER_API.storage, BROWSER_API.cookies, BROWSER_API.http,
                    // getVariable("speed") / getVariable("user", "@app"); setVariable("speed", 10) / setVariable("cart", item, "@app", "append")
                    function (name, scopeId) { return fnVars.get(name, scopeId); },
                    function (name, value, scopeId, op) { return fnVars.set(name, value, scopeId, op); });
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
        } else if (node.type === "set-variable") {
            setVariable(screen, node, msg);
        } else if (node.type === "teleport") {
            // a node (of this surface) drawn in a target / on the page, or back home; the msg goes on
            var cutT = node.id.lastIndexOf("::");
            var tEl = elById((cutT === -1 ? "" : node.id.slice(0, cutT + 2)) + node.node);
            var to = node.toSource === "payload" ? (msg && msg.payload) : node.to;
            to = to === undefined || to === null ? "" : String(to).trim();
            if (!tEl) logicTrace("teleport: no such node", node.node);
            else if (!to || to === "home") teleportHome(tEl);
            else if (!teleportEl(tEl, teleportTarget(to), to)) logicTrace("teleport: no target", to);
        } else if (node.type === "overlay-open") {
            // continues when the overlay closes: msg.payload = its result, msg.closedBy
            var cutO = node.id.lastIndexOf("::");
            var oNs = (cutO === -1 ? "" : node.id.slice(0, cutO + 2)) + node.overlay;
            if (!openOverlay(screen, oNs, msg, function (res) { continuePropagation(screen, node, res, budget); })) logicTrace("overlay-open: no overlay", oNs);
            return;
        } else if (node.type === "overlay-close") {
            closeOverlay(overlayForNode(node), node.valueSource === "none" ? undefined : msg && msg.payload, "node");
            outMsg = null;
        } else if (node.type === "http-request") {
            runHttpNode(screen, node, msg, function (res) { continuePropagation(screen, node, res, budget); });
            return; // propagation happens when the response is in
        } else if (node.type === "populate") {
            if (node.container) runPopulate(screen, node, msg);
            else {
                // no container of its own: whichever Layout node(s) it is wired to fill theirs
                // a shallow copy: the items go on as they are (the Layout node only reads them).
                // Wired after another Populate (e.g. Clear -> Append): both, in that order.
                outMsg = Object.assign({}, msg || {});
                var job = { template: node.template, itemParam: node.itemParam, mode: node.mode, key: node.key, fill: node.fill, virtualize: node.virtualize, items: valueFromMsg(node, msg) };
                var before = msg && msg.populate ? [].concat(msg.populate).filter(function (j) { return j && typeof j === "object"; }) : [];
                outMsg.populate = before.length ? before.concat([job]) : job;
            }
        } else if (node.type === "layout") {
            // a container (Row / Column / Grid frame) as a Logic node: applies what a Populate sent it.
            // Its output is what its copies send to the host ("Send to Host" -> sendToHost), not this msg.
            if (msg && msg.populate && typeof msg.populate === "object") {
                // one Populate's job, or several in a row (Populate -> Populate -> Layout)
                [].concat(msg.populate).forEach(function (job) {
                    if (!job || typeof job !== "object") return;
                    runPopulate(screen, { id: node.id, container: node.container, template: job.template, itemParam: job.itemParam, mode: job.mode,
                        key: job.key, fill: job.fill, virtualize: job.virtualize, valueSource: "static", value: job.items }, msg);
                });
            }
            outMsg = null;
        } else if (node.type === "template-output") {
            sendToHost(screen, node, msg, budget);
            outMsg = null;
        } else if (node.type === "storage") {
            outMsg = runStorageNode(screen, node, msg);
        } else if (node.type === "cookie") {
            outMsg = runCookieNode(screen, node, msg);
        } else if (node.type === "get-variable") {
            var gScope = resolveScope(screen, node.scope, node.id);
            outMsg = cloneMsg(msg || {});
            setMsgPath(outMsg, node.target || "payload", gScope ? cloneValue(gScope[node.name]) : undefined);
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
            // from inside a card a Populate node made: which card (msg.item, msg.index)
            var cut = compId.lastIndexOf("::");
            var owner = cut !== -1 && screen.__paramStates && screen.__paramStates[compId.slice(0, cut)];
            if (owner && Object.prototype.hasOwnProperty.call(owner, "item") && Object.prototype.hasOwnProperty.call(owner, "index")) {
                initialMsg.item = cloneValue(owner.item);
                initialMsg.index = owner.index;
            }
            if (payload && typeof payload === "object") {
                if (payload.value !== undefined) initialMsg.value = cloneValue(payload.value);
                if (payload.tag !== undefined) initialMsg.tag = payload.tag;
                if (payload.timestamp !== undefined) initialMsg.timestamp = payload.timestamp;
                // an event about one item of a list (a carousel's slide): msg.index / msg.item
                if (payload.index !== undefined) initialMsg.index = payload.index;
                if (payload.item !== undefined) initialMsg.item = cloneValue(payload.item);
            }
            // already its own (the payload was cloned above): no second copy
            runLogicGraph(screen, n, initialMsg);
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
                // a variable / URL query parameter (the value is NOT resolved first: it names the target)
                var local = writeLocalTarget(screen, comp, raw, value);
                if (local) return local;
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

    // A component writing to a variable ({speed}, {cfg.limit}: set on the scope
    // that declares it, the path set inside a copy) or a URL query parameter
    // ({$route.query.status}: the address bar updates, what binds $route
    // re-renders). Returns a Promise, or null when `raw` is neither (a tag).
    var LOCAL_TARGET_RE = /^\{(\$route\.query\.([A-Za-z_$][\w$]*)|([A-Za-z_][\w$]*)((?:\.[A-Za-z_$][\w$]*)*))\}$/;
    function writeLocalTarget(screen, comp, raw, value) {
        if (typeof raw !== "string") return null;
        var m = LOCAL_TARGET_RE.exec(raw.trim());
        if (!m || m[3] === "msg") return null;
        if (m[2]) { setRouteQuery(screen, m[2], value); return Promise.resolve({ ok: true, target: "route" }); }
        var name = m[3], rest = m[4] ? m[4].slice(1).split(".") : [];
        var owner = ownerOf(comp.__paramState || (screen.__scopes || {})[""], name);
        if (!owner) return Promise.reject(new Error("{" + name + "} is not a variable around this component"));
        var inst = owner[name];
        if (rest.length && inst && typeof inst === "object" && inst.__type && window.NexaModel) return writeInstanceMember(screen, owner, name, inst, rest, value);
        var next = value;
        if (rest.length) {
            next = cloneValue(owner[name]);
            if (next === null || typeof next !== "object") next = {};
            var cur = next;
            for (var i = 0; i < rest.length - 1; i++) {
                if (cur[rest[i]] === null || typeof cur[rest[i]] !== "object") cur[rest[i]] = {};
                cur = cur[rest[i]];
            }
            cur[rest[rest.length - 1]] = value;
        }
        writeVariable(screen, owner, name, next, "set");
        return Promise.resolve({ ok: true, target: "variable" });
    }

    // {M101.Setpoint}: an instance of a type (UDT). Only a "readwrite" member takes a
    // write. One with a source (a tag) writes that tag; a value member is set on a
    // copy of the instance (so watchers see the change).
    function writeInstanceMember(screen, owner, name, inst, path, value) {
        var M = window.NexaModel;
        var member = M.memberAt(inst, path);
        if (!member) return Promise.reject(new Error("{" + name + "." + path.join(".") + "}: no such member"));
        if (member.access !== "readwrite") return Promise.reject(new Error("{" + name + "." + path.join(".") + "} is read-only"));
        var cur = inst;
        for (var i = 0; i < path.length - 1; i++) cur = cur && cur[path[i]];
        var leaf = cur && cur[path[path.length - 1]];
        if (leaf && typeof leaf.__nexaBinding === "string") {
            var ref = parseSparkplugBindingPath(leaf.__nexaBinding);
            if (ref) return sendSparkplugWrite(ref.groupId, ref.edgeNodeId, ref.deviceId, [{ name: ref.metricName, value: value }]);
            var sdk = window.NexaSDK, t = sdk && sdk.parseTag(leaf.__nexaBinding);
            var provider = t && sdk.getTagProvider(t.provider);
            if (provider && typeof provider.write === "function") return Promise.resolve(provider.write(t.ref, value, t));
            return Promise.reject(new Error("can't write " + leaf.__nexaBinding));
        }
        // copy along the path, keeping each level's type (non-enumerable __type)
        function copyOf(o) {
            var c = Object.assign({}, o);
            if (o && o.__type) Object.defineProperty(c, "__type", { value: o.__type, enumerable: false });
            return c;
        }
        var top = copyOf(inst), at = top;
        for (var j = 0; j < path.length - 1; j++) { at[path[j]] = copyOf(at[path[j]]); at = at[path[j]]; }
        at[path[path.length - 1]] = value;
        writeVariable(screen, owner, name, top, "set");
        return Promise.resolve({ ok: true, target: "member" });
    }

    // ?key=value in the address bar (no reload, no history entry) and in {$route.query}
    function setRouteQuery(screen, key, value) {
        var app = (screen.__scopes || {})["@app"];
        var root = app && Object.getPrototypeOf(app);
        try {
            var url = new URL(window.location.href);
            if (value === undefined || value === null || value === "") url.searchParams.delete(key);
            else url.searchParams.set(key, String(value));
            window.history.replaceState(window.history.state, "", url.toString());
        } catch (e) { /* no URL / history (a test shim) */ }
        if (root && root.$route) {
            var q = Object.assign({}, root.$route.query || {});
            if (value === undefined || value === null || value === "") delete q[key]; else q[key] = String(value);
            root.$route = Object.assign({}, root.$route, { query: q });
            screen.components.forEach(function (c) {
                if (isStructural(c) || c.type === "@template") return;
                if (propsMention(c.props, "$route")) refreshComponentRender(screen, c);
            });
        }
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
        var namespacedComp = compIndex(effectiveScreen)[namespace];
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
            addComponent(effectiveScreen, namespacedComp);
        }

        // the scope this container opens for what is inside it (the same object
        // on a re-mount, so values a Logic node set are kept)
        var innerScope = paramState;
        if (isStructural(comp) && hasVariables(comp)) {
            effectiveScreen.__scopes = effectiveScreen.__scopes || {};
            innerScope = effectiveScreen.__scopes[namespace] || (effectiveScreen.__scopes[namespace] = makeScope(paramState, comp.variables));
        }
        var vis = combineVisibility(inheritedVis, comp);
        if (vis === "remove") {
            // register what is inside too, so Logic can address it while removed
            if (isContainerNode(comp)) {
                walkNodes(comp.children, function (n) {
                    var ns = childNamespace(namespace, n);
                    if (compIndex(effectiveScreen)[ns]) return;
                    var clone = buildComponentClone(n, ns);
                    clone.__paramState = innerScope;
                    addComponent(effectiveScreen, clone);
                });
            }
            return;
        }

        var el = document.createElement("div");
        el.setAttribute("data-id", namespace);
        // where it is drawn: in its parent; "on the screen": the screen itself; "docked": the
        // layer over what is in view of its parent (it stays at its edge while that scrolls)
        var place = window.NexaModel && window.NexaModel.placeOf ? window.NexaModel.placeOf(comp, parentEl.__nexaNode || null) : "free";
        var into = place === "screen" ? surfaceElOf(parentEl)
            : place === "dock" ? dockLayerOf(parentEl.__nexaFrameEl || parentEl) : parentEl;
        applyNodeBox(el, comp, into.__nexaNode || null, into.__nexaSize || null);
        if (place === "dock") el.style.pointerEvents = "auto";
        el.style.display = vis === "show" ? (el.style.display || "") : "none";
        if (beforeEl && beforeEl.parentNode === into) into.insertBefore(el, beforeEl);
        else into.appendChild(el);
        // a component's slot frame: its component's <slot> of that name places it
        if (comp.type === "@frame" && comp.inSlot) el.setAttribute("slot", comp.inSlot);
        // "When scrolling": Fixed / Sticky (a node its parent's auto layout places is sticky by CSS instead)
        if ((comp.scrollBehavior === "fixed" || comp.scrollBehavior === "sticky") &&
            !(window.NexaModel && parentEl.__nexaNode && window.NexaModel.isInFlow(comp, parentEl.__nexaNode))) registerPin(el, comp);
        // teleported: drawn in another place once the tree is up (its logic, params and
        // variables stay those of where it is in the tree)
        el.__nexaModel = comp;
        if (typeof comp.teleport === "string" && comp.teleport && comp.teleportOn !== "logic") PENDING_TELEPORTS.push({ el: el, node: comp, ns: namespace });

        if (isStructural(comp)) {
            el.setAttribute("data-nexa-container", comp.type);
            if (comp.name) el.setAttribute("data-name", comp.name);
            // a teleport target: what is teleported to its name is drawn in it
            if (typeof comp.slot === "string" && comp.slot.trim()) el.setAttribute("data-teleport-slot", comp.slot.trim());
            // a carousel: the children (slides) go into its track; arrows / dots sit on the frame
            var carousel = comp.type === "@frame" && window.NexaModel && window.NexaModel.carouselOf ? window.NexaModel.carouselOf(comp) : null;
            var zoom = !carousel && comp.type === "@frame" && window.NexaModel && window.NexaModel.zoomOf ? window.NexaModel.zoomOf(comp) : null;
            var host = carousel ? setupCarousel(effectiveScreen, el, comp, namespace, innerScope, carousel) : zoom ? setupZoom(el, comp, zoom) : el;
            // a dialog / drawer: into a layer over its scope, hidden until opened
            if (overlayModel(comp)) setupOverlay(effectiveScreen, el, comp, namespace, parentEl);
            el.__childHost = host;
            host.__nexaNode = comp; // its children read its layout (applyNodeBox)
            host.__nexaFrameEl = el; // a docked child's layer is the frame's (not a carousel's track)
            (comp.children || []).forEach(function (child) {
                mountAndFlatten(host, child, vis, templates, childNamespace(namespace, child), visitedTemplateIds, effectiveScreen, innerScope);
            });
            if (el.__carousel) el.__carousel.refresh();
            if (el.__zoom) el.__zoom.start();
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
            var inner = document.createElement("div");
            inner.style.position = "absolute";
            inner.style.left = "0";
            inner.style.top = "0";
            var Mdl = window.NexaModel;
            var slideOf = parentEl.__nexaNode && Mdl && Mdl.carouselOf && Mdl.carouselOf(parentEl.__nexaNode) ? parentEl.__nexaNode : null;
            var lc = comp.layoutChild || {};
            if (slideOf) {
                // a carousel slide is a cell: the template in it — filling it or its own size
                // (its On-the-live-page setting), inside the slide's padding, aligned
                var it = Mdl.layoutOf(slideOf).items;
                var px = Number(it.padX) || 0, py = Number(it.padY) || 0;
                if (lc.w === "fill") { inner.style.left = px + "px"; inner.style.right = px + "px"; inner.style.width = "auto"; }
                else { inner.style.width = template.width + "px"; inner.style.left = "calc(" + px + "px + (100% - " + (2 * px + template.width) + "px) * " + Mdl.alignFraction(it.alignX) + ")"; }
                if (lc.h === "fill") { inner.style.top = py + "px"; inner.style.bottom = py + "px"; inner.style.height = "auto"; }
                else { inner.style.height = template.height + "px"; inner.style.top = "calc(" + py + "px + (100% - " + (2 * py + template.height) + "px) * " + Mdl.alignFraction(it.alignY) + ")"; }
            } else {
                // the instance's box: its w / h, or what its host gives an axis it fills
                inner.style.width = "100%";
                inner.style.height = "100%";
            }
            el.appendChild(inner);
            // its box clips it (a container of one thing): nothing spills over its neighbours
            inner.style.overflow = "hidden";
            // its design in that box: laid out by constraints, or scaled (the instance's / template's setting)
            var contentHost = templateContentHost(inner, template, comp);

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
                mountAndFlatten(contentHost, innerComp, "show", templates, namespace + "::" + innerComp.id, innerVisited, effectiveScreen, instanceParamState);
            });
            return;
        }

        if (comp.type === "@lit-component") {
            renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, paramState, namespacedComp), makeCtx(effectiveScreen, namespacedComp));
            return;
        }

        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        if (typeDef && typeof typeDef.render === "function") {
            if (el.__nexaPendingTimer) { clearTimeout(el.__nexaPendingTimer); el.__nexaPendingTimer = null; }
            if (typeof el.removeAttribute === "function") el.removeAttribute("data-nexa-unknown");
            if (typeof typeDef.migrateProps === "function") namespacedComp.props = typeDef.migrateProps(namespacedComp.props || {});
            try {
                typeDef.render(el, interpolateProps(namespacedComp.props || {}, paramState, namespacedComp), makeCtx(effectiveScreen, namespacedComp));
            } catch (e) {
                el.textContent = "(render error: " + e.message + ")";
            }
            // a component with slots (Tabs…): what its slots hold, drawn in them
            mountSlotFrames(el, comp, typeDef, function (host, child) {
                mountAndFlatten(host, child, vis, templates, childNamespace(namespace, child), visitedTemplateIds, effectiveScreen, innerScope);
            });
        } else {
            el.setAttribute("data-nexa-unknown", comp.type);
            if (typeof window !== "undefined" && window.requestAnimationFrame && typeof setTimeout === "function") {
                if (el.__nexaPendingTimer) clearTimeout(el.__nexaPendingTimer);
                el.__nexaPendingTimer = setTimeout(function () {
                    if (el.getAttribute("data-nexa-unknown") === comp.type && (!window.NEXA || !window.NEXA.getComponent(comp.type))) {
                        el.textContent = "(unknown component: " + comp.type + ")";
                    }
                }, 500);
            } else {
                el.textContent = "(unknown component: " + comp.type + ")";
            }
            // its plugin may register later (an ES module): its slots are mounted then
            if (isSlotHostNode(comp)) {
                el.__mountSlots = function (lateDef) {
                    mountSlotFrames(el, comp, lateDef, function (host, child) {
                        mountAndFlatten(host, child, vis, templates, childNamespace(namespace, child), visitedTemplateIds, effectiveScreen, innerScope);
                    });
                };
            }
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
        (function visit(list, parentEl, inherited, scope) {
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
                    mountAndFlatten(parentEl, node, inherited, effectiveScreen.__templates, node.id, [], effectiveScreen, scope, before);
                    return;
                }
                el.style.display = vis === "show" ? (node.type === "@frame" && window.NexaModel ? window.NexaModel.frameCss(node).display : "") : "none";
                // a component with slots: into its element once it placed them (not before its plugin registered)
                if (isSlotHostNode(node)) { if (el.__childHost) visit((node.children || []).filter(function (c) { return !c.slotUnused; }), el.__childHost, vis, scope); return; }
                if (isContainerNode(node)) visit(node.children, el.__childHost || el, vis, (effectiveScreen.__scopes || {})[node.id] || scope);
            });
        })(effectiveScreen.__tree.components, artboard, "show", (effectiveScreen.__scopes || {})[""]);
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

    // How the screen sits in the browser window (screen.displayMode):
    //   "fixed"    its exact size (a specific device), centred       (default)
    //   "fit"      scaled to fit the window, proportions kept (letterbox)
    //   "fitWidth" scaled to the window's width; scrolls vertically
    //   "fill"     the screen IS the window: nothing is scaled, the root's
    //              children keep to its edges by their constraints (responsive)
    function applyDisplayMode(screen, artboard) {
        var mode = screen.displayMode || "fixed";
        var body = document.body;
        if (body && body.classList) body.classList.add("nexa-mode-" + mode);
        if (mode === "fixed") return;
        var st = artboard.style;
        st.margin = "0";
        st.boxShadow = "none";
        if (mode === "fill") {
            st.width = "100vw";
            st.height = "100vh";
            if (body) body.style.overflow = "hidden";
            return;
        }
        st.position = "absolute";
        st.transformOrigin = "0 0";
        function layout() {
            var vw = window.innerWidth || document.documentElement.clientWidth;
            var vh = window.innerHeight || document.documentElement.clientHeight;
            var w = screen.width || 1, h = screen.height || 1;
            var scale = mode === "fit" ? Math.min(vw / w, vh / h) : vw / w;
            st.transform = "scale(" + scale + ")";
            st.left = (mode === "fit" ? Math.max(0, (vw - w * scale) / 2) : 0) + "px";
            st.top = (mode === "fit" ? Math.max(0, (vh - h * scale) / 2) : 0) + "px";
            if (body) {
                body.style.overflowX = "hidden";
                body.style.overflowY = mode === "fit" ? "hidden" : "auto";
                body.style.height = mode === "fit" ? "100vh" : (h * scale) + "px";
            }
        }
        layout();
        if (window.addEventListener) window.addEventListener("resize", layout);
    }

    // ---- Breakpoints (src/model/breakpoints.js): the screen's overrides for the window's width ---
    // Desktop-first: the tree as designed is the band of the screen's width (a 1920 screen:
    // 3xl); a window in another band (the app's breakpoints: xs sm md lg xl 2xl 3xl)
    // applies the overrides from the design to it. Crossing one while the page is open
    // applies them in place — boxes, layouts, visibility, props — so what the page holds
    // (a Populate's copies, variables, a carousel's slide) stays. {$breakpoint} is the band
    // in use ("md", …); On Variable Change of it fires on a change.
    function appBreakpoints() { return window.__NEXA_APP__ || {}; }
    function startBreakpoints(screen, effectiveScreen) {
        var M = window.NexaModel;
        if (!M || !M.activeBreakpoint) { CURRENT_APP_SCOPE.$breakpoint = ""; return; }
        // each node's desktop values, to come back to
        walkNodes(screen.components, function (n) {
            if (!n.__bpBase) Object.defineProperty(n, "__bpBase", { value: M.baseOf(n), writable: true, configurable: true });
        });
        var width = function () { return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || screen.width; };
        var current = M.activeBreakpoint(appBreakpoints(), screen, width());
        applyBreakpointTree(screen, current);
        CURRENT_APP_SCOPE.$breakpoint = current;
        effectiveScreen.__breakpoint = current;
        var queued = false;
        if (typeof window.addEventListener === "function") window.addEventListener("resize", function () {
            if (queued) return;
            queued = true;
            (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () {
                queued = false;
                var next = M.activeBreakpoint(appBreakpoints(), screen, width());
                if (next === effectiveScreen.__breakpoint) return;
                effectiveScreen.__breakpoint = next;
                applyBreakpointTree(screen, next);
                redrawForBreakpoint(effectiveScreen, screen);
                writeVariable(effectiveScreen, CURRENT_APP_SCOPE, "$breakpoint", next);
            });
        });
    }
    function applyBreakpointTree(screen, id) {
        var M = window.NexaModel, chain = M.chainFor(appBreakpoints(), screen, id);
        walkNodes(screen.components, function (n) { M.applyOverrides(n, n.__bpBase || M.baseOf(n), chain); });
    }
    // The tree changed in place: every drawn node gets its box, visibility and props again.
    function redrawForBreakpoint(effectiveScreen, screen) {
        var M = window.NexaModel;
        function visit(list, inheritedVis) {
            (list || []).forEach(function (node) {
                var vis = combineVisibility(inheritedVis, node);
                var el = elById(node.id);
                if (el) {
                    var host = el.parentNode;
                    var parentNode = host && host.__nexaNode || null, parentSize = host && host.__nexaSize || null;
                    if (el.__carousel || el.__zoom) {
                        // it set itself up (a track / a viewport inside): only its box on the page
                        var box = M.boxCss(node, parentNode, { constraints: true, parentSize: parentSize });
                        Object.keys(box).forEach(function (k) { el.style.setProperty(k, box[k]); });
                    } else {
                        applyNodeBox(el, node, parentNode, parentSize);
                    }
                    if (vis !== "show") el.style.display = "none";
                    else if (el.style.display === "none") el.style.display = el.__carousel || el.__zoom ? "block" : "";
                    var comp = compIndex(effectiveScreen)[node.id];
                    if (comp && !isStructural(node) && node.type !== "@template") {
                        ["props", "x", "y", "w", "h"].forEach(function (k) { comp[k] = node[k]; });
                        refreshComponentRender(effectiveScreen, comp);
                    }
                    if (el.__carousel) el.__carousel.refresh();
                    if (el.__zoom) el.__zoom.refresh();
                    if (el.__overlay) el.__overlay.place();   // its own placement (the breakpoint may change it)
                }
                if (isContainerNode(node)) visit(node.children, vis);
            });
        }
        visit(screen.components, "show");
        registerSparkplugBoundComponentsFrom(effectiveScreen);
        queuePins(true);
    }

    // ---- The theme (src/model/theme.js): design tokens as CSS variables, light / dark ---------
    // The page gets every token as a CSS variable (html[data-nexa-mode="dark"] the dark
    // values); a prop bound to {token:…} is resolved in the current mode, and drawn again
    // when it changes. {$colorMode} is the mode in use; Set Variable $colorMode to
    // "light" / "dark" / "system" switches it (kept for this browser).
    var THEME = { theme: null, mode: "light", pref: "light", media: null };
    var COLOR_MODE_KEY = "nexa:colorMode";
    function startTheme(screen, app) {
        var M = window.NexaModel;
        if (!M || !M.themeOf) return;
        THEME.theme = M.themeOf(app);
        var into = document.head || document.documentElement;
        var style = typeof document.getElementById === "function" ? document.getElementById("nexa-theme-css") : null;
        if (!style && into && typeof into.appendChild === "function") { style = document.createElement("style"); style.id = "nexa-theme-css"; into.appendChild(style); }
        if (style) style.textContent = M.themeCss(THEME.theme, ":root", 'html[data-nexa-mode="dark"]');
        var stored = null;
        try { stored = window.localStorage && window.localStorage.getItem(COLOR_MODE_KEY); } catch (e) { /* no storage */ }
        applyColorMode(screen, stored || THEME.theme.defaultMode || "light", false);
    }
    function systemMode() {
        return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    // -> the mode in use ("light" / "dark"), what {$colorMode} holds
    function applyColorMode(screen, pref, keep) {
        pref = pref === "dark" || pref === "system" ? pref : "light";
        THEME.pref = pref;
        var mode = pref === "system" ? systemMode() : pref;
        if (pref === "system" && !THEME.media && typeof window.matchMedia === "function") {
            THEME.media = window.matchMedia("(prefers-color-scheme: dark)");
            var onOs = function () { if (THEME.pref === "system") writeVariable(screen, CURRENT_APP_SCOPE, "$colorMode", "system"); };
            if (THEME.media.addEventListener) THEME.media.addEventListener("change", onOs); else if (THEME.media.addListener) THEME.media.addListener(onOs);
        }
        if (keep) { try { window.localStorage.setItem(COLOR_MODE_KEY, pref); } catch (e) { /* no storage */ } }
        var changed = THEME.mode !== mode;
        THEME.mode = mode;
        if (document.documentElement && typeof document.documentElement.setAttribute === "function") document.documentElement.setAttribute("data-nexa-mode", mode);
        if (window.NexaSDK && window.NexaSDK.setTheme) window.NexaSDK.setTheme(THEME.theme, mode);
        if (CURRENT_APP_SCOPE && !keep) CURRENT_APP_SCOPE.$colorMode = mode;
        // what shows a token's value: drawn again (a frame's CSS variables follow by themselves)
        if (changed && screen && screen.components) screen.components.forEach(function (c) { if (propsMention(c.props, "{token:")) refreshComponentRender(screen, c); });
        return mode;
    }

    // ---- Teleport: a node drawn in another place of the page ----------------------------------
    // node.teleport = "<name>" (a frame whose `slot` is that name: drawn inside it, placed by
    // its layout) or "@page" (the page itself, above every frame: out of any clip). Only its
    // element moves: its namespace — and so its Logic, params, variables and bindings —
    // stays where it is in the tree. A target not on the page: it stays where it is.
    var PENDING_TELEPORTS = [];
    function teleportTarget(name) {
        var art = document.getElementById("nexa-runtime-artboard");
        if (name === "@page") return art;
        var list = document.querySelectorAll("[data-teleport-slot]");
        for (var i = 0; i < list.length; i++) if (list[i].getAttribute("data-teleport-slot") === name) return list[i].__childHost || list[i];
        return null;
    }
    function applyTeleports(screen) {
        var pending = PENDING_TELEPORTS.splice(0);
        pending.forEach(function (t) {
            var host = teleportTarget(t.node.teleport);
            if (!host) { logicTrace("teleport: no target", t.node.teleport, t.ns); return; }
            teleportEl(t.el, host, t.node.teleport);
        });
        if (pending.length) queuePins(true);
    }
    // `el` (a node's element) drawn in `host`; the first move leaves a marker where it was
    // (its home), so it can go back exactly there
    function teleportEl(el, host, label) {
        var st = el.__overlay;
        var moving = st ? st.layer : el;
        // not into itself / something inside it
        if (!host || moving === host || (typeof moving.contains === "function" && moving.contains(host))) return false;
        if (!el.__home && moving.parentNode) {
            var mark = document.createComment("nexa-home");
            moving.parentNode.insertBefore(mark, moving);
            el.__home = mark;
        }
        host.appendChild(moving);
        if (label) el.setAttribute("data-teleported", label);
        placeIn(el, host);
        return true;
    }
    function teleportHome(el) {
        var mark = el.__home;
        if (!mark || !mark.parentNode) return false;
        var st = el.__overlay, moving = st ? st.layer : el;
        mark.parentNode.insertBefore(moving, mark);
        el.removeAttribute("data-teleported");
        placeIn(el, mark.parentNode);
        return true;
    }
    // its box against the place it is in now (a target's layout, the page, its home)
    function placeIn(el, host) {
        var st = el.__overlay, node = el.__nexaModel;
        if (st) {
            // a dialog / drawer: its scope is where it is now
            var root = host.id === "nexa-runtime-artboard";
            var scaled = root && typeof getComputedStyle === "function" && getComputedStyle(host).transform && getComputedStyle(host).transform !== "none";
            st.scope = host; st.root = root; st.fixedRoot = root && !scaled;
            st.layer.style.position = st.fixedRoot ? "fixed" : "absolute";
            st.place();
        } else if (node) {
            var shown = el.style.display;
            applyNodeBox(el, node, host.__nexaNode || null, host.__nexaSize || null);
            if (shown === "none") el.style.display = "none";
        }
        if (el.__carousel) el.__carousel.refresh();
        if (el.__zoom) el.__zoom.refresh();
        queuePins(true);
    }

    // ---- Overlays (src/model/layout.js overlayOf): a dialog / drawer frame on top of its scope ---
    // The frame goes into a layer over its parent (the page for a root node: fixed to the
    // window when the screen is not scaled; else the frame it is in): a backdrop, and the
    // frame placed in it — a dialog by its alignment and margin, a drawer along a side.
    // Closed: the layer is hidden. Open (Logic "Open", startOpen): shown on top of every
    // open one (a stack: Esc closes the top one). Closed by the backdrop, Esc, a timer,
    // Logic "Close" (with a result) — the "Open" node that opened it then continues with
    // msg.payload = the result, msg.closedBy = how. "open" / "close" fire as its events.
    var OVERLAYS = {};
    var overlayStack = [];
    var overlayZ = 1000;
    var overlayKeysWired = false;
    var FLEX = { start: "flex-start", center: "center", end: "flex-end" };
    function overlayModel(node) { return window.NexaModel && window.NexaModel.overlayOf ? window.NexaModel.overlayOf(node) : null; }
    function setupOverlay(screen, el, comp, ns, parentEl) {
        var root = parentEl && parentEl.id === "nexa-runtime-artboard";
        var layer = document.createElement("div");
        layer.className = "nexa-overlay-layer";
        layer.setAttribute("data-overlay", ns);
        var ls = layer.style;
        var scaled = root && typeof getComputedStyle === "function" && getComputedStyle(parentEl).transform && getComputedStyle(parentEl).transform !== "none";
        ls.position = root && !scaled ? "fixed" : "absolute";
        ls.left = ls.top = ls.right = ls.bottom = "0";
        ls.display = "none";
        ls.overflow = "hidden";
        ls.boxSizing = "border-box";
        var backdrop = document.createElement("div");
        backdrop.className = "nexa-overlay-backdrop";
        backdrop.style.position = "absolute";
        backdrop.style.left = backdrop.style.top = backdrop.style.right = backdrop.style.bottom = "0";
        parentEl.insertBefore(layer, el);
        layer.appendChild(backdrop);
        layer.appendChild(el);
        var st = { ns: ns, node: comp, screen: screen, layer: layer, el: el, backdrop: backdrop, open: false, pending: null, timer: null, dx: 0, dy: 0, hideTimer: null,
            scope: parentEl, root: root, fixedRoot: root && !scaled };
        st.place = function () { placeOverlay(st); if (st.open) st.pin(); };
        // the layer covers the part of its scope in view, and stays there while it scrolls
        // (a frame that scrolls; a page scaled to the window's width)
        st.pin = function () { pinOverlayLayer(st); };
        if (!st.fixedRoot) {
            var onScroll = function () { if (st.open) st.pin(); };
            if (root) { window.addEventListener("scroll", onScroll, { passive: true }); window.addEventListener("resize", onScroll); }
            else if (typeof parentEl.addEventListener === "function") parentEl.addEventListener("scroll", onScroll, { passive: true });
        }
        el.__overlay = st;
        OVERLAYS[ns] = st;
        backdrop.addEventListener("click", function () {
            var o = overlayModel(st.node);
            if (o && o.closeOnBackdrop) closeOverlay(st, undefined, "backdrop");
        });
        wireOverlayDrag(st);
        if (!overlayKeysWired && typeof document.addEventListener === "function") {
            overlayKeysWired = true;
            document.addEventListener("keydown", function (e) {
                if (e.key !== "Escape") return;
                for (var i = overlayStack.length - 1; i >= 0; i--) {
                    var o = overlayModel(overlayStack[i].node);
                    if (o && o.closeOnEsc) { closeOverlay(overlayStack[i], undefined, "esc"); e.stopPropagation(); return; }
                    if (o && o.modal) return;   // a modal one on top keeps Esc from the ones below
                }
            });
        }
        placeOverlay(st);
        var o0 = overlayModel(comp);
        if (o0 && o0.startOpen) setTimeout(function () { openOverlay(screen, ns, null, null); }, 0);
        return st;
    }
    function pinOverlayLayer(st) {
        if (st.fixedRoot) return;
        var p = st.scope, ls = st.layer.style, left, top, w, h;
        if (st.root) {
            // a scaled page: the window, in the artboard's own (design) units — the whole
            // window, also where the content runs past the screen's height
            var r = p.getBoundingClientRect(), s = p.offsetWidth ? r.width / p.offsetWidth : 1;
            var vw = window.innerWidth || r.right, vh = window.innerHeight || r.bottom;
            left = -r.left / s; top = -r.top / s;
            w = vw / s; h = vh / s;
        } else {
            // a frame: its visible box, wherever it is scrolled to
            left = p.scrollLeft || 0; top = p.scrollTop || 0; w = p.clientWidth; h = p.clientHeight;
        }
        ls.right = ls.bottom = "auto";
        ls.left = left + "px"; ls.top = top + "px";
        ls.width = w + "px"; ls.height = h + "px";
    }
    // the transform of the panel while hidden (its animation's start)
    function overlayHiddenTransform(o) {
        if (o.animation === "slide") {
            if (o.kind === "drawer") return { left: "translateX(-100%)", right: "translateX(100%)", top: "translateY(-100%)", bottom: "translateY(100%)" }[o.side];
            return "translateY(24px)";
        }
        if (o.animation === "scale") return "scale(0.94)";
        return "";
    }
    function placeOverlay(st) {
        var o = overlayModel(st.node);
        if (!o) return;
        var el = st.el, ls = st.layer.style, es = el.style;
        var bd = st.backdrop.style;
        bd.background = o.backdrop === "none" ? "transparent" : "rgba(0,0,0," + (o.backdrop === "blur" ? Math.min(o.backdropOpacity, 0.25) : o.backdropOpacity) + ")";
        bd.backdropFilter = bd.webkitBackdropFilter = o.backdrop === "blur" ? "blur(4px)" : "";
        // not modal without a backdrop: the page behind stays usable (only the panel takes the pointer)
        var passThrough = !o.modal && o.backdrop === "none";
        // dragged anywhere: the panel may leave its scope (else the scope clips it)
        ls.overflow = o.draggable && o.dragWithin === "page" ? "visible" : "hidden";
        ls.pointerEvents = passThrough ? "none" : "auto";
        bd.pointerEvents = passThrough ? "none" : "auto";
        es.pointerEvents = "auto";
        es.right = es.bottom = "";
        es.maxWidth = es.maxHeight = "";
        if (o.kind === "drawer") {
            ls.padding = "0";
            es.position = "absolute";
            var horizontal = o.side === "left" || o.side === "right";
            es.top = horizontal || o.side === "top" ? "0" : "auto";
            es.bottom = horizontal || o.side === "bottom" ? "0" : "";
            es.left = !horizontal || o.side === "left" ? "0" : "auto";
            es.right = !horizontal || o.side === "right" ? "0" : "";
            es.width = horizontal ? (st.node.w || 320) + "px" : "auto";
            es.height = horizontal ? "auto" : (st.node.h || 240) + "px";
            es.maxWidth = "100%";
            es.maxHeight = "100%";
        } else {
            ls.padding = o.margin + "px";
            ls.justifyContent = FLEX[o.alignX] || "center";
            ls.alignItems = FLEX[o.alignY] || "center";
            es.position = "relative";
            es.left = es.top = "auto";
            es.width = (st.node.w || 320) + "px";
            es.height = (st.node.h || 200) + "px";
            es.maxWidth = "100%";
            es.maxHeight = "100%";
            es.flex = "0 0 auto";
        }
        var dur = o.animation === "none" ? 0 : o.duration;
        es.transition = dur ? "transform " + dur + "ms ease, opacity " + dur + "ms ease" : "";
        bd.transition = dur ? "opacity " + dur + "ms ease" : "";
        applyOverlayState(st, o);
    }
    function applyOverlayState(st, o) {
        var es = st.el.style, move = st.dx || st.dy ? "translate(" + st.dx + "px," + st.dy + "px) " : "";
        if (st.open) {
            es.opacity = "1";
            es.transform = move || "none";
            st.backdrop.style.opacity = "1";
        } else {
            es.opacity = o.animation === "none" ? "1" : "0";
            es.transform = move + overlayHiddenTransform(o) || "none";
            st.backdrop.style.opacity = "0";
        }
    }
    function openOverlay(screen, ns, msg, onClose) {
        var st = OVERLAYS[ns];
        if (!st) { logicTrace("open: no overlay", ns); return false; }
        var o = overlayModel(st.node);
        if (!o) return false;
        // opened again while open: the newer Open node is the one that gets the result
        if (onClose) st.pending = { msg: msg || {}, onClose: onClose };
        if (screen) st.screen = screen;
        clearTimeout(st.hideTimer);
        st.layer.style.zIndex = String(++overlayZ);
        var i = overlayStack.indexOf(st);
        if (i !== -1) overlayStack.splice(i, 1);
        overlayStack.push(st);
        if (o.autoClose) { clearTimeout(st.timer); st.timer = setTimeout(function () { closeOverlay(st, undefined, "timer"); }, o.autoClose); }
        if (st.open) return true;
        st.layer.style.display = o.kind === "drawer" ? "block" : "flex";
        st.pin();
        applyOverlayState(st, o);          // the hidden state, drawn…
        void st.layer.offsetWidth;         // …once, so the change below animates
        st.open = true;
        applyOverlayState(st, o);
        if (st.el.__carousel) st.el.__carousel.refresh();
        if (st.el.__zoom) st.el.__zoom.refresh();
        queuePins(true);
        // its On Open event: msg.payload = what it was opened with
        fireUiEvent(st.screen, ns, "open", msg ? msg.payload : undefined);
        return true;
    }
    function closeOverlay(st, result, by) {
        if (!st || !st.open) return false;
        var o = overlayModel(st.node) || { duration: 0, animation: "none" };
        st.open = false;
        clearTimeout(st.timer);
        var i = overlayStack.indexOf(st);
        if (i !== -1) overlayStack.splice(i, 1);
        applyOverlayState(st, o);
        var dur = o.animation === "none" ? 0 : o.duration;
        st.hideTimer = setTimeout(function () {
            if (st.open) return;
            st.layer.style.display = "none";
            st.dx = st.dy = 0;        // dragged: back at its place next time
        }, dur);
        var p = st.pending;
        st.pending = null;
        // its On Close event: msg.payload = the result
        fireUiEvent(st.screen, st.ns, "close", result === undefined ? null : result);
        if (p) {
            var out = cloneMsg(p.msg || {});
            out.payload = result === undefined ? null : cloneValue(result);
            out.closedBy = by;
            p.onClose(out);
        }
        return true;
    }
    // the overlay a Close node means: one it names (in its own surface), else the top one
    function overlayForNode(node) {
        if (node.overlay) {
            var cut = node.id.lastIndexOf("::");
            return OVERLAYS[(cut === -1 ? "" : node.id.slice(0, cut + 2)) + node.overlay] || null;
        }
        return overlayStack[overlayStack.length - 1] || null;
    }
    // draggable: by any part that is not a control (a button, a field…), within the scope or anywhere
    function wireOverlayDrag(st) {
        var el = st.el;
        if (typeof el.addEventListener !== "function") return;
        el.addEventListener("pointerdown", function (e) {
            var o = overlayModel(st.node);
            if (!o || !o.draggable || !st.open || e.button !== 0) return;
            var path = typeof e.composedPath === "function" ? e.composedPath() : [e.target];
            for (var i = 0; i < path.length && path[i] !== el; i++) {
                var t = path[i];
                if (t && t.matches && t.matches("button, input, select, textarea, a, [contenteditable], [role=button], [role=slider], [data-no-drag]")) return;
            }
            e.preventDefault();
            var sx = e.clientX, sy = e.clientY, ox = st.dx, oy = st.dy;
            var lr = st.layer.getBoundingClientRect(), er = el.getBoundingClientRect();
            // the panel as placed (no drag): the offsets it may take inside the scope
            var bx = er.left - ox, by = er.top - oy;
            var prevTransition = el.style.transition;
            el.style.transition = "";
            el.style.userSelect = "none";
            function move(ev) {
                var nx = ox + ev.clientX - sx, ny = oy + ev.clientY - sy;
                if (o.dragWithin !== "page") {
                    nx = Math.min(lr.right - er.width - bx, Math.max(lr.left - bx, nx));
                    ny = Math.min(lr.bottom - er.height - by, Math.max(lr.top - by, ny));
                }
                st.dx = nx; st.dy = ny;
                applyOverlayState(st, o);
            }
            function up() {
                document.removeEventListener("pointermove", move);
                document.removeEventListener("pointerup", up);
                el.style.transition = prevTransition;
                el.style.userSelect = "";
            }
            document.addEventListener("pointermove", move);
            document.addEventListener("pointerup", up);
        });
    }

    // Nodes mounted after the page started (the content of a component's slots, when its
    // plugin registered late): everything mountScreen did once for the first tree is done
    // for them too — their tags subscribed (else a bound value stays "???"), their
    // teleports, their templates' param-input, their Logic's onload / onrender.
    function beginLateMount(effectiveScreen) {
        return { logicCount: effectiveScreen.logic.nodes.length, instances: Object.keys(effectiveScreen.__paramStates || {}) };
    }
    function endLateMount(effectiveScreen, before) {
        applyTeleports(effectiveScreen);
        registerSparkplugBoundComponentsFrom(effectiveScreen);
        var states = effectiveScreen.__paramStates || {};
        Object.keys(states).forEach(function (ns) {
            if (before.instances.indexOf(ns) === -1) fireParamInputForInstance(effectiveScreen, ns, states[ns]);
        });
        var added = effectiveScreen.logic.nodes.slice(before.logicCount);
        ["onload", "onrender"].forEach(function (type) {
            added.filter(function (n) { return n.type === type; }).forEach(function (n) { runLogicGraph(effectiveScreen, n, cloneMsg({ payload: null })); });
        });
    }

    // The layer a docked node is drawn in: over what is in view of its parent — a frame's
    // visible box wherever it is scrolled to, the screen's part of the window — kept there
    // while that scrolls or resizes. It takes no pointer; what is docked in it does.
    // The surface a node "on the screen" is placed on: the screen, or the template it is in.
    function surfaceElOf(el) {
        for (var e = el; e; e = e.parentElement) if (e.__nexaSurface || e.id === "nexa-runtime-artboard") return e;
        return el;
    }
    function dockLayerOf(scopeEl) {
        if (scopeEl.__dockLayer && scopeEl.__dockLayer.parentNode === scopeEl) return scopeEl.__dockLayer;
        var root = scopeEl.id === "nexa-runtime-artboard";
        var layer = document.createElement("div");
        layer.className = "nexa-dock-layer";
        var ls = layer.style;
        ls.position = "absolute"; ls.left = "0px"; ls.top = "0px"; ls.pointerEvents = "none"; ls.boxSizing = "border-box";
        layer.__nexaNode = scopeEl.__nexaNode || null;
        layer.__nexaSize = scopeEl.__nexaSize || null;
        scopeEl.appendChild(layer);
        scopeEl.__dockLayer = layer;
        var pin = function () {
            var left, top, w, h;
            if (root) {
                // the screen's part of the window, in the screen's own units (it may be scaled)
                var r = scopeEl.getBoundingClientRect(), k = scopeEl.offsetWidth ? r.width / scopeEl.offsetWidth : 1;
                if (!k) k = 1;
                // the viewport without its scrollbars (a docked footer is not under the scrollbar)
                var de = document.documentElement || {};
                var vw = de.clientWidth || window.innerWidth || r.right, vh = de.clientHeight || window.innerHeight || r.bottom;
                var x0 = Math.max(r.left, 0), y0 = Math.max(r.top, 0), x1 = Math.min(r.right, vw), y1 = Math.min(r.bottom, vh);
                left = (x0 - r.left) / k; top = (y0 - r.top) / k;
                w = Math.max(0, x1 - x0) / k; h = Math.max(0, y1 - y0) / k;
            } else {
                left = scopeEl.scrollLeft || 0; top = scopeEl.scrollTop || 0; w = scopeEl.clientWidth; h = scopeEl.clientHeight;
            }
            ls.left = left + "px"; ls.top = top + "px"; ls.width = w + "px"; ls.height = h + "px";
        };
        layer.__pin = pin;
        if (root) { window.addEventListener("scroll", pin, { passive: true }); window.addEventListener("resize", pin); }
        else if (typeof scopeEl.addEventListener === "function") scopeEl.addEventListener("scroll", pin, { passive: true });
        if (typeof ResizeObserver === "function") new ResizeObserver(pin).observe(scopeEl);
        pin();
        return layer;
    }

    function mountScreen(screen, templates) {
        var artboard = document.getElementById("nexa-runtime-artboard");
        if (!artboard || !screen) return;
        artboard.__nexaSize = { w: screen.width, h: screen.height };
        applyDisplayMode(screen, artboard);

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
        // the app ($route + app variables), then the screen's variables ("" = the screen)
        if (window.NexaModel && window.NexaModel.setTypes) window.NexaModel.setTypes((window.__NEXA_APP__ || {}).types || []);
        CURRENT_APP_SCOPE = makeAppScope(window.__NEXA_APP__ || { variables: [] });
        effectiveScreen.__scopes = { "@app": CURRENT_APP_SCOPE, "": makeScope(CURRENT_APP_SCOPE, screen.variables) };
        // the breakpoint of the window's width: its overrides on the tree before anything is drawn
        startBreakpoints(screen, effectiveScreen);
        // the theme: CSS variables, the colour mode ({$colorMode})
        startTheme(effectiveScreen, window.__NEXA_APP__ || {});
        (screen.logic && screen.logic.nodes || []).forEach(function (n) { effectiveScreen.logic.nodes.push(n); });
        (screen.logic && screen.logic.wires || []).forEach(function (w) { effectiveScreen.logic.wires.push(w); });

        (screen.components || []).forEach(function (comp) {
            mountAndFlatten(artboard, comp, "show", effectiveScreen.__templates, comp.id, [], effectiveScreen, effectiveScreen.__scopes[""]);
        });
        // every target exists now: what is teleported goes there
        applyTeleports(effectiveScreen);

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
                var late = null; // what its slots held, mounted only now
                Array.prototype.forEach.call(pending, function (el) {
                    var comp = findComponent(effectiveScreen, el.getAttribute("data-id"));
                    if (!comp) return;
                    if (el.__nexaPendingTimer) {
                        clearTimeout(el.__nexaPendingTimer);
                        el.__nexaPendingTimer = null;
                    }
                    el.removeAttribute("data-nexa-unknown");
                    el.textContent = "";
                    refreshComponentRender(effectiveScreen, comp);
                    // a component with slots: what they hold, now that it can place them
                    if (el.__mountSlots) {
                        var mountSlots = el.__mountSlots;
                        el.__mountSlots = null;
                        if (!late) late = beginLateMount(effectiveScreen);
                        mountSlots(window.NEXA.getComponent(id));
                    }
                });
                if (late) endLateMount(effectiveScreen, late);
            });
        }
    }

    if (window.__NEXA_SCREEN__) {
        mountScreen(window.__NEXA_SCREEN__, window.__NEXA_TEMPLATES__ || []);
    }
})();
