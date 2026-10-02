// Nexa "Media" components, built into the dashboard: Image.
// An ES module on the Nexa component SDK (served at nexa-dashboard-media/vendor/,
// registered by lib/nexa-plugin.js like any component package).
//
// Image shows an imported asset ({asset:name}, the Assets tab), a URL, or what a
// binding gives (an asset name or a URL: {param1.image}). A state map switches
// the image by a value (0 -> motor-off, 1 -> motor-on, 2 -> motor-fault), and a
// tint paints its shape one colour (an SVG icon: one file, any colour).
import { defineComponent, NexaElement, html, css, nothing, assetUrl, onAssetsChange } from "../../nexa-sdk/nexa-component-sdk.js";

const FIT = [
    { value: "contain", label: "Contain (whole image)" }, { value: "cover", label: "Cover (fill, crop)" },
    { value: "fill", label: "Stretch" }, { value: "none", label: "Original size" }, { value: "scale-down", label: "Scale down only" }
];
const POSITION = ["center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"]
    .map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
// a tint is a CSS mask: the same sizes as object-fit
const MASK_SIZE = { contain: "contain", cover: "cover", fill: "100% 100%", none: "auto", "scale-down": "contain" };

class ImageView extends NexaElement {
    static styles = css`
        :host { display: block; width: 100%; height: 100%; box-sizing: border-box; }
        .box { position: relative; width: 100%; height: 100%; overflow: hidden; box-sizing: border-box; }
        img { display: block; width: 100%; height: 100%; transition: opacity 0.25s ease; }
        img.hidden { visibility: hidden; }
        .tint { position: absolute; inset: 0; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; transition: opacity 0.25s ease; }
        .skeleton { position: absolute; inset: 0; background: linear-gradient(90deg, #eceff3 25%, #f6f7f9 37%, #eceff3 63%); background-size: 400% 100%; animation: sk 1.4s ease infinite; }
        @keyframes sk { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
        .empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
            color: #94a3b8; font: 12px sans-serif; border: 1px dashed #cbd5e1; box-sizing: border-box; background: #f8fafc; }
        .empty svg { width: 28px; height: 28px; }
    `;

    constructor() {
        super();
        this._loaded = null;   // the URL that finished loading (no fade / skeleton for it again)
        this._failed = null;   // the URL that failed (then the fallback)
    }
    mounted() {
        // an import / rename in the Assets tab: show the new file
        this.onDestroy(onAssetsChange(() => this.requestUpdate()));
    }

    /** The value shown now: a state-map row whose value matches, else the Image. */
    current() {
        const p = this.p;
        const rows = Array.isArray(p.stateMap) ? p.stateMap : [];
        if (rows.length && p.stateValue !== undefined && p.stateValue !== null && p.stateValue !== "") {
            const hit = rows.filter((r) => r && String(r.value) === String(p.stateValue))[0];
            if (hit && hit.src) return hit.src;
        }
        return p.src;
    }

    render() {
        const p = this.p;
        const value = this.current();
        let url = assetUrl(value);
        if (url && url === this._failed) url = assetUrl(p.fallback) || null;
        if (!url) {
            return html`<div class="box" style="${this.boxStyle(p)}">${this.isEditor ? html`<div class="empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>
                <span>${value ? "Image not found" : "Image"}</span></div>` : nothing}</div>`;
        }
        const loaded = this._loaded === url;
        const fade = p.fadeIn && !loaded && !this.isEditor;
        const filters = [];
        if (Number(p.grayscale) > 0) filters.push("grayscale(" + Number(p.grayscale) + "%)");
        if (p.brightness !== "" && p.brightness !== undefined && Number(p.brightness) !== 100) filters.push("brightness(" + Number(p.brightness) + "%)");
        if (Number(p.blur) > 0) filters.push("blur(" + Number(p.blur) + "px)");
        const filter = filters.join(" ") || "none";
        const tint = p.tint && p.tint !== "transparent" ? p.tint : "";
        const imgStyle = "object-fit:" + (p.fit || "contain") + ";object-position:" + (p.position || "center") + ";filter:" + filter + ";opacity:" + (fade ? 0 : 1);
        const maskUrl = 'url("' + String(url).replace(/"/g, "%22") + '")';
        return html`<div class="box" style="${this.boxStyle(p)}" @click="${() => this.emit("click", { src: value, state: p.stateValue })}">
            ${!loaded && p.placeholder === "skeleton" ? html`<div class="skeleton"></div>` : nothing}
            <img class="${tint ? "hidden" : ""}" src="${url}" alt="${p.alt || ""}" loading="${p.loading === "eager" ? "eager" : "lazy"}" decoding="async" draggable="false"
                style="${imgStyle}" @load="${() => this.onLoad(url)}" @error="${() => this.onError(url)}">
            ${tint ? html`<div class="tint" style="${"background-color:" + tint + ";-webkit-mask-image:" + maskUrl + ";mask-image:" + maskUrl +
                ";-webkit-mask-size:" + MASK_SIZE[p.fit || "contain"] + ";mask-size:" + MASK_SIZE[p.fit || "contain"] +
                ";-webkit-mask-position:" + (p.position || "center") + ";mask-position:" + (p.position || "center") + ";filter:" + filter + ";opacity:" + (fade ? 0 : 1)}"></div>` : nothing}
        </div>`;
    }

    boxStyle(p) {
        const r = Number(p.radius) || 0;
        const bg = p.placeholder === "color" && this._loaded !== assetUrl(this.current()) ? (p.placeholderColor || "#eceff3") : (p.background || "transparent");
        return "border-radius:" + r + "px;background:" + bg + ";opacity:" + (p.opacity === undefined ? 1 : p.opacity) + ";cursor:" + (this.isEditor ? "default" : "inherit");
    }

    onLoad(url) {
        if (this._loaded === url) return;
        this._loaded = url;
        this.requestUpdate();
        this.emit("load", { src: this.current(), url: url });
    }
    onError(url) {
        if (this._failed === url) return;
        this._failed = url;
        this.requestUpdate();
        this.emit("error", { src: this.current(), url: url });
    }
}

export const image = defineComponent({
    id: "kufayeka-image", label: "Image", icon: "fa fa-picture-o", category: "Media", size: { w: 160, h: 120 },
    capabilities: { resizable: true, rotatable: true, flippable: true, lockable: true },
    properties: {
        src: { type: "asset", default: "", group: "Image", label: "Image",
            help: "An imported image (the Assets tab) or a URL. Bind it (⛓) to a variable that holds an asset name or a URL, e.g. {param1.image}." },
        alt: { type: "string", default: "", group: "Image", label: "Alt text", help: "Read out by screen readers; shown if the image cannot load." },
        fallback: { type: "asset", default: "", group: "Image", label: "If it fails to load", bindable: false },
        fit: { type: "enum", default: "contain", group: "Layout", label: "Fit", options: FIT, style: "select" },
        position: { type: "enum", default: "center", group: "Layout", label: "Position", options: POSITION, style: "select",
            visibleWhen: (p) => p.fit !== "fill" },
        stateMap: { type: "list", default: [], group: "States", label: "State map", bindable: false,
            help: "A row whose value matches the Value below shows its image instead (e.g. 0 → motor-off, 1 → motor-on).",
            item: { fields: { value: { type: "string", label: "Value", default: "" }, src: { type: "asset", label: "Image", default: "" } }, row: true } },
        stateValue: { type: "string", default: "", group: "States", label: "Value", help: "Bind it (⛓) to a tag or a variable: 0, 1, true, \"RUN\"…",
            visibleWhen: (p) => Array.isArray(p.stateMap) && p.stateMap.length > 0 },
        tint: { type: "color", default: "", group: "Style", label: "Tint", help: "Paints the image's shape one colour: an SVG icon in any colour. Empty: the image's own colours." },
        background: { type: "color", default: "", group: "Style", label: "Background" },
        radius: { type: "number", default: 0, min: 0, unit: "px", group: "Style", label: "Corner radius" },
        opacity: { type: "range", default: 1, min: 0, max: 1, step: 0.05, group: "Style" },
        grayscale: { type: "number", default: 0, min: 0, max: 100, unit: "%", group: "Style", label: "Grayscale" },
        brightness: { type: "number", default: 100, min: 0, max: 300, unit: "%", group: "Style", label: "Brightness" },
        blur: { type: "number", default: 0, min: 0, max: 50, unit: "px", group: "Style", label: "Blur" },
        loading: { type: "enum", default: "lazy", group: "Loading", label: "Load", style: "segmented",
            options: [{ value: "lazy", label: "When visible" }, { value: "eager", label: "At once" }],
            help: "When visible: an image far down a page or in a list loads when it comes near the view." },
        placeholder: { type: "enum", default: "skeleton", group: "Loading", label: "While loading", style: "segmented",
            options: [{ value: "none", label: "Nothing" }, { value: "skeleton", label: "Skeleton" }, { value: "color", label: "Colour" }] },
        placeholderColor: { type: "color", default: "#eceff3", group: "Loading", label: "Placeholder colour", visibleWhen: (p) => p.placeholder === "color" },
        fadeIn: { type: "boolean", default: true, group: "Loading", label: "Fade in when loaded" }
    },
    events: {
        click: { label: "Clicked", payload: { src: "string", state: "any" } },
        load: { label: "Loaded", payload: { src: "string", url: "string" } },
        error: { label: "Failed to load", payload: { src: "string", url: "string" } }
    },
    view: ImageView
});
