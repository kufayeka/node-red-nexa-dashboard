import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";

// CodeMirror 6 — deliberately NOT RED.editor.createEditor (ace/monaco). See
// lit-code-dialog.js / function-dialog.js for the full incident history: a
// severe Ctrl+A -> Ctrl+C -> Ctrl+V freeze survived three targeted Monaco
// fixes, so those two dialogs were rewritten to a plain <textarea> as a
// guaranteed-safe fallback. This module brings syntax highlighting and
// custom autocomplete back via CM6 instead, which has a fundamentally
// simpler architecture than Monaco: no shared global mutable TypeScript
// compiler-options state, no language-service worker — no moving part in
// the same class as whatever caused the Monaco freeze. There's still no
// TypeScript type-checking here (CM6's javascript() is a parser/highlighter,
// not a language service) — that's intentional, not a missing feature.
//
// Assembled by hand (not CM6's own `basicSetup` bundle) so a custom
// `completionSource` can be the ONLY autocomplete source, without fighting
// basicSetup's own baked-in `autocompletion()` call.
function themeExtension() {
    return EditorView.theme({
        "&": {
            color: "var(--red-ui-primary-text-color, #333)",
            backgroundColor: "var(--red-ui-primary-background, #fff)",
            border: "1px solid var(--red-ui-secondary-border-color, #ccc)",
            height: "100%"
        },
        "&.cm-focused": {
            outline: "none",
            borderColor: "var(--red-ui-primary-border-color, #3379b7)"
        },
        ".cm-content": {
            fontFamily: "Consolas, Monaco, monospace",
            fontSize: "13px"
        },
        ".cm-gutters": {
            backgroundColor: "var(--red-ui-secondary-background, #f7f7f9)",
            color: "var(--red-ui-tertiary-text-color, #999)",
            border: "none"
        },
        ".cm-scroller": { overflow: "auto" }
    });
}

function languageExtension(language) {
    if (language === "css") return css();
    return javascript();
}

function baseExtensions(language, completionSource) {
    var keymaps = [...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab];
    var extensions = [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        languageExtension(language),
        keymap.of(keymaps),
        themeExtension(),
        EditorView.lineWrapping
    ];
    if (completionSource) {
        extensions.push(autocompletion({ override: [completionSource] }));
    } else {
        extensions.push(autocompletion());
    }
    return extensions;
}

// options: { parent, value, language: "javascript"|"css", completionSource, onChange }
// returns: { getValue(), setValue(v), focus(), resize(), destroy() }
export function createCM6Editor(options) {
    // Test-only seam: CM6 needs a real DOM (layout, ResizeObserver, selection
    // APIs) and can't run against this repo's hand-rolled fake-jQuery Node.js
    // test harness (test/mock-templates-editor.js) — the same limitation
    // that already applied to real Monaco/Ace before. A test sets this
    // global to substitute a fake editor object instead; it's never set
    // outside tests, so this is a no-op in the real editor.
    if (typeof window !== "undefined" && window.__kufayekaCreateCM6EditorOverride) {
        return window.__kufayekaCreateCM6EditorOverride(options);
    }

    var onChange = options.onChange;
    var state = EditorState.create({
        doc: options.value || "",
        extensions: [
            ...baseExtensions(options.language, options.completionSource),
            EditorView.updateListener.of(function (update) {
                if (update.docChanged && onChange) onChange(update.state.doc.toString());
            })
        ]
    });

    var view = new EditorView({ state: state, parent: options.parent });

    return {
        getValue: function () { return view.state.doc.toString(); },
        setValue: function (v) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v || "" } });
        },
        focus: function () { view.focus(); },
        resize: function () { /* CM6 sizes off its parent element via CSS — nothing to do */ },
        destroy: function () { view.destroy(); }
    };
}

// A full-viewport modal wrapping one createCM6Editor instance, standing in
// for RED.editor.editJavaScript()'s "expand" dialog — that kernel feature is
// itself Monaco/Ace underneath, so calling it from here would quietly bring
// the exact freeze risk this migration exists to remove back in through the
// one button most likely to see a big Ctrl+A/Ctrl+C/Ctrl+V paste.
// options: { value, language, completionSource, onComplete(value), onCancel() }
export function openFullscreenCM6Editor(options) {
    var overlay = window.$("<div>").css({
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0, "z-index": 10000,
        background: "var(--red-ui-primary-background, #fff)",
        display: "flex", "flex-direction": "column"
    }).appendTo(document.body);

    var toolbar = window.$("<div>").css({
        display: "flex", "justify-content": "flex-end", gap: "8px", padding: "8px 12px",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #ddd)", "flex-shrink": "0"
    }).appendTo(overlay);

    var editorContainer = window.$("<div>").css({ flex: "1 1 auto", overflow: "hidden" }).appendTo(overlay);

    var editor = createCM6Editor({
        parent: editorContainer.get(0),
        value: options.value || "",
        language: options.language,
        completionSource: options.completionSource
    });

    function close() { editor.destroy(); overlay.remove(); }

    window.$("<button>", { type: "button", "class": "red-ui-button" }).text("Cancel").on("click", function () {
        close();
        if (options.onCancel) options.onCancel();
    }).appendTo(toolbar);
    window.$("<button>", { type: "button", "class": "red-ui-button primary" }).text("Done").on("click", function () {
        var value = editor.getValue();
        close();
        if (options.onComplete) options.onComplete(value);
    }).appendTo(toolbar);

    editor.focus();
    return { close: close };
}
