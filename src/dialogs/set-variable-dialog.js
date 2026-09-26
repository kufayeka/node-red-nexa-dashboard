import { markDirty, getActiveScreen, Tree, Scope, state } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";
import { buildTypedInputWidget } from "../param-types.js";

// The "Set Variable" Logic node: which variable (a scope — the screen, or the
// group / frame that declares it — and a name) and the value: the incoming
// msg.payload, or a fixed value.
export function openSetVariableNodeEditor(node) {
    var screen = getActiveScreen();
    var decls = screen ? Scope.allDeclarations(screen, Tree.walk) : [];
    var surfaceLabel = state.editingMode === "template" ? "This template" : "Screen";
    var draft = { scope: node.scope || "", name: node.name || "", valueSource: node.valueSource || "payload", value: node.value };
    var scopeSel, nameSel, staticRow;

    function namesIn(scopeId) {
        return decls.filter(function (d) { return d.scopeId === scopeId; }).map(function (d) { return d.variable.name; });
    }
    function fillNames() {
        nameSel.empty();
        var names = namesIn(draft.scope);
        if (draft.name && names.indexOf(draft.name) === -1) names.unshift(draft.name); // keep a name that is not declared (any more)
        if (!names.length) window.$("<option>", { value: "" }).text("(no variables declared here)").appendTo(nameSel);
        names.forEach(function (n) { window.$("<option>", { value: n }).text(n).appendTo(nameSel); });
        nameSel.val(draft.name || names[0] || "");
        draft.name = nameSel.val() || "";
    }

    window.RED.tray.show({
        id: "nexa-logic-setvariable-editor",
        title: "Configure Set Variable Node",
        width: 450,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.scope = draft.scope;
                    node.name = draft.name;
                    node.valueSource = draft.valueSource;
                    if (draft.valueSource === "static") node.value = draft.value; else delete node.value;
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("Sets a variable on the live page. Everything inside its scope that binds {name} (and doesn't declare its own) updates; a template instance bound to it gets the value passed in. The message goes on unchanged.")
                .appendTo(body);
            var label = function (text) { return window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888", margin: "8px 0 4px" }).text(text).appendTo(body); };

            label("Scope (where the variable is declared)");
            scopeSel = window.$("<select>").css({ width: "100%" }).appendTo(body);
            var scopes = [{ id: "", name: surfaceLabel }];
            decls.forEach(function (d) { if (d.scopeId && !scopes.some(function (s) { return s.id === d.scopeId; })) scopes.push({ id: d.scopeId, name: d.scopeName }); });
            if (draft.scope && !scopes.some(function (s) { return s.id === draft.scope; })) scopes.push({ id: draft.scope, name: "(missing) " + draft.scope });
            scopes.forEach(function (s) { window.$("<option>", { value: s.id }).text(s.name).appendTo(scopeSel); });
            scopeSel.val(draft.scope).on("change", function () { draft.scope = scopeSel.val(); draft.name = ""; fillNames(); });

            label("Variable");
            nameSel = window.$("<select>").css({ width: "100%" }).appendTo(body).on("change", function () { draft.name = nameSel.val(); });
            fillNames();

            label("Value");
            var srcSel = window.$("<select>").css({ width: "100%" }).appendTo(body);
            window.$("<option>", { value: "payload" }).text("msg.payload").appendTo(srcSel);
            window.$("<option>", { value: "static" }).text("A fixed value").appendTo(srcSel);
            srcSel.val(draft.valueSource);
            staticRow = window.$("<div>").css({ "margin-top": "6px" }).appendTo(body);
            var decl = decls.filter(function (d) { return d.scopeId === draft.scope && d.variable.name === draft.name; })[0];
            buildTypedInputWidget(staticRow, (decl && decl.variable.type) || "string", draft.value !== undefined ? draft.value : "", function (v) { draft.value = v; });
            var sync = function () { staticRow.toggle(draft.valueSource === "static"); };
            srcSel.on("change", function () { draft.valueSource = srcSel.val(); sync(); });
            sync();
        }
    });
}
