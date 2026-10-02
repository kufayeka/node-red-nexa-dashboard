// Nexa Link nodes in the editor: the label and dialog name the channel.
import { defineLogicEditors } from "../registry.js";
import { openLinkNodeEditor, linkNodeLabel } from "./link-dialog.js";

const part = { label: linkNodeLabel, edit: openLinkNodeEditor, hint: "Double-click to choose the channel" };

defineLogicEditors({ "link-request": part, "link-send": part, "link-receive": part });
