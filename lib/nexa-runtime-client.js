// Mounts one deployed screen's component tree into #nexa-runtime-artboard,
// AND runs its screen.logic graph — this is the deployed-page counterpart
// of the Pages editor's own execution engine (runLogicGraph/fireLifecycle/
// fireUiEvent in lib/nexa-plugin.html's <script>), reimplemented here in
// plain vanilla JS (no jQuery — this file ships to public, unauthenticated
// pages) against the actual rendered DOM instead of the editor's canvas.
// Deliberately a plain, chrome-free version of the editor's own
// renderComponent()/isLayerVisible() — no drag, no resize/rotate handles,
// no selection outline, since there's nothing to edit here, only to run.
// Same render()/onBind() component contract either way.
(function () {
    function isLayerVisible(screen, layerId) {
        var layers = screen.layers || [];
        var layer = layers.filter(function (l) { return l.id === layerId; })[0];
        while (layer) {
            if (!layer.visible) return false;
            var parentId = layer.parentId;
            layer = parentId ? layers.filter(function (l) { return l.id === parentId; })[0] : null;
        }
        return true;
    }

    function findComponent(screen, id) {
        return (screen.components || []).filter(function (c) { return c.id === id; })[0];
    }

    function findLogicNode(screen, id) {
        return ((screen.logic && screen.logic.nodes) || []).filter(function (n) { return n.id === id; })[0];
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
        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        if (!typeDef || typeof typeDef.render !== "function") return;
        try {
            typeDef.render(el, comp.props || {}, makeCtx(screen, comp));
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
            emit: function (eventName, payload) {
                console.log("[nexa] component event", comp.type, comp.id, eventName, payload);
                fireUiEvent(screen, comp.id, eventName, payload);
            }
        };
    }

    function mountComponent(artboard, screen, comp) {
        var typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
        var el = document.createElement("div");
        el.setAttribute("data-id", comp.id);
        el.style.position = "absolute";
        el.style.left = comp.x + "px";
        el.style.top = comp.y + "px";
        el.style.width = comp.w + "px";
        el.style.height = comp.h + "px";
        el.style.transform = getComponentTransform(comp);
        el.style.boxSizing = "border-box";
        el.style.display = isLayerVisible(screen, comp.layerId) ? "" : "none";
        artboard.appendChild(el);

        if (typeDef && typeof typeDef.render === "function") {
            try {
                typeDef.render(el, comp.props || {}, makeCtx(screen, comp));
            } catch (e) {
                el.textContent = "(render error: " + e.message + ")";
            }
        } else {
            el.textContent = "(unknown component: " + comp.type + ")";
        }
    }

    function mountScreen(screen) {
        var artboard = document.getElementById("nexa-runtime-artboard");
        if (!artboard || !screen) return;
        (screen.components || []).forEach(function (comp) { mountComponent(artboard, screen, comp); });
        // A deployed page has no "open the tray"/"switch screens" moment
        // the way the editor does — the page load itself IS both of those
        // at once, so onload and onrender both fire here, once.
        fireLifecycle(screen, "onload");
        fireLifecycle(screen, "onrender");
        window.addEventListener("beforeunload", function () { fireLifecycle(screen, "onclose"); });

        // "Inject" nodes are sources with no incoming trigger (like
        // onload/ui-event) — they start their own timer instead, same idea
        // as Node-RED's own inject node's "repeat" option.
        ((screen.logic && screen.logic.nodes) || []).filter(function (n) { return n.type === "inject"; }).forEach(function (n) {
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
                runLogicGraph(screen, n, cloneMsg(msg));
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

    if (window.__NEXA_SCREEN__) {
        mountScreen(window.__NEXA_SCREEN__);
    }
})();
