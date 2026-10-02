import { markDirty } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

// The Nexa Link Logic nodes (docs/LINK.md): the page side of a real Node-RED flow.
//   link-request  Request        msg.payload to the flow; output 1 = its answer, output 2 = msg.error
//   link-send     To Node-RED    msg.payload to the flow, fire and forget
//   link-receive  From Node-RED  fires for every message the flow pushes on the channel
// The channel is a kufayeka-nexa-channel config node: the dropdown lists the ones in
// the Node-RED editor (deployed or not), so it fills itself.
var TITLES = { "link-request": "Request", "link-send": "To Node-RED", "link-receive": "From Node-RED" };
var HELP = {
    "link-request": "Sends msg.payload to a Node-RED flow (a \"from Nexa\" node on this channel) and waits for its answer (a \"to Nexa\" node). The flow runs on the server: database queries and API keys stay there. Output 1: msg.payload = the answer. Output 2: msg.error (the flow answered with an error, the channel timeout passed, or the link is down).",
    "link-send": "Sends msg.payload to a Node-RED flow (a \"from Nexa\" node on this channel). It doesn't wait for an answer; msg goes on once it is sent.",
    "link-receive": "Fires for every message a Node-RED flow pushes to this channel (a \"to Nexa\" node). msg.payload = the message. Only while this screen is open."
};

/** All kufayeka-nexa-channel config nodes in the Node-RED editor: [{id, name}]. */
export function listLinkChannels() {
    var out = [];
    var RED = window.RED;
    if (RED && RED.nodes && typeof RED.nodes.eachConfig === "function") {
        RED.nodes.eachConfig(function (n) {
            if (n.type === "kufayeka-nexa-channel") out.push({ id: n.id, name: n.name || n.id });
        });
    }
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
}

function channelName(node) {
    var RED = window.RED;
    var cfg = node.channel && RED && RED.nodes && typeof RED.nodes.node === "function" ? RED.nodes.node(node.channel) : null;
    return (cfg && cfg.name) || node.channelName || (node.channel ? "(missing channel)" : "(no channel)");
}

export function linkNodeLabel(node) {
    return (TITLES[node.type] || node.type) + ": " + channelName(node);
}

export function openLinkNodeEditor(node) {
    var d = { channel: node.channel || "" };
    window.RED.tray.show({
        id: "nexa-logic-link-editor",
        title: "Configure " + TITLES[node.type] + " Node",
        width: 480,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.channel = d.channel;
                    // kept for the label and msg.topic, in case the config node is renamed / not in this editor
                    var picked = listLinkChannels().filter(function (c) { return c.id === d.channel; })[0];
                    node.channelName = picked ? picked.name : "";
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" }).text(HELP[node.type]).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888", margin: "8px 0 4px" }).text("Channel").appendTo(body);
            var channels = listLinkChannels();
            if (!channels.length) {
                window.$("<div>").css({ "font-size": "12px", color: "#b45309" }).text(
                    "No channel yet. In a Node-RED flow, add a \"from Nexa\" or \"to Nexa\" node and create a channel in it (the pencil next to Channel). It shows up here right away."
                ).appendTo(body);
                return;
            }
            if (!d.channel || !channels.some(function (c) { return c.id === d.channel; })) d.channel = channels[0].id;
            var input = window.$("<input>", { type: "text" }).css({ width: "calc(100% - 4px)" }).appendTo(body);
            input.typedInput({ types: [{ value: "channel", options: channels.map(function (c) { return { value: c.id, label: c.name }; }) }] });
            input.typedInput("value", d.channel);
            input.on("change", function () { d.channel = input.typedInput("value"); });
            window.$("<div>").css({ "font-size": "11px", color: "#888", "margin-top": "10px" }).text(
                "Timeout, size limit, delivery and compression are set on the channel (in Node-RED). Links use their own connection, apart from the tags."
            ).appendTo(body);
        }
    });
}
