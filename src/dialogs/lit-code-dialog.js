import { markDirty } from "../state.js";
import { refreshComponentRender } from "../canvas/component-renderer.js";
import { createCM6Editor } from "../editor/cm6-code-editor.js";
import { sparkplugBindingCompletionSource, litBindablePropsCompletionSource, combineCompletionSources } from "../editor/nexa-completions.js";

// CodeMirror 6 — deliberately NOT RED.editor.createEditor (ace/monaco). This
// is the FOURTH revision of this dialog. Two targeted Monaco fixes (avoiding
// two simultaneously-live editor instances; switching to the "nrjavascript"
// mode Node-RED's own core Function node uses) both failed to stop a severe,
// reported browser freeze on Ctrl+A -> Ctrl+C -> Ctrl+V, reproducible even
// with SHORT code — so a plain <textarea> became the guaranteed-safe
// fallback (revision 3). This revision brings syntax highlighting and
// custom autocomplete back via CM6 — see src/editor/cm6-code-editor.js's
// header comment for why CM6 specifically, and why it's architecturally a
// different risk class than Monaco.
//
// Still ONE tab active at a time (JavaScript / CSS) for a focused editing
// surface, and still a modal dialog (not inline in the Properties panel) —
// see the ORIGINAL reported bug that moved this to a dialog in the first
// place: the sidebar panel rebuilds (destroy + recreate) on almost any
// unrelated interaction, silently discarding anything typed but not yet
// applied. A modal owns these fields exclusively while open.
export function openLitComponentCodeEditor(comp) {
    var jsValue = comp.litCode || "";
    var cssValue = comp.litStyles || "";
    var activeTab = "js";
    var jsEditor, cssEditor, jsPane, cssPane, jsTabBtn, cssTabBtn;

    var jsCompletionSource = combineCompletionSources([
        sparkplugBindingCompletionSource,
        litBindablePropsCompletionSource(comp.litBindable)
    ]);

    function flushActiveValue() {
        if (activeTab === "js") jsValue = jsEditor.getValue();
        else cssValue = cssEditor.getValue();
    }

    function setActiveTabStyle() {
        var selectedCss = { "border-bottom-color": "var(--red-ui-primary-border-color, #3379b7)", "font-weight": "600" };
        var unselectedCss = { "border-bottom-color": "transparent", "font-weight": "normal" };
        jsTabBtn.css(activeTab === "js" ? selectedCss : unselectedCss);
        cssTabBtn.css(activeTab === "css" ? selectedCss : unselectedCss);
        jsPane.toggle(activeTab === "js");
        cssPane.toggle(activeTab === "css");
        if (activeTab === "js" && jsEditor) jsEditor.focus();
        if (activeTab === "css" && cssEditor) cssEditor.focus();
    }

    function switchTab(tab) {
        if (tab === activeTab) return;
        flushActiveValue();
        activeTab = tab;
        setActiveTabStyle();
    }

    window.RED.tray.show({
        id: "nexa-lit-component-editor",
        title: "Edit Lit Component",
        width: 700,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Done", "class": "primary",
                click: function () {
                    flushActiveValue();
                    comp.litCode = jsValue;
                    comp.litStyles = cssValue;
                    refreshComponentRender(comp);
                    markDirty();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "0", height: "100%", display: "flex", "flex-direction": "column" });

            var tabBar = window.$("<div>").css({
                display: "flex", "border-bottom": "1px solid var(--red-ui-secondary-border-color, #ddd)", "flex-shrink": "0"
            }).appendTo(body);
            jsTabBtn = window.$("<div>").text("JavaScript").css({
                padding: "8px 16px", cursor: "pointer", "font-size": "12px", "border-bottom": "2px solid transparent"
            }).on("click", function () { switchTab("js"); }).appendTo(tabBar);
            cssTabBtn = window.$("<div>").text("CSS").css({
                padding: "8px 16px", cursor: "pointer", "font-size": "12px", "border-bottom": "2px solid transparent"
            }).on("click", function () { switchTab("css"); }).appendTo(tabBar);

            jsPane = window.$("<div>").css({ flex: "1 1 auto", height: "440px", padding: "8px 12px", display: "flex", "flex-direction": "column", "box-sizing": "border-box" }).appendTo(body);
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "6px", "flex-shrink": "0" })
                .text("Class body — write render()/methods here (properties are auto-declared from Bindable Properties below); call this.emit(name, payload) to fire an event, or this.mountTemplate(hostEl, templateIdOrName, paramValues) to embed a Screen Template.")
                .appendTo(jsPane);
            var jsEditorContainer = window.$("<div>", { id: "nexa-lit-js-editor" }).css({ flex: "1 1 auto", "min-height": "0" }).appendTo(jsPane);
            jsEditor = createCM6Editor({ parent: jsEditorContainer.get(0), value: jsValue, language: "javascript", completionSource: jsCompletionSource });

            cssPane = window.$("<div>").css({ flex: "1 1 auto", height: "440px", padding: "8px 12px", display: "flex", "flex-direction": "column", "box-sizing": "border-box" }).appendTo(body);
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "6px", "flex-shrink": "0" })
                .text("CSS — scoped to this component only, via Shadow DOM.")
                .appendTo(cssPane);
            var cssEditorContainer = window.$("<div>", { id: "nexa-lit-css-editor" }).css({ flex: "1 1 auto", "min-height": "0" }).appendTo(cssPane);
            cssEditor = createCM6Editor({ parent: cssEditorContainer.get(0), value: cssValue, language: "css" });

            setActiveTabStyle();
        },
        close: function () {
            if (jsEditor) jsEditor.destroy();
            if (cssEditor) cssEditor.destroy();
        }
    });
}

export function openCssCodeEditor(comp, propKey, title) {
    var key = propKey || "css";
    comp.props = comp.props || {};
    var cssValue = comp.props[key] !== undefined ? comp.props[key] : "";
    var cssEditor;

    window.RED.tray.show({
        id: "nexa-css-editor",
        title: title || "Edit CSS (" + key + ")",
        width: 700,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Done", "class": "primary",
                click: function () {
                    if (cssEditor) {
                        comp.props[key] = cssEditor.getValue();
                    }
                    refreshComponentRender(comp);
                    markDirty();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "0", height: "100%", display: "flex", "flex-direction": "column" });
            var cssPane = window.$("<div>").css({ flex: "1 1 auto", height: "480px", padding: "8px 12px", display: "flex", "flex-direction": "column", "box-sizing": "border-box" }).appendTo(body);
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "6px", "flex-shrink": "0" })
                .text("CSS — scoped to this component's shadow DOM. Target :host, button, button.active, etc.")
                .appendTo(cssPane);
            var cssEditorContainer = window.$("<div>", { id: "nexa-comp-css-editor" }).css({ flex: "1 1 auto", "min-height": "0" }).appendTo(cssPane);
            cssEditor = createCM6Editor({ parent: cssEditorContainer.get(0), value: cssValue, language: "css" });
            if (cssEditor) cssEditor.focus();
        },
        close: function () {
            if (cssEditor) cssEditor.destroy();
        }
    });
}

