// Every Logic node type's meta (see ./registry.js). Loaded by the editor and by the page.
import { defineLogicNodes } from "./registry.js";
import lifecycle from "./lifecycle/meta.js";
import ui from "./ui/meta.js";
import control from "./control/meta.js";
import variables from "./variables/meta.js";
import templates from "./templates/meta.js";
import navigation from "./navigation/meta.js";
import web from "./web/meta.js";
import sparkplug from "./sparkplug/meta.js";
import link from "./link/meta.js";

export const FAMILIES = { lifecycle, ui, control, variables, templates, navigation, web, sparkplug, link };
Object.keys(FAMILIES).forEach(function (f) { defineLogicNodes(FAMILIES[f]); });
