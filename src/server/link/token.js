// Per-page token for the Nexa Link socket. The screen worker hands one to a page
// (GET /nexa/_link-info, same origin as the page, so another site's script can't
// read it); the link worker accepts a WebSocket only with a valid one. Both
// workers get the same random secret from the main thread (src/server/link/bridge.js).
"use strict";
const crypto = require("crypto");

function sign(secret, nonce) {
    return crypto.createHmac("sha256", secret).update(nonce).digest("base64url").slice(0, 32);
}

function issueToken(secret) {
    const nonce = crypto.randomBytes(12).toString("base64url");
    return nonce + "." + sign(secret, nonce);
}

function verifyToken(secret, token) {
    if (!secret || typeof token !== "string") return false;
    const dot = token.indexOf(".");
    if (dot <= 0) return false;
    const want = Buffer.from(sign(secret, token.slice(0, dot)));
    const got = Buffer.from(token.slice(dot + 1));
    return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { issueToken, verifyToken };
