import { markDirty, getActiveScreen } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";
import { buildEditableListWidget } from "../../../param-types.js";

var OPERATORS = [
    { v: "eq", label: "==" },
    { v: "neq", label: "!=" },
    { v: "lt", label: "<" },
    { v: "lte", label: "<=" },
    { v: "gt", label: ">" },
    { v: "gte", label: ">=" },
    { v: "btwn", label: "is between" },
    { v: "cont", label: "contains" },
    { v: "true", label: "is true" },
    { v: "false", label: "is false" },
    { v: "null", label: "is null" },
    { v: "nnull", label: "is not null" },
    { v: "empty", label: "is empty" },
    { v: "nempty", label: "is not empty" },
    { v: "else", label: "otherwise" }
];

var UNARY_OPERATORS = ["true", "false", "null", "nnull", "empty", "nempty", "else"];

function isUnary(op) {
    return UNARY_OPERATORS.indexOf(op) !== -1;
}

export function openSwitchNodeEditor(node) {
    var nameInput, propertyInput, checkallSelect;
    var currentPropertyType = node.propertyType || "msg";
    var rulesListEl;

    window.RED.tray.show({
        id: "nexa-logic-switch-editor",
        title: "Configure Switch Node",
        width: 600,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.name = (nameInput.val() || "").trim();
                    node.checkall = checkallSelect.val();

                    if (typeof propertyInput.typedInput === "function") {
                        node.propertyType = propertyInput.typedInput("type");
                        node.property = propertyInput.typedInput("value");
                    } else {
                        node.propertyType = currentPropertyType;
                        node.property = propertyInput.val();
                    }

                    var gatheredRules = [];
                    rulesListEl.find(".nexa-switch-rule-row").each(function () {
                        var row = window.$(this);
                        var getter = row.data("getRuleData");
                        if (typeof getter === "function") {
                            gatheredRules.push(getter());
                        }
                    });

                    if (!gatheredRules.length) {
                        gatheredRules.push({ t: "eq", v: "", vt: "str" });
                    }
                    node.rules = gatheredRules;
                    node.outputs = gatheredRules.length;

                    // Prune wires that were connected to deleted output ports
                    var screen = getActiveScreen();
                    if (screen && screen.logic && screen.logic.wires) {
                        screen.logic.wires = screen.logic.wires.filter(function (w) {
                            if (w.from === node.id) {
                                return (w.fromPort || 0) < gatheredRules.length;
                            }
                            return true;
                        });
                    }

                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "14px" });

            window.$("<div>").css({ "font-size": "12px", color: "var(--red-ui-secondary-text-color, #64748b)", "margin-bottom": "14px" })
                .text("Route messages based on property values and conditional rules. Each rule outputs to its corresponding output port.")
                .appendTo(body);

            // Name Row
            var nameRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Name").appendTo(nameRow);
            nameInput = window.$("<input>", { type: "text", placeholder: "Switch" }).css({ width: "100%", "box-sizing": "border-box" })
                .val(node.name || "").appendTo(nameRow);

            // Property Row (LHS: msg, var, tag - EXPLICITLY NO JSONata expression)
            var propRow = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Property").appendTo(propRow);

            var propContainer = window.$("<div>").css({ width: "100%" }).appendTo(propRow);
            propertyInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).appendTo(propContainer);

            var propTypes = [
                { value: "msg", label: "msg.", hasValue: true },
                { value: "var", label: "var", hasValue: true },
                { value: "tag", label: "tag", hasValue: true }
            ];

            if (typeof propertyInput.typedInput === "function") {
                propertyInput.typedInput({
                    default: node.propertyType || "msg",
                    types: propTypes,
                    width: "100%"
                });
                propertyInput.typedInput("type", node.propertyType || "msg");
                propertyInput.typedInput("value", node.property !== undefined ? String(node.property) : "payload");
            } else {
                // Fallback select + input for test environments
                propContainer.empty();
                var pFlex = window.$("<div>").css({ display: "flex", gap: "6px" }).appendTo(propContainer);
                var pTypeSel = window.$("<select>").css({ width: "90px" }).appendTo(pFlex);
                propTypes.forEach(function (pt) {
                    window.$("<option>", { value: pt.value }).text(pt.label).prop("selected", (node.propertyType || "msg") === pt.value).appendTo(pTypeSel);
                });
                propertyInput = window.$("<input>", { type: "text" }).css({ flex: "1" }).val(node.property !== undefined ? String(node.property) : "payload").appendTo(pFlex);
                pTypeSel.on("change", function () {
                    currentPropertyType = pTypeSel.val();
                });
            }

            // Rules List Header
            var rulesSection = window.$("<div>").css({ "margin-bottom": "14px" }).appendTo(body);
            window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "6px", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Rules (Output Ports)").appendTo(rulesSection);

            var valueTypes = [
                { value: "str", label: "string", hasValue: true },
                { value: "num", label: "num", hasValue: true },
                { value: "bool", label: "bool", hasValue: true },
                { value: "msg", label: "msg.", hasValue: true },
                { value: "var", label: "var", hasValue: true },
                { value: "tag", label: "tag", hasValue: true }
            ];

            function refreshPortBadges() {
                rulesListEl.find(".nexa-switch-rule-row").each(function (idx) {
                    window.$(this).find(".nexa-switch-port-badge").text(idx + 1);
                });
            }

            rulesListEl = buildEditableListWidget(rulesSection, {
                minHeight: "160px",
                maxHeight: "320px",
                addButton: "add rule",
                removable: true,
                sortable: true,
                addItem: function (container, index, ruleData) {
                    var rule = ruleData && ruleData.t ? ruleData : { t: "eq", v: "", vt: "str", v2: "", v2t: "num" };

                    var row = window.$("<div>", { "class": "nexa-switch-rule-row" }).css({
                        display: "flex",
                        "align-items": "center",
                        gap: "6px",
                        width: "100%",
                        padding: "2px 0"
                    }).appendTo(container);

                    // Port badge
                    var badge = window.$("<span>", { "class": "nexa-switch-port-badge" }).css({
                        display: "inline-flex",
                        "align-items": "center",
                        "justify-content": "center",
                        width: "20px",
                        height: "20px",
                        background: "var(--red-ui-secondary-background, #f1f5f9)",
                        color: "var(--red-ui-primary-text-color, #334155)",
                        border: "1px solid var(--red-ui-form-input-border-color, #cbd5e1)",
                        "border-radius": "50%",
                        "font-size": "10px",
                        "font-weight": "bold",
                        "flex-shrink": "0"
                    }).text(index + 1).appendTo(row);

                    // Operator select
                    var opSel = window.$("<select>").css({
                        width: "110px",
                        "flex-shrink": "0",
                        height: "28px"
                    }).appendTo(row);

                    OPERATORS.forEach(function (op) {
                        window.$("<option>", { value: op.v }).text(op.label).prop("selected", rule.t === op.v).appendTo(opSel);
                    });

                    // First value container
                    var valContainer = window.$("<div>").css({ flex: "1", "min-width": "0" }).appendTo(row);
                    var valInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).appendTo(valContainer);
                    var currentVt = rule.vt || "str";

                    if (typeof valInput.typedInput === "function") {
                        valInput.typedInput({
                            default: currentVt,
                            types: valueTypes,
                            width: "100%"
                        });
                        valInput.typedInput("type", currentVt);
                        valInput.typedInput("value", rule.v !== undefined ? String(rule.v) : "");
                    } else {
                        // Fallback select + input
                        valContainer.empty();
                        var vFlex = window.$("<div>").css({ display: "flex", gap: "4px" }).appendTo(valContainer);
                        var vtSel = window.$("<select>").css({ width: "65px" }).appendTo(vFlex);
                        valueTypes.forEach(function (vt) {
                            window.$("<option>", { value: vt.value }).text(vt.label).prop("selected", currentVt === vt.value).appendTo(vtSel);
                        });
                        valInput = window.$("<input>", { type: "text" }).css({ flex: "1" }).val(rule.v !== undefined ? String(rule.v) : "").appendTo(vFlex);
                        vtSel.on("change", function () { currentVt = vtSel.val(); });
                    }

                    // Second value container (for 'btwn')
                    var btwnContainer = window.$("<div>").css({
                        display: rule.t === "btwn" ? "flex" : "none",
                        "align-items": "center",
                        gap: "4px",
                        flex: "1",
                        "min-width": "0"
                    }).appendTo(row);

                    window.$("<span>").css({ "font-size": "11px", color: "#666" }).text("and").appendTo(btwnContainer);
                    var val2Input = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).appendTo(btwnContainer);
                    var currentV2t = rule.v2t || "num";

                    if (typeof val2Input.typedInput === "function") {
                        val2Input.typedInput({
                            default: currentV2t,
                            types: valueTypes,
                            width: "100%"
                        });
                        val2Input.typedInput("type", currentV2t);
                        val2Input.typedInput("value", rule.v2 !== undefined ? String(rule.v2) : "");
                    } else {
                        var v2Flex = window.$("<div>").css({ display: "flex", gap: "4px", width: "100%" }).appendTo(btwnContainer);
                        var v2tSel = window.$("<select>").css({ width: "65px" }).appendTo(v2Flex);
                        valueTypes.forEach(function (vt) {
                            window.$("<option>", { value: vt.value }).text(vt.label).prop("selected", currentV2t === vt.value).appendTo(v2tSel);
                        });
                        val2Input = window.$("<input>", { type: "text" }).css({ flex: "1" }).val(rule.v2 !== undefined ? String(rule.v2) : "").appendTo(v2Flex);
                        v2tSel.on("change", function () { currentV2t = v2tSel.val(); });
                    }

                    function updateRuleVisibility() {
                        var op = opSel.val();
                        if (isUnary(op)) {
                            valContainer.hide();
                            btwnContainer.hide();
                        } else if (op === "btwn") {
                            valContainer.show();
                            btwnContainer.show();
                        } else {
                            valContainer.show();
                            btwnContainer.hide();
                        }
                    }

                    opSel.on("change", updateRuleVisibility);
                    updateRuleVisibility();

                    row.data("getRuleData", function () {
                        var op = opSel.val();
                        var rObj = { t: op };
                        if (!isUnary(op)) {
                            if (typeof valInput.typedInput === "function") {
                                rObj.vt = valInput.typedInput("type");
                                rObj.v = valInput.typedInput("value");
                            } else {
                                rObj.vt = currentVt;
                                rObj.v = valInput.val();
                            }
                            if (op === "btwn") {
                                if (typeof val2Input.typedInput === "function") {
                                    rObj.v2t = val2Input.typedInput("type");
                                    rObj.v2 = val2Input.typedInput("value");
                                } else {
                                    rObj.v2t = currentV2t;
                                    rObj.v2 = val2Input.val();
                                }
                            }
                        }
                        return rObj;
                    });

                    setTimeout(refreshPortBadges, 10);
                },
                removeItem: function () {
                    setTimeout(refreshPortBadges, 10);
                }
            });

            // Populate initial rules
            var initialRules = (node.rules && node.rules.length) ? node.rules : [{ t: "eq", v: "", vt: "str" }];
            initialRules.forEach(function (r) {
                rulesListEl.editableList("addItem", r);
            });
            refreshPortBadges();

            // Evaluate Mode row
            var checkallRow = window.$("<div>").css({ "margin-top": "12px", display: "flex", "align-items": "center", gap: "8px" }).appendTo(body);
            window.$("<label>").css({ "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)" })
                .text("Evaluate").appendTo(checkallRow);
            checkallSelect = window.$("<select>").css({ flex: "1" }).appendTo(checkallRow);
            window.$("<option>", { value: "true" }).text("checking all rules").prop("selected", node.checkall !== "false").appendTo(checkallSelect);
            window.$("<option>", { value: "false" }).text("stopping after first match").prop("selected", node.checkall === "false").appendTo(checkallSelect);
        }
    });
}
