import "./registry.js";
import { registerPagesEditorAction } from "./editor-tray.js";
import { buildSidebarContent } from "./sidebar/sidebar-content.js";

registerPagesEditorAction();

if (typeof window.RED !== "undefined" && window.RED.plugins) {
    window.RED.plugins.registerPlugin("kufayeka-nexa-dashboard", {
        type: "node-red-editor-plugin",
        onadd: function () {
            window.RED.menu.addItem("red-ui-header-button-sidemenu", {
                id: "menu-item-nexa-open-pages",
                label: "Pages (Nexa Dashboard)",
                onselect: "nexa:open-pages-editor"
            });

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
