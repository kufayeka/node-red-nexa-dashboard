import { markDirty, getActiveScreen, Tree, Scope, state, getApp } from "../state.js";
import { renderLogicCanvas } from "../logic/logic-nodes.js";
import { buildTypedInputWidget, buildEditableListWidget } from "../param-types.js";

// One dialog for the three variable Logic nodes (docs/STATE.md):
//   set-variable        which variable + an operation + where the value comes from
//   get-variable        which variable + the msg property it goes into
//   on-variable-change  multiple watched variables (fires with payload = new, previous = old, variable)
// A variable is a scope (the app, the screen / template, or the group / frame
// that declares it) and a name.
var TITLES = { "set-variable": "Set Variable", "get-variable": "Get Variable", "on-variable-change": "Watch Variable" };
var HELP = {
    "set-variable": "Changes a variable on the live page. Everything bound to it ({name}) updates, a template instance bound to it gets it passed in, and \"Watch Variable\" nodes watching it fire. The message goes on unchanged.",
    "get-variable": "Puts the variable's current value into the message and passes it on.",
    "on-variable-change": "Watches one or more variables and starts a flow whenever any of them changes (like a useEffect dependency array). msg.payload = new value, msg.previous = old value, msg.variable = variable name, msg.scope = variable scope."
};
var OPS = [["set", "Set to the value"], ["merge", "Merge into (object)"], ["append", "Append to (array)"], ["remove", "Remove from (array item / object key)"], ["toggle", "Toggle (boolean)"], ["increment", "Increment by (number, default 1)"]];

export function openSetVariableNodeEditor(node) {
    var type = node.type in TITLES ? node.type : "set-variable";
    var screen = getActiveScreen();
    var decls = screen ? Scope.allDeclarations(screen, Tree.walk, getApp()) : [];
    var surfaceLabel = state.editingMode === "template" ? "This template" : "This screen";
    var draft = {
        scope: node.scope || "",
        name: node.name || "",
        op: node.op || "set",
        valueSource: node.valueSource || "payload",
        value: node.value,
        msgPath: node.msgPath || "payload.data",
        target: node.target || "payload",
        variables: Array.isArray(node.variables) ? JSON.parse(JSON.stringify(node.variables)) : (node.name ? [{ scope: node.scope || "", name: node.name }] : [])
    };
    var nameSel;

    function namesIn(scopeId) {
        return decls.filter(function (d) { return d.scopeId === scopeId; }).map(function (d) { return d.variable.name; });
    }
    function fillNames() {
        if (!nameSel) return;
        nameSel.empty();
        var names = namesIn(draft.scope);
        if (draft.name && names.indexOf(draft.name) === -1) names.unshift(draft.name); // keep a name that is not declared (any more)
        if (!names.length) window.$("<option>", { value: "" }).text("(no variables declared here)").appendTo(nameSel);
        names.forEach(function (n) { window.$("<option>", { value: n }).text(n).appendTo(nameSel); });
        nameSel.val(draft.name || names[0] || "");
        draft.name = nameSel.val() || "";
    }

    var scopes = [{ id: "@app", name: "App (every screen)" }, { id: "", name: surfaceLabel }];
    decls.forEach(function (d) { if (d.scopeId && d.scopeId !== "@app" && !scopes.some(function (s) { return s.id === d.scopeId; })) scopes.push({ id: d.scopeId, name: d.scopeName }); });
    if (draft.scope && !scopes.some(function (s) { return s.id === draft.scope; })) scopes.push({ id: draft.scope, name: "(missing) " + draft.scope });

    window.RED.tray.show({
        id: "nexa-logic-variable-editor",
        title: "Configure " + TITLES[type] + " Node",
        width: 500,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    if (type === "on-variable-change") {
                        var gathered = [];
                        tray.find(".red-ui-editableList-item-content").each(function () {
                            var getter = window.$(this).data("getVarData");
                            if (typeof getter === "function") {
                                var item = getter();
                                if (item && item.name) {
                                    if (!gathered.some(function (g) { return g.scope === item.scope && g.name === item.name; })) {
                                        gathered.push(item);
                                    }
                                }
                            }
                        });
                        node.variables = gathered;
                        node.scope = gathered[0] ? gathered[0].scope : "";
                        node.name = gathered[0] ? gathered[0].name : "";
                    } else {
                        node.scope = draft.scope;
                        node.name = draft.name;
                        if (type === "set-variable") {
                            node.op = draft.op;
                            node.valueSource = draft.valueSource;
                            if (draft.valueSource === "static") node.value = draft.value; else delete node.value;
                            if (draft.valueSource === "msg") node.msgPath = draft.msgPath; else delete node.msgPath;
                        }
                        if (type === "get-variable") node.target = draft.target || "payload";
                    }
                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "14px" });
            window.$("<div>").css({ "font-size": "12px", color: "var(--red-ui-secondary-text-color, #64748b)", "margin-bottom": "12px", "line-height": "1.4" }).text(HELP[type]).appendTo(body);
            var label = function (text, parent) { return window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)", margin: "10px 0 4px" }).text(text).appendTo(parent || body); };

            if (type === "on-variable-change") {
                label("Watched Variables (Dependencies)");
                window.$("<div>").css({ "font-size": "11px", color: "var(--red-ui-secondary-text-color, #94a3b8)", "margin-bottom": "8px" })
                    .text("Listen to multiple variables. Whenever any of these variables changes, this node fires.")
                    .appendTo(body);

                var listContainer = window.$("<div>").css({ "margin-bottom": "12px" }).appendTo(body);

                var editList = buildEditableListWidget(listContainer, {
                    addButton: "Add variable dependency",
                    removable: true,
                    addItem: function (rowContainer, index, data) {
                        var rowScope = (data && data.scope !== undefined) ? data.scope : "";
                        var rowName = (data && data.name !== undefined) ? data.name : "";

                        var rowFlex = window.$("<div>").css({
                            display: "flex",
                            gap: "8px",
                            "align-items": "center",
                            width: "100%"
                        }).appendTo(rowContainer);

                        var rScopeSel = window.$("<select>").css({
                            width: "45%",
                            "font-size": "12px"
                        }).appendTo(rowFlex);

                        scopes.forEach(function (s) {
                            window.$("<option>", { value: s.id }).text(s.name).appendTo(rScopeSel);
                        });
                        rScopeSel.val(rowScope);

                        var rNameSel = window.$("<select>").css({
                            flex: "1",
                            "font-size": "12px"
                        }).appendTo(rowFlex);

                        function populateRowNames() {
                            rNameSel.empty();
                            var curScope = rScopeSel.val();
                            var names = namesIn(curScope);
                            if (rowName && names.indexOf(rowName) === -1) names.unshift(rowName);
                            if (!names.length) {
                                window.$("<option>", { value: "" }).text("(no variables declared)").appendTo(rNameSel);
                            }
                            names.forEach(function (n) {
                                window.$("<option>", { value: n }).text(n).appendTo(rNameSel);
                            });
                            rNameSel.val(rowName || names[0] || "");
                            rowName = rNameSel.val() || "";
                        }

                        rScopeSel.on("change", function () {
                            rowName = "";
                            populateRowNames();
                        });
                        rNameSel.on("change", function () {
                            rowName = rNameSel.val();
                        });

                        populateRowNames();

                        rowContainer.data("getVarData", function () {
                            var n = rNameSel.val();
                            if (!n) return null;
                            return { scope: rScopeSel.val(), name: n };
                        });
                    }
                });

                var initialVars = draft.variables && draft.variables.length ? draft.variables : [{ scope: "", name: "" }];
                initialVars.forEach(function (v) {
                    editList.editableList("addItem", v);
                });
                return;
            }

            label("Scope (where the variable is declared)");
            var scopeSel = window.$("<select>").css({ width: "100%" }).appendTo(body);
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
