import { markDirty } from "../../../state.js";
import { renderLogicCanvas } from "../../../logic/logic-nodes.js";

/**
 * Join node – gathers messages from multiple upstream "channels" (discriminated
 * by msg.topic) and emits a combined message.
 *
 * Modes:
 *   wait-all       – wait until every configured slot has sent ≥1 message,
 *                    then emit once and reset.  Optional timeout (ms).
 *   combine-latest – store the latest message per slot; emit immediately
 *                    whenever ANY slot fires (with all latest values).
 *   sequence-n     – collect N consecutive messages (any topic) into an array,
 *                    emit every N.
 *
 * Output format:
 *   object  – { [slot.topic]: msg } keyed by topic  (default)
 *   array   – [ msg0, msg1, … ] in slot-declaration order
 *   forward – pass the triggering msg through unchanged; attach `.join` object
 *             with all latest values
 *
 * Upstream nodes should set msg.topic = "<slot-topic>" to route their message
 * to the correct slot.  (A Function node or a Switch node branch works well.)
 */
export function openJoinNodeEditor(node) {
    var trayEl = null;

    var draft = {
        mode: node.mode || "wait-all",
        slots: Array.isArray(node.slots) ? JSON.parse(JSON.stringify(node.slots)) : [],
        count: typeof node.count === "number" ? node.count : 2,
        outputFormat: node.outputFormat || "object",
        timeout: typeof node.timeout === "number" ? node.timeout : 0
    };

    var MODE_HELP = {
        "wait-all": "Waits until every configured slot has received at least one message, then emits the combined result and resets. Great for parallel async operations (HTTP + timer, etc.).",
        "combine-latest": "Stores the latest message for each slot. Emits every time any slot fires, always including the most-recent value from all slots. Great for watching several variables together.",
        "sequence-n": "Collects N consecutive messages (from any source) and emits them as an array every N messages. Great for batching events."
    };

    var OUTPUT_OPTIONS = [
        { value: "object", label: "Object \u2013 { [topic]: msg }" },
        { value: "array",  label: "Array  \u2013 [ msg0, msg1, \u2026 ] (slot order)" },
        { value: "forward", label: "Forward first msg + .join \u2013 pass triggering msg, attach .join with all values" }
    ];

    function buildBody(tray) {
        trayEl = tray;
        var body = tray.find(".red-ui-tray-body").css({ padding: "14px" });

        /* ── help ── */
        var helpDiv = window.$("<div>").css({ "font-size": "12px", color: "var(--red-ui-secondary-text-color,#64748b)", "margin-bottom": "14px", "line-height": "1.4" })
            .appendTo(body);

        function label(text, parent) {
            return window.$("<label>").css({ display: "block", "font-size": "11px", "font-weight": "600", color: "var(--red-ui-secondary-text-color,#475569)", margin: "12px 0 4px" })
                .text(text).appendTo(parent || body);
        }

        if (window.NexaKit && typeof window.NexaKit.ensureStyles === "function") window.NexaKit.ensureStyles();

        /* ── mode selector ── */
        label("Mode");
        var modeWrap = window.$("<div>").css({ display: "flex", gap: "8px", "flex-wrap": "wrap", "margin-bottom": "6px" }).appendTo(body);
        ["wait-all", "combine-latest", "sequence-n"].forEach(function (m) {
            var mLabel = { "wait-all": "Wait All", "combine-latest": "Combine Latest", "sequence-n": "Sequence N" }[m];
            var btn = window.$("<button>", { type: "button" })
                .css({
                    padding: "4px 12px", "border-radius": "4px", "font-size": "12px", cursor: "pointer",
                    border: "1px solid var(--red-ui-form-input-border-color,#cbd5e1)",
                    background: draft.mode === m ? "var(--red-ui-primary-background,#1d4ed8)" : "var(--red-ui-secondary-background,#f8fafc)",
                    color: draft.mode === m ? "#fff" : "var(--red-ui-primary-text-color,#333)"
                })
                .text(mLabel).appendTo(modeWrap);
            btn.on("click", function () {
                draft.mode = m;
                // re-render body
                body.empty();
                buildBody(tray);
            });
        });

        helpDiv.text(MODE_HELP[draft.mode]);

        /* ── slot list (wait-all / combine-latest) ── */
        if (draft.mode !== "sequence-n") {
            label("Slots (upstream channels)");
            window.$("<div>").css({ "font-size": "11px", color: "var(--red-ui-secondary-text-color,#94a3b8)", "margin-bottom": "6px" })
                .text("Add one slot per upstream branch. Set msg.topic = the slot topic in each upstream node so the Join can route it.")
                .appendTo(body);

            var listContainer = window.$("<div>", { "class": "nx-kit" }).css({ "margin-bottom": "8px" }).appendTo(body);
            var html = (window.NEXA_LIT && window.NEXA_LIT.html) || function () { return ""; };

            var nxList = document.createElement("nx-list");
            nxList.setAttribute("add-label", "Add slot");
            nxList.setAttribute("empty-text", "No slots configured. Add at least 2 slots.");
            nxList.sortable = true;
            nxList.value = draft.slots.length ? JSON.parse(JSON.stringify(draft.slots)) : [];

            nxList.newItem = function () {
                return { topic: "slot" + (Date.now() % 1000), label: "Slot" };
            };

            nxList.renderItem = function (item, _idx, setItem) {
                var curTopic = item ? (item.topic || "") : "";
                var curLabel = item ? (item.label || "") : "";
                return html`
                    <nx-row cols="2" style="width:100%;gap:8px;">
                        <nx-input label="Topic (msg.topic value)"  .value="${curTopic}"
                            @nx-change="${function (e) {
                                e.stopPropagation();
                                setItem(Object.assign({}, item, { topic: e.detail.value }));
                            }}">
                        </nx-input>
                        <nx-input label="Label (for output key in object mode)" .value="${curLabel}"
                            @nx-change="${function (e) {
                                e.stopPropagation();
                                setItem(Object.assign({}, item, { label: e.detail.value }));
                            }}">
                        </nx-input>
                    </nx-row>
                `;
            };

            listContainer.append(nxList);
        }

        /* ── count (sequence-n) ── */
        if (draft.mode === "sequence-n") {
            label("Collect N messages");
            var countInput = window.$("<input>", { type: "number" })
                .css({ width: "100%", "box-sizing": "border-box", padding: "5px 8px", "border-radius": "4px", border: "1px solid var(--red-ui-form-input-border-color,#cbd5e1)" })
                .attr({ min: 2, max: 100 })
                .val(draft.count)
                .on("change", function () { draft.count = Math.max(2, parseInt(this.value, 10) || 2); })
                .appendTo(body);
        }

        /* ── output format ── */
        label("Output format");
        var fmtSel = window.$("<select>")
            .css({ width: "100%", padding: "5px 8px", "border-radius": "4px", border: "1px solid var(--red-ui-form-input-border-color,#cbd5e1)" })
            .appendTo(body);
        OUTPUT_OPTIONS.forEach(function (o) {
            window.$("<option>", { value: o.value }).text(o.label)
                .prop("selected", draft.outputFormat === o.value)
                .appendTo(fmtSel);
        });
        fmtSel.on("change", function () { draft.outputFormat = fmtSel.val(); });

        /* ── timeout (wait-all only) ── */
        if (draft.mode === "wait-all") {
            label("Timeout (ms, 0 = wait forever)");
            window.$("<input>", { type: "number" })
                .css({ width: "100%", "box-sizing": "border-box", padding: "5px 8px", "border-radius": "4px", border: "1px solid var(--red-ui-form-input-border-color,#cbd5e1)" })
                .attr({ min: 0 })
                .val(draft.timeout)
                .on("change", function () { draft.timeout = Math.max(0, parseInt(this.value, 10) || 0); })
                .appendTo(body);
            window.$("<div>").css({ "font-size": "11px", color: "var(--red-ui-secondary-text-color,#94a3b8)", "margin-top": "4px" })
                .text("If all slots do not arrive within this time the node emits partial results (missing slots get null).")
                .appendTo(body);
        }
    }

    window.RED.tray.show({
        id: "nexa-logic-join-editor",
        title: "Configure Join Node",
        width: 560,
        buttons: [
            { text: "Cancel", click: function () { window.RED.tray.close(); } },
            {
                text: "Save", "class": "primary",
                click: function () {
                    node.mode = draft.mode;
                    node.outputFormat = draft.outputFormat;
                    node.timeout = draft.timeout;

                    if (draft.mode === "sequence-n") {
                        node.count = draft.count;
                        delete node.slots;
                    } else {
                        var nxListEl = trayEl && trayEl.find("nx-list").get(0);
                        var rawSlots = (nxListEl && (nxListEl.items || nxListEl.value)) || draft.slots || [];
                        node.slots = rawSlots.filter(function (s) { return s && s.topic; });
                        delete node.count;
                    }

                    markDirty();
                    renderLogicCanvas();
                    window.RED.tray.close();
                }
            }
        ],
        open: buildBody
    });
}
