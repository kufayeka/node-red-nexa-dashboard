// Lit Web Components & Visual Template Mounting
// Compiles dynamic Lit components and mounts visual template instances.

import { state } from "../state.js";
import { applyNodeBox, combineVisibility, templateContentHost } from "./box.js";
import { isStructural, childNamespace, findTemplateById, getComponentTemplateTarget, mountSlotFrames } from "./slots.js";
import { buildComponentClone } from "../features/navigation.js";
import { resolveInstanceParamState } from "../state/scope.js";
import { interpolateProps } from "./render.js";
import { makeCtx } from "../logic/runner.js";

export function hashLitSource(str) {
    let h = 0;
    str = str || "";
    for (let i = 0; i < str.length; i++) {
        h = (h * 31 + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
}

export function getNexaLitBase() {
    if (!window.NEXA_LIT || !window.NEXA_LIT.LitElement) return null;
    if (!window.__nexaLitBase) {
        const LitElementBase = window.NEXA_LIT.LitElement;
        window.__nexaLitBase = class extends LitElementBase {
            emit(eventName, payload) {
                if (this.__nexaCtx && typeof this.__nexaCtx.emit === "function") {
                    this.__nexaCtx.emit(eventName, payload);
                }
            }
            mountTemplate(hostEl, templateIdOrName, paramValues, opts) {
                opts = opts || {};
                if (!hostEl) return;
                const templates = window.__NEXA_TEMPLATES__ || [];
                const template = findTemplateByIdOrName(templates, templateIdOrName);
                hostEl.innerHTML = "";
                if (!template) {
                    hostEl.textContent = "(mountTemplate: unknown template \"" + templateIdOrName + "\")";
                    return;
                }
                const w = opts.width || template.width;
                const h = opts.height || template.height;
                const wrapper = document.createElement("div");
                wrapper.style.position = "relative";
                wrapper.style.width = w + "px";
                wrapper.style.height = h + "px";
                wrapper.style.overflow = "hidden";
                hostEl.appendChild(wrapper);
                const namespace = (this.__nexaNamespace || "lit-embed") + "::embed::" +
                    (opts.key !== undefined ? opts.key : template.id);
                const fakeComp = { type: "@template", templateId: template.id, x: 0, y: 0, w: w, h: h, rotation: 0, paramValues: paramValues || {} };
                mountTemplateVisual(wrapper, fakeComp, "show", templates, namespace, [], this.__nexaScreen, undefined);
            }
            updated(changedProps) {
                const twoWay = this.constructor.__nexaTwoWayProps;
                if (twoWay && twoWay.length && this.__nexaCtx && typeof this.__nexaCtx.setBindableValue === "function") {
                    const self = this;
                    twoWay.forEach(function (name) {
                        if (changedProps.has(name)) self.__nexaCtx.setBindableValue(name, self[name]);
                    });
                }
            }
        };
    }
    return window.__nexaLitBase;
}

export function coerceLitBindableValue(type, value) {
    if (value === undefined || value === null) return value;
    if (type === "boolean") {
        if (typeof value === "string") return value !== "" && value !== "false" && value !== "0";
        return !!value;
    }
    if (type === "number") return typeof value === "number" ? value : (parseFloat(value) || 0);
    return value;
}

export function litPropertyCtor(type) {
    if (type === "number") return "Number";
    if (type === "boolean") return "Boolean";
    if (type === "object") return "Object";
    if (type === "array") return "Array";
    return "String";
}

export function compileLitComponentClass(litCode, litStyles, bindable) {
    const Base = getNexaLitBase();
    if (!Base) return { error: new Error("Lit runtime not loaded (window.NEXA_LIT missing)") };
    const cacheKey = hashLitSource(
        (litCode || "") + "||" + (litStyles || "") + "||" +
        (bindable || []).map(function (p) { return p.name + ":" + p.type + ":" + (p.twoWay ? "1" : "0"); }).join(",")
    );
    if (state.litClassCache[cacheKey]) return state.litClassCache[cacheKey];

    const propsDecl = "static properties = {" + (bindable || []).map(function (p) {
        return JSON.stringify(p.name) + ": { type: " + litPropertyCtor(p.type) + " }";
    }).join(",") + "};";
    const twoWayDecl = "static __nexaTwoWayProps = " + JSON.stringify(
        (bindable || []).filter(function (p) { return p.twoWay; }).map(function (p) { return p.name; })
    ) + ";";
    const safeStyles = String(litStyles || "").replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    const stylesDecl = litStyles ? ("static styles = css`" + safeStyles + "`;") : "";
    const defaultRender = "render(){ return html`<div style=\"color:#999;font-size:11px;padding:6px;\">(empty Lit component)</div>`; }";
    const classBody = propsDecl + "\n" + twoWayDecl + "\n" + stylesDecl + "\n" + (litCode || defaultRender);
    const tagName = "nexa-lit-" + cacheKey;

    let Klass;
    try {
        const factory = new Function("NexaLitBase", "html", "css", "nothing",
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
    const entry = { tagName: tagName, Klass: Klass };
    state.litClassCache[cacheKey] = entry;
    return entry;
}

export function renderLitComponentInstance(el, comp, props, ctx) {
    if (!window.NEXA_LIT || !window.NEXA_LIT.LitElement) {
        el.textContent = "(Lit runtime not loaded)";
        return;
    }
    const compiled = compileLitComponentClass(comp.litCode, comp.litStyles, comp.litBindable);
    if (compiled.error) {
        el.textContent = "(Lit compile error: " + compiled.error.message + ")";
        return;
    }
    const existing = el.firstElementChild;
    let instance;
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
        const hasOwn = props && Object.prototype.hasOwnProperty.call(props, p.name);
        instance[p.name] = coerceLitBindableValue(p.type, hasOwn ? props[p.name] : p.defaultValue);
    });
}

export function findTemplateByIdOrName(templates, idOrName) {
    return findTemplateById(templates, idOrName) ||
        (templates || []).filter(function (t) { return t.name === idOrName || t.identifier === idOrName; })[0];
}

export function mountTemplateVisual(parentEl, comp, inheritedVis, templates, namespace, visitedTemplateIds, screenForCtx, paramState) {
    const vis = combineVisibility(inheritedVis, comp);
    if (vis === "remove") return;
    const el = document.createElement("div");
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
        const template = findTemplateById(templates, comp.templateId);
        if (!template) { el.textContent = "(missing template)"; return; }
        if (visitedTemplateIds.indexOf(comp.templateId) !== -1) {
            el.textContent = "(circular template reference: " + template.name + ")";
            return;
        }
        const innerVisited = visitedTemplateIds.concat([comp.templateId]);
        const instanceParamState = resolveInstanceParamState(comp, template, paramState);
        if (template.kind === "component") {
            const targetComp = getComponentTemplateTarget(template);
            if (targetComp) {
                mountTemplateVisual(el, targetComp, "show", templates, namespace + "::" + targetComp.id, innerVisited, screenForCtx, instanceParamState);
            }
            return;
        }
        const inner = document.createElement("div");
        inner.style.position = "absolute";
        inner.style.left = "0";
        inner.style.top = "0";
        inner.style.width = "100%";
        inner.style.height = "100%";
        el.appendChild(inner);
        const contentHost = templateContentHost(inner, template, comp);
        (template.components || []).forEach(function (innerComp) {
            mountTemplateVisual(contentHost, innerComp, "show", templates, namespace + "::" + innerComp.id, innerVisited, screenForCtx, instanceParamState);
        });
        return;
    }

    const namespacedComp = buildComponentClone(comp, namespace);
    if (comp.type === "@lit-component") {
        renderLitComponentInstance(el, comp, interpolateProps(comp.props || {}, paramState, namespacedComp), makeCtx(screenForCtx, namespacedComp));
        return;
    }
    const typeDef = window.NEXA && window.NEXA.getComponent(comp.type);
    if (typeDef && typeof typeDef.render === "function") {
        if (el.__nexaPendingTimer) { clearTimeout(el.__nexaPendingTimer); el.__nexaPendingTimer = null; }
        if (typeof el.removeAttribute === "function") el.removeAttribute("data-nexa-unknown");
        if (typeof typeDef.migrateProps === "function") namespacedComp.props = typeDef.migrateProps(namespacedComp.props || {});
        try {
            const ctx = makeCtx(screenForCtx, namespacedComp);
            typeDef.render(el, interpolateProps(namespacedComp.props || {}, paramState, namespacedComp), ctx);
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
