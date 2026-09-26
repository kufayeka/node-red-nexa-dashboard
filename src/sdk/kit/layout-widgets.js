// --- Layout widgets: the frame / auto layout inspector ---------------------------
//   <nx-align>    the 3×3 alignment pad; value { x, y }, each "start" | "center" | "end"
//   <nx-spacing>  four sides (padding); value { t, r, b, l }; one number for all
//                 sides until "each side" is switched on
import { html } from "lit";
import { KitElement } from "./base.js";

var STEPS = ["start", "center", "end"];

export class NxAlign extends KitElement {
    render() {
        var v = this.value || {};
        var x = STEPS.indexOf(v.x) === -1 ? "start" : v.x;
        var y = STEPS.indexOf(v.y) === -1 ? "start" : v.y;
        var cells = [];
        STEPS.forEach((row) => STEPS.forEach((col) => {
            var on = col === x && row === y;
            cells.push(html`<button type="button" class="nx-align-cell ${on ? "nx-on" : ""}" role="radio" aria-checked="${on}"
                title="${row} / ${col}" data-x="${col}" data-y="${row}" ?disabled="${this.disabled || this.readonly}"
                @click="${() => this.change({ x: col, y: row })}"><span></span></button>`);
        }));
        return this.frame(html`<div class="nx-align" role="radiogroup" id="${this.controlId}">${cells}</div>`);
    }
}

function n(v) {
    var x = parseFloat(v);
    return isFinite(x) ? x : 0;
}

export class NxSpacing extends KitElement {
    static properties = { _each: { state: true }, min: { type: Number } };

    constructor() { super(); this._each = null; this.min = 0; }

    _sides() {
        var v = this.value || {};
        return { t: n(v.t), r: n(v.r), b: n(v.b), l: n(v.l) };
    }

    _set(side, raw) {
        var s = this._sides();
        var val = Math.max(this.min || 0, n(raw));
        if (side === "all") s = { t: val, r: val, b: val, l: val };
        else s[side] = val;
        this.change(s);
    }

    render() {
        var s = this._sides();
        var uniform = s.t === s.r && s.r === s.b && s.b === s.l;
        var each = this._each === null ? !uniform : this._each;
        var input = (side, value, title) => html`<input class="nx-control nx-spacing-input" type="number" .value="${String(value)}" min="${this.min || 0}"
            title="${title}" aria-label="${title}" data-side="${side}" ?disabled="${this.disabled || this.readonly}"
            @change="${(e) => { e.stopPropagation(); this._set(side, e.target.value); }}" @input="${(e) => e.stopPropagation()}">`;
        return this.frame(html`<div class="nx-spacing" id="${this.controlId}">
            ${each
                ? html`${input("t", s.t, "Top")}${input("r", s.r, "Right")}${input("b", s.b, "Bottom")}${input("l", s.l, "Left")}`
                : input("all", s.t, "All sides")}
            <button type="button" class="nx-icon-btn ${each ? "nx-on" : ""}" title="${each ? "One value for all sides" : "Each side"}"
                @click="${() => { this._each = !each; }}"><i class="fa fa-expand"></i></button>
        </div>`);
    }
}
