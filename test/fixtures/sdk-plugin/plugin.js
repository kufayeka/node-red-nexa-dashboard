// FIXTURE for test/sdk-kit-browser.test.js — a component plugin that uses
// every SDK feature at once, written the way a real plugin is.
import {
    defineComponent, cssFields, NexaElement, html, css,
    defineTagProvider, definePropertyEditor, makeTag
} from "../../nexa-sdk/nexa-component-sdk.js";

// A second tag provider: tags are generic, Sparkplug is just the first one.
const opcuaWrites = window.__opcuaWrites = [];
defineTagProvider("opcua", {
    label: "OPC UA", icon: "fa fa-plug", placeholder: "ns=2;s=Path",
    parse: (address) => (/^ns=\d+;[isgb]=.+$/.test(address) ? { ns: Number(address.split(";")[0].slice(3)), id: address.split(";")[1] } : null),
    format: (ref) => "ns=" + ref.ns + ";" + ref.id,
    display: (ref) => "ns" + ref.ns + " " + ref.id.slice(2),
    list: () => [{ address: "ns=2;s=Motor.Speed", label: "Motor.Speed" }, { address: "ns=2;s=Motor.Setpoint", label: "Motor.Setpoint" }],
    write: (ref, value) => { opcuaWrites.push([ref.id, value]); return Promise.resolve({ ok: true }); }
});

// A prop's own editor (prop.editor), in the inspector's pane, same contract as the built-in widgets.
definePropertyEditor("acme-stepper", ({ PropertyEditor, html }) => class extends PropertyEditor {
    static summary(v) { return "step " + v; }
    render() {
        const v = Number(this.value) || 0;
        return this.frame(html`<div class="acme-stepper">
            <button type="button" class="nx-btn dec" @click=${() => this.commit(v - 1)}>-</button>
            <span class="val">${v}</span>
            <button type="button" class="nx-btn inc" @click=${() => this.commit(v + 1)}>+</button>
        </div>`);
    }
});

// One that needs room: a dialog (the pane shows its summary and Edit…); its plugin's routes as this.api.
definePropertyEditor("acme-range", ({ PropertyEditor, html }) => class extends PropertyEditor {
    static kind = "dialog";
    static plugin = "acme-gauges";
    static summary(v) { return v ? v.from + " … " + v.to : ""; }
    render() {
        const v = this.value || { from: 0, to: 100 };
        return html`<div class="acme-range">
            <button type="button" class="nx-btn wide" @click=${() => this.commit({ from: 0, to: 500 })}>0 … 500</button>
            <span class="now">${v.from} … ${v.to}</span></div>`;
    }
});

const GAUGE_STATES = { normal: { label: "Normal" }, alarm: { label: "Alarm", selector: ".g.alarm", css: "background: red;" } };
const GAUGE_CSS = ".g { border: 1px solid #999; }";

export const gauge = defineComponent({
    id: "acme-gauge",
    label: "Test Gauge", category: "Test", icon: "fa fa-tachometer",
    size: { w: 200, h: 120 },
    version: 3,
    migrate: (props, from) => {
        if (from < 2 && props.color) { props.barColor = props.color; delete props.color; }
        if (from < 3 && props.max === undefined) props.max = 100;
        return props;
    },

    properties: {
        max: { type: "number", default: 100, min: 1, group: "Scale", required: true, warn: (v) => (v > 1000 ? "Very large scale" : "") },
        steps: { type: "number", default: 4, min: 1, max: 10, group: "Scale", label: "Steps (custom editor)", editor: "acme-stepper" },
        range: { type: "json", default: null, group: "Scale", label: "Range", editor: "acme-range" },
        barColor: { type: "color", default: "#16a34a", group: "Style" },
        showPens: { type: "boolean", default: true, group: "Style" },
        mode: { type: "enum", default: "bar", group: "Style", options: [{ value: "bar", label: "Bar" }, { value: "needle", label: "Needle" }] },
        unitsFrom: { type: "enum", default: "none", group: "Scale", section: "Units",
            options: () => new Promise((r) => setTimeout(() => r([{ value: "none", label: "None" }, { value: "rpm", label: "rpm" }]), 30)) },
        // its Custom CSS fields (the inspector binds them): the base and the alarm state
        ...cssFields({ base: GAUGE_CSS, states: GAUGE_STATES, group: "Style" })
    },

    inputs: {
        value: { type: "number", label: "Value", help: "Shown by the bar.", throttle: 150 },
        pens: { type: "number", multiple: true, label: "Pens" },
        setpoint: { type: "number", providers: ["opcua"], label: "Setpoint (OPC UA)" }
    },
    outputs: {
        setpoint: { fallback: "setpoint", providers: ["opcua"], label: "Setpoint write" }
    },
    events: { overMax: { label: "On Over Max", payload: { value: "number" } }, tick: { label: "On Tick" } },
    actions: { reset: { label: "Reset peak" }, bump: { label: "Bump", params: { by: "number" } } },

    states: GAUGE_STATES,
    css: GAUGE_CSS,

    state: { peak: 0, ticks: 0 },
    preview: { inputs: { value: 42 } },
    editor: { interactive: [".knob"] },
    assets: { base: import.meta.url, scripts: ["./vendor-lib.js"], styles: ["./vendor-style.css"] },

    view: class extends NexaElement {
        static styles = css`:host { display: block; width: 100%; height: 100%; } .g { width: 100%; height: 100%; }`;

        mounted() {
            this.every(40, () => { this.ticks++; });
            this.onDestroy(() => { window.__gaugeDestroyed = (window.__gaugeDestroyed || 0) + 1; });
        }

        propsChanged() {
            const v = this.in.value;
            if (v !== null && v > this.peak) this.peak = v;
            if (v !== null && v > this.p.max) this.emit("overMax", { value: v });
        }

        reset() { this.peak = 0; }
        bump(params) { this.peak += (params && params.by) || 1; return this.peak; }

        get alarm() { return this.previewState === "alarm" || (this.in.value !== null && this.in.value > this.p.max); }

        render() {
            const doubled = this.assetsReady && window.VendorLib ? window.VendorLib.double(this.in.value || 0) : null;
            return html`<div class="g from-asset-css ${this.alarm ? "alarm" : ""}">
                <span class="value">${this.in.value === null ? "???" : this.in.value}</span>
                <span class="peak">${this.peak}</span>
                <span class="pens">${this.in.pens.map((v) => (v === null ? "?" : v)).join(",")}</span>
                <span class="size">${Math.round(this.size.w)}x${Math.round(this.size.h)}</span>
                <span class="doubled">${doubled === null ? "" : doubled}</span>
                <button class="knob" @click=${() => this.out.write("setpoint", (this.in.setpoint || 0) + 1)}>+</button>
            </div>`;
        }
    }
});

// A plain one: the same inspector, from the schema alone.
export const plain = defineComponent({
    id: "acme-plain", label: "Plain", category: "Test",
    properties: {
        a: { type: "number", default: 1, min: 0, max: 10, group: "One", label: "A" },
        b: { type: "string", default: "", group: "One", label: "B", required: true },
        c: { type: "boolean", default: false, group: "Two", label: "C" },
        d: { type: "string", default: "", group: "Two", label: "D", visibleWhen: (p) => !!p.c },
        fill: { type: "color", default: "#000000", group: "Two", label: "Fill" }
    },
    view: class extends NexaElement { render() { return html`<b>${this.p.a}</b>`; } }
});

window.__makeTag = makeTag;
