import { markDirty, getActiveScreen, Tree, Scope, state, getApp } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";
import { buildTypedInputWidget } from "../param-types.js";

// One dialog for the three variable Logic nodes (docs/STATE.md):
//   set-variable        which variable + an operation + where the value comes from
//   get-variable        which variable + the msg property it goes into
//   on-variable-change  which variable (fires with payload = new, previous = old)
// A variable is a scope (the app, the screen / template, or the group / frame
// that declares it) and a name.
var TITLES = { "set-variable": "Set Variable", "get-variable": "Get Variable", "on-variable-change": "On Variable Change", "refetch-query": "Refetch Query" };
var HELP = {
    "set-variable": "Changes a variable on the live page. Everything bound to it ({name}) updates, a template instance bound to it gets it passed in, and \"On Variable Change\" nodes watching it fire. The message goes on unchanged.",
    "get-variable": "Puts the variable's current value into the message and passes it on.",
    "refetch-query": "Fetches a query variable (a variable filled from an API) again now — e.g. after saving something, or on a Refresh button. The message goes on right away; watch the variable (On Variable Change) for the new data.",
    "on-variable-change": "Starts a flow whenever the variable changes — by a Set Variable node, a Function node (vars.set) or a query. msg.payload = the new value, msg.previous = the old one."
};
var OPS = [["set", "Set to the value"], ["merge", "Merge into (object)"], ["append", "Append to (array)"], ["remove", "Remove from (array item / object key)"], ["toggle", "Toggle (boolean)"], ["increment", "Increment by (number, default 1)"]];

export function openSetVariableNodeEditor(node) {
    var type = node.type in TITLES ? node.type : "set-variable";
    var screen = getActiveScreen();
    var decls = screen ? Scope.allDeclarations(screen, Tree.walk, getApp()) : [];
    var surfaceLabel = state.editingMode === "template" ? "This template" : "This screen";
    var draft = { scope: node.scope || "", name: node.name || "", op: node.op || "set", valueSource: node.valueSource || "payload", value: node.value, msgPath: node.msgPath || "payload.data", target: node.target || "payload" };
    var nameSel;

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
        id: "nexa-logic-variable-editor",
        title: "Configure " + TITLES[type] + " Node",
        width: 460,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.scope = draft.scope;
                    node.name = draft.name;
                    if (type === "set-variable") {
                        node.op = draft.op;
                        node.valueSource = draft.valueSource;
                        if (draft.valueSource === "static") node.value = draft.value; else delete node.value;
                        if (draft.valueSource === "msg") node.msgPath = draft.msgPath; else delete node.msgPath;
                    }
                    if (type === "get-variable") node.target = draft.target || "payload";
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" }).text(HELP[type]).appendTo(body);
            var label = function (text, parent) { return window.$("<label>").css({ display: "block", "font-size": "11px", color: "#888", margin: "8px 0 4px" }).text(text).appendTo(parent || body); };

            label("Scope (where the variable is declared)");
            var scopeSel = window.$("<select>").css({ width: "100%" }).appendTo(body);
            var scopes = [{ id: "@app", name: "App (every screen)" }, { id: "", name: surfaceLabel }];
            decls.forEach(function (d) { if (d.scopeId && d.scopeId !== "@app" && !scopes.some(function (s) { return s.id === d.scopeId; })) scopes.push({ id: d.scopeId, name: d.scopeName }); });
            if (draft.scope && !scopes.some(function (s) { return s.id === draft.scope; })) scopes.push({ id: draft.scope, name: "(missing) " + draft.scope });
            scopes.forEach(function (s) { window.$("<option>", { value: s.id }).text(s.name).appendTo(scopeSel); });
            scopeSel.val(draft.scope).on("change", function () { draft.scope = scopeSel.val(); draft.name = ""; fillNames(); });

            label("Variable");
            nameSel = window.$("<select>").css({ width: "100%" }).appendTo(body).on("change", function () { draft.name = nameSel.val(); });
            fillNames();

            if (type === "get-variable") {
                label("Into msg property");
                window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(draft.target)
                    .appendTo(body).on("change", function () { draft.target = this.value.trim() || "payload"; });
            }

            if (type === "set-variable") {
                label("Operation");
                var opSel = window.$("<select>").css({ width: "100%" }).appendTo(body);
                OPS.forEach(function (o) { window.$("<option>", { value: o[0] }).text(o[1]).appendTo(opSel); });
                opSel.val(draft.op);

                var valueWrap = window.$("<div>").appendTo(body);
                label("Value", valueWrap);
                var srcSel = window.$("<select>").css({ width: "100%" }).appendTo(valueWrap);
                [["payload", "msg.payload"], ["msg", "A msg property…"], ["static", "A fixed value"]].forEach(function (o) { window.$("<option>", { value: o[0] }).text(o[1]).appendTo(srcSel); });
                srcSel.val(draft.valueSource);
                var pathInput = window.$("<input>", { type: "text", placeholder: "e.g. payload.data.items" }).css({ width: "100%", "box-sizing": "border-box", "margin-top": "6px" })
                    .val(draft.msgPath).appendTo(valueWrap).on("change", function () { draft.msgPath = this.value.trim(); });
                var staticRow = window.$("<div>").css({ "margin-top": "6px" }).appendTo(valueWrap);
                var decl = decls.filter(function (d) { return d.scopeId === draft.scope && d.variable.name === draft.name; })[0];
                buildTypedInputWidget(staticRow, (decl && decl.variable.type) || "string", draft.value !== undefined ? draft.value : "", function (v) { draft.value = v; });
                var sync = function () {
                    valueWrap.toggle(draft.op !== "toggle");
                    pathInput.toggle(draft.valueSource === "msg");
                    staticRow.toggle(draft.valueSource === "static");
                };
                opSel.on("change", function () { draft.op = opSel.val(); sync(); });
                srcSel.on("change", function () { draft.valueSource = srcSel.val(); sync(); });
                sync();
            }
        }
    });
}
