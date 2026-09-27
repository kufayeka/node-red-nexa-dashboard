// Image assets of a Nexa app (the Assets tab): png, jpg, svg, webp, gif, avif,
// imported once and used by name — {asset:logo} in any prop, bindable like a tag.
//
// On disk, in <userDir>/nexa-assets/:
//   assets.json          [{ id, name, file, type, size, w, h, updated }]
//   <sha1-16>.<ext>      the file, named by its content: a URL never changes
//                        meaning, so it is cached forever (immutable); a new
//                        upload under the same name is a new file.
// The type comes from the file's own bytes, not from what the browser says.
// An SVG is cleaned (scripts, event handlers, javascript: links, foreignObject)
// and served with a CSP that runs nothing, as it may be opened on its own.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_BYTES = 10 * 1024 * 1024;
const EXT = { png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp", gif: "image/gif", avif: "image/avif" };
const FILE_RE = /^[a-f0-9]{16}\.(png|jpg|svg|webp|gif|avif)$/;
// a name: folders with "/", no "..", no leading / trailing slash
const NAME_RE = /^[A-Za-z0-9_][\w\- .]*(\/[A-Za-z0-9_][\w\- .]*)*$/;
// a big image slows a page down: the Assets tab warns above these
const WARN_BYTES = 1024 * 1024, WARN_PX = 3000;

function sniff(buf) {
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
    if (buf.length > 6 && buf.slice(0, 4).toString("latin1") === "GIF8") return "gif";
    if (buf.length > 12 && buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "webp";
    if (buf.length > 12 && buf.slice(4, 8).toString("latin1") === "ftyp" && /^avi[fs]$/.test(buf.slice(8, 12).toString("latin1"))) return "avif";
    var head = buf.slice(0, 2048).toString("utf8").replace(/^\uFEFF/, "").trim();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
    return null;
}

/** { w, h } in px when the header says so (else nulls). */
function dimensions(buf, ext) {
    try {
        if (ext === "png") return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
        if (ext === "gif") return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
        if (ext === "webp") {
            var chunk = buf.slice(12, 16).toString("latin1");
            if (chunk === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
            if (chunk === "VP8L") { var b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
            if (chunk === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
        }
        if (ext === "jpg") {
            var o = 2;
            while (o + 9 < buf.length) {
                if (buf[o] !== 0xff) { o++; continue; }
                var marker = buf[o + 1];
                if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: buf.readUInt16BE(o + 7), h: buf.readUInt16BE(o + 5) };
                o += 2 + buf.readUInt16BE(o + 2);
            }
        }
        if (ext === "svg") {
            var tag = (/<svg[^>]*>/i.exec(buf.toString("utf8")) || [""])[0];
            var num = function (attr) { var m = new RegExp("\\s" + attr + "\\s*=\\s*[\"']\\s*([\\d.]+)(px)?\\s*[\"']", "i").exec(tag); return m ? Math.round(parseFloat(m[1])) : null; };
            var w = num("width"), h = num("height");
            if (w && h) return { w: w, h: h };
            var vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
            if (vb) return { w: Math.round(parseFloat(vb[1])), h: Math.round(parseFloat(vb[2])) };
        }
    } catch (e) { /* a truncated header: unknown size */ }
    return { w: null, h: null };
}

/** An SVG without anything that runs: scripts, handlers, javascript: links, foreign HTML, entities. */
function cleanSvg(text) {
    return text
        .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
        .replace(/<!ENTITY[\s\S]*?>/gi, "")
        .replace(/<script[\s\S]*?<\/script\s*>/gi, "").replace(/<script[^>]*\/>/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
        .replace(/<(iframe|embed|object|handler|listener)[\s\S]*?(<\/\1\s*>|\/>)/gi, "")
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s(href|xlink:href|src)\s*=\s*("\s*(javascript|data:text\/html|vbscript):[^"]*"|'\s*(javascript|data:text\/html|vbscript):[^']*')/gi, "");
}

function createAssetStore(dir) {
    var indexFile = path.join(dir, "assets.json");
    function load() {
        try { var l = JSON.parse(fs.readFileSync(indexFile, "utf8")); return Array.isArray(l) ? l : []; } catch (e) { return []; }
    }
    function save(list) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(indexFile + ".tmp", JSON.stringify(list, null, 1));
        fs.renameSync(indexFile + ".tmp", indexFile);
    }
    function dropFileIfUnused(list, file) {
        if (!file || list.some(function (a) { return a.file === file; })) return;
        try { fs.unlinkSync(path.join(dir, file)); } catch (e) { /* already gone */ }
    }
    function fail(status, message) { var e = new Error(message); e.status = status; return e; }
    function checkName(name) {
        name = String(name || "").trim();
        if (!NAME_RE.test(name) || name.indexOf("..") !== -1 || name.length > 120) throw fail(400, "A name: letters, digits, _ - . and spaces, folders with / (e.g. icons/motor-on)");
        return name;
    }
    return {
        dir: dir,
        list: load,
        /** Import (or replace, same name) one file. Resolves the asset. */
        add: function (name, buf) {
            name = checkName(name);
            if (!buf || !buf.length) throw fail(400, "Empty file");
            if (buf.length > MAX_BYTES) throw fail(413, "Larger than " + (MAX_BYTES / 1048576) + " MB");
            var ext = sniff(buf);
            if (!ext) throw fail(415, "Not an image: png, jpg, svg, webp, gif or avif");
            if (ext === "svg") buf = Buffer.from(cleanSvg(buf.toString("utf8")), "utf8");
            var file = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16) + "." + ext;
            fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(path.join(dir, file))) fs.writeFileSync(path.join(dir, file), buf);
            var dim = dimensions(buf, ext);
            var list = load();
            var existing = list.filter(function (a) { return a.name === name; })[0];
            var asset = existing || { id: "a" + crypto.randomBytes(6).toString("hex"), name: name };
            var oldFile = existing && existing.file;
            Object.assign(asset, { file: file, type: EXT[ext], size: buf.length, w: dim.w, h: dim.h, updated: Date.now() });
            if (!existing) list.push(asset);
            save(list);
            if (oldFile !== file) dropFileIfUnused(list, oldFile);
            return asset;
        },
        rename: function (id, name) {
            name = checkName(name);
            var list = load();
            var a = list.filter(function (x) { return x.id === id; })[0];
            if (!a) throw fail(404, "No such asset");
            if (list.some(function (x) { return x.name === name && x.id !== id; })) throw fail(409, "\"" + name + "\" is taken");
            a.name = name;
            save(list);
            return a;
        },
        remove: function (id) {
            var list = load();
            var a = list.filter(function (x) { return x.id === id; })[0];
            if (!a) throw fail(404, "No such asset");
            list = list.filter(function (x) { return x.id !== id; });
            save(list);
            dropFileIfUnused(list, a.file);
            return a;
        },
        /** The path of a stored file, or null for anything that is not one. */
        filePath: function (file) {
            return FILE_RE.test(String(file || "")) ? path.join(dir, file) : null;
        }
    };
}

/** Headers for serving an asset file: cached forever (its name is its content); an SVG runs nothing. */
function assetHeaders(file) {
    var ext = String(file).split(".").pop();
    var h = { "Content-Type": EXT[ext] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" };
    if (ext === "svg") h["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
    return h;
}

module.exports = { createAssetStore: createAssetStore, assetHeaders: assetHeaders, cleanSvg: cleanSvg, sniff: sniff, dimensions: dimensions, MAX_BYTES: MAX_BYTES, WARN_BYTES: WARN_BYTES, WARN_PX: WARN_PX, FILE_RE: FILE_RE };
