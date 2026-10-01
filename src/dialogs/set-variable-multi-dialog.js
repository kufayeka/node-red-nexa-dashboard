import { markDirty, getActiveScreen, Tree, Scope, state, getApp } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";

var OPS = [
    ["set",       "Set to value"],
    ["merge",     "Merge into (object)"],
    ["append",    "Append to (array)"],
    ["remove",    "Remove from (array / object key)"],
    ["toggle",    "Toggle (boolean)"],
    ["increment", "Increment by (number, default 1)"]
];

var CSS_SEL = {
    width: "100%", "box-sizing": "border-box", padding: "4px 6px",
    "border-radius": "3px", border: "1px solid var(--red-ui-form-input-border-color,#ccc)",
    "font-size": "12px", background: "var(--red-ui-secondary-background,#fff)",
    color: "var(--red-ui-primary-text-color,#333)"
};
var CSS_LABEL = {
    display: "block", "font-size": "11px", "font-weight": "600",
    color: "var(--red-ui-secondary-text-color,#475569)", "margin-bottom": "3px"
};

export function openSetVariableMultiNodeEditor(node) {
    var screen  = getActiveScreen();
    var decls   = screen ? Scope.allDeclarations(screen, Tree.walk, getApp()) : [];
    var surface = state.editingMode === "template" ? "This template" : "This screen";

    var scopes = [
        { id: "@shared", name: "Shared / Server (realtime)" },
        { id: "@app",    name: "App (every screen)" },
        { id: "",        name: surface }
    ];
    decls.forEach(function (d) {
        if (d.scopeId && d.scopeId !== "@app" && d.scopeId !== "@shared" &&
            !scopes.some(function (s) { return s.id === d.scopeId; })) {
            scopes.push({ id: d.scopeId, name: d.scopeName });
        }
    });

    function namesIn(scopeId) {
        return decls
            .filter(function (d) { return d.scopeId === scopeId; })
            .map(function (d) { return d.variable.name; });
    }

    var listEl = null;

    window.RED.tray.show({
        id:    "nexa-logic-set-variable-multi-editor",
        title: "Configure Set Variables Node",
        width: 640,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    if (!listEl) { window.RED.tray.close(); return; }
                    var assignments = [];
                    listEl.editableList("items").each(function () {
                        var d = window.$(this).data("nexaRow");
                        if (!d || !d.name) return;
                        var out = { scope: d.scope || "", name: d.name, op: d.op || "set" };
                        var t = d.valueType, v = d.valueRaw;
                        if (t === "msg") {
                            out.valueSource = "msg";
                            out.msgPath = v || "payload";
                        } else {
                            out.valueSource = "static";
                            out.staticType  = t;
                            if (t === "num")  { out.value = parseFloat(v);  if (isNaN(out.value)) out.value = 0; }
                            else if (t === "bool") { out.value = (v === "true" || v === true); }
                            else if (t === "json") { try { out.value = JSON.parse(v); } catch (_) { out.value = v; } }
                            else { out.value = v; }
                        }
                        assignments.push(out);
                    });
                    node.assignments = assignments;
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "14px" });

            window.$("<div>").css({
                "font-size": "12px",
                color: "var(--red-ui-secondary-text-color,#64748b)",
                "margin-bottom": "14px", "line-height": "1.5"
            }).text(
                "Each row sets one variable when a message arrives. " +
                "Choose the target variable, the operation, and the value \u2014 " +
                "either a message property (msg) or a static value (string, number, boolean, JSON object/array). " +
                "The message is passed on unchanged after all assignments."
            ).appendTo(body);

            listEl = window.$("<ol>").appendTo(body);

            listEl.editableList({
                addLabel:  "Add assignment",
                sortable:  true,
                removable: true,
                height:    "auto",
                addItem: function (container, _i, data) {
                    /* ── defaults ─────────────────────────────────────── */
                    var defScope = scopes[0] ? scopes[0].id : "";
                    var defNames = namesIn(defScope);
                    var row = {
                        scope:     data.scope     !== undefined ? data.scope     : defScope,
                        name:      data.name      !== undefined ? data.name      : (defNames[0] || ""),
                        op:        data.op        || "set",
                        valueType: data.valueSource === "msg" ? "msg" : (data.staticType || "str"),
                        valueRaw:  data.valueSource === "msg"
                            ? (data.msgPath || "payload")
                            : (data.value   !== undefined ? String(data.value) : "")
                    };
                    container.data("nexaRow", row);

                    /* ── layout ───────────────────────────────────────── */
                    var grid = window.$("<div>").css({
                        display: "grid",
                        "grid-template-columns": "1fr 1fr",
                        gap: "8px"
                    }).appendTo(container);

                    /* Scope */
                    var scopeWrap = window.$("<div>").appendTo(grid);
                    window.$("<label>").css(CSS_LABEL).text("Scope").appendTo(scopeWrap);
                    var scopeSel = window.$("<select>").css(CSS_SEL).appendTo(scopeWrap);
                    scopes.forEach(function (s) {
                        window.$("<option>", { value: s.id })
                            .text(s.name).prop("selected", s.id === row.scope)
                            .appendTo(scopeSel);
                    });

                    /* Variable */
                    var varWrap = window.$("<div>").appendTo(grid);
                    window.$("<label>").css(CSS_LABEL).text("Variable").appendTo(varWrap);
                    var varSel = window.$("<select>").css(CSS_SEL).appendTo(varWrap);

                    function fillVarSel(scope, current) {
                        varSel.empty();
                        var names = namesIn(scope);
                        if (current && names.indexOf(current) === -1) names.unshift(current);
                        if (!names.length) {
                            window.$("<option>", { value: "" }).text("(no variables declared)").appendTo(varSel);
                        }
                        names.forEach(function (n) {
                            window.$("<option>", { value: n }).text(n)
                                .prop("selected", n === current).appendTo(varSel);
                        });
                        row.name = varSel.val() || "";
                    }
                    fillVarSel(row.scope, row.name);

                    /* Operation */
                    var opWrap = window.$("<div>").appendTo(grid);
                    window.$("<label>").css(CSS_LABEL).text("Operation").appendTo(opWrap);
                    var opSel = window.$("<select>").css(CSS_SEL).appendTo(opWrap);
                    OPS.forEach(function (o) {
                        window.$("<option>", { value: o[0] }).text(o[1])
                            .prop("selected", o[0] === row.op).appendTo(opSel);
                    });

                    /* Value — typedInput (msg | str | num | bool | json) */
                    var valWrap = window.$("<div>").appendTo(grid);
                    window.$("<label>").css(CSS_LABEL).text("Value").appendTo(valWrap);
                    var valInput = window.$("<input>", { type: "text" }).css({ width: "100%" }).appendTo(valWrap);

                    if (typeof valInput.typedInput === "function") {
                        valInput.typedInput({
                            types: ["msg", "str", "num", "bool", "json"],
                            width: "100%"
                        });
                        valInput.typedInput("type",  row.valueType);
                        valInput.typedInput("value", row.valueRaw);
                        valInput.on("change", function () {
                            row.valueType = valInput.typedInput("type");
                            row.valueRaw  = valInput.typedInput("value");
                        });
                    } else {
                        /* Fallback if typedInput unavailable */
                        valInput.css(CSS_SEL).val(row.valueRaw);
                        valInput.on("change input", function () { row.valueRaw = valInput.val(); });
                    }

                    /* ── events ───────────────────────────────────────── */
                    scopeSel.on("change", function () {
                        row.scope = scopeSel.val();
                        row.name  = "";
                        fillVarSel(row.scope, "");
                    });
                    varSel.on("change", function () { row.name = varSel.val(); });
                    opSel.on("change",  function () { row.op   = opSel.val();  });
                }
            });

            /* Populate existing */
            var existing = Array.isArray(node.assignments) ? node.assignments : [];
            if (existing.length) {
                existing.forEach(function (a) { listEl.editableList("addItem", a); });
            } else {
                listEl.editableList("addItem", {});
            }
        }
    });
}
