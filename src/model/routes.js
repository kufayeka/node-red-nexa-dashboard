// URL -> screen, for the deployed pages (pure: no DOM, no HTTP). The screen worker
// resolves a request with it, the page resolves its own navigation with the same rules.
//
// Every route goes through a Screen Flow: /nexa/<flow endpoint>[/<screen path>]. A flow's
// screens are the ones its Render Screen / Goto Screen nodes name, and the ones those
// screens' Goto Screen nodes reach. A project without flows (older projects, fixtures)
// serves screens by their own path.

/** "/line/:id" vs "/line/7" -> {id: "7"}; no match -> null. */
export function matchScreenPath(pattern, actualPath) {
    if (!pattern || !actualPath) return null;
    const patternParts = pattern.split("/").filter(Boolean);
    const actualParts = actualPath.split("/").filter(Boolean);
    if (patternParts.length !== actualParts.length) return null;
    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].charAt(0) === ":") params[patternParts[i].slice(1)] = decodeURIComponent(actualParts[i]);
        else if (patternParts[i] !== actualParts[i]) return null;
    }
    return params;
}

/** The ids of the screens a flow can show (see above), in the order found. */
export function flowScreenIds(flow, screens) {
    if (!flow || !flow.logic || !Array.isArray(flow.logic.nodes)) return [];
    const all = screens || [];
    const ids = [];
    function add(id) {
        const sid = id ? String(id).trim() : "";
        if (!sid || ids.indexOf(sid) !== -1) return;
        ids.push(sid);
        const scr = all.find(function (s) { return s.id === sid; });
        ((scr && scr.logic && scr.logic.nodes) || []).forEach(function (n) {
            if (n && n.type === "navigate" && n.screenId) add(n.screenId);
        });
    }
    flow.logic.nodes.forEach(function (n) {
        if (n && (n.type === "render-screen" || n.type === "navigate") && n.screenId) add(n.screenId);
    });
    return ids;
}

/** A flow's endpoint, normalised: "/orders"; an empty one is "/flow<n>" (n = 1-based position). */
export function flowEndpoint(flow, index) {
    let ep = (flow.endpoint || "").trim();
    if (!ep) ep = "/flow" + (index + 1);
    if (ep.charAt(0) !== "/") ep = "/" + ep;
    return ep.replace(/\/+$/, "");
}

/** The flow "/" goes to: the default one, else the first enabled one. */
export function defaultFlow(project) {
    const flows = project.flows || [];
    return flows.find(function (f) { return !f.disabled && f.isDefault; }) || flows.find(function (f) { return !f.disabled; }) || null;
}

function notFound(text) { return { kind: "not-found", text: text }; }

function enabledScreen(project, id) {
    return (project.screens || []).find(function (s) { return s.id === id && !s.disabled; }) || null;
}

// the screen a Route Trigger / Route Not Found node leads to (its first wire), if the flow may show it
function screenAfter(project, flow, sourceType, allowedIds) {
    const nodes = (flow.logic && flow.logic.nodes) || [];
    const source = nodes.find(function (n) { return n.type === sourceType; });
    if (!source) return { node: null, screen: null, fanOut: 0 };
    const wires = ((flow.logic && flow.logic.wires) || []).filter(function (w) { return w.from === source.id; });
    const targets = wires.map(function (w) {
        return nodes.find(function (n) { return n.id === w.to && (n.type === "render-screen" || n.type === "navigate"); });
    }).filter(Boolean);
    const next = wires[0] && nodes.find(function (n) { return n.id === wires[0].to; });
    const ok = next && (next.type === "render-screen" || next.type === "navigate") && next.screenId && allowedIds.indexOf(next.screenId) !== -1;
    return { node: source, screen: ok ? enabledScreen(project, next.screenId) : null, fanOut: targets.length };
}

/**
 * A request path under /nexa ("/orders/detail/7") -> what to serve:
 *   {kind: "screen", screen, flow, params, warnings}
 *   {kind: "redirect", location}          "/" -> the default flow (search is kept)
 *   {kind: "not-found", text}
 * @param {object} project   {screens, flows}
 * @param {string} subPath   the path after the runtime prefix
 * @param {{prefix?: string, search?: string}} [opts]  prefix "/nexa"; search "?a=1" (kept on a redirect)
 */
export function resolveScreenRoute(project, subPath, opts) {
    opts = opts || {};
    const prefix = opts.prefix || "/nexa";
    if (!subPath) subPath = "/";
    if (subPath.charAt(0) !== "/") subPath = "/" + subPath;
    const flows = project.flows || [];
    const screens = project.screens || [];

    // no flows at all: a screen by its own path
    if (!flows.length) {
        for (let i = 0; i < screens.length; i++) {
            const params = matchScreenPath(screens[i].path || ("/" + screens[i].id), subPath);
            if (!params) continue;
            if (screens[i].disabled) return notFound("Nexa screen is disabled: " + subPath);
            return { kind: "screen", screen: screens[i], flow: null, params: params, warnings: [] };
        }
    }

    if (subPath === "/") {
        const def = defaultFlow(project);
        if (def) {
            let ep = (def.endpoint || "").trim() || "/flow1";
            if (ep.charAt(0) !== "/") ep = "/" + ep;
            return { kind: "redirect", location: prefix + ep + (opts.search && opts.search !== "?" ? opts.search : "") };
        }
    }

    const warnings = [];
    for (let f = 0; f < flows.length; f++) {
        const flow = flows[f];
        if (flow.disabled) continue;
        const ep = flowEndpoint(flow, f);
        const flowName = flow.name || flow.id;
        const allowedIds = flowScreenIds(flow, screens);

        // the flow's own endpoint: its entry screen
        if (subPath === ep || subPath === ep + "/") {
            if (!allowedIds.length) return notFound("No accessible screens defined in Flow: " + flowName + ". Please add a 'Render Screen' node to define accessible screens.");
            const entry = screenAfter(project, flow, "route-trigger", allowedIds);
            if (entry.fanOut > 1) warnings.push("Route Trigger fan-out warning in Flow '" + flowName + "': connected to " + entry.fanOut + " render targets. Ambiguous entry screen.");
            let screen = entry.screen;
            if (!screen) {
                // any screen a Render Screen / Goto Screen node of the flow names
                const nodes = (flow.logic && flow.logic.nodes) || [];
                for (let n = 0; n < nodes.length && !screen; n++) {
                    if ((nodes[n].type === "render-screen" || nodes[n].type === "navigate") && nodes[n].screenId && allowedIds.indexOf(nodes[n].screenId) !== -1) {
                        screen = enabledScreen(project, nodes[n].screenId);
                    }
                }
            }
            if (!screen) screen = enabledScreen(project, allowedIds[0]);
            if (!screen) return notFound("None of the screens defined in Flow '" + flowName + "' are available or enabled.");
            return { kind: "screen", screen: screen, flow: flow, params: {}, warnings: warnings };
        }

        // a screen under the flow: /<endpoint>/<screen path>
        if (subPath.indexOf(ep + "/") === 0) {
            let scrPath = subPath.slice(ep.length);
            if (scrPath.charAt(0) !== "/") scrPath = "/" + scrPath;
            const target = screens.find(function (s) {
                if (s.disabled) return false;
                let sp = (s.path || ("/" + s.id)).trim();
                if (sp.charAt(0) !== "/") sp = "/" + sp;
                return sp === scrPath || matchScreenPath(sp, scrPath);
            });
            if (!target) {
                const nf = screenAfter(project, flow, "route-not-found", allowedIds);
                if (nf.node) {
                    const screen = nf.screen || enabledScreen(project, allowedIds[0]);
                    if (screen) return { kind: "screen", screen: screen, flow: flow, params: { path: scrPath, notFound: true }, warnings: warnings };
                }
                return notFound("Screen '" + scrPath + "' not found in Flow: " + flowName);
            }
            if (allowedIds.indexOf(target.id) === -1) {
                return notFound("Screen '" + scrPath + "' is not accessible in Flow: " + flowName + ". Only screens defined via 'Render Screen' or 'Goto Screen' in this flow are accessible.");
            }
            return { kind: "screen", screen: target, flow: flow, params: matchScreenPath(target.path || ("/" + target.id), scrPath) || {}, warnings: warnings };
        }
    }

    return notFound("No Nexa flow found for path: " + subPath + ". Direct screen access is disabled — all routes must go through a Flow gateway (e.g. /nexa" + ((flows[0] && flows[0].endpoint) || "/flow1") + ").");
}
