// A Nexa component: 1. properties  2. inputs / outputs  3. events  4. inspector  5. view.
// See @kufayeka/node-red-nexa-dashboard/docs/SDK.md.
import { defineComponent, NexaElement, html, css, bind } from "../../nexa-sdk/nexa-component-sdk.js";

export default defineComponent({
    id: "acme-sample-indicator",
    label: "Indicator", category: "Display", icon: "fa fa-circle",
    size: { w: 140, h: 40 },

    properties: {
        onText: { type: "string", default: "RUNNING", group: "Text" },
        offText: { type: "string", default: "STOPPED", group: "Text" },
        onColor: { type: "color", default: "#16a34a", group: "Style" },
        offColor: { type: "color", default: "#94a3b8", group: "Style" }
    },
    inputs: { value: { type: "boolean", label: "Running" } },
    outputs: { command: { fallback: "value", label: "Command" } },
    events: { toggled: { label: "On Toggle", payload: { value: "boolean" } } },

    inspector: () => html`
        <nx-section heading="Tags" icon="fa fa-exchange">
            <nx-tag ${bind("inputs.value")}></nx-tag>
            <nx-tag ${bind("outputs.command")}></nx-tag>
        </nx-section>
        <nx-section heading="Look" icon="fa fa-paint-brush">
            <nx-row><nx-text ${bind("onText")}></nx-text><nx-text ${bind("offText")}></nx-text></nx-row>
            <nx-row><nx-color ${bind("onColor")}></nx-color><nx-color ${bind("offColor")}></nx-color></nx-row>
        </nx-section>`,

    view: class extends NexaElement {
        static styles = css`
            :host { display: block; width: 100%; height: 100%; }
            button { width: 100%; height: 100%; border: none; border-radius: 4px; color: #fff; font: 600 13px sans-serif; cursor: pointer; }
        `;
        render() {
            const on = this.in.value === true;
            const unknown = this.in.value === null && this.status("value").bound;
            return html`<button style="background:${on ? this.p.onColor : this.p.offColor}; opacity:${unknown ? 0.5 : 1}"
                @click=${this.toggle}>${unknown ? "???" : on ? this.p.onText : this.p.offText}</button>`;
        }
        toggle() {
            const next = !(this.in.value === true);
            this.out.write("command", next);
            this.emit("toggled", { value: next });
        }
    }
});
