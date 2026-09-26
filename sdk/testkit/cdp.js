// Minimal headless-Chrome driver (DevTools protocol over ws) for the SDK's
// browser tests — same approach as @kufayeka/nexa-component-fields'
// test/browser.test.js. Resolves null (test skipped) when no Chrome / Edge is
// installed (set CHROME_PATH) or the ws package is missing.
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const CHROME = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"
].find((p) => p && fs.existsSync(p));
let WebSocket = null;
try { WebSocket = require("ws"); } catch (e) { /* optional */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) => new Promise((res, rej) => http.get(url, (r) => { let d = ""; r.on("data", (c) => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on("error", rej));

async function withPage(file, fn, opts) {
    opts = opts || {};
    if (!CHROME || !WebSocket) {
        console.log("SKIP (" + (!CHROME ? "no Chrome/Edge found, set CHROME_PATH" : "the ws package is not available") + ")");
        return null;
    }
    const port = 9400 + Math.floor(Math.random() * 400);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nexa-sdk-"));
    const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "--no-first-run", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
    let ws;
    const logs = [];
    try {
        let targets;
        for (let i = 0; i < 60; i++) { try { targets = await getJSON("http://127.0.0.1:" + port + "/json"); if (targets.some((t) => t.type === "page")) break; } catch (e) { /* starting */ } await sleep(250); }
        ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false });
        await new Promise((r) => ws.on("open", r));
        let seq = 0;
        const pending = new Map();
        ws.on("message", (m) => {
            const msg = JSON.parse(m);
            if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
            if (msg.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + (msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text));
            if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) logs.push("console." + msg.params.type + " " + msg.params.args.map((a) => a.value || a.description).join(" "));
        });
        const send = (method, params) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {} })); });
        const js = async (expr) => {
            const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
            if (r.result.exceptionDetails) throw new Error(expr.slice(0, 300) + " -> " + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails.text));
            return r.result.result.value;
        };
        const settle = () => js("new Promise(function (r) { setTimeout(function () { r(true); }, 60); })");
        const type = async (text) => { await send("Input.insertText", { text }); await settle(); };
        const key = async (k, modifiers) => {
            const codes = { Enter: [13, "Enter", "\r"], Escape: [27, "Escape", ""], Tab: [9, "Tab", ""], Backspace: [8, "Backspace", ""], ArrowDown: [40, "ArrowDown", ""] };
            const [vk, code, txt] = codes[k];
            await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: txt || undefined, modifiers: modifiers || 0 });
            await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: modifiers || 0 });
            await settle();
        };
        await send("Runtime.enable");
        await send("Page.enable");
        await send("Emulation.setFocusEmulationEnabled", { enabled: true });
        if (opts.width) await send("Emulation.setDeviceMetricsOverride", { width: opts.width, height: opts.height || 900, deviceScaleFactor: 1, mobile: false });
        await send("Page.navigate", { url: /^https?:/.test(file) ? file : pathToFileURL(file).href });
        const ready = opts.ready || "document.readyState === 'complete' && !!window.T";
        for (let i = 0; i < (opts.readyTries || 40) && !(await js(ready).catch(() => false)); i++) await sleep(100);
        return await fn({ js, send, settle, type, key, logs });
    } finally {
        if (ws) ws.close();
        chrome.kill();
        await sleep(300);
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome may still hold it */ }
    }
}

module.exports = { withPage };
