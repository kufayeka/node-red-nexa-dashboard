// Image assets for components (the Assets tab; src/server/assets.js stores them).
// A prop names one as {asset:name} — bindable like anything else, e.g.
// {asset:{param1.image}} — or just by its name ("icons/motor-on"), which is
// what a variable usually holds. assetUrl(value) is what an <img> shows.
//
// The list: the editor fills it from the admin API (setAssets); a deployed
// page gets window.__NEXA_ASSETS__ from the screen worker.
var REF_RE = /^\{asset:([^{}]+)\}$/;
var URL_RE = /^(https?:|data:image\/|blob:|\/|\.\.?\/)/i;
var FILE_RE = /^[\w./-]+\.(png|jpe?g|svg|webp|gif|avif)(\?.*)?$/i;

function reg() {
    var w = window;
    if (!w.NexaAssets) w.NexaAssets = { list: [], byName: {}, listeners: [], set: false };
    var r = w.NexaAssets;
    // the page's list (set after the SDK has loaded): taken on first use
    if (!r.set && Array.isArray(w.__NEXA_ASSETS__)) fill(r, w.__NEXA_ASSETS__);
    return r;
}
function fill(r, list) {
    r.set = true;
    r.list = (list || []).slice();
    r.byName = {};
    r.list.forEach(function (a) { if (a && a.name) r.byName[a.name] = a; });
}

/** Replace the list (the editor, after loading / importing / renaming); components redraw. */
export function setAssets(list) {
    var r = reg();
    fill(r, list);
    r.listeners.slice().forEach(function (fn) { try { fn(r.list); } catch (e) { /* one listener must not stop the others */ } });
}
export function listAssets() { return reg().list.slice(); }
export function getAsset(name) { return reg().byName[name] || null; }
/** fn(list) on every change; returns an unsubscribe function. */
export function onAssetsChange(fn) {
    var r = reg();
    r.listeners.push(fn);
    return function () { var i = r.listeners.indexOf(fn); if (i !== -1) r.listeners.splice(i, 1); };
}
export function assetRef(name) { return "{asset:" + name + "}"; }

/** The asset a value names — {asset:name} or an imported asset's plain name — else null. */
export function resolveAsset(value) {
    if (typeof value !== "string") return null;
    var s = value.trim();
    var m = REF_RE.exec(s);
    return reg().byName[m ? m[1].trim() : s] || null;
}

/** What to show: an asset's URL, else the value itself when it is a URL / path; null otherwise. */
export function assetUrl(value) {
    var a = resolveAsset(value);
    if (a) return a.url;
    if (typeof value !== "string") return null;
    var s = value.trim();
    if (!s || s.charAt(0) === "{") return null;          // a binding that did not resolve, or an unknown asset
    return URL_RE.test(s) || FILE_RE.test(s) ? s : null;
}
