// Sources: fired by the page (src/runtime/logic/runner.js fireLifecycle, src/runtime/mounting/render.js
// setUpInjectNodes); on their own they only pass their message on.
import { defineLogicRuntimes } from "../registry.js";

const passOn = { run: function (node, msg) { return msg; } };

defineLogicRuntimes({ onload: passOn, onrender: passOn, onclose: passOn, inject: passOn });
