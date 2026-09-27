// The editor's side of the image assets (lib/assets.js on the server): load the
// list into the SDK (window.NexaSDK.setAssets — every nx-asset picker and Image
// component follows it), import files, rename, delete. $.ajax, not fetch: the
// editor's own auth token rides along on it.
export var assetLimits = { maxBytes: 10 * 1024 * 1024, warnBytes: 1024 * 1024, warnPx: 3000 };

var loading = null;

function sdk() { return window.NexaSDK || null; }
function ajax(opts) {
    return new Promise(function (resolve, reject) {
        if (!window.$ || typeof window.$.ajax !== "function") { reject(new Error("no $.ajax")); return; }
        window.$.ajax(Object.assign({ dataType: "json" }, opts)).done(resolve).fail(function (xhr) {
            var msg = (xhr && xhr.responseJSON && xhr.responseJSON.error) || (xhr && xhr.status === 413 ? "Larger than 10 MB" : "Request failed (" + (xhr ? xhr.status : "?") + ")");
            reject(new Error(msg));
        });
    });
}

/** Load (or reload) the list. Resolves the assets. */
export function loadAssets(force) {
    if (loading && !force) return loading;
    loading = ajax({ url: "nexa-dashboard/_assets" }).then(function (d) {
        if (d.maxBytes) assetLimits = { maxBytes: d.maxBytes, warnBytes: d.warnBytes, warnPx: d.warnPx };
        var list = d.assets || [];
        if (sdk() && sdk().setAssets) sdk().setAssets(list);
        return list;
    }, function () { return []; });
    return loading;
}

/** "Motor ON (1).png" -> "Motor ON _1_" (a name the server accepts), in `folder` if given. */
export function nameFromFile(fileName, folder) {
    var base = String(fileName || "image").replace(/\.[^.]+$/, "").replace(/[^\w\- .]/g, "_").replace(/^[^A-Za-z0-9_]+/, "") || "image";
    folder = String(folder || "").trim().replace(/^\/+|\/+$/g, "");
    return (folder ? folder + "/" : "") + base.slice(0, 80);
}

/** Import files one after the other; resolves the imported assets (a failed one is reported and skipped). */
export function uploadAssets(files, folder) {
    var added = [];
    var chain = Promise.resolve();
    (files || []).forEach(function (file) {
        chain = chain.then(function () {
            if (file.size > assetLimits.maxBytes) throw new Error(file.name + ": larger than " + Math.round(assetLimits.maxBytes / 1048576) + " MB");
            return ajax({
                url: "nexa-dashboard/_assets?name=" + encodeURIComponent(nameFromFile(file.name, folder)),
                type: "POST", data: file, processData: false, contentType: "application/octet-stream"
            }).then(function (d) {
                var a = d.asset;
                added.push(a);
                var big = a.size > assetLimits.warnBytes || (a.w && Math.max(a.w, a.h) > assetLimits.warnPx);
                if (big) notify("\"" + a.name + "\" is big (" + Math.round(a.size / 1024) + " KB" + (a.w ? ", " + a.w + " × " + a.h : "") + ") — a smaller file loads faster on a page.", "warning");
            });
        }).catch(function (e) { notify(e.message, "error"); });
    });
    return chain.then(function () { return loadAssets(true); }).then(function () { return added; });
}

export function renameAsset(id, name) {
    return ajax({ url: "nexa-dashboard/_assets/" + encodeURIComponent(id) + "/rename", type: "POST", contentType: "application/json", data: JSON.stringify({ name: name }) })
        .then(function () { return loadAssets(true); });
}

export function deleteAsset(id) {
    return ajax({ url: "nexa-dashboard/_assets/" + encodeURIComponent(id), type: "DELETE" }).then(function () { return loadAssets(true); });
}

function notify(text, type) {
    if (window.RED && window.RED.notify) window.RED.notify(text, { type: type || "compact", timeout: 4000 });
}
