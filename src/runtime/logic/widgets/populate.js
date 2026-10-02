/**
 * @file src/runtime/logic/widgets/populate.js
 * @description Dynamic list population and data-binding engine for Nexa containers.
 * Clones and reconciles component/template instances based on incoming arrays or objects.
 */

import { findComponent, findTemplateById, getComponentTemplateTarget, findLogicNode } from "../../mounting/slots.js";
import { cloneMsg, logicTrace } from "../context.js";
import { cloneValue, valueFromMsg, sameValue, resolvePath } from "../../state/variable.js";
import { updateInstanceParam, fireParamInputForInstance } from "../../mounting/render.js";
import { applyTeleports } from "../../features/teleport.js";
import { mountAndFlatten } from "../../features/navigation.js";
import { runLogicGraph, continuePropagation } from "../runner.js";
import { sizingOf, unmountRepeated, startVirtual, stopVirtual } from "./virtual.js";

export function repeatList(screen, frameNs) {
    screen.__lists = screen.__lists || {};
    return screen.__lists[frameNs] || (screen.__lists[frameNs] = { entries: [], seq: 0 });
}

export function repeatKeyOf(node, item, list, seen) {
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

export function repeatNs(frameNs, key) {
    return frameNs + "#" + String(key).replace(/[^\w-]/g, "_");
}

export function elById(id) {
    return document.querySelector('[data-id="' + id + '"]');
}

export function mountRepeated(screen, node, frameNs, frameEl, entry, box) {
    var t = findTemplateById(screen.__templates, node.template);
    if (!t) {
        logicTrace("populate: no such template", node.template);
        return false;
    }
    var frame = findComponent(screen, frameNs);
    var scope = (screen.__scopes || {})[frameNs] || (frame && frame.__paramState) || (screen.__scopes || {})[""];
    var isCompTmpl = t.kind === "component";
    var targetComp = isCompTmpl ? getComponentTemplateTarget(t) : null;
    var initW = (targetComp && targetComp.w !== undefined) ? targetComp.w : (t.width || 100);
    var initH = (targetComp && targetComp.h !== undefined) ? targetComp.h : (t.height || 40);
    var inst = {
        id: entry.ns,
        type: "@template",
        templateId: t.id,
        x: 0,
        y: 0,
        w: initW,
        h: initH,
        paramValues: { item: entry.item, index: entry.index }
    };
    if (targetComp && targetComp.layoutChild) {
        inst.layoutChild = Object.assign({}, targetComp.layoutChild);
    }
    if (node.itemParam && node.itemParam !== "item") {
        inst.paramValues[node.itemParam] = entry.item;
    }
    var sz = sizingOf(t, node);
    var lcFill = inst.layoutChild ? Object.assign({}, inst.layoutChild) : {};
    if (sz.w === "fill") lcFill.w = "fill";
    if (sz.h === "fill") lcFill.h = "fill";
    if (box) {
        inst.x = box.x;
        inst.y = box.y;
        if (box.w) inst.w = box.w;
        if (box.h) inst.h = box.h;
    }
    if (lcFill.w || lcFill.h) inst.layoutChild = lcFill;
    ["minW", "maxW", "minH", "maxH"].forEach(function (k) {
        if (sz[k] !== "" && sz[k] !== undefined && isFinite(Number(sz[k]))) inst[k] = Number(sz[k]);
    });
    var nodesBefore = (screen.logic.nodes || []).length;
    mountAndFlatten(frameEl, inst, "show", screen.__templates, entry.ns, [], screen, scope);
    applyTeleports(screen);

    var pre = entry.ns + "::";
    fireParamInputForInstance(screen, entry.ns, screen.__paramStates[entry.ns]);
    (screen.logic.nodes || []).slice(nodesBefore).forEach(function (n) {
        if (n.id.indexOf(pre) === 0 && (n.type === "onload" || n.type === "onrender")) {
            runLogicGraph(screen, n, { payload: null });
        }
    });
    entry.mounted = true;
    return true;
}

export function runPopulate(screen, node, msg) {
    return batchSparkplugIndex(function () { runPopulateNow(screen, node, msg); });
}

export function runPopulateNow(screen, node, msg) {
    var cut = node.id.lastIndexOf("::");
    var frameNs = (cut === -1 ? "" : node.id.slice(0, cut + 2)) + node.container;
    var outerEl = elById(frameNs);
    var frameEl = outerEl && (outerEl.__childHost || outerEl);
    if (!frameEl || !node.template) {
        logicTrace("populate: no container / template", frameNs, node.template);
        return;
    }
    if (outerEl.__carousel && node.virtualize) {
        logicTrace("populate: a carousel draws every slide (Virtualize ignored)");
        node = Object.assign({}, node, { virtualize: false });
    }
    var list = repeatList(screen, frameNs);
    list.ownerId = node.id;
    var virtual = !!node.virtualize;

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

    function add(item, atStart, key) {
        if (byKey[key]) { update(byKey[key], item); return; }
        var e = { key: key, ns: repeatNs(frameNs, key), item: item, index: atStart ? 0 : list.entries.length };
        if (atStart) list.entries.unshift(e); else list.entries.push(e);
        byKey[key] = e;
        if (!virtual && !mountRepeated(screen, node, frameNs, frameEl, e)) {
            list.entries.splice(list.entries.indexOf(e), 1);
            delete byKey[key];
        }
    }

    function update(e, item) {
        if (sameValue(e.item, item)) return;
        e.item = item;
        if (!e.mounted) return;
        updateInstanceParam(screen, e.ns, "item", item);
        if (node.itemParam && node.itemParam !== "item") updateInstanceParam(screen, e.ns, node.itemParam, item);
    }

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
        var seenA = {};
        Object.keys(byKey).forEach(function (k) { seenA[k] = true; });
        (mode === "prepend" ? items.slice().reverse() : items).forEach(function (it) { add(it, mode === "prepend", repeatKeyOf(node, it, list, seenA)); });
    } else {
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

    list.entries.forEach(function (e, i) {
        if (e.index !== i) { e.index = i; updateInstanceParam(screen, e.ns, "index", i); }
        var el = elById(e.ns);
        if (el) frameEl.appendChild(el);
    });
    if (outerEl.__carousel) outerEl.__carousel.refresh();
    registerSparkplugBoundComponentsFrom(screen);
}

export function sendToHost(screen, node, msg, budget) {
    var cut = node.id.lastIndexOf("::");
    if (cut === -1) {
        logicTrace("send to host: not inside a template instance", node.id);
        return;
    }
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
    targets.forEach(function (n, i) {
        runLogicGraph(screen, n, i === 0 ? out : cloneMsg(out), budget);
    });
}
