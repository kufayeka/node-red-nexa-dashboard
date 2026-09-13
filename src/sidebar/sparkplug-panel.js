import { state } from "../state.js";
import {
    ensureSparkplugCommsWired, onSparkplugLiveUpdate, getRawTree,
    formatSparkplugValue, openSparkplugConnectionSettings
} from "../canvas/sparkplug-live.js";

var liveWired = false;

function collapsibleHeader(parentEl, label, iconClass, extra) {
    var header = window.$("<div>", { "class": "nexa-sparkplug-node-header" }).css({
        display: "flex", "align-items": "center", gap: "6px",
        padding: "5px 8px", cursor: "pointer", "user-select": "none",
        "font-size": "12px", "font-weight": "600",
        background: "var(--red-ui-tertiary-background, #f8fafc)",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)"
    }).appendTo(parentEl);
    window.$("<i>", { "class": "fa fa-angle-down" }).css({ width: "12px" }).appendTo(header);
    window.$("<i>", { "class": "fa " + iconClass }).appendTo(header);
    window.$("<span>").css({ flex: "1 1 auto", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }).text(label).appendTo(header);
    if (extra) extra(header);
    return header;
}

function onlineDot(online) {
    return window.$("<span>").css({
        width: "7px", height: "7px", "border-radius": "50%", "flex": "0 0 auto",
        background: online ? "#22c55e" : "#cbd5e1"
    }).attr("title", online ? "online" : "offline");
}

function metricChip(container, ref, name) {
    var row = window.$("<div>", { "class": "nexa-sparkplug-metric-row" }).css({
        display: "flex", "align-items": "center", "justify-content": "space-between",
        gap: "8px", padding: "3px 8px 3px 30px", cursor: "grab", "user-select": "none",
        "font-size": "11px", "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f5f5f5)"
    }).appendTo(container);
    window.$("<span>").css({
        overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", flex: "1 1 auto"
    }).text(name).appendTo(row);
    window.$("<span>", { "class": "nexa-sparkplug-value" }).css({
        "font-family": "monospace", color: "var(--red-ui-secondary-text-color, #475569)",
        flex: "0 0 auto", "max-width": "40%", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap"
    }).text(formatSparkplugValue(ref)).appendTo(row);

    // Marker attribute for state.artboardEl's droppable() accept selector
    // (editor-tray.js) — the actual rich payload rides on .data(), same
    // split the Events tab's logic-node chips already use, since a metric
    // reference doesn't reduce to a bare type-id string.
    row.attr("data-sparkplug-metric", "1");
    row.data("nexaSparkplugMetric", ref);

    row.draggable({
        helper: "clone",
        appendTo: "#red-ui-editor",
        revert: "invalid",
        zIndex: 10000,
        start: function (e, ui) {
            if (ui && ui.helper) {
                ui.helper.css({
                    "z-index": 10000, opacity: 0.88, "pointer-events": "none",
                    "box-shadow": "0 6px 16px rgba(0,0,0,0.25)"
                });
            }
        },
        stop: function () {
            if (!state.artboardEl) {
                if (window.RED && window.RED.notify) window.RED.notify("Open the Pages canvas first (menu → Pages)", { type: "warning", timeout: 2000 });
                return;
            }
            if (state.activeCanvasTab !== "ui") {
                if (window.RED && window.RED.notify) window.RED.notify("Switch to the UI tab first", { type: "warning", timeout: 2000 });
            }
        }
    });
    return row;
}

function drawTree(container) {
    container.empty();
    var tree = getRawTree();
    var groupIds = Object.keys(tree);

    if (!groupIds.length) {
        window.$("<div>").css({ color: "#999", "font-size": "12px", padding: "16px", "text-align": "center" })
            .text("No Sparkplug data seen yet. Check the connection settings and make sure an Edge Node is publishing.")
            .appendTo(container);
        return;
    }

    function bindToggle(header, body) {
        header.on("click", function () {
            body.toggle();
            header.find("> i.fa-angle-down, > i.fa-angle-right").toggleClass("fa-angle-down fa-angle-right");
        });
    }

    groupIds.sort().forEach(function (groupId) {
        var groupHeader = collapsibleHeader(container, groupId, "fa-object-group");
        var groupBody = window.$("<div>").appendTo(container);
        bindToggle(groupHeader, groupBody);

        var edgeNodes = tree[groupId];
        Object.keys(edgeNodes).sort().forEach(function (edgeNodeId) {
            var edgeNode = edgeNodes[edgeNodeId];
            var edgeHeader = collapsibleHeader(groupBody, edgeNodeId, "fa-microchip", function (header) {
                onlineDot(edgeNode.online).appendTo(header);
            });
            edgeHeader.css({ "padding-left": "22px", background: "transparent", "font-weight": "500" });
            var edgeBody = window.$("<div>").appendTo(groupBody);
            bindToggle(edgeHeader, edgeBody);

            var nodeMetricNames = Object.keys(edgeNode.nodeMetrics || {});
            if (nodeMetricNames.length) {
                var nodeMetricsWrap = window.$("<div>").appendTo(edgeBody);
                nodeMetricNames.sort().forEach(function (name) {
                    metricChip(nodeMetricsWrap, { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: null, metricName: name }, name);
                });
            }

            Object.keys(edgeNode.devices || {}).sort().forEach(function (deviceId) {
                var device = edgeNode.devices[deviceId];
                var deviceHeader = collapsibleHeader(edgeBody, deviceId, "fa-cube", function (header) {
                    onlineDot(device.online && edgeNode.online).appendTo(header);
                });
                deviceHeader.css({ "padding-left": "34px", background: "transparent", "font-weight": "400" });
                var deviceBody = window.$("<div>").appendTo(edgeBody);
                bindToggle(deviceHeader, deviceBody);

                Object.keys(device.metrics || {}).sort().forEach(function (name) {
                    metricChip(deviceBody, { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: deviceId, metricName: name }, name);
                });
            });
        });
    });
}

export function renderSparkplugPanel() {
    if (!state.sparkplugPane) return;
    ensureSparkplugCommsWired();
    var pane = state.sparkplugPane;
    pane.empty();

    var toolbar = window.$("<div>").css({
        display: "flex", "align-items": "center", "justify-content": "space-between",
        padding: "8px 10px", "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)",
        background: "var(--red-ui-tertiary-background, #f8fafc)", "flex-shrink": "0"
    }).appendTo(pane);
    window.$("<span>").css({
        "font-size": "11px", "font-weight": "bold", "text-transform": "uppercase",
        color: "var(--red-ui-secondary-text-color, #64748b)"
    }).text("MQTT Sparkplug").appendTo(toolbar);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small" })
        .text("Configure Connection...").css({ "font-size": "11px", padding: "2px 8px", height: "24px", "line-height": "20px" })
        .on("click", function () { openSparkplugConnectionSettings(); })
        .appendTo(toolbar);

    var treeWrap = window.$("<div>", { "class": "nexa-sparkplug-tree" }).css({ flex: "1 1 auto", "overflow-y": "auto" }).appendTo(pane);
    drawTree(treeWrap);

    if (!liveWired) {
        liveWired = true;
        // Simplest-correct approach: full redraw from the (in-memory, no
        // network) raw tree on every update batch, rather than precisely
        // patching just the changed DOM nodes — cheap for a typical HMI
        // project's metric counts, and it's the only thing already exactly
        // right about collapsed/expanded state going stale on structural
        // changes (a new device appearing, an edge node's online dot
        // flipping) without extra bookkeeping. Only actually redraws while
        // this tab is the visible one.
        onSparkplugLiveUpdate(function () {
            if (state.sparkplugPane && state.sparkplugPane.is(":visible")) {
                drawTree(treeWrap);
            }
        });
    }
}
