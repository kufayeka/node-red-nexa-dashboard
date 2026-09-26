// A tiny static HTTP server for the SDK harness: the SDK files where a real
// host serves them, plus the plugin directories a test mounts. (ES modules
// can't load from file:// — hence a server.)
const http = require("http");
const fs = require("fs");
const path = require("path");

const DASH = path.join(__dirname, "..", "..");
const TYPES = { ".js": "application/javascript", ".mjs": "application/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

function startServer(opts) {
    opts = opts || {};
    const files = {
        "/nexa-sdk/nexa-component-sdk.js": path.join(DASH, "sdk", "nexa-component-sdk.js"),
        "/__nexa_test__/registry.js": path.join(DASH, "lib", "nexa-registry-client.js"),
        "/__nexa_test__/sdk.js": path.join(DASH, "dist", "nexa-sdk.bundle.js"),
        "/__nexa_test__/kit.js": path.join(DASH, "dist", "nexa-sdk-kit.bundle.js"),
        "/__nexa_test__/harness.html": path.join(__dirname, "harness.html"),
        "/__nexa_test__/testkit.js": path.join(__dirname, "testkit-browser.js")
    };
    const mounts = Object.assign({}, opts.mounts || {}); // "/url/prefix" -> directory
    const server = http.createServer(function (req, res) {
        const url = decodeURIComponent(req.url.split("?")[0]);
        let file = files[url];
        if (!file) {
            const prefix = Object.keys(mounts).filter((p) => url.indexOf(p + "/") === 0).sort((a, b) => b.length - a.length)[0];
            if (prefix) {
                const rel = url.slice(prefix.length + 1);
                const full = path.join(mounts[prefix], rel);
                if (full.indexOf(path.resolve(mounts[prefix])) === 0) file = full;
            }
        }
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("not found: " + url);
            return;
        }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(function (resolve) {
        server.listen(0, "127.0.0.1", function () {
            const url = "http://127.0.0.1:" + server.address().port;
            resolve({ url: url, close: function () { return new Promise((r) => server.close(r)); } });
        });
    });
}

module.exports = { startServer };
