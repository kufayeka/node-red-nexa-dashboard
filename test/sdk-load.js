// Loads a src/sdk ES module into a Node test (bundled to CommonJS on the fly
// with esbuild). Only for the pure modules (format, schema, codecs) — the
// Lit-based ones are covered by test/sdk-kit-browser.test.js in Chrome.
const path = require("path");
const esbuild = require("esbuild");

module.exports = function loadSdkModule(rel) {
    const out = esbuild.buildSync({
        entryPoints: [path.join(__dirname, "..", "src", "sdk", rel)],
        bundle: true, format: "cjs", platform: "neutral", write: false
    });
    const mod = { exports: {} };
    new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
    return mod.exports;
};
