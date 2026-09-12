import { markDirty } from "../state.js";
import { refreshComponentRender } from "../canvas/component-renderer.js";

// Mirrors function-dialog.js's openFunctionNodeEditor() exactly on purpose —
// a modal RED.tray owns the ace editor exclusively for as long as it's open,
// so nothing else on the page can tear it down mid-edit. This REPLACES an
// earlier design that embedded the code editors directly in the Properties
// panel sidebar: that panel fully rebuilds (destroy + recreate) on almost
// any interaction elsewhere in it (editing a Bindable Property row, adding
// one, etc.), which silently discarded anything typed but not yet applied —
// a real, reported bug, not just an inconvenience. A dialog sidesteps the
// whole class of bug: Cancel discards by simply never reading the editors'
// values, Done commits both at once, and the sidebar's own re-renders can
// never reach in and touch the editor while it's open.
export function openLitComponentCodeEditor(comp) {
    var jsEditor = null, cssEditor = null;
    window.RED.tray.show({
        id: "nexa-lit-component-editor",
        title: "Edit Lit Component",
        width: 700,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Done", "class": "primary",
                click: function () {
                    if (jsEditor) comp.litCode = jsEditor.getValue();
                    if (cssEditor) comp.litStyles = cssEditor.getValue();
                    refreshComponentRender(comp);
                    markDirty();
                    window.RED.tray.close();
                }
            }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "0" });
            window.$("<div>").css({ padding: "8px 12px", "font-size": "12px", color: "#888" })
                .text("Class body — write render()/methods here (properties are auto-declared from Bindable Properties below); call this.emit(name, payload) to fire an event, or this.mountTemplate(hostEl, templateIdOrName, paramValues) to embed a Screen Template.")
                .appendTo(body);
            window.$("<div>", { id: "nexa-lit-component-js" }).css({ height: "320px" }).appendTo(body);
            jsEditor = window.RED.editor.createEditor({
                id: "nexa-lit-component-js",
                mode: "ace/mode/javascript",
                value: comp.litCode || ""
            });

            window.$("<div>").css({ padding: "10px 12px 4px", "font-size": "12px", color: "#888" })
                .text("CSS — scoped to this component only, via Shadow DOM.")
                .appendTo(body);
            window.$("<div>", { id: "nexa-lit-component-css" }).css({ height: "180px" }).appendTo(body);
            cssEditor = window.RED.editor.createEditor({
                id: "nexa-lit-component-css",
                mode: "ace/mode/css",
                value: comp.litStyles || ""
            });
        },
        close: function () {
            if (jsEditor && jsEditor.destroy) jsEditor.destroy();
            if (cssEditor && cssEditor.destroy) cssEditor.destroy();
        }
    });
}
