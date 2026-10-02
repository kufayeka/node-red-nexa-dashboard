// Nexa "Layout" components, built into the dashboard using the Nexa Component SDK.
// An ES module served at nexa-dashboard-layout/vendor/, registered by src/server/plugin.js.
// These demonstrate the official standard for container & slot components.
import { defineComponent, NexaElement, html, css, nothing } from "../../nexa-sdk/nexa-component-sdk.js";

/* -------------------------------------------------------------------------
   1. Row (Horizontal Flex Container)
   ------------------------------------------------------------------------- */
class RowView extends NexaElement {
    static styles = css`
        :host { display: block; width: 100%; height: 100%; box-sizing: border-box; }
        .row-box {
            display: flex;
            flex-direction: row;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            position: relative;
        }
    `;

    render() {
        const p = this.p;
        const style = [
            `gap: ${p.gap !== undefined ? p.gap : 8}px`,
            `align-items: ${p.align || "center"}`,
            `justify-content: ${p.justify || "flex-start"}`,
            `flex-wrap: ${p.wrap ? "wrap" : "nowrap"}`,
            `padding: ${p.paddingTop || 0}px ${p.paddingRight || 0}px ${p.paddingBottom || 0}px ${p.paddingLeft || 0}px`,
            `background: ${p.background || "transparent"}`,
            `border-radius: ${p.radius || 0}px`,
            p.border ? `border: ${p.borderWidth || 1}px solid ${p.borderColor || "#cbd5e1"}` : ""
        ].filter(Boolean).join("; ");

        return html`
            <div class="row-box" style="${style}">
                ${this.renderSlot("default", { style: "display: contents;" })}
            </div>
        `;
    }
}

export const row = defineComponent({
    id: "nexa-layout-row",
    label: "Row (Flex)",
    category: "Layout",
    icon: "fa fa-columns",
    size: { w: 320, h: 80 },
    capabilities: { resizable: true, rotatable: false, lockable: true },
    properties: {
        gap: { type: "number", default: 8, min: 0, unit: "px", group: "Layout", label: "Gap" },
        align: {
            type: "enum", default: "center", group: "Layout", label: "Align (Cross Axis)", style: "select",
            options: [
                { value: "center", label: "Center" },
                { value: "flex-start", label: "Start / Top" },
                { value: "flex-end", label: "End / Bottom" },
                { value: "stretch", label: "Stretch" }
            ]
        },
        justify: {
            type: "enum", default: "flex-start", group: "Layout", label: "Justify (Main Axis)", style: "select",
            options: [
                { value: "flex-start", label: "Start / Left" },
                { value: "center", label: "Center" },
                { value: "flex-end", label: "End / Right" },
                { value: "space-between", label: "Space Between" },
                { value: "space-around", label: "Space Around" }
            ]
        },
        wrap: { type: "boolean", default: false, group: "Layout", label: "Wrap to next line" },
        background: { type: "color", default: "transparent", group: "Style", label: "Background" },
        radius: { type: "number", default: 0, min: 0, unit: "px", group: "Style", label: "Radius" },
        border: { type: "boolean", default: false, group: "Border", label: "Enable Border" },
        borderColor: { type: "color", default: "#cbd5e1", group: "Border", label: "Border Color", visibleWhen: (p) => p.border },
        borderWidth: { type: "number", default: 1, min: 1, unit: "px", group: "Border", label: "Border Width", visibleWhen: (p) => p.border },
        paddingTop: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Top" },
        paddingRight: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Right" },
        paddingBottom: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Bottom" },
        paddingLeft: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Left" }
    },
    slots: () => [{ name: "default", label: "Row Content" }],
    view: RowView
});

/* -------------------------------------------------------------------------
   2. Column (Vertical Flex Container)
   ------------------------------------------------------------------------- */
class ColumnView extends NexaElement {
    static styles = css`
        :host { display: block; width: 100%; height: 100%; box-sizing: border-box; }
        .col-box {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            position: relative;
        }
    `;

    render() {
        const p = this.p;
        const style = [
            `gap: ${p.gap !== undefined ? p.gap : 8}px`,
            `align-items: ${p.align || "stretch"}`,
            `justify-content: ${p.justify || "flex-start"}`,
            `padding: ${p.paddingTop || 0}px ${p.paddingRight || 0}px ${p.paddingBottom || 0}px ${p.paddingLeft || 0}px`,
            `background: ${p.background || "transparent"}`,
            `border-radius: ${p.radius || 0}px`,
            p.border ? `border: ${p.borderWidth || 1}px solid ${p.borderColor || "#cbd5e1"}` : ""
        ].filter(Boolean).join("; ");

        return html`
            <div class="col-box" style="${style}">
                ${this.renderSlot("default", { style: "display: contents;" })}
            </div>
        `;
    }
}

export const column = defineComponent({
    id: "nexa-layout-column",
    label: "Column (Flex)",
    category: "Layout",
    icon: "fa fa-bars",
    size: { w: 200, h: 260 },
    capabilities: { resizable: true, rotatable: false, lockable: true },
    properties: {
        gap: { type: "number", default: 8, min: 0, unit: "px", group: "Layout", label: "Gap" },
        align: {
            type: "enum", default: "stretch", group: "Layout", label: "Align (Cross Axis)", style: "select",
            options: [
                { value: "stretch", label: "Stretch (Full Width)" },
                { value: "flex-start", label: "Start / Left" },
                { value: "center", label: "Center" },
                { value: "flex-end", label: "End / Right" }
            ]
        },
        justify: {
            type: "enum", default: "flex-start", group: "Layout", label: "Justify (Main Axis)", style: "select",
            options: [
                { value: "flex-start", label: "Start / Top" },
                { value: "center", label: "Center" },
                { value: "flex-end", label: "End / Bottom" },
                { value: "space-between", label: "Space Between" },
                { value: "space-around", label: "Space Around" }
            ]
        },
        background: { type: "color", default: "transparent", group: "Style", label: "Background" },
        radius: { type: "number", default: 0, min: 0, unit: "px", group: "Style", label: "Radius" },
        border: { type: "boolean", default: false, group: "Border", label: "Enable Border" },
        borderColor: { type: "color", default: "#cbd5e1", group: "Border", label: "Border Color", visibleWhen: (p) => p.border },
        borderWidth: { type: "number", default: 1, min: 1, unit: "px", group: "Border", label: "Border Width", visibleWhen: (p) => p.border },
        paddingTop: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Top" },
        paddingRight: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Right" },
        paddingBottom: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Bottom" },
        paddingLeft: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Left" }
    },
    slots: () => [{ name: "default", label: "Column Content" }],
    view: ColumnView
});

/* -------------------------------------------------------------------------
   3. Grid (CSS Grid Container)
   ------------------------------------------------------------------------- */
class GridView extends NexaElement {
    static styles = css`
        :host { display: block; width: 100%; height: 100%; box-sizing: border-box; }
        .grid-box {
            display: grid;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            position: relative;
        }
    `;

    render() {
        const p = this.p;
        const cols = Number(p.columns) || 2;
        const style = [
            `grid-template-columns: repeat(${cols}, minmax(0, 1fr))`,
            `gap: ${p.gap !== undefined ? p.gap : 12}px`,
            `padding: ${p.paddingTop || 0}px ${p.paddingRight || 0}px ${p.paddingBottom || 0}px ${p.paddingLeft || 0}px`,
            `background: ${p.background || "transparent"}`,
            `border-radius: ${p.radius || 0}px`,
            p.border ? `border: ${p.borderWidth || 1}px solid ${p.borderColor || "#cbd5e1"}` : ""
        ].filter(Boolean).join("; ");

        return html`
            <div class="grid-box" style="${style}">
                ${this.renderSlot("default", { style: "display: contents;" })}
            </div>
        `;
    }
}

export const grid = defineComponent({
    id: "nexa-layout-grid",
    label: "Grid",
    category: "Layout",
    icon: "fa fa-th",
    size: { w: 320, h: 200 },
    capabilities: { resizable: true, rotatable: false, lockable: true },
    properties: {
        columns: { type: "number", default: 2, min: 1, max: 12, group: "Grid", label: "Columns" },
        gap: { type: "number", default: 12, min: 0, unit: "px", group: "Grid", label: "Gap" },
        background: { type: "color", default: "transparent", group: "Style", label: "Background" },
        radius: { type: "number", default: 0, min: 0, unit: "px", group: "Style", label: "Radius" },
        border: { type: "boolean", default: false, group: "Border", label: "Enable Border" },
        borderColor: { type: "color", default: "#cbd5e1", group: "Border", label: "Border Color", visibleWhen: (p) => p.border },
        borderWidth: { type: "number", default: 1, min: 1, unit: "px", group: "Border", label: "Border Width", visibleWhen: (p) => p.border },
        paddingTop: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Top" },
        paddingRight: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Right" },
        paddingBottom: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Bottom" },
        paddingLeft: { type: "number", default: 8, min: 0, unit: "px", group: "Padding", label: "Left" }
    },
    slots: () => [{ name: "default", label: "Grid Content" }],
    view: GridView
});

/* -------------------------------------------------------------------------
   4. Card (Panel / Card Container with Header, Body & Shadow)
   ------------------------------------------------------------------------- */
class CardView extends NexaElement {
    static styles = css`
        :host { display: block; width: 100%; height: 100%; box-sizing: border-box; }
        .card-box {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            background: #ffffff;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
            overflow: hidden;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
            position: relative;
        }
        .card-header {
            padding: 10px 14px;
            font-size: 13px;
            font-weight: 600;
            color: #1e293b;
            border-bottom: 1px solid #f1f5f9;
            background: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .card-body {
            flex: 1 1 auto;
            position: relative;
            box-sizing: border-box;
            min-height: 0;
        }
    `;

    render() {
        const p = this.p;
        const style = [
            `background: ${p.background || "#ffffff"}`,
            `border-radius: ${p.radius !== undefined ? p.radius : 6}px`,
            p.border ? `border: ${p.borderWidth || 1}px solid ${p.borderColor || "#e2e8f0"}` : "border: none",
            p.shadow ? "box-shadow: 0 2px 6px 0 rgba(0, 0, 0, 0.08)" : "box-shadow: none"
        ].join("; ");

        const bodyStyle = [
            `padding: ${p.paddingTop || 12}px ${p.paddingRight || 12}px ${p.paddingBottom || 12}px ${p.paddingLeft || 12}px`
        ].join("; ");

        return html`
            <div class="card-box" style="${style}">
                ${p.showHeader && p.title ? html`<div class="card-header">${p.title}</div>` : nothing}
                <div class="card-body" style="${bodyStyle}">
                    ${this.renderSlot("default", { style: "display: contents;" })}
                </div>
            </div>
        `;
    }
}

export const card = defineComponent({
    id: "nexa-layout-card",
    label: "Card (Container)",
    category: "Layout",
    icon: "fa fa-id-card-o",
    size: { w: 260, h: 180 },
    capabilities: { resizable: true, rotatable: false, lockable: true },
    properties: {
        title: { type: "string", default: "Card Title", group: "Header", label: "Title" },
        showHeader: { type: "boolean", default: true, group: "Header", label: "Show Header" },
        background: { type: "color", default: "#ffffff", group: "Style", label: "Background" },
        radius: { type: "number", default: 6, min: 0, unit: "px", group: "Style", label: "Radius" },
        shadow: { type: "boolean", default: true, group: "Style", label: "Drop Shadow" },
        border: { type: "boolean", default: true, group: "Border", label: "Border" },
        borderColor: { type: "color", default: "#e2e8f0", group: "Border", label: "Border Color", visibleWhen: (p) => p.border },
        borderWidth: { type: "number", default: 1, min: 1, unit: "px", group: "Border", label: "Border Width", visibleWhen: (p) => p.border },
        paddingTop: { type: "number", default: 12, min: 0, unit: "px", group: "Padding", label: "Top" },
        paddingRight: { type: "number", default: 12, min: 0, unit: "px", group: "Padding", label: "Right" },
        paddingBottom: { type: "number", default: 12, min: 0, unit: "px", group: "Padding", label: "Bottom" },
        paddingLeft: { type: "number", default: 12, min: 0, unit: "px", group: "Padding", label: "Left" }
    },
    slots: () => [{ name: "default", label: "Card Body" }],
    view: CardView
});
