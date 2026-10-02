import { markDirty, getActiveScreen, Tree, Scope, state, getApp } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";
import { buildTypedInputWidget } from "../../../param-types.js";

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
    var trayEl = null; // FIX: capture tray so button click handler can access it

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

    var scopes = [
        { id: "@shared", name: "Shared / Server (Realtime across all devices)" },
        { id: "@app", name: "App (every screen)" },
        { id: "", name: surfaceLabel }
    ];
    decls.forEach(function (d) { if (d.scopeId && d.scopeId !== "@app" && d.scopeId !== "@shared" && !scopes.some(function (s) { return s.id === d.scopeId; })) scopes.push({ id: d.scopeId, name: d.scopeName }); });
    if (draft.scope && !scopes.some(function (s) { return s.id === draft.scope; })) scopes.push({ id: draft.scope, name: "(missing) " + draft.scope });

    window.RED.tray.show({
        id: "nexa-logic-variable-editor",
        title: "Configure " + TITLES[type] + " Node",
        width: 520,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    if (type === "on-variable-change") {
                        var gathered = [];
                        var nxListInst = trayEl && trayEl.find("nx-list").get(0);
                        var rawItems = (nxListInst && (nxListInst.items || nxListInst.value)) || draft.variables || [];
                        rawItems.forEach(function (item) {
                            if (item && item.name) {
                                if (!gathered.some(function (g) { return g.scope === item.scope && g.name === item.name; })) {
                                    gathered.push({ scope: item.scope || "", name: item.name });
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
            trayEl = tray; // FIX: capture so Save button can find nx-list
            var body = tray.find(".red-ui-tray-body").css({ padding: "14px" });
            window.$("<div>").css({ "font-size": "12px", color: "var(--red-ui-secondary-text-color, #64748b)", "margin-bottom": "14px", "line-height": "1.4" }).text(HELP[type]).appendTo(body);
            var label = function (text, parent) { return window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)", margin: "10px 0 4px" }).text(text).appendTo(parent || body); };

            // Ensure Nexa property kit styles are active
            if (window.NexaKit && typeof window.NexaKit.ensureStyles === "function") {
                window.NexaKit.ensureStyles();
            }

            if (type === "on-variable-change") {
                label("Watched Variables (Dependencies)");
                window.$("<div>").css({ "font-size": "11px", color: "var(--red-ui-secondary-text-color, #94a3b8)", "margin-bottom": "8px" })
                    .text("Select the variables to watch. Whenever any of these variables changes, this node fires (like a useEffect dependency array).")
                    .appendTo(body);

                var listContainer = window.$("<div>", { "class": "nx-kit" }).css({ "margin-bottom": "12px" }).appendTo(body);

                var defaultScope = scopes[0] ? scopes[0].id : "";
                var defaultNames = namesIn(defaultScope);
                var defaultName = defaultNames[0] || "";
                var initialVars = (draft.variables && draft.variables.length)
                    ? JSON.parse(JSON.stringify(draft.variables))
                    : [{ scope: defaultScope, name: defaultName }];

                var html = (window.NEXA_LIT && window.NEXA_LIT.html) || function () { return ""; };
                var nxList = document.createElement("nx-list");
                nxList.setAttribute("add-label", "Add variable dependency");
                nxList.setAttribute("empty-text", "No variables watched. Click Add variable dependency below.");
                nxList.sortable = true;
                nxList.value = initialVars;

                nxList.newItem = function () {
                    var s = scopes[0] ? scopes[0].id : "";
                    var n = namesIn(s);
                    return { scope: s, name: n[0] || "" };
                };

                nxList.renderItem = function (item, index, setItem) {
                    var curScope = item ? (item.scope !== undefined ? item.scope : "") : "";
                    var curName = item ? (item.name !== undefined ? item.name : "") : "";

                    var scopeOptions = scopes.map(function (s) {
                        return { value: s.id, label: s.name };
                    });

                    var names = namesIn(curScope);
                    if (!curName && names.length) {
                        curName = names[0];
                        if (item) item.name = curName;
                    }
                    if (curName && names.indexOf(curName) === -1) names.unshift(curName);
                    var nameOptions = names.map(function (n) {
                        return { value: n, label: n };
                    });
                    if (!nameOptions.length) {
                        nameOptions = [{ value: "", label: "(no variables declared)" }];
                    }

                    return html`<nx-row cols="2" style="width:100%;gap:8px;">
                        <nx-select
                            label="Scope"
                            .value="${curScope}"
                            .options="${scopeOptions}"
                            @nx-change="${function (e) {
                                e.stopPropagation();
                                var newScope = e.detail.value;
                                var newNames = namesIn(newScope);
                                setItem({ scope: newScope, name: newNames[0] || "" });
                            }}">
                        </nx-select>
                        <nx-select
                            label="Variable"
                            .value="${curName}"
                            .options="${nameOptions}"
                            @nx-change="${function (e) {
                                e.stopPropagation();
                                setItem({ scope: curScope, name: e.detail.value });
                            }}">
                        </nx-select>
                    </nx-row>`;
                };

                listContainer.append(nxList);
                return;
            }

            label("Scope (where the variable is declared)");
            var scopeSel = window.$("<select>").css({ width: "100%", padding: "5px 8px", "border-radius": "4px", border: "1px solid var(--red-ui-form-input-border-color, #cbd5e1)" }).appendTo(body);
            scopes.forEach(function (s) { window.$("<option>", { value: s.id }).text(s.name).appendTo(scopeSel); });
            scopeSel.val(draft.scope).on("change", function () {
                draft.scope = scopeSel.val();
                draft.name = "";
                fillNames();
                if (typeof refreshStaticWidget === "function") refreshStaticWidget();
            });

            label("Variable");
            nameSel = window.$("<select>").css({ width: "100%", padding: "5px 8px", "border-radius": "4px", border: "1px solid var(--red-ui-form-input-border-color, #cbd5e1)" }).appendTo(body).on("change", function () {
                draft.name = nameSel.val();
                if (typeof refreshStaticWidget === "function") refreshStaticWidget();
            });
            fillNames();

            if (type === "get-variable") {
                label("Into msg property");
                var targetRow = window.$("<div>").css({ width: "100%", "margin-top": "4px" }).appendTo(body);
                var targetInput = window.$("<input>", { type: "text" }).appendTo(targetRow);
                if (typeof targetInput.typedInput === "function") {
                    targetInput.typedInput({
                        default: "msg",
                        types: ["msg"],
                        width: "100%"
                    });
                    targetInput.typedInput("value", draft.target || "payload");
                    targetInput.on("change", function () {
                        draft.target = targetInput.typedInput("value").trim() || "payload";
                    });
                } else {
                    targetInput.css({ width: "100%", "box-sizing": "border-box", padding: "6px" }).val(draft.target || "payload")
                        .on("change", function () { draft.target = this.value.trim() || "payload"; });
                }
            }

            if (type === "set-variable") {
                label("Operation");
                var opSel = window.$("<select>").css({ width: "100%", padding: "5px 8px", "border-radius": "4px", border: "1px solid var(--red-ui-form-input-border-color, #cbd5e1)" }).appendTo(body);
                OPS.forEach(function (o) { window.$("<option>", { value: o[0] }).text(o[1]).appendTo(opSel); });
                opSel.val(draft.op);

                var valueWrap = window.$("<div>").appendTo(body);
                label("Value", valueWrap);
                var srcSel = window.$("<select>").css({ width: "100%", padding: "5px 8px", "border-radius": "4px", border: "1px solid var(--red-ui-form-input-border-color, #cbd5e1)" }).appendTo(valueWrap);
                [["payload", "msg.payload"], ["msg", "A msg property…"], ["static", "A fixed value"]].forEach(function (o) { window.$("<option>", { value: o[0] }).text(o[1]).appendTo(srcSel); });
                srcSel.val(draft.valueSource);

                var pathRow = window.$("<div>").css({ width: "100%", "margin-top": "6px" }).appendTo(valueWrap);
                var pathInput = window.$("<input>", { type: "text" }).appendTo(pathRow);
                if (typeof pathInput.typedInput === "function") {
                    pathInput.typedInput({
                        default: "msg",
                        types: ["msg"],
                        width: "100%"
                    });
                    pathInput.typedInput("value", draft.msgPath || "payload.data");
                    pathInput.on("change", function () {
                        draft.msgPath = pathInput.typedInput("value").trim();
                    });
                } else {
                    pathInput.css({ width: "100%", "box-sizing": "border-box", padding: "6px" })
                        .val(draft.msgPath || "payload.data")
                        .on("change", function () { draft.msgPath = this.value.trim(); });
                }

                var staticRow = window.$("<div>").css({ "margin-top": "6px" }).appendTo(valueWrap);
                var refreshStaticWidget = function () {
                    staticRow.empty();
                    var decl = decls.filter(function (d) { return d.scopeId === draft.scope && d.variable.name === draft.name; })[0];
                    var varType = (decl && decl.variable && decl.variable.type) || "string";
                    buildTypedInputWidget(staticRow, varType, draft.value !== undefined ? draft.value : "", function (v) {
                        draft.value = v;
                    });
                };
                refreshStaticWidget();

                var sync = function () {
                    valueWrap.toggle(draft.op !== "toggle");
                    pathRow.toggle(draft.valueSource === "msg");
                    staticRow.toggle(draft.valueSource === "static");
                };
                opSel.on("change", function () { draft.op = opSel.val(); sync(); });
                srcSel.on("change", function () { draft.valueSource = srcSel.val(); sync(); });
                sync();
            }
        }
    });
}
