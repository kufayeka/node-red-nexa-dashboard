import { state, findComponent, findTemplate, markDirty, genId, getActiveScreen, Tree, Layout, isNodeLocked } from "../state.js";
import { pushHistory } from "../history.js";
import { buildTypedInputWidget, buildEditableListWidget, PARAM_TYPES, defaultValueForType } from "../param-types.js";
import { isSelected, selectOnly, groupSelection, frameSelection, ungroupSelection, setLockedForSelection, toggleFlipForSelection } from "../canvas/selection.js";
import { renderActiveScreen } from "../canvas/canvas-ui.js";
import { refreshComponentRender } from "../canvas/component-renderer.js";
import { updateComponentBox } from "../canvas/selection-handles.js";
import { openLitComponentCodeEditor, openCssCodeEditor } from "../dialogs/lit-code-dialog.js";
import { renderEventsPanel } from "./palette-events-panel.js";
import { listKnownSparkplugBindings, parseSparkplugBindingPath } from "../canvas/sparkplug-live.js";
import { renderKitInspector } from "./kit-inspector.js";
import { renderFrameInspector, renderLayoutChildInspector, renderConstraintsInspector } from "./frame-inspector.js";

// Sizing / placement in the parent's auto layout — or, where no layout places
// it (a frame's / the screen's child, an absolute one), its constraints.
function renderLayoutChildSection(comp) {
    var screen = getActiveScreen();
    if (!screen) return;
    var parent = Tree.parentOf(screen, comp.id);
    var host = function () { return window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.propertiesPane); };
    if (Layout.hasAutoLayout(parent)) renderLayoutChildInspector(host(), comp, parent);
    if (Layout.hasConstraints(comp, parent)) renderConstraintsInspector(host(), comp, parent);
}

function previewText(code, emptyLabel) {
    if (!code) return emptyLabel;
    var firstLine = code.split("\n")[0];
    return (firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine) +
        " (" + code.length + " chars)";
}

export function renderPropertiesPanel() {
    if (!state.propertiesPane) return;
    state.propertiesPane.empty();
    if (state.selectedIds.length > 1) {
        window.$("<div>").css({ color: "#666", "font-size": "12px", "margin-bottom": "10px" }).text(state.selectedIds.length + " components selected.").appendTo(state.propertiesPane);

        var groupRow = window.$("<div>").css({ display: "flex", gap: "6px", "margin-bottom": "6px" }).appendTo(state.propertiesPane);
        window.$("<button>", { type: "button", title: "Group selection (Ctrl+G)" }).text("Group").css({ flex: "1" }).on("click", function () { groupSelection(); }).appendTo(groupRow);
        window.$("<button>", { type: "button", title: "Frame selection (Ctrl+Alt+G)" }).text("Frame").css({ flex: "1" }).on("click", frameSelection).appendTo(groupRow);

        var lockRow = window.$("<div>").css({ display: "flex", gap: "6px", "margin-bottom": "6px" }).appendTo(state.propertiesPane);
        window.$("<button>", { type: "button" }).text("Lock all").css({ flex: "1" })
            .on("click", function () { setLockedForSelection(true); }).appendTo(lockRow);
        window.$("<button>", { type: "button" }).text("Unlock all").css({ flex: "1" })
            .on("click", function () { setLockedForSelection(false); }).appendTo(lockRow);

        var flipRow = window.$("<div>").css({ display: "flex", gap: "6px" }).appendTo(state.propertiesPane);
        window.$("<button>", { type: "button", title: "Flip Horizontal (Shift+H)" }).html('<i class="fa fa-arrows-h"></i> Flip H').css({ flex: "1" })
            .on("click", function () { toggleFlipForSelection("h"); }).appendTo(flipRow);
        window.$("<button>", { type: "button", title: "Flip Vertical (Shift+V)" }).html('<i class="fa fa-arrows-v"></i> Flip V').css({ flex: "1" })
            .on("click", function () { toggleFlipForSelection("v"); }).appendTo(flipRow);
        return;
    }
    var comp = state.selectedIds.length === 1 ? findComponent(state.selectedIds[0]) : null;
    if (!comp) {
        window.$("<div>").css({ color: "#999", "font-size": "12px" }).text("Select a component on the canvas to edit its properties.").appendTo(state.propertiesPane);
        return;
    }
    var isTemplateInstance = comp.type === "@template";
    var isLitComponent = comp.type === "@lit-component";
    var isContainer = Tree.isContainer(comp);
    var typeDef = (isTemplateInstance || isLitComponent || isContainer) ? null : window.NEXA.getComponent(comp.type);
    if (isContainer) {
        renderContainerProperties(comp);
        return;
    }
    if (!isTemplateInstance && !isLitComponent && !typeDef) {
        window.$("<div>").css({ color: "#a00", "font-size": "12px" }).text("Unknown component type: " + comp.type).appendTo(state.propertiesPane);
        return;
    }
    var templateRef = isTemplateInstance ? findTemplate(comp.templateId) : null;

    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", "margin-bottom": "8px" })
        .text(isTemplateInstance ? ("Template instance: " + (templateRef ? templateRef.name : "(missing)")) : isLitComponent ? "Lit Component" : (typeDef.label || comp.type))
        .appendTo(state.propertiesPane);

    var lockRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.propertiesPane);
    var lockInput = window.$("<input>", { type: "checkbox" }).prop("checked", !!comp.locked).css({ "margin-right": "6px" });
    lockRow.append(lockInput).append(window.$("<label>").css({ "font-size": "11px", color: "#888" }).text("Locked"));
    lockInput.on("change", function () {
        setLockedForSelection(lockInput.is(":checked"), [comp.id]);
    });

    renderNameField(comp);
    renderLayoutChildSection(comp);

    if (typeDef && typeDef.nexa && renderKitInspector(window.$("<div>").appendTo(state.propertiesPane), comp, typeDef)) {
        // SDK component: the property kit rendered its inspector from the schema
    } else if (typeDef && typeof typeDef.renderProperties === "function") {
        typeDef.renderProperties(state.propertiesPane, comp, {
            refreshComponentRender: refreshComponentRender,
            markDirty: markDirty,
            openCssCodeEditor: openCssCodeEditor,
            listKnownSparkplugBindings: listKnownSparkplugBindings,
            parseSparkplugBindingPath: parseSparkplugBindingPath,
            previewText: previewText
        });
    } else {
        var defaults = (typeDef && typeDef.defaults) || {};
        Object.keys(defaults).forEach(function (key) {
            var fieldDef = defaults[key] || {};
            if (fieldDef.type === "css") {
                var cssRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.propertiesPane);
                window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text(key).appendTo(cssRow);
                window.$("<input>", { type: "text", readonly: "readonly" })
                    .css({ width: "100%", "box-sizing": "border-box", color: "#888", background: "#f7f7f7", "margin-bottom": "4px" })
                    .val(previewText(comp.props[key], "(empty — click Edit CSS)"))
                    .appendTo(cssRow);
                window.$("<button>", { type: "button" }).text("Edit CSS...").css({ width: "100%" }).on("click", function () {
                    openCssCodeEditor(comp, key, "Edit CSS (" + (typeDef.label || comp.type) + ")");
                }).appendTo(cssRow);
                return;
            }

            var inputType = fieldDef.type === "number" ? "number" : fieldDef.type === "color" ? "color" : fieldDef.type === "checkbox" ? "checkbox" : "text";
            var row = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.propertiesPane);
            window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text(key).appendTo(row);

            var input;
            if (inputType === "checkbox") {
                input = window.$("<input>", { type: "checkbox" }).prop("checked", !!comp.props[key]).appendTo(row);
            } else {
                input = window.$("<input>", { type: inputType }).css({ width: "100%", "box-sizing": "border-box" }).val(comp.props[key]).appendTo(row);
            }
            input.on("change", function () {
                var v = inputType === "checkbox" ? input.is(":checked") : inputType === "number" ? (parseFloat(input.val()) || 0) : input.val();
                comp.props[key] = v;
                refreshComponentRender(comp);
                markDirty();
            });
        });
    }

    // One field per param this instance's template declares — like a
    // Subflow instance's own env-var dialog: sets this ONE instance's
    // static/default value (comp.paramValues[name]), separate from any live
    // override a "set-template-param" Logic node applies at runtime. A full
    // re-render is the simplest correct way to make {name} interpolation
    // reactive to this edit (design-time, low-frequency — not worth a more
    // surgical update path).
    if (isTemplateInstance && templateRef) {
        if ((templateRef.params || []).length) {
            window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", margin: "14px 0 8px", "border-top": "1px solid #ddd", "padding-top": "10px" }).text("Parameters").appendTo(state.propertiesPane);
        }
        (templateRef.params || []).forEach(function (param) {
            var row = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.propertiesPane);
            window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text(param.label + " {" + param.name + "}").appendTo(row);
            var current = (comp.paramValues && comp.paramValues[param.name] !== undefined) ? comp.paramValues[param.name] : param.defaultValue;
            buildTypedInputWidget(row, param.type, current, function (v) {
                comp.paramValues = comp.paramValues || {};
                comp.paramValues[param.name] = v;
                markDirty();
                renderActiveScreen();
                selectOnly(comp.id);
            });
        });
    }

    // "@lit-component": code lives on the instance itself, authored here.
    // Bindable Properties doubles as the Lit `static properties` declaration
    // (see compileLitComponentClass) AND the ui-update/Properties default
    // value targets — one list, same role `typeDef.defaults` plays for a
    // registered component. Events just needs names so palette-events-panel
    // can offer "on <name>" chips for whatever this.emit(name, payload) call
    // the user's own code makes.
    if (isLitComponent) {
        window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", margin: "14px 0 8px", "border-top": "1px solid #ddd", "padding-top": "10px" }).text("Lit Code").appendTo(state.propertiesPane);

        // Read-only PREVIEW fields only — just enough to see at a glance
        // that code exists (and roughly how much). The actual editing
        // happens in a modal dialog (openLitComponentCodeEditor), exactly
        // like the Function Logic node's own code editor — NOT inline here.
        // An earlier version embedded live ace/monaco editors directly in
        // this panel; that broke badly because this panel fully rebuilds
        // (destroy + recreate everything) on almost any interaction
        // elsewhere in it (editing a Bindable Property row, adding one,
        // etc.), which silently discarded anything typed but not yet
        // explicitly "applied" — a real bug, not just an inconvenience. A
        // modal dialog is immune to that: it owns the editor exclusively
        // while open, and nothing outside it can tear it down mid-edit.
        var jsPreviewRow = window.$("<div>").css({ "margin-bottom": "6px" }).appendTo(state.propertiesPane);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text("Class body").appendTo(jsPreviewRow);
        window.$("<input>", { type: "text", readonly: "readonly" })
            .css({ width: "100%", "box-sizing": "border-box", color: "#888", background: "#f7f7f7" })
            .val(previewText(comp.litCode, "(empty — click Edit Code to write render())"))
            .appendTo(jsPreviewRow);

        var cssPreviewRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.propertiesPane);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text("CSS").appendTo(cssPreviewRow);
        window.$("<input>", { type: "text", readonly: "readonly" })
            .css({ width: "100%", "box-sizing": "border-box", color: "#888", background: "#f7f7f7" })
            .val(previewText(comp.litStyles, "(empty)"))
            .appendTo(cssPreviewRow);

        window.$("<button>", { type: "button" }).text("Edit Code...").css({ width: "100%", "margin-bottom": "12px" }).on("click", function () {
            openLitComponentCodeEditor(comp);
        }).appendTo(state.propertiesPane);

        // Bindable Properties boxed editableList (Write Rules style)
        window.$("<label>").css({ "font-weight": "bold", "font-size": "12px", margin: "10px 0 4px", display: "block" })
            .html('<i class="fa fa-list"></i> Bindable Properties')
            .appendTo(state.propertiesPane);

        comp.litBindable = comp.litBindable || [];

        var bindableList = buildEditableListWidget(state.propertiesPane, {
            minHeight: "300px",
            removable: true,
            sortable: true,
            addItem: function (container, i, opt) {
                var p = opt || {};
                if (!p.name) p.name = "prop" + (comp.litBindable.length + 1);
                if (p.type === undefined) p.type = "string";
                if (p.defaultValue === undefined) p.defaultValue = "";

                if (comp.litBindable.indexOf(p) === -1) {
                    comp.litBindable.push(p);
                    markDirty();
                }

                var row = window.$('<div style="display:flex; flex-direction:column; gap:6px; padding:4px 0;"></div>').appendTo(container);

                // Sub-row 1: Name
                var nameRow = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "8px" }).appendTo(row);
                window.$("<span>").css({ width: "50px", "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)" })
                    .html('<i class="fa fa-tag"></i> Name')
                    .appendTo(nameRow);
                var nameInput = window.$("<input>", { type: "text", "class": "node-input-prop-name", placeholder: "propName" })
                    .css({ flex: "1" })
                    .val(p.name)
                    .appendTo(nameRow);
                nameInput.on("change input", function () {
                    var oldName = p.name;
                    var newName = nameInput.val().trim();
                    p.name = newName;
                    if (comp.props && oldName !== newName && comp.props[oldName] !== undefined) {
                        comp.props[newName] = comp.props[oldName];
                        delete comp.props[oldName];
                    }
                    markDirty();
                    refreshComponentRender(comp);
                });

                // Sub-row 2: Value
                var valRow = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "8px" }).appendTo(row);
                window.$("<span>").css({ width: "50px", "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)" })
                    .html('<i class="fa fa-arrow-left"></i> Value')
                    .appendTo(valRow);
                var valWrapper = window.$("<div>").css({ flex: "1" }).appendTo(valRow);
                buildTypedInputWidget(valWrapper, p.type || "string", p.defaultValue, function (parsedVal, detType) {
                    p.defaultValue = parsedVal;
                    p.type = detType;
                    comp.props = comp.props || {};
                    comp.props[p.name] = parsedVal;
                    markDirty();
                    refreshComponentRender(comp);
                });

                // Sub-row 3: Two-way binding — when checked, this.<name>
                // assignments inside the component's own render()/handlers
                // (e.g. from an @input listener) automatically write back
                // into comp.props (see getNexaLitBase's updated() and this
                // panel's own imports), instead of the user having to wire
                // that persistence up by hand for every field.
                var twoWayRow = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "8px" }).appendTo(row);
                window.$("<span>").css({ width: "50px", "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)" })
                    .html('<i class="fa fa-exchange"></i> 2-way')
                    .appendTo(twoWayRow);
                var twoWayInput = window.$("<input>", { type: "checkbox" }).prop("checked", !!p.twoWay).appendTo(twoWayRow);
                window.$("<span>").css({ "font-size": "11px", color: "#888" }).text("Sync this." + p.name + " changes back to comp.props").appendTo(twoWayRow);
                twoWayInput.on("change", function () {
                    p.twoWay = twoWayInput.is(":checked");
                    markDirty();
                    refreshComponentRender(comp);
                });
            },
            removeItem: function (opt) {
                var idx = comp.litBindable.indexOf(opt);
                if (idx !== -1) {
                    comp.litBindable.splice(idx, 1);
                    markDirty();
                    refreshComponentRender(comp);
                }
            }
        });

        comp.litBindable.forEach(function (p) {
            bindableList.editableList("addItem", p);
        });

        // Events boxed editableList
        window.$("<label>").css({ "font-weight": "bold", "font-size": "12px", margin: "10px 0 4px", display: "block" })
            .html('<i class="fa fa-bolt"></i> Events')
            .appendTo(state.propertiesPane);

        comp.litEvents = comp.litEvents || [];

        var eventList = buildEditableListWidget(state.propertiesPane, {
            minHeight: "300px",
            removable: true,
            sortable: true,
            addItem: function (container, i, opt) {
                var evt = opt || {};
                if (!evt.name) evt.name = "myEvent" + (comp.litEvents.length + 1);

                if (comp.litEvents.indexOf(evt) === -1) {
                    comp.litEvents.push(evt);
                    markDirty();
                }

                var row = window.$("<div>").css({ display: "flex", "align-items": "center", gap: "8px", padding: "2px 0" }).appendTo(container);
                window.$("<span>").css({ width: "50px", "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color, #475569)" })
                    .html('<i class="fa fa-tag"></i> Name')
                    .appendTo(row);
                var nameInput = window.$("<input>", { type: "text", "class": "node-input-event-name", placeholder: "eventName" })
                    .css({ flex: "1" })
                    .val(evt.name)
                    .appendTo(row);
                nameInput.on("change", function () {
                    evt.name = nameInput.val().trim();
                    markDirty();
                });
            },
            removeItem: function (opt) {
                var idx = comp.litEvents.indexOf(opt);
                if (idx !== -1) {
                    comp.litEvents.splice(idx, 1);
                    markDirty();
                }
            }
        });

        comp.litEvents.forEach(function (evt) {
            eventList.editableList("addItem", evt);
        });
    }

    // Sparkplug Tag Watch field — available on components unless explicitly opted out (e.g. Buttons with dedicated Read/Write tags)
    if (!typeDef || !typeDef.hideSparkplugWatch) {
        var spRow = window.$("<div>").css({
            margin: "14px 0 8px", "border-top": "1px solid #ddd", "padding-top": "10px"
        }).appendTo(state.propertiesPane);
        window.$("<label>").css({
            display: "block", "font-weight": "bold", "font-size": "12px", "margin-bottom": "4px", color: "var(--red-ui-secondary-text-color, #475569)"
        }).html('<i class="fa fa-bolt" style="color:#f59e0b; margin-right:4px;"></i> Sparkplug Tag Watch').appendTo(spRow);

        var spInputWrap = window.$("<div>").css({ display: "flex", gap: "4px" }).appendTo(spRow);
        var spInput = window.$("<input>", {
            type: "text",
            placeholder: "{sparkplug:Group::Node::Device::Metric}"
        }).css({
            flex: "1", "font-size": "11px", "font-family": "monospace", "box-sizing": "border-box"
        }).val(comp.sparkplugBinding || "").appendTo(spInputWrap);

        var spClearBtn = window.$("<button>", {
            type: "button",
            title: "Clear Sparkplug Watch"
        }).css({
            padding: "3px 8px", "font-size": "11px", cursor: "pointer"
        }).html('<i class="fa fa-times"></i>').appendTo(spInputWrap);

        function onSparkplugBindingChanged(newVal) {
            var trimmed = (newVal || "").trim();
            if (trimmed) {
                comp.sparkplugBinding = trimmed;
            } else {
                delete comp.sparkplugBinding;
            }
            markDirty();
            refreshComponentRender(comp);
            if (typeof renderEventsPanel === "function") renderEventsPanel();
        }

        spInput.on("change", function () {
            onSparkplugBindingChanged(spInput.val());
        });
        spClearBtn.on("click", function () {
            spInput.val("");
            onSparkplugBindingChanged("");
        });
    }

    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", margin: "14px 0 8px", "border-top": "1px solid #ddd", "padding-top": "10px" }).text("Position & Size").appendTo(state.propertiesPane);
    [["x", "X"], ["y", "Y"], ["w", "Width"], ["h", "Height"], ["rotation", "Rotation"]].forEach(function (pair) {
        var field = pair[0], label = pair[1];
        var row = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(state.propertiesPane);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text(label).appendTo(row);
        var input = window.$("<input>", { type: "number" }).css({ width: "100%", "box-sizing": "border-box" }).val(comp[field]).prop("disabled", isNodeLocked(comp.id)).appendTo(row);
        input.on("change", function () {
            comp[field] = parseFloat(input.val()) || 0;
            afterGeometryEdit(comp);
            markDirty();
        });
    });

    var caps = (typeDef && typeDef.capabilities) || {};
    if (caps.flippable !== false) {
        var flipRow = window.$("<div>").css({ display: "flex", gap: "6px", "margin-top": "6px", "margin-bottom": "8px" }).appendTo(state.propertiesPane);
        window.$("<button>", { type: "button", title: "Flip Horizontal (Shift+H)" })
            .css({
                flex: "1", padding: "5px 8px", "font-size": "11px", cursor: comp.locked ? "default" : "pointer",
                background: comp.flipH ? "var(--red-ui-secondary-background-selected, #cfe0ff)" : "",
                border: comp.flipH ? "1px solid #2196f3" : "1px solid #ccc",
                "font-weight": comp.flipH ? "bold" : "normal"
            })
            .html('<i class="fa fa-arrows-h"></i> Flip H')
            .prop("disabled", comp.locked)
            .on("click", function () { toggleFlipForSelection("h"); })
            .appendTo(flipRow);

        window.$("<button>", { type: "button", title: "Flip Vertical (Shift+V)" })
            .css({
                flex: "1", padding: "5px 8px", "font-size": "11px", cursor: comp.locked ? "default" : "pointer",
                background: comp.flipV ? "var(--red-ui-secondary-background-selected, #cfe0ff)" : "",
                border: comp.flipV ? "1px solid #2196f3" : "1px solid #ccc",
                "font-weight": comp.flipV ? "bold" : "normal"
            })
            .html('<i class="fa fa-arrows-v"></i> Flip V')
            .prop("disabled", comp.locked)
            .on("click", function () { toggleFlipForSelection("v"); })
            .appendTo(flipRow);
    }
}

// Name of any node: what the Hierarchy panel shows (and what the Logic
// "Layer Control" node targets for a group).
function renderNameField(comp) {
    var row = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(state.propertiesPane);
    window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text("Name").appendTo(row);
    var input = window.$("<input>", { type: "text", placeholder: comp.type }).css({ width: "100%", "box-sizing": "border-box" }).val(comp.name || "").appendTo(row);
    input.on("change", function () {
        var next = String(input.val()).trim();
        var screen = getActiveScreen();
        pushHistory({ t: "node", screenId: screen.id, id: comp.id, key: "name", from: comp.name, to: next || undefined });
        if (next) comp.name = next; else delete comp.name;
        markDirty();
        refreshHierarchyIfOpen();
    });
}

var hierarchyRefresher = null;
export function setHierarchyRefresher(fn) { hierarchyRefresher = fn; }
function refreshHierarchyIfOpen() { if (hierarchyRefresher) hierarchyRefresher(); }

// A node moved / resized in the panel: groups around it hug again.
function afterGeometryEdit(comp) {
    var screen = getActiveScreen();
    var inGroup = screen && Tree.ancestors(screen, comp.id).some(function (a) { return a.type === "@group"; });
    if (inGroup) {
        Tree.refitGroupsUp(screen, comp.id);
        renderActiveScreen();
        selectOnly(comp.id);
    } else {
        updateComponentBox(comp);
    }
}

// A group: name, lock, ungroup, position (its size follows its children).
function renderContainerProperties(comp) {
    var screen = getActiveScreen();
    var pane = state.propertiesPane;
    var isFrame = comp.type === "@frame";
    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", "margin-bottom": "8px" })
        .html('<i class="fa ' + (isFrame ? "fa-square-o" : "fa-object-group") + '"></i> ' + (isFrame ? "Frame" : "Group") + " — " + Tree.kids(comp).length + " children")
        .appendTo(pane);
    renderNameField(comp);
    renderLayoutChildSection(comp);
    var lockRow = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(pane);
    var lockInput = window.$("<input>", { type: "checkbox" }).prop("checked", !!comp.locked).css({ "margin-right": "6px" });
    lockRow.append(lockInput).append(window.$("<label>").css({ "font-size": "11px", color: "#888" }).text("Locked (with everything inside)"));
    lockInput.on("change", function () { setLockedForSelection(lockInput.is(":checked"), [comp.id]); });
    var btnRow = window.$("<div>").css({ display: "flex", gap: "6px", "margin-bottom": "10px" }).appendTo(pane);
    window.$("<button>", { type: "button", title: (isFrame ? "Remove the frame, keep its children" : "Ungroup") + " (Ctrl+Shift+G)" }).text(isFrame ? "Remove frame" : "Ungroup").css({ flex: "1" }).prop("disabled", isNodeLocked(comp.id)).on("click", ungroupSelection).appendTo(btnRow);
    // a frame: its box, auto layout and style in the property kit
    if (isFrame && renderFrameInspector(window.$("<div>").appendTo(pane), comp)) return;
    window.$("<div>").css({ "font-weight": "bold", "font-size": "12px", margin: "14px 0 8px", "border-top": "1px solid #ddd", "padding-top": "10px" }).text("Position").appendTo(pane);
    [["x", "X"], ["y", "Y"]].forEach(function (pair) {
        var row = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(pane);
        window.$("<label>").css({ display: "block", "font-size": "11px", "margin-bottom": "2px", color: "#888" }).text(pair[1]).appendTo(row);
        var input = window.$("<input>", { type: "number" }).css({ width: "100%", "box-sizing": "border-box" }).val(comp[pair[0]]).prop("disabled", isNodeLocked(comp.id)).appendTo(row);
        input.on("change", function () {
            comp[pair[0]] = parseFloat(input.val()) || 0;
            afterGeometryEdit(comp);
            markDirty();
        });
    });
    window.$("<div>").css({ "font-size": "11px", color: "#888" }).text("Size " + Math.round(comp.w) + " × " + Math.round(comp.h) + " (follows the children)").appendTo(pane);
    if (screen && Tree.parentOf(screen, comp.id)) {
        window.$("<div>").css({ "font-size": "11px", color: "#888", "margin-top": "4px" }).text("Inside: " + (Tree.parentOf(screen, comp.id).name || Tree.parentOf(screen, comp.id).type)).appendTo(pane);
    }
}
