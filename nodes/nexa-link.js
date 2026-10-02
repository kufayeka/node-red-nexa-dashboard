// Nexa Link nodes: a Nexa page talks to a real Node-RED flow, so anything that
// needs a secret (DB credentials, API keys) or server work runs here, never in
// the browser.
//   kufayeka-nexa-channel  config: the channel both sides pick (name, limits, delivery)
//   kufayeka-nexa-from     "from Nexa": a page's To Node-RED / Request node arrives here
//   kufayeka-nexa-to       "to Nexa": answer a request, or push to the pages (From Node-RED)
// Transport: src/server/link/bridge.js (main thread) -> the link worker (own port,
// own thread). See docs/LINK.md.
"use strict";
const bridge = require("../src/server/link/bridge.js");

const MB = 1024 * 1024;

function channelConfig(node, config) {
    const maxMb = Number(config.maxMb);
    const timeoutS = Number(config.timeoutS);
    return {
        id: node.id,
        name: config.name || node.id,
        maxBytes: Math.round((isFinite(maxMb) && maxMb > 0 ? maxMb : 32) * MB),
        timeout: Math.round((isFinite(timeoutS) && timeoutS > 0 ? timeoutS : 10) * 1000),
        delivery: config.delivery === "latest" ? "latest" : "queue",
        retain: config.retain === true || config.retain === "true",
        compress: config.compress === "auto" ? "auto" : "off"
    };
}

function errorText(e) {
    if (!e) return "";
    if (typeof e === "string") return e;
    return e.message || (e.toString ? e.toString() : String(e));
}

module.exports = function (RED) {
    const ns = RED.settings && RED.settings.nexaDashboard;
    const screenPort = (ns && ns.screenWorkerPort) || 1881;
    bridge.configure({
        port: ns && ns.linkWorkerPort !== undefined ? ns.linkWorkerPort : screenPort + 1,
        log: RED.log
    });

    function NexaChannelNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.name = config.name;
        bridge.registerChannel(channelConfig(node, config));
        node.on("close", function () { bridge.unregisterChannel(node.id); });
    }
    RED.nodes.registerType("kufayeka-nexa-channel", NexaChannelNode);

    function NexaFromNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const channel = config.channel && RED.nodes.getNode(config.channel);
        if (!channel) {
            node.status({ fill: "red", shape: "ring", text: "no channel" });
            return;
        }
        node.status({});
        const stop = bridge.listen(channel.id, function (m) {
            m.topic = channel.name || "";
            node.send(m);
        });
        node.on("close", stop);
    }
    RED.nodes.registerType("kufayeka-nexa-from", NexaFromNode);

    function NexaToNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const channel = config.channel && RED.nodes.getNode(config.channel);
        const target = config.target === "all" || config.target === "client" ? config.target : "auto";
        node.on("input", function (msg, send, done) {
            const nexa = msg._nexa && typeof msg._nexa === "object" ? msg._nexa : null;
            const finish = function (err, delivered) {
                if (err) { done(new Error(err)); return; }
                if (delivered !== undefined) node.status({ fill: "green", shape: "dot", text: delivered === 1 ? "1 page" : delivered + " pages" });
                done();
            };
            if (target === "auto" && nexa && nexa.reqId) {
                // msg.error (a string, an Error, or what a Catch node sets) answers the request with an error
                const err = msg.error ? errorText(msg.error) : null;
                bridge.reply(nexa.reqId, nexa.channel, msg.payload, err, finish);
                return;
            }
            if (target === "client") {
                if (!nexa || !nexa.client) { done(new Error("target is \"the page in msg._nexa\" but msg._nexa.client is missing")); return; }
                bridge.push(nexa.channel || (channel && channel.id), msg.payload, nexa.client, finish);
                return;
            }
            if (!channel) { done(new Error("no channel selected")); return; }
            bridge.push(channel.id, msg.payload, null, finish);
        });
    }
    RED.nodes.registerType("kufayeka-nexa-to", NexaToNode);
};

module.exports.channelConfig = channelConfig;
