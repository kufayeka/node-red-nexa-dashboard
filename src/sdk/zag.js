// zag.js in the SDK: accessible behaviour (keyboard, focus, ARIA, positioning) for
// complex widgets — select, combobox, slider, tags input, pin input, rating, number
// input — as state machines that don't care about the framework. Plugins take it from
// the SDK (NexaSDK.zag / the facade's `zag`), never from outside:
//
//   import { NexaElement, html, zag } from "../../nexa-sdk/nexa-component-sdk.js";
//   const { ZagController, spread, select } = zag;
//   class MySelect extends NexaElement {
//       sel = new ZagController(this, select, () => ({
//           collection: select.collection({ items: this.p.options }),
//           value: [this.p.value], onValueChange: (d) => this.pick(d.value[0])
//       }));
//       render() { const api = this.sel.api;
//           return html`<button ${spread(api.getTriggerProps())}>${api.valueAsString}</button> …`; }
//   }
//
// ZagController runs the machine for the component's lifetime (its shadow root is the
// machine's root node, a unique id each), re-renders the view on every change, and
// reads the props function each time (a bound / changed prop reaches the machine).
// spread(props) puts zag's attributes and event listeners on an element (diffed).
import { noChange } from "lit";
import { directive, Directive, PartType } from "lit/directive.js";
import { VanillaMachine, normalizeProps, spreadProps, mergeProps } from "@zag-js/vanilla";
import * as select from "@zag-js/select";
import * as combobox from "@zag-js/combobox";
import * as slider from "@zag-js/slider";
import * as tagsInput from "@zag-js/tags-input";
import * as pinInput from "@zag-js/pin-input";
import * as ratingGroup from "@zag-js/rating-group";
import * as numberInput from "@zag-js/number-input";

var seq = 0;

export class ZagController {
    /**
     * host: the Lit element; def: a zag module ({ machine, connect }, e.g. zag.select);
     * props: () => the machine's props (called on every read, so they stay current).
     */
    constructor(host, def, props) {
        this.host = host;
        this.def = def;
        this.props = props || function () { return {}; };
        this.id = "nx-zag-" + (++seq);
        this.machine = null;
        this._unsub = null;
        host.addController(this);
    }
    hostConnected() {
        var self = this;
        if (this.machine) return;
        this.machine = new VanillaMachine(this.def.machine, function () {
            return Object.assign({ id: self.id, getRootNode: function () { return self.host.renderRoot || document; } }, self.props());
        });
        this._unsub = this.machine.subscribe(function () { self.host.requestUpdate(); });
        this.machine.start();
    }
    hostDisconnected() {
        if (this._unsub) this._unsub();
        if (this.machine) this.machine.stop();
        this.machine = null;
        this._unsub = null;
    }
    /** The machine's api (getTriggerProps(), value, open…), for this render. */
    get api() {
        if (!this.machine) this.hostConnected();
        return this.def.connect(this.machine.service, normalizeProps);
    }
    /** Send the machine an event directly. */
    send(event) { if (this.machine) this.machine.send(event); }
}

class SpreadDirective extends Directive {
    constructor(part) {
        super(part);
        if (part.type !== PartType.ELEMENT) throw new Error("[nexa] zag.spread() goes on an element: <div ${spread(api.getRootProps())}>");
    }
    render() { return noChange; }
    update(part, args) {
        spreadProps(part.element, args[0] || {});
        return noChange;
    }
}
/** <div ${spread(api.getRootProps())}>: zag's attributes / listeners on the element. */
export var spread = directive(SpreadDirective);

export var zag = {
    ZagController: ZagController, spread: spread,
    VanillaMachine: VanillaMachine, normalizeProps: normalizeProps, spreadProps: spreadProps, mergeProps: mergeProps,
    select: select, combobox: combobox, slider: slider, tagsInput: tagsInput, pinInput: pinInput,
    ratingGroup: ratingGroup, numberInput: numberInput
};
