// "lit" for the kit bundle (see build.js's lit-from-global alias): the Lit the
// SDK bundle already loaded, so the editor never evaluates a second copy.
var L = window.NEXA_LIT;
if (!L) throw new Error("[nexa] the property kit needs the SDK bundle (window.NEXA_LIT) loaded first");
export var LitElement = L.LitElement;
export var html = L.html;
export var css = L.css;
export var nothing = L.nothing;
export var svg = L.svg;
export var unsafeCSS = L.unsafeCSS;
export var render = L.render;
export var noChange = L.noChange;
