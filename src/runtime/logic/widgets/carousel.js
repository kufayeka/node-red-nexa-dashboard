// Carousel Frame Engine
// Frame layout mode "carousel" with snap tracking, native swiping, arrows, and dots.

import { ownerOf } from "../../state/scope.js";
import { writeVariable, cloneValue } from "../../state/variable.js";

export const CAROUSEL_CSS = [
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

export function ensureCarouselCss() {
    if (document.getElementById("nexa-carousel-css") || !document.head) return;
    const s = document.createElement("style");
    s.id = "nexa-carousel-css";
    s.textContent = CAROUSEL_CSS;
    document.head.appendChild(s);
}

export function setupCarousel(screen, el, comp, ns, scope, c) {
    ensureCarouselCss();
    const M = window.NexaModel, L = M.layoutOf(comp);
    const horizontal = c.direction !== "vertical", fade = c.transition === "fade";
    if (el.style.display !== "none") el.style.display = "block";
    el.style.padding = "0";
    el.style.overflowX = "";
    el.style.overflowY = "";
    el.style.overflow = "hidden";
    if (!el.style.position || el.style.position === "static") el.style.position = "relative";
    const track = document.createElement("div");
    track.className = "nexa-carousel-track";
    track.setAttribute("tabindex", "0");
    const tcss = M.carouselTrackCss(comp, true);
    tcss.position = "relative"; tcss.width = "100%"; tcss.height = "100%"; tcss["box-sizing"] = "border-box";
    tcss.padding = L.padding.t + "px " + L.padding.r + "px " + L.padding.b + "px " + L.padding.l + "px";
    if (!c.swipe) { tcss.overflow = "hidden"; tcss["overflow-x"] = "hidden"; tcss["overflow-y"] = "hidden"; }
    Object.keys(tcss).forEach(function (k) {
        if (typeof track.style.setProperty === "function") track.style.setProperty(k, tcss[k]);
        else track.style[k] = tcss[k];
    });
    el.appendChild(track);

    const st = { index: 0, paused: false, touching: false, ready: false };
    const owner = c.index ? ownerOf(scope, c.index) : null;
    if (owner) st.index = Math.max(0, Math.floor(Number(owner[c.index]) || 0));

    function slides() {
        return Array.prototype.filter.call(track.children, function (e) {
            return e.getAttribute && e.getAttribute("data-id") && e.style.display !== "none";
        });
    }
    function pages() {
        const n = slides().length;
        return fade ? Math.max(1, n) : Math.max(1, n - Math.ceil(c.perView) + 1);
    }
    function offsetOf(s) {
        const first = slides()[0];
        return first ? (horizontal ? s.offsetLeft - first.offsetLeft : s.offsetTop - first.offsetTop) : 0;
    }
    function scrollPos() {
        return horizontal ? track.scrollLeft : track.scrollTop;
    }
    function clamp(i) {
        const n = pages();
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
        const s = slides()[i];
        if (!s) return;
        const pos = offsetOf(s);
        if (typeof track.scrollTo === "function") {
            track.scrollTo(horizontal ? { left: pos, behavior: smooth ? "smooth" : "auto" } : { top: pos, behavior: smooth ? "smooth" : "auto" });
        } else if (horizontal) track.scrollLeft = pos; else track.scrollTop = pos;
    }
    function setIndex(i, fromOutside) {
        if (i === st.index && st.ready) return;
        st.index = i;
        drawControls();
        if (owner && !fromOutside && Number(owner[c.index]) !== i) writeVariable(screen, owner, c.index, i);
        const slide = slides()[i];
        const sid = slide && slide.getAttribute("data-id");
        const ps = sid && screen.__paramStates && screen.__paramStates[sid];
        if (typeof window.__nexaFireUiEvent === "function") {
            window.__nexaFireUiEvent(screen, ns, "slide-change", {
                index: i,
                value: i,
                item: ps && Object.prototype.hasOwnProperty.call(ps, "item") ? cloneValue(ps.item) : undefined
            });
        }
    }
    function goTo(i, smooth, fromOutside) {
        i = clamp(i);
        show(i, smooth);
        setIndex(i, fromOutside);
    }

    let prev = null, next = null, dots = null;
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
        const n = pages();
        if (prev) {
            prev.disabled = !c.loop && st.index <= 0;
            next.disabled = !c.loop && st.index >= n - 1;
            prev.style.display = next.style.display = n > 1 ? "" : "none";
        }
        if (!dots) return;
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
            for (let k = 0; k < n; k++) (function (k) {
                const d = document.createElement("button");
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

    let settleTimer = null;
    if (!fade) track.addEventListener("scroll", function () {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(function () {
            const s = slides();
            if (!s.length) return;
            const pos = scrollPos();
            let best = 0, bestD = Infinity;
            s.forEach(function (x, k) { const d = Math.abs(offsetOf(x) - pos); if (d < bestD) { bestD = d; best = k; } });
            const max = horizontal ? track.scrollWidth - track.clientWidth : track.scrollHeight - track.clientHeight;
            if (pos >= max - 2) best = pages() - 1;
            setIndex(clamp(best));
        }, 120);
    });

    track.addEventListener("keydown", function (e) {
        const back = horizontal ? "ArrowLeft" : "ArrowUp", fwd = horizontal ? "ArrowRight" : "ArrowDown";
        if (e.key === back || e.key === fwd) { e.preventDefault(); goTo(st.index + (e.key === fwd ? 1 : -1), true); }
    });

    if (c.swipe && typeof track.addEventListener === "function") {
        let drag = null, moved = false;
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
            const d = horizontal ? e.clientX - drag.x : e.clientY - drag.y;
            if (Math.abs(d) > 5) moved = true;
            if (!fade) { if (horizontal) track.scrollLeft = drag.pos - d; else track.scrollTop = drag.pos - d; }
        });
        window.addEventListener("pointerup", function (e) {
            if (!drag) return;
            const d = horizontal ? e.clientX - drag.x : e.clientY - drag.y;
            drag = null;
            st.touching = false;
            if (!fade) track.style.scrollSnapType = (horizontal ? "x" : "y") + " mandatory";
            if (!moved) return;
            const s = slides()[0], size = s ? (horizontal ? s.offsetWidth : s.offsetHeight) : 1;
            const step = Math.abs(d) > size * 0.15 ? (d < 0 ? 1 : -1) : 0;
            goTo(st.index + step, true);
        });
        track.addEventListener("click", function (e) { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    }

    if (Number(c.autoplay) > 0) {
        if (c.pauseOnHover) {
            el.addEventListener("mouseenter", function () { st.paused = true; });
            el.addEventListener("mouseleave", function () { st.paused = false; });
        }
        const timer = setInterval(function () {
            if (!el.isConnected) { clearInterval(timer); return; }
            if (st.paused || st.touching || (document.hidden === true)) return;
            goTo(st.index + 1 >= pages() ? 0 : st.index + 1, true);
        }, Math.max(500, Number(c.autoplay)));
    }

    if (owner) {
        screen.__varWatchers = screen.__varWatchers || [];
        const watcher = {
            scope: owner, name: c.index, fn: function (v) {
                if (!el.isConnected) { screen.__varWatchers.splice(screen.__varWatchers.indexOf(watcher), 1); return; }
                const n = Math.floor(Number(v));
                if (isFinite(n) && n !== st.index) goTo(n, true, true);
            }
        };
        screen.__varWatchers.push(watcher);
    }

    if (typeof ResizeObserver === "function") {
        let lastW = 0, lastH = 0;
        new ResizeObserver(function () {
            if (track.clientWidth === lastW && track.clientHeight === lastH) return;
            lastW = track.clientWidth; lastH = track.clientHeight;
            show(st.index, false);
        }).observe(track);
    }

    el.__carousel = {
        track: track,
        refresh: function () {
            const i = clamp(st.index);
            st.index = i;
            drawControls();
            if (fade) applyFade(i);
            const run = function () { show(st.index, false); st.ready = true; };
            if (typeof requestAnimationFrame === "function") requestAnimationFrame(run); else run();
        },
        goTo: function (i) { goTo(i, true); },
        index: function () { return st.index; }
    };
    return track;
}
