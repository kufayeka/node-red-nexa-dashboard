// DOM Box & Constraints Styling
// Positions and sizes DOM elements according to NexaModel / Figma constraints,
// auto-layout CSS, and transforms.

import { VIS_RANK } from "../state.js";

export function combineVisibility(inherited, node) {
    const own = (node && node.visibility) || "show";
    return VIS_RANK[own] > VIS_RANK[inherited || "show"] ? own : (inherited || "show");
}

export function getComponentTransform(comp) {
    let transform = "rotate(" + (comp.rotation || 0) + "deg)";
    if (comp.flipH || comp.flipV) {
        const sx = comp.flipH ? -1 : 1;
        const sy = comp.flipV ? -1 : 1;
        transform += " scale(" + sx + "," + sy + ")";
    }
    return transform;
}

export function ensureNoScrollbarCss() {
    if (typeof document === "undefined" || !document.head || document.getElementById("nexa-no-scrollbar-css")) return;
    const s = document.createElement("style");
    s.id = "nexa-no-scrollbar-css";
    s.textContent = ".nexa-no-scrollbar::-webkit-scrollbar { display: none; } .nexa-no-scrollbar { scrollbar-width: none; }";
    document.head.appendChild(s);
}

export function applyNodeBox(el, comp, parentNode, parentSize) {
    const M = window.NexaModel;
    const css = M ? M.boxCss(comp, parentNode, { constraints: true, parentSize: parentSize }) : {
        position: "absolute",
        left: (comp.x || 0) + "px",
        top: (comp.y || 0) + "px",
        width: comp.w + "px",
        height: comp.h + "px"
    };

    if (M && comp.type === "@frame") {
        const f = M.frameCss(comp, { scroll: true });
        Object.keys(f).forEach(function (k) { css[k] = f[k]; });
    }

    Object.keys(css).forEach(function (k) {
        if (typeof el.style.setProperty === "function") el.style.setProperty(k, css[k]);
        else el.style[k.replace(/-([a-z])/g, function (_m, c) { return c.toUpperCase(); })] = css[k];
    });

    if (M && comp.type === "@frame" && M.styleOf(comp).scrollbar === "hidden" && el.classList) {
        ensureNoScrollbarCss();
        el.classList.add("nexa-no-scrollbar");
    }

    const rotate = !M || M.canRotate(comp, parentNode);
    el.style.transform = rotate ? getComponentTransform(comp) : getComponentTransform({ flipH: comp.flipH, flipV: comp.flipV });
    el.style.boxSizing = "border-box";
}

export function templateContentHost(boxEl, template, instance) {
    const M = window.NexaModel;
    const tw = Number(template.width) || 1, th = Number(template.height) || 1;
    const fitOf = M && M.templateContentFit ? function (w, h) { return M.templateContentFit(template, w, h, instance); } : function () { return null; };
    if (!fitOf(tw, th)) {
        boxEl.__nexaSize = { w: tw, h: th };
        boxEl.__nexaSurface = true;
        return boxEl;
    }
    const layer = document.createElement("div");
    layer.style.position = "absolute";
    layer.style.left = "0";
    layer.style.top = "0";
    layer.style.width = tw + "px";
    layer.style.height = th + "px";
    layer.style.transformOrigin = "0 0";
    layer.__nexaSize = { w: tw, h: th };
    layer.__nexaSurface = true;
    boxEl.appendChild(layer);

    function fit() {
        const bw = boxEl.clientWidth, bh = boxEl.clientHeight;
        if (!bw || !bh) return;
        const f = fitOf(bw, bh);
        layer.style.transform = f.transform;
        layer.style.left = f.left + "px";
        layer.style.top = f.top + "px";
    }

    fit();
    if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(boxEl);
    else (window.requestAnimationFrame || setTimeout)(fit);
    return layer;
}

export var ACTIVE_DISPLAY_MODE_RESIZE = null;

export function resetScreenStyles(artboard) {
    if (ACTIVE_DISPLAY_MODE_RESIZE && typeof window !== "undefined" && window.removeEventListener) {
        window.removeEventListener("resize", ACTIVE_DISPLAY_MODE_RESIZE);
        ACTIVE_DISPLAY_MODE_RESIZE = null;
    }

    var body = typeof document !== "undefined" ? document.body : null;
    if (body) {
        if (body.classList) {
            ["nexa-mode-fixed", "nexa-mode-fit", "nexa-mode-fitWidth", "nexa-mode-fill"].forEach(function (cls) {
                body.classList.remove(cls);
            });
        }
        if (body.style) {
            body.style.overflow = "";
            body.style.overflowX = "";
            body.style.overflowY = "";
            body.style.height = "";
        }
    }

    if (artboard && artboard.style) {
        artboard.style.position = "relative";
        artboard.style.margin = "0";
        artboard.style.boxShadow = "none";
        artboard.style.transform = "none";
        artboard.style.transformOrigin = "0 0";
        artboard.style.left = "";
        artboard.style.top = "";
        artboard.style.width = "";
        artboard.style.height = "";
    }
}

export function applyDisplayMode(screen, artboard) {
    resetScreenStyles(artboard);

    var mode = screen.displayMode || "fixed";
    var body = typeof document !== "undefined" ? document.body : null;
    if (body && body.classList) {
        body.classList.add("nexa-mode-" + mode);
    }

    var w = Number(screen.width) || 1024;
    var h = Number(screen.height) || 768;
    var st = artboard.style;

    if (mode === "fill") {
        st.position = "relative";
        st.width = "100vw";
        st.height = "100vh";
        st.margin = "0";
        st.boxShadow = "none";
        st.transform = "none";
        st.left = "";
        st.top = "";
        if (body) {
            body.style.overflow = "hidden";
            body.style.height = "100vh";
        }
        return;
    }

    if (mode === "fixed") {
        st.position = "relative";
        st.width = w + "px";
        st.height = h + "px";
        st.transform = "none";
        st.left = "";
        st.top = "";

        if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
            st.margin = "";
            st.boxShadow = "";
            if (body) {
                body.style.overflowX = "auto";
                body.style.overflowY = "auto";
                body.style.height = "auto";
            }
            return;
        }

        st.position = "relative";
        st.width = w + "px";
        st.height = h + "px";
        st.margin = "20px auto";
        st.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
        st.transform = "none";
        st.left = "";
        st.top = "";
        if (body) {
            body.style.overflowX = "auto";
            body.style.overflowY = "auto";
            body.style.height = "auto";
        }
        return;
    }

    st.position = "absolute";
    st.width = w + "px";
    st.height = h + "px";
    st.margin = "0";
    st.boxShadow = "none";
    st.transformOrigin = "0 0";

    function layout() {
        var vw = (typeof window !== "undefined" && (window.innerWidth || (document.documentElement && document.documentElement.clientWidth))) || w;
        var vh = (typeof window !== "undefined" && (window.innerHeight || (document.documentElement && document.documentElement.clientHeight))) || h;
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

    if (typeof window !== "undefined" && window.addEventListener) {
        ACTIVE_DISPLAY_MODE_RESIZE = layout;
        window.addEventListener("resize", layout);
    }
}
