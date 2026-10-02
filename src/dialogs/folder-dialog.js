import { state, markDirty, deleteFolder } from "../state.js";
import { renderScreenList } from "../sidebar/screens-panel.js";

function isFolderDescendant(ancestorId, testId) {
    var cur = (state.folders || []).find(function (f) { return f.id === testId; });
    var seen = {};
    while (cur && cur.parentId) {
        if (cur.parentId === ancestorId) return true;
        if (seen[cur.parentId]) break;
        seen[cur.parentId] = true;
        cur = (state.folders || []).find(function (f) { return f.id === cur.parentId; });
    }
    return false;
}

export function openFolderPropertiesDialog(folder) {
    if (!folder) return;

    var container = window.$("<div>", { "class": "red-ui-editor" }).css({
        padding: "16px 20px",
        height: "100%",
        "box-sizing": "border-box",
        overflow: "auto"
    });

    var header = window.$("<div>").css({
        "font-weight": "bold",
        "font-size": "14px",
        "margin-bottom": "16px",
        "padding-bottom": "8px",
        "border-bottom": "1px solid var(--red-ui-secondary-border-color, #e2e8f0)",
        color: "var(--red-ui-primary-text-color, #1e293b)",
        display: "flex",
        "align-items": "center",
        gap: "8px"
    }).html('<i class="fa fa-folder-open-o" style="color: #f59e0b; font-size: 16px;"></i> Group Properties').appendTo(container);

    // Group Name Row
    var nameRow = window.$("<div>").css({ "margin-bottom": "14px" }).appendTo(container);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "5px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Group Name").appendTo(nameRow);
    var nameInput = window.$("<input>", { type: "text" }).css({ width: "100%", "box-sizing": "border-box" }).val(folder.name || "").appendTo(nameRow);

    // Parent Group Row
    var pRow = window.$("<div>").css({ "margin-bottom": "16px" }).appendTo(container);
    window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", "margin-bottom": "5px", color: "var(--red-ui-secondary-text-color, #475569)" })
        .text("Parent Group").appendTo(pRow);
    var pSel = window.$("<select>").css({ width: "100%", "box-sizing": "border-box", padding: "4px" }).appendTo(pRow);
    window.$("<option>", { value: "" }).text("(Root level)").appendTo(pSel);
    (state.folders || []).forEach(function (f) {
        if (f.id !== folder.id && !isFolderDescendant(folder.id, f.id)) {
            window.$("<option>", { value: f.id }).text(f.name).appendTo(pSel);
        }
    });
    pSel.val(folder.parentId || "");

    // Delete Button
    var btnRow = window.$("<div>").css({ "margin-top": "24px", "padding-top": "12px", "border-top": "1px solid var(--red-ui-secondary-border-color, #f0f0f0)" }).appendTo(container);
    window.$("<button>", { type: "button", "class": "red-ui-button red-ui-button-small" })
        .css({ color: "#ef4444", display: "inline-flex", "align-items": "center", gap: "5px" })
        .html('<i class="fa fa-trash"></i> Delete Group')
        .on("click", function () {
            if (window.confirm && !window.confirm("Are you sure you want to delete group '" + (folder.name || folder.id) + "'?")) return;
            deleteFolder(folder.id);
            state.selectedFolderId = null;
            markDirty();
            renderScreenList();
            if (window.RED && window.RED.tray) window.RED.tray.close();
        }).appendTo(btnRow);

    var trayOptions = {
        title: "Group Properties: " + (folder.name || folder.id),
        buttons: [
            {
                id: "node-dialog-cancel",
                text: "Cancel",
                class: "left",
                click: function () {
                    window.RED.tray.close();
                }
            },
            {
                id: "node-dialog-ok",
                text: "Done",
                class: "primary",
                click: function () {
                    folder.name = nameInput.val().trim() || folder.name;
                    folder.parentId = pSel.val() || null;
                    markDirty();
                    renderScreenList();
                    window.RED.tray.close();
                }
            }
        ],
        resize: function () {},
        open: function (trayEl) {
            trayEl.append(container);
            setTimeout(function () { nameInput.focus(); }, 100);
        },
        close: function () {},
        show: function () {}
    };

    if (window.RED && window.RED.tray) {
        window.RED.tray.show(trayOptions);
    }
}
