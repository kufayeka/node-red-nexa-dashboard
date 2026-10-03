// A Nexa component: 1. properties  2. inputs / outputs  3. events  4. view.
// The inspector is built from them: `group` / `section` / `groups` lay out its tree.
// See @kufayeka/node-red-nexa-dashboard/docs/SDK.md.
import { defineComponent, NexaElement, html, css } from "../../nexa-sdk/nexa-component-sdk.js";

export default defineComponent({
    id: "acme-sample-indicator",
    label: "Indicator", category: "Display", icon: "fa fa-circle",
    size: { w: 140, h: 40 },

    properties: {
        onText: { type: "string", default: "RUNNING", group: "Look", section: "Text" },
        offText: { type: "string", default: "STOPPED", group: "Look", section: "Text" },
        onColor: { type: "color", default: "#16a34a", group: "Look", section: "Colour" },
        offColor: { type: "color", default: "#94a3b8", group: "Look", section: "Colour" }
    },
    inputs: { value: { type: "boolean", label: "Running", group: "Tags" } },
    outputs: { command: { fallback: "value", label: "Command", group: "Tags" } },
    groups: ["Tags", "Look"],
    events: { toggled: { label: "On Toggle", payload: { value: "boolean" } } },

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
