// ---- nx-asset -----------------------------------------------------------------------
// An image picker: the app's assets (the Assets tab) as thumbnails, search,
// Import… (uploads through the editor, then picks it), or a URL. Value: the
// saved string — "{asset:name}" for an asset, the URL otherwise, "" for none.
// A prop of type "asset" gets this widget; its ⛓ binds it like any prop.
import { html, nothing } from "lit";
import { KitElement, str, icon, getHost } from "./base.js";

function sdk() { return window.NexaSDK || null; }

var STYLE_ID = "nx-asset-styles";
function ensureAssetStyles(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var s = doc.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
        ".nx-asset { position: relative; }",
        ".nx-asset-current { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid var(--red-ui-form-input-border-color, #ccc); border-radius: 4px; background: var(--red-ui-form-input-background, #fff); cursor: pointer; text-align: left; font: inherit; }",
        ".nx-asset-thumb { flex: 0 0 auto; width: 36px; height: 28px; border-radius: 3px; display: flex; align-items: center; justify-content: center; overflow: hidden; color: #999;",
        "  background: repeating-conic-gradient(#e8e8e8 0% 25%, #fff 0% 50%) 50% / 10px 10px; }",
        ".nx-asset-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }",
        ".nx-asset-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }",
        ".nx-asset-name.nx-empty { color: #999; }",
        ".nx-asset-panel { margin-top: 4px; border: 1px solid var(--red-ui-secondary-border-color, #ddd); border-radius: 4px; padding: 6px; background: var(--red-ui-secondary-background, #fafafa); }",
        ".nx-asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; max-height: 220px; overflow: auto; margin: 6px 0; }",
        ".nx-asset-tile { display: flex; flex-direction: column; align-items: stretch; gap: 2px; padding: 3px; border: 1px solid transparent; border-radius: 4px; background: #fff; cursor: pointer; font: inherit; }",
        ".nx-asset-tile:hover { border-color: #999; }",
        ".nx-asset-tile.nx-on { border-color: #ff5722; box-shadow: 0 0 0 1px #ff5722; }",
        ".nx-asset-tile .nx-asset-thumb { width: 100%; height: 48px; }",
        ".nx-asset-tile span { font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
        ".nx-asset-foot { display: flex; gap: 6px; align-items: center; }",
        ".nx-asset-foot input[type=text] { flex: 1 1 auto; min-width: 0; }",
        ".nx-asset-none { font-size: 11px; color: #999; padding: 8px 2px; }"
    ].join("\n");
    doc.head.appendChild(s);
}

export class NxAsset extends KitElement {
    static properties = { _open: { state: true }, _q: { state: true }, _busy: { state: true }, _error: { state: true } };

    constructor() { super(); this._open = false; this._q = ""; this._busy = false; this._error = ""; }

    connectedCallback() {
        super.connectedCallback();
        ensureAssetStyles(this.ownerDocument);
        var S = sdk();
        this._off = S && S.onAssetsChange ? S.onAssetsChange(() => this.requestUpdate()) : null;
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._off) this._off();
    }

    _pick(v) { this._open = false; this.change(v); }

    _import(files) {
        var h = getHost();
        if (!files || !files.length) return;
        if (typeof h.uploadAssets !== "function") { this._error = "Importing needs the dashboard editor"; return; }
        this._busy = true; this._error = "";
        Promise.resolve(h.uploadAssets(Array.from(files))).then((added) => {
            this._busy = false;
            var last = (added || []).filter(Boolean).pop();
            if (last) this._pick("{asset:" + last.name + "}");
        }, (e) => { this._busy = false; this._error = (e && e.message) || String(e); });
    }

    _panel() {
        var S = sdk();
        var v = str(this.value);
        var current = S ? S.resolveAsset(v) : null;
        var q = this._q.trim().toLowerCase();
        var list = (S ? S.listAssets() : []).filter(function (a) { return !q || a.name.toLowerCase().indexOf(q) !== -1; });
        var isUrl = v && !current && v.charAt(0) !== "{";
        return html`<div class="nx-asset-panel">
            <input type="text" class="nx-control" placeholder="Search images…" .value="${this._q}" @input="${(e) => { this._q = e.target.value; }}">
            ${list.length ? html`<div class="nx-asset-grid">${list.map((a) => html`
                <button type="button" class="nx-asset-tile ${current && current.name === a.name ? "nx-on" : ""}" title="${a.name}${a.w ? " · " + a.w + " × " + a.h : ""}" @click="${() => this._pick("{asset:" + a.name + "}")}">
                    <span class="nx-asset-thumb"><img src="${a.url}" alt="" loading="lazy"></span><span>${a.name}</span>
                </button>`)}</div>`
                : html`<div class="nx-asset-none">${q ? "No image matches." : "No images yet — import png, jpg, svg, webp, gif or avif."}</div>`}
            <div class="nx-asset-foot">
                <button type="button" class="nx-btn" ?disabled="${this._busy}" @click="${() => this.querySelector(".nx-asset-file").click()}">${icon("fa fa-upload")} ${this._busy ? "Importing…" : "Import…"}</button>
                <input class="nx-asset-file" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/avif,.svg" multiple hidden
                    @change="${(e) => { this._import(e.target.files); e.target.value = ""; }}">
                <input type="text" class="nx-control" placeholder="or a URL: https://…" .value="${isUrl ? v : ""}"
                    @keydown="${(e) => { if (e.key === "Enter") { e.preventDefault(); this._pick(e.target.value.trim()); } }}"
                    @change="${(e) => this._pick(e.target.value.trim())}">
                ${v ? html`<button type="button" class="nx-btn" title="No image" @click="${() => this._pick("")}">None</button>` : nothing}
            </div>
            ${this._error ? html`<div class="nx-message">${this._error}</div>` : nothing}
        </div>`;
    }

    render() {
        var S = sdk();
        var v = str(this.value);
        var a = S ? S.resolveAsset(v) : null;
        var url = S ? S.assetUrl(v) : null;
        var name = a ? a.name : v;
        var unknown = v && !url;
        return this.frame(html`<div class="nx-asset">
            <button type="button" id="${this.controlId}" class="nx-asset-current" ?disabled="${this.disabled}" @click="${() => { this._open = !this._open; }}">
                <span class="nx-asset-thumb">${url ? html`<img src="${url}" alt="">` : icon(unknown ? "fa fa-exclamation-triangle" : "fa fa-picture-o")}</span>
                <span class="nx-asset-name ${v ? "" : "nx-empty"}" title="${v}">${v ? name : "No image"}${unknown ? " (not found)" : ""}</span>
                ${icon(this._open ? "fa fa-caret-up" : "fa fa-caret-down")}
            </button>
            ${this._open ? this._panel() : nothing}
        </div>`);
    }
}
