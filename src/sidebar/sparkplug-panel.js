import { state } from "../state.js";
import {
    ensureSparkplugCommsWired, onSparkplugLiveUpdate, getRawTree,
    formatSparkplugValue, formatSparkplugTimestamp, getSparkplugEntry,
    openSparkplugConnectionSettings, requestSparkplugRebirth
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
        padding: "4px 6px", cursor: "pointer", "user-select": "none",
        "font-size": "12px", "font-weight": "600",
        background: "var(--red-ui-tertiary-background, #f8fafc)",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)",
        "border-radius": "3px", "margin-bottom": "1px"
    }).appendTo(parentEl);
    var isCollapsed = !!collapsedPaths[pathKey];
    window.$("<i>", { "class": "fa " + (isCollapsed ? "fa-caret-right" : "fa-caret-down") }).css({ width: "10px", color: "#64748b", "flex-shrink": "0" }).appendTo(header);
    window.$("<i>", { "class": "fa " + iconClass }).css({ color: "#475569", "flex-shrink": "0" }).appendTo(header);
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

function renderBooleanBadge(val) {
    var isTrue = !!val;
    var badge = window.$("<span>", { "class": "nexa-sparkplug-bool-badge" }).css({
        display: "inline-flex", "align-items": "center", "justify-content": "center",
        width: "13px", height: "13px", "border-radius": "2px",
        "font-size": "9px", "line-height": "1", "font-weight": "bold",
        background: isTrue ? "#38bdf8" : "#ffffff",
        border: isTrue ? "1px solid #0284c7" : "1px solid #cbd5e1",
        color: isTrue ? "#ffffff" : "transparent"
    });
    if (isTrue) badge.html("&#10003;");
    return badge;
}

function renderPropertyRow(container, propName, propValue, dataPropKey) {
    var row = window.$("<div>", { "class": "nexa-sparkplug-prop-row" }).css({
        display: "flex", "align-items": "center", "justify-content": "space-between",
        padding: "2px 8px 2px 4px", "font-size": "11px",
        color: "var(--red-ui-primary-text-color, #334155)",
        "line-height": "18px"
    }).appendTo(container);

    var left = window.$("<div>").css({
        display: "flex", "align-items": "center", gap: "6px",
        overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", flex: "1 1 auto"
    }).appendTo(row);

    // Square bullet matching Ignition
    window.$("<span>").css({
        display: "inline-block", width: "6px", height: "6px",
        background: "#64748b", "flex-shrink": "0", "border-radius": "1px"
    }).appendTo(left);

    window.$("<span>").text(propName).appendTo(left);

    var right = window.$("<div>", {
        "class": "nexa-sparkplug-prop-val-wrap"
    }).css({
        flex: "0 0 auto", "max-width": "60%", "text-align": "right",
        overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap"
    }).appendTo(row);

    if (dataPropKey) {
        right.attr("data-prop-key", dataPropKey);
    }

    if (typeof propValue === "boolean") {
        renderBooleanBadge(propValue).appendTo(right);
    } else {
        var textVal = propValue === undefined || propValue === null ? "" : String(propValue);
        window.$("<span>", { "class": "nexa-sparkplug-prop-text" }).css({
            "font-family": "var(--red-ui-monospace-font, monospace)", "font-size": "11px",
            color: "var(--red-ui-secondary-text-color, #475569)"
        }).text(textVal).appendTo(right);
    }
    return row;
}

function buildTagDetails(container, ref) {
    container.empty();
    var entry = getSparkplugEntry(ref) || {};
    var props = entry.properties || {};

    // Standard list of property keys matching Sparkplug B & Ignition
    var allKeys = Object.keys(props);
    var seenKeys = {};

    var priorityOrder = [
        "AlarmEvalEnabled", "CanRead", "CanWrite", "Deadband", "Documentation",
        "EngHigh", "EngLow", "EngUnit", "FormatString", "HistoryEnabled",
        "Quality", "ReadOnly", "TagGroup", "Timestamp", "Tooltip", "value", "DataType"
    ];

    var orderedList = [];
    priorityOrder.forEach(function (k) {
        if (k === "value" || k === "Timestamp" || k === "DataType" || k === "Quality") {
            orderedList.push(k);
            seenKeys[k] = true;
        } else if (props[k] !== undefined) {
            orderedList.push(k);
            seenKeys[k] = true;
        }
    });

    allKeys.sort().forEach(function (k) {
        if (!seenKeys[k]) {
            orderedList.push(k);
            seenKeys[k] = true;
        }
    });

    orderedList.sort(function (a, b) {
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });

    orderedList.forEach(function (key) {
        if (key === "value") {
            renderPropertyRow(container, "value", formatSparkplugValue(ref), "value");
        } else if (key === "Timestamp") {
            renderPropertyRow(container, "Timestamp", formatSparkplugTimestamp(entry.timestamp), "Timestamp");
        } else if (key === "DataType") {
            renderPropertyRow(container, "DataType", entry.type || "String", "DataType");
        } else if (key === "Quality") {
            var q = entry.online ? (entry.isNull ? "Bad" : (props.Quality !== undefined ? props.Quality : "Good")) : "Bad";
            renderPropertyRow(container, "Quality", q, "Quality");
        } else {
            renderPropertyRow(container, key, props[key], key);
        }
    });
}

function tagNode(container, ref, name) {
    var key = ref.groupId + "::" + ref.edgeNodeId + "::" + (ref.deviceId || "") + "::" + ref.metricName;
    var tagPathKey = "t::" + key;
    if (collapsedPaths[tagPathKey] === undefined) {
        collapsedPaths[tagPathKey] = true;
    }
    var isCollapsed = !!collapsedPaths[tagPathKey];

    var tagWrap = window.$("<div>", { "class": "nexa-sparkplug-tag-wrap" }).attr("data-metric-key", key).css({
        "margin-bottom": "1px"
    }).appendTo(container);

    var row = window.$("<div>", { "class": "nexa-sparkplug-metric-row" }).css({
        display: "flex", "align-items": "center", "justify-content": "space-between",
        gap: "6px", padding: "3px 6px", cursor: "grab", "user-select": "none",
        "font-size": "12px", "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f8fafc)",
        "border-radius": "2px"
    }).appendTo(tagWrap);

    var left = window.$("<div>").css({
        display: "flex", "align-items": "center", gap: "6px",
        overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", flex: "1 1 auto"
    }).appendTo(row);

    // Expand / Collapse Chevron
    var chevron = window.$("<i>", {
        "class": "fa " + (isCollapsed ? "fa-caret-right" : "fa-caret-down")
    }).css({
        width: "10px", cursor: "pointer", color: "#64748b", "flex-shrink": "0"
    }).appendTo(left);

    // Ignition Tag Icon
    window.$("<i>", { "class": "fa fa-tag" }).css({
        color: "#60a5fa", "font-size": "11px", "flex-shrink": "0"
    }).appendTo(left);

    // Tag Name
    window.$("<span>", { "class": "nexa-sparkplug-tag-name" }).css({
        overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
        color: "var(--red-ui-primary-text-color, #1e293b)", "font-weight": "500"
    }).text(name).appendTo(left);

    // Live Value on the right of the Tag header
    window.$("<span>", { "class": "nexa-sparkplug-value" }).css({
        "font-family": "var(--red-ui-monospace-font, monospace)",
        color: "var(--red-ui-secondary-text-color, #334155)",
        flex: "0 0 auto", "max-width": "40%", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
        "font-size": "11px", "font-weight": "500"
    }).text(formatSparkplugValue(ref)).appendTo(row);

    // Child Details Container (Collapsible) with dotted guide line
    var detailsBody = window.$("<div>", { "class": "nexa-sparkplug-tag-details" }).css({
        "margin-left": "14px",
        "padding-left": "6px",
        "border-left": "1px dotted #cbd5e1",
        "padding-top": "2px",
        "padding-bottom": "4px"
    }).appendTo(tagWrap);

    var detailsBuilt = false;
    function buildDetails() {
        if (detailsBuilt) return;
        detailsBuilt = true;
        buildTagDetails(detailsBody, ref);
    }

    if (isCollapsed) {
        detailsBody.hide();
    } else {
        buildDetails();
    }

    // Toggle on chevron click
    chevron.on("click", function (e) {
        e.stopPropagation();
        var currentlyCollapsed = !detailsBody.is(":visible");
        if (currentlyCollapsed) buildDetails();
        detailsBody.toggle();
        var nowCollapsed = !detailsBody.is(":visible");
        collapsedPaths[tagPathKey] = nowCollapsed;
        if (nowCollapsed) {
            chevron.removeClass("fa-caret-down").addClass("fa-caret-right");
        } else {
            chevron.removeClass("fa-caret-right").addClass("fa-caret-down");
        }
    });

    // Marker attribute for artboard drag-drop
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

    return tagWrap;
}

function updateSingleMetricDOM(row, ref) {
    var val = formatSparkplugValue(ref);
    row.find("> .nexa-sparkplug-metric-row .nexa-sparkplug-value").text(val);

    var details = row.find("> .nexa-sparkplug-tag-details");
    if (details.length && details.is(":visible")) {
        var entry = getSparkplugEntry(ref) || {};
        var valRow = details.find('[data-prop-key="value"] .nexa-sparkplug-prop-text');
        if (valRow.length) valRow.text(val);

        var tsRow = details.find('[data-prop-key="Timestamp"] .nexa-sparkplug-prop-text');
        if (tsRow.length) tsRow.text(formatSparkplugTimestamp(entry.timestamp));

        var qRow = details.find('[data-prop-key="Quality"] .nexa-sparkplug-prop-text');
        if (qRow.length) {
            var q = entry.online ? (entry.isNull ? "Bad" : ((entry.properties && entry.properties.Quality !== undefined) ? entry.properties.Quality : "Good")) : "Bad";
            qRow.text(q);
        }
    }
}

function updateLiveValues(container, changedKeys) {
    if (changedKeys && Array.isArray(changedKeys) && changedKeys.length) {
        changedKeys.forEach(function (key) {
            var tagWrap = container.find('.nexa-sparkplug-tag-wrap[data-metric-key="' + key + '"]');
            if (tagWrap.length) {
                var ref = tagWrap.find("> .nexa-sparkplug-metric-row").data("nexaSparkplugMetric");
                if (ref) {
                    updateSingleMetricDOM(tagWrap, ref);
                }
            }
        });
    } else {
        container.find(".nexa-sparkplug-tag-wrap").each(function () {
            var tagWrap = window.$(this);
            var ref = tagWrap.find("> .nexa-sparkplug-metric-row").data("nexaSparkplugMetric");
            if (ref) {
                updateSingleMetricDOM(tagWrap, ref);
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

function buildMetricHierarchy(metricsMap) {
    var root = { folders: {}, metrics: [] };
    var names = Object.keys(metricsMap || {}).sort();
    names.forEach(function (fullName) {
        var parts = fullName.split("/");
        var current = root;
        for (var i = 0; i < parts.length - 1; i++) {
            var folderName = parts[i];
            if (!current.folders[folderName]) {
                current.folders[folderName] = { folders: {}, metrics: [] };
            }
            current = current.folders[folderName];
        }
        var leafName = parts[parts.length - 1];
        current.metrics.push({
            name: leafName,
            fullName: fullName,
            entry: metricsMap[fullName]
        });
    });
    return root;
}

function renderMetricHierarchy(parentEl, hierarchy, basePathPrefix, refBase, bindToggle) {
    // 1. Render Subfolders (e.g. "Lantai_1", "tambahan")
    Object.keys(hierarchy.folders).sort().forEach(function (folderName) {
        var subTree = hierarchy.folders[folderName];
        var folderKey = basePathPrefix + "/f::" + folderName;
        var folderHeader = collapsibleHeader(parentEl, folderName, "fa-folder-o", folderKey);
        folderHeader.css({ background: "transparent" });
        var folderBody = window.$("<div>", { "class": "nexa-sparkplug-subfolder-body" }).css({
            "margin-left": "10px",
            "padding-left": "6px",
            "border-left": "1px dotted #cbd5e1",
            "margin-bottom": "2px"
        }).appendTo(parentEl);

        bindToggle(folderHeader, folderBody, folderKey, function () {
            renderMetricHierarchy(folderBody, subTree, folderKey, refBase, bindToggle);
        });
    });

    // 2. Render Tags in this folder level
    hierarchy.metrics.sort(function (a, b) {
        return a.name.localeCompare(b.name);
    }).forEach(function (m) {
        tagNode(parentEl, Object.assign({}, refBase, { metricName: m.fullName }), m.name);
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

    function bindToggle(header, body, pathKey, buildChildren) {
        var built = !buildChildren;
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
            if (currentlyCollapsed) build();
            body.toggle();
            var isCollapsed = !body.is(":visible");
            collapsedPaths[pathKey] = isCollapsed;
            var icon = header.find("> i.fa-caret-down, > i.fa-caret-right");
            if (isCollapsed) {
                icon.removeClass("fa-caret-down").addClass("fa-caret-right");
            } else {
                icon.removeClass("fa-caret-right").addClass("fa-caret-down");
            }
        });
    }

    groupIds.sort().forEach(function (groupId) {
        var groupKey = "g::" + groupId;
        var groupHeader = collapsibleHeader(container, groupId, "fa-folder-open", groupKey);
        var groupBody = window.$("<div>", { "class": "nexa-sparkplug-group-body" }).css({
            "margin-left": "10px",
            "padding-left": "6px",
            "border-left": "1px dotted #cbd5e1",
            "margin-bottom": "4px"
        }).appendTo(container);

        bindToggle(groupHeader, groupBody, groupKey, function () {
            var edgeNodes = tree[groupId];
            Object.keys(edgeNodes).sort().forEach(function (edgeNodeId) {
                var edgeNode = edgeNodes[edgeNodeId];
                var edgeKey = "e::" + groupId + "::" + edgeNodeId;
                var edgeHeader = collapsibleHeader(groupBody, edgeNodeId, "fa-server", edgeKey, function (header) {
                    header.attr("data-edge-key", groupId + "::" + edgeNodeId);
                    header.css({ background: "transparent" });
                    onlineDot(edgeNode.online).appendTo(header);
                });
                var edgeBody = window.$("<div>", { "class": "nexa-sparkplug-edge-body" }).css({
                    "margin-left": "10px",
                    "padding-left": "6px",
                    "border-left": "1px dotted #cbd5e1",
                    "margin-bottom": "3px"
                }).appendTo(groupBody);

                bindToggle(edgeHeader, edgeBody, edgeKey, function () {
                    var nodeMetrics = edgeNode.nodeMetrics || {};
                    if (Object.keys(nodeMetrics).length) {
                        var nodeMetricsWrap = window.$("<div>", { "class": "nexa-sparkplug-nodemetrics-wrap" }).appendTo(edgeBody);
                        var nodeHierarchy = buildMetricHierarchy(nodeMetrics);
                        renderMetricHierarchy(nodeMetricsWrap, nodeHierarchy, edgeKey + "/nm", { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: null }, bindToggle);
                    }

                    Object.keys(edgeNode.devices || {}).sort().forEach(function (deviceId) {
                        var device = edgeNode.devices[deviceId];
                        var deviceKey = "d::" + groupId + "::" + edgeNodeId + "::" + deviceId;
                        var deviceHeader = collapsibleHeader(edgeBody, deviceId, "fa-cube", deviceKey, function (header) {
                            header.attr("data-device-key", groupId + "::" + edgeNodeId + "::" + deviceId);
                            header.css({ background: "transparent" });
                            onlineDot(device.online && edgeNode.online).appendTo(header);
                        });
                        var deviceBody = window.$("<div>", { "class": "nexa-sparkplug-device-body" }).css({
                            "margin-left": "10px",
                            "padding-left": "6px",
                            "border-left": "1px dotted #cbd5e1",
                            "margin-bottom": "2px"
                        }).appendTo(edgeBody);

                        bindToggle(deviceHeader, deviceBody, deviceKey, function () {
                            var deviceHierarchy = buildMetricHierarchy(device.metrics || {});
                            renderMetricHierarchy(deviceBody, deviceHierarchy, deviceKey, { groupId: groupId, edgeNodeId: edgeNodeId, deviceId: deviceId }, bindToggle);
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

export function collapseAllSparkplugTree() {
    var pane = state.sparkplugPane;
    if (!pane) return;
    var container = pane.find(".nexa-sparkplug-tree");
    if (!container.length) return;

    // Set all known and rendered paths to collapsed
    Object.keys(collapsedPaths).forEach(function (k) {
        collapsedPaths[k] = true;
    });

    // Collapse all node bodies
    container.find(".nexa-sparkplug-node-header").each(function () {
        var header = window.$(this);
        header.find("> i.fa-caret-down").removeClass("fa-caret-down").addClass("fa-caret-right");
    });
    container.find(".nexa-sparkplug-node-header + div").hide();

    // Collapse all tag detail containers
    container.find(".nexa-sparkplug-tag-wrap").each(function () {
        var wrap = window.$(this);
        var metricKey = wrap.attr("data-metric-key");
        if (metricKey) collapsedPaths["t::" + metricKey] = true;
        wrap.find(".fa-caret-down").removeClass("fa-caret-down").addClass("fa-caret-right");
        wrap.find("> .nexa-sparkplug-tag-details").hide();
    });
}

export function expandAllSparkplugTree() {
    var pane = state.sparkplugPane;
    if (!pane) return;
    var container = pane.find(".nexa-sparkplug-tree");
    if (!container.length) return;

    // Reset collapsedPaths so all headers expand
    Object.keys(collapsedPaths).forEach(function (k) {
        if (k.indexOf("t::") !== 0) {
            collapsedPaths[k] = false;
        }
    });

    // Re-draw tree so all child builders run cleanly and open
    lastRenderedStructureKey = null;
    renderOrUpdateTree(container);
}

export function renderSparkplugPanel() {
    if (!state.sparkplugPane) return;
    ensureSparkplugCommsWired();
    var pane = state.sparkplugPane;
    pane.empty();

    var toolbar = window.$("<div>").css({
        display: "flex", "align-items": "center", "justify-content": "space-between",
        padding: "6px 8px", "border-bottom": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)",
        background: "var(--red-ui-tertiary-background, #f8fafc)", "flex-shrink": "0"
    }).appendTo(pane);

    window.$("<span>").css({
        "font-size": "11px", "font-weight": "bold", "text-transform": "uppercase",
        color: "var(--red-ui-secondary-text-color, #64748b)"
    }).text("MQTT Sparkplug").appendTo(toolbar);

    var toolbarButtons = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "4px" }).appendTo(toolbar);

    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Collapse All Folders and Tags" })
        .html('<i class="fa fa-compress"></i> Collapse All').css({ "font-size": "11px", padding: "2px 6px", height: "22px", "line-height": "18px" })
        .on("click", function () { collapseAllSparkplugTree(); })
        .appendTo(toolbarButtons);

    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Expand All Folders" })
        .html('<i class="fa fa-expand"></i> Expand All').css({ "font-size": "11px", padding: "2px 6px", height: "22px", "line-height": "18px" })
        .on("click", function () { expandAllSparkplugTree(); })
        .appendTo(toolbarButtons);

    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Ask every known Edge Node to re-send its NBIRTH/DBIRTH" })
        .html('<i class="fa fa-refresh"></i> Rebirth').css({ "font-size": "11px", padding: "2px 6px", height: "22px", "line-height": "18px" })
        .on("click", function () { requestSparkplugRebirth(); })
        .appendTo(toolbarButtons);

    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small", title: "Configure Sparkplug Connection" })
        .html('<i class="fa fa-cog"></i> Config...').css({ "font-size": "11px", padding: "2px 6px", height: "22px", "line-height": "18px" })
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


