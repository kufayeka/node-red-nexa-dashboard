import { listKnownSparkplugBindings } from "../canvas/sparkplug-live.js";

// "Sparkplug Write Multi" has no static per-tag config at all (unlike
// "Sparkplug Write") — it's entirely msg-driven: msg.writes = [{tag, value},
// ...], grouped by (group/edge/device) and sent as one DCMD/NCMD per group
// (see runLogicGraph). This dialog is read-only/informational: it doesn't
// even need a Save button doing anything, since there's nothing on the node
// itself to configure — just copy-paste help for building msg.writes in an
// upstream "function" node, and a live list of tags this project has
// actually seen so far to copy exact spellings from.
export function openSparkplugWriteMultiNodeEditor(node) {
    window.RED.tray.show({
        id: "nexa-logic-sparkplug-write-multi-editor",
        title: "Sparkplug Write Multi",
        width: 520,
        buttons: [
            { text: "Close", "class": "primary", click: function () { window.RED.tray.close(); } }
        ],
        open: function (tray) {
            var body = tray.find(".red-ui-tray-body").css({ padding: "12px" });
            window.$("<div>").css({ "font-size": "12px", color: "#888", "margin-bottom": "10px" })
                .text("This node has no per-tag configuration of its own — wire a \"function\" node in front of it that sets msg.writes to an array, then wire that into this node:")
                .appendTo(body);

            window.$("<pre>").css({
                "font-size": "11px", background: "var(--red-ui-tertiary-background, #f5f5f5)",
                padding: "8px", "border-radius": "4px", "white-space": "pre-wrap", "word-break": "break-all"
            }).text(
                "msg.writes = [\n" +
                "  { tag: \"{sparkplug:Group::Edge::Device::metricA}\", value: 1 },\n" +
                "  { tag: \"{sparkplug:Group::Edge::Device::metricB}\", value: 2 }\n" +
                "];\nreturn msg;"
            ).appendTo(body);

            window.$("<div>").css({ "font-size": "11px", color: "#888", "margin": "10px 0 4px" })
                .text("Tags with different group/edge/device get batched into separate publishes automatically; tags sharing the same one are sent together in a single Sparkplug message.")
                .appendTo(body);

            var knownBindings = listKnownSparkplugBindings();
            if (knownBindings.length) {
                window.$("<div>").css({ "font-size": "11px", color: "#888", "margin-top": "10px", "font-weight": "bold" })
                    .text("Tags seen so far (click to copy):").appendTo(body);
                var listWrap = window.$("<div>").css({ "max-height": "160px", "overflow-y": "auto", border: "1px solid #ddd", "border-radius": "4px", "margin-top": "4px" }).appendTo(body);
                knownBindings.forEach(function (b) {
                    window.$("<div>").css({
                        "font-size": "11px", padding: "4px 8px", cursor: "pointer", "font-family": "monospace"
                    }).text(b.label).attr("title", "Click to copy: " + b.binding).on("click", function () {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(b.binding);
                            if (window.RED && window.RED.notify) window.RED.notify("Copied: " + b.binding, { type: "success", timeout: 1500 });
                        }
                    }).appendTo(listWrap);
                });
            }
        }
    });
}
