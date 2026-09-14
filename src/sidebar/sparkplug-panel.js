import { state } from "../state.js";
import {
    ensureSparkplugCommsWired, onSparkplugLiveUpdate, getRawTree,
    formatSparkplugValue, openSparkplugConnectionSettings, requestSparkplugRebirth
} from "../canvas/sparkplug-live.js";

var liveWired = false;
var isDragging = false;
var pendingTreeRebuild = false;
var collapsedPaths = {}; // pathKey -> boolean (true if collapsed)
var lastRenderedStructureKey = null;

function computeStructureKey(tree) {
    var keys = [];
    var groupIds = Object.keys(tree || {}).sort();
    if (!groupIds.length) return "";
    groupIds.forEach(function (g) {
        var edgeNodes = tree[g] || {};
        var eIds = Object.keys(edgeNodes).sort();
        eIds.forEach(function (e) {
            var node = edgeNodes[e];
            var nMetrics = Object.keys(node.nodeMetrics || {}).sort().join(",");
            var devKeys = [];
            Object.keys(node.devices || {}).sort().forEach(function (d) {
                var dev = node.devices[d];
                var dMetrics = Object.keys(dev.metrics || {}).sort().join(",");
                devKeys.push(d + "[" + dMetrics + "]");
            });
            keys.push(g + "::" + e + "(" + nMetrics + ")::" + devKeys.join(";"));
        });
    });
    return keys.join("|");
}

function collapsibleHeader(parentEl, label, iconClass, pathKey, extra) {
    var header = window.$("<div>", { "class": "nexa-sparkplug-node-header" }).css({
        display: "flex", "align-items": "center", gap: "6px",
        padding: "5px 8px", cursor: "pointer", "user-select": "none",
        "font-size": "12px", "font-weight": "600",
        background: "var(--red-ui-tertiary-background, #f8fafc)",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)"
    }).appendTo(parentEl);
    var isCollapsed = !!collapsedPaths[pathKey];
    window.$("<i>", { "class": "fa " + (isCollapsed ? "fa-angle-right" : "fa-angle-down") }).css({ width: "12px" }).appendTo(header);
    window.$("<i>", { "class": "fa " + iconClass }).appendTo(header);
    window.$("<span>").css({ flex: "1 1 auto", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }).text(label).appendTo(header);
    if (extra) extra(header);
    return header;
}

function onlineDot(online) {
    return window.$("<span>", { "class": "nexa-sparkplug-online-dot" }).css({
        width: "7px", height: "7px", "border-radius": "50%", "flex": "0 0 auto",
        background: online ? "#22c55e" : "#cbd5e1"
    }).attr("title", online ? "online" : "offline");
}

function metricChip(container, ref, name) {
    var key = ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "") + "::" + ref.metricName;
    var row = window.$("<div>", { "class": "nexa-sparkplug-metric-row" }).css({
        display: "flex", "align-items": "center", "justify-content": "space-between",
        gap: "8px", padding: "3px 8px 3px 30px", cursor: "grab", "user-select": "none",
        "font-size": "11px", "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f5f5f5)"
    }).attr("data-metric-key", key).appendTo(container);

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
            isDragging = true;
            if (ui && ui.helper) {
                ui.helper.css({
                    "z-index": 10000, opacity: 0.88, "pointer-events": "none",
                    "box-shadow": "0 6px 16px rgba(0,0,0,0.25)"
                });
            }
        },
        stop: function () {
            isDragging = false;
            if (pendingTreeRebuild) {
                pendingTreeRebuild = false;
                var wrap = state.sparkplugPane && state.sparkplugPane.find(".nexa-sparkplug-tree");
                if (wrap && wrap.length) renderOrUpdateTree(wrap);
            }
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

function updateLiveValues(container, changedKeys) {
    if (changedKeys && Array.isArray(changedKeys) && changedKeys.length) {
        changedKeys.forEach(function (key) {
            var row = container.find('.nexa-sparkplug-metric-row[data-metric-key="' + key + '"]');
            if (row.length) {
                var ref = row.data("nexaSparkplugMetric");
                if (ref) {
                    row.find(".nexa-sparkplug-value").text(formatSparkplugValue(ref));
                }
            }
        });
    } else {
        container.find(".nexa-sparkplug-metric-row").each(function () {
            var row = window.$(this);
            var ref = row.data("nexaSparkplugMetric");
            if (ref) {
                row.find(".nexa-sparkplug-value").text(formatSparkplugValue(ref));
            }
        });
    }
}

function updateOnlineStatus(container, tree) {
    Object.keys(tree || {}).forEach(function (groupId) {
        var edgeNodes = tree[groupId] || {};
        Object.keys(edgeNodes).forEach(function (edgeNodeId) {
            var edgeNode = edgeNodes[edgeNodeId];
            var edgeDot = container.find('[data-edge-key="' + groupId + '::' + edgeNodeId + '"] .nexa-sparkplug-online-dot');
            if (edgeDot.length) {
                edgeDot.css("background", edgeNode.online ? "#22c55e" : "#cbd5e1")
                       .attr("title", edgeNode.online ? "online" : "offline");
            }
            Object.keys(edgeNode.devices || {}).forEach(function (deviceId) {
                var device = edgeNode.devices[deviceId];
                var isOnline = !!(device.online && edgeNode.online);
                var deviceDot = container.find('[data-device-key="' + groupId + '::' + edgeNodeId + '::' + deviceId + '"] .nexa-sparkplug-online-dot');
                if (deviceDot.length) {
                    deviceDot.css("background", isOnline ? "#22c55e" : "#cbd5e1")
                             .attr("title", isOnline ? "online" : "offline");
                }
            });
        });
    });
}

function drawTree(container, tree) {
    container.empty();
    tree = tree || getRawTree();
    var groupIds = Object.keys(tree);

    if (!groupIds.length) {
        window.$("<div>").css({ color: "#999", "font-size": "12px", padding: "16px", "text-align": "center" })
            .text("No Sparkplug data seen yet. Check the connection settings and make sure an Edge Node is publishing.")
            .appendTo(container);
        return;
    }

    // `buildChildren`, when given, is deferred until the FIRST time this
    // folder is actually expanded rather than run unconditionally up front
    // — a folder that starts (or stays) collapsed never has its metric rows
    // built at all, no DOM nodes and no draggable() initialization, instead
    // of building everything and merely CSS-hiding it. This matters once a
    // tree has hundreds/thousands of metrics: the previous behavior spent
    // real time (draggable() alone is not free) on rows a user may never
    // even open, on every drawTree() rebuild (a real, if less frequent,
    // concern even with renderOrUpdateTree's own structure-key check below
    // — a single newly-appeared metric anywhere in the whole tree still
    // forces one full drawTree(), which used to re-build EVERY folder's
    // contents regardless of collapsed state). Re-collapsing and expanding
    // again reuses what was already built (`built` below), so this never
    // rebuilds on every toggle, only on the first expand.
    function bindToggle(header, body, pathKey, buildChildren) {
        var built = !buildChildren; // nothing to defer if there's no buildChildren at all
        function build() {
            if (built) return;
            built = true;
            buildChildren();
        }
        if (collapsedPaths[pathKey]) {
            body.hide();
        } else {
            build();
        }
        header.on("click", function () {
            var currentlyCollapsed = !body.is(":visible");
            if (currentlyCollapsed) build(); // about to expand -- this is the first look, if it hasn't been built yet
            body.toggle();
            var isCollapsed = !body.is(":visible");
            collapsedPaths[pathKey] = isCollapsed;
            var icon = header.find("> i.fa-angle-down, > i.fa-angle-right");
            if (isCollapsed) {
                icon.removeClass("fa-angle-down").addClass("fa-angle-right");
            } else {
                icon.removeClass("fa-angle-right").addClass("fa-angle-down");
            }
        });
    }

    groupIds.sort().forEach(function (groupId) {
        var groupKey = "g::" + groupId;
        var groupHeader = collapsibleHeader(container, groupId, "fa-object-group", groupKey);
        var groupBody = window.$("<div>").appendTo(container);
        bindToggle(groupHeader, groupBody, groupKey, function () {
            var edgeNodes = tree[groupId];
            Object.keys(edgeNodes).sort().forEach(function (edgeNodeId) {
                var edgeNode = edgeNodes[edgeNodeId];
                var edgeKey = "e::" + groupId + "::" + edgeNodeId;
                var edgeHeader = collapsibleHeader(groupBody, edgeNodeId, "fa-microchip", edgeKey, function (header) {
                    header.attr("data-edge-key", groupId + "::" + edgeNodeId);
                    onlineDot(edgeNode.online).appendTo(header);
                });
                edgeHeader.css({ "padding-left": "22px", background: "transparent", "font-weight": "500" });
                var edgeBody = window.$("<div>").appendTo(groupBody);
                bindToggle(edgeHeader, edgeBody, edgeKey, function () {
                    var nodeMetricNames = Object.keys(edgeNode.nodeMetrics || {});
                    if (nodeMetricNames.length) {
                        var nodeMetricsWrap = window.$("<div>").appendTo(edgeBody);
                        nodeMetricNames.sort().forEach(function (name) {
                            metricChip(nodeMetricsWrap, { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: null, metricName: name }, name);
                        });
                    }

                    Object.keys(edgeNode.devices || {}).sort().forEach(function (deviceId) {
                        var device = edgeNode.devices[deviceId];
                        var deviceKey = "d::" + groupId + "::" + edgeNodeId + "::" + deviceId;
                        var deviceHeader = collapsibleHeader(edgeBody, deviceId, "fa-cube", deviceKey, function (header) {
                            header.attr("data-device-key", groupId + "::" + edgeNodeId + "::" + deviceId);
                            onlineDot(device.online && edgeNode.online).appendTo(header);
                        });
                        deviceHeader.css({ "padding-left": "34px", background: "transparent", "font-weight": "400" });
                        var deviceBody = window.$("<div>").appendTo(edgeBody);
                        bindToggle(deviceHeader, deviceBody, deviceKey, function () {
                            Object.keys(device.metrics || {}).sort().forEach(function (name) {
                                metricChip(deviceBody, { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: deviceId, metricName: name }, name);
                            });
                        });
                    });
                });
            });
        });
    });
}

function renderOrUpdateTree(container, changedKeys) {
    var tree = getRawTree();
    var structKey = computeStructureKey(tree);

    if (isDragging) {
        if (structKey !== lastRenderedStructureKey) {
            pendingTreeRebuild = true;
        }
        updateLiveValues(container, changedKeys);
        updateOnlineStatus(container, tree);
        return;
    }

    if (structKey === lastRenderedStructureKey && container.children().length > 0) {
        updateLiveValues(container, changedKeys);
        updateOnlineStatus(container, tree);
        return;
    }

    lastRenderedStructureKey = structKey;
    drawTree(container, tree);
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
    var toolbarButtons = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "4px" }).appendTo(toolbar);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Ask every known Edge Node to re-send its NBIRTH/DBIRTH — NBIRTH/DBIRTH are only ever published once and aren't retained by the broker, so anything that connected after an Edge Node already birthed (or a metric only ever sent by alias) can otherwise stay invisible or stuck at \"???\" forever." })
        .html('<i class="fa fa-refresh"></i> Rebirth / Refresh').css({ "font-size": "11px", padding: "2px 8px", height: "24px", "line-height": "20px" })
        .on("click", function () { requestSparkplugRebirth(); })
        .appendTo(toolbarButtons);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small" })
        .text("Configure Connection...").css({ "font-size": "11px", padding: "2px 8px", height: "24px", "line-height": "20px" })
        .on("click", function () { openSparkplugConnectionSettings(); })
        .appendTo(toolbarButtons);

    var treeWrap = window.$("<div>", { "class": "nexa-sparkplug-tree" }).css({ flex: "1 1 auto", "overflow-y": "auto" }).appendTo(pane);
    lastRenderedStructureKey = null; // force initial draw
    renderOrUpdateTree(treeWrap);

    if (!liveWired) {
        liveWired = true;
        onSparkplugLiveUpdate(function (changedKeys) {
            if (state.sparkplugPane && state.sparkplugPane.is(":visible")) {
                var currentWrap = state.sparkplugPane.find(".nexa-sparkplug-tree");
                if (currentWrap.length) {
                    renderOrUpdateTree(currentWrap, changedKeys);
                }
            }
        });
    }
}

