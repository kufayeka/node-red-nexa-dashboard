import "./registry.js";
import { registerHistoryRenderers } from "./history.js";
import { renderActiveScreen } from "./canvas/canvas-ui.js";
import { renderLogicCanvas } from "./logic/logic-nodes.js";
import { registerPagesEditorAction } from "./editor-tray.js";
import { buildSidebarContent } from "./sidebar/sidebar-content.js";

// Wires undo/redo (history.js) back to the actual canvas renderers.
// history.js takes these as injected callbacks rather than importing
// canvas-ui.js/logic-nodes.js directly to avoid a circular import; without
// this call, applyHistoryEvent()'s render calls are silent no-ops — the
// underlying screen/template data is correctly mutated by undo/redo, but the
// canvas keeps showing whatever was last rendered by something else, which
// looks like "Ctrl+Z did nothing" until an unrelated action forces a
// re-render.
registerHistoryRenderers(renderActiveScreen, renderLogicCanvas);

registerPagesEditorAction();

if (typeof window.RED !== "undefined" && window.RED.plugins) {
    window.RED.plugins.registerPlugin("kufayeka-nexa-dashboard", {
        type: "node-red-editor-plugin",
        onadd: function () {
            // window.RED.menu.addItem("red-ui-header-button-sidemenu", {
            //     id: "menu-item-nexa-open-pages",
            //     label: "Pages (Nexa Dashboard)",
            //     onselect: "nexa:open-pages-editor"
            // });

            window.RED.sidebar.addTab({
                id: "nexa-dashboard-sidebar",
                label: "Nexa",
                name: "Nexa Dashboard",
                iconClass: "fa fa-object-group",
                content: buildSidebarContent(),
                enableOnEdit: true
            });
        }
    });
}
