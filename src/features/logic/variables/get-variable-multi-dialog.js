import { markDirty, getActiveScreen, Tree, Scope, state, getApp } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";

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

export function openGetVariableMultiNodeEditor(node) {
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
        id:    "nexa-logic-get-variable-multi-editor",
        title: "Configure Get Variables Node",
        width: 580,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    if (!listEl) { window.RED.tray.close(); return; }
                    var reads = [];
                    listEl.editableList("items").each(function () {
                        var d = window.$(this).data("nexaRow");
                        if (!d || !d.name) return;
                        reads.push({
                            scope:  d.scope  || "",
                            name:   d.name,
                            target: d.target || "payload"
                        });
                    });
                    node.props.reads = reads;
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
                "Reads multiple variables and injects their values into the outgoing message. " +
                "Each row: pick the variable and the msg property it should be written into. " +
                "The enriched message is passed on."
            ).appendTo(body);

            listEl = window.$("<ol>").appendTo(body);

            listEl.editableList({
                addLabel:  "Add variable read",
                sortable:  true,
                removable: true,
                height:    "auto",
                addItem: function (container, _i, data) {
                    var defScope = scopes[0] ? scopes[0].id : "";
                    var defNames = namesIn(defScope);
                    var row = {
                        scope:  data.scope  !== undefined ? data.scope  : defScope,
                        name:   data.name   !== undefined ? data.name   : (defNames[0] || ""),
                        target: data.target !== undefined ? data.target : "payload"
                    };
                    container.data("nexaRow", row);

                    /* ── 3-column grid: Scope | Variable | Into msg.property ── */
                    var grid = window.$("<div>").css({
                        display: "grid",
                        "grid-template-columns": "1fr 1fr 1fr",
                        gap: "8px",
                        "align-items": "end"
                    }).appendTo(container);

                    /* 1. Scope */
                    var scopeWrap = window.$("<div>").appendTo(grid);
                    window.$("<label>").css(CSS_LABEL).text("Scope").appendTo(scopeWrap);
                    var scopeSel = window.$("<select>").css(CSS_SEL).appendTo(scopeWrap);
                    scopes.forEach(function (s) {
                        window.$("<option>", { value: s.id })
                            .text(s.name).prop("selected", s.id === row.scope)
                            .appendTo(scopeSel);
                    });

                    /* 2. Variable */
                    var varWrap = window.$("<div>").appendTo(grid);
                    window.$("<label>").css(CSS_LABEL).text("Variable").appendTo(varWrap);
                    var varSel = window.$("<select>").css(CSS_SEL).appendTo(varWrap);

                    function fillVarSel(scope, current) {
                        varSel.empty();
                        var names = namesIn(scope);
                        if (current && names.indexOf(current) === -1) names.unshift(current);
                        if (!names.length) {
                            window.$("<option>", { value: "" })
                                .text("(no variables declared)").appendTo(varSel);
                        }
                        names.forEach(function (n) {
                            window.$("<option>", { value: n }).text(n)
                                .prop("selected", n === current).appendTo(varSel);
                        });
                        row.name = varSel.val() || "";
                    }
                    fillVarSel(row.scope, row.name);

                    /* 3. Into msg.property (typedInput locked to msg type) */
                    var targetWrap = window.$("<div>").appendTo(grid);
                    window.$("<label>").css(CSS_LABEL).text("Into msg.\u2026").appendTo(targetWrap);
                    var targetInput = window.$("<input>", { type: "text" })
                        .css({ width: "100%" }).appendTo(targetWrap);

                    if (typeof targetInput.typedInput === "function") {
                        targetInput.typedInput({ types: ["msg"], width: "100%" });
                        targetInput.typedInput("value", row.target || "payload");
                        targetInput.on("change", function () {
                            row.target = targetInput.typedInput("value") || "payload";
                        });
                    } else {
                        /* Fallback */
                        targetInput.css(CSS_SEL).val(row.target || "payload");
                        targetInput.on("change input", function () {
                            row.target = targetInput.val() || "payload";
                        });
                    }

                    /* ── events ─────────────────────────────────────────────── */
                    scopeSel.on("change", function () {
                        row.scope = scopeSel.val();
                        row.name  = "";
                        fillVarSel(row.scope, "");
                    });
                    varSel.on("change", function () { row.name = varSel.val(); });
                }
            });

            /* Populate existing reads */
            var existing = Array.isArray(node.props.reads) ? node.props.reads : [];
            if (existing.length) {
                existing.forEach(function (r) { listEl.editableList("addItem", r); });
            } else {
                listEl.editableList("addItem", {});
            }
        }
    });
}
