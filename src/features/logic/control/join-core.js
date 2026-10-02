// The Join node's rules, pure (no timers, no DOM): ./runtime.js keeps one per node and
// does the timer. Upstream nodes set msg.topic to a slot's topic to fill that slot.
//
//   wait-all        every slot has a message -> send once, start over. With a timeout: when
//                   it passes, send what is there (missing slots: null) and start over.
//   combine-latest  keep the latest message per slot; send on every message, with all of them.
//   sequence-n      collect N messages (any topic), send them, start over.
//
// The message sent:
//   object   msg.payload = {[topic]: payload}   (sequence-n: [payload, …])
//   array    msg.payload = [payload, …]          in slot order (sequence-n: arrival order)
//   forward  the message that completed it, with msg.join = {[topic]: payload} (sequence-n: [payload, …])
// Always: msg.joinMessages = the full messages ({[topic]: msg} / [msg, …]), msg.joinMode = the mode,
// msg.complete = false when a timeout (or Combine Latest, before every slot spoke) sent it with slots missing.

function clone(v) {
    if (v === null || typeof v !== "object") return v;
    try { return typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
}

export function createJoin(node) {
    const mode = node.mode === "combine-latest" || node.mode === "sequence-n" ? node.mode : "wait-all";
    const format = node.outputFormat === "array" || node.outputFormat === "forward" ? node.outputFormat : "object";
    const topics = (Array.isArray(node.slots) ? node.slots : []).map(function (s) { return s && s.topic; }).filter(Boolean);
    const count = Math.max(2, Number(node.count) || 2);
    let latest = {};   // topic -> msg (slot modes)
    let seq = [];      // msgs (sequence-n)

    function build(trigger, complete) {
        let full, values;
        if (mode === "sequence-n") {
            full = seq.slice();
            values = full.map(function (m) { return m ? m.payload : null; });
        } else {
            full = {};
            values = format === "array" ? [] : {};
            topics.forEach(function (t) {
                const m = Object.prototype.hasOwnProperty.call(latest, t) ? latest[t] : null;
                full[t] = m;
                if (format === "array") values.push(m ? m.payload : null);
                else values[t] = m ? m.payload : null;
            });
        }
        let out;
        if (format === "forward" && trigger) {
            out = clone(trigger);
            out.join = values;
        } else {
            out = { payload: values };
        }
        out.joinMessages = full;
        out.joinMode = mode;
        out.complete = complete;
        return out;
    }

    return {
        mode: mode,
        /** A message arrives -> {send: msg|null, startTimer: bool, stopTimer: bool, ignored?: string} */
        push: function (msg) {
            if (mode === "sequence-n") {
                seq.push(msg);
                if (seq.length < count) return { send: null, startTimer: false, stopTimer: false };
                const out = build(msg, true);
                seq = [];
                return { send: out, startTimer: false, stopTimer: false };
            }
            const topic = msg && msg.topic;
            if (topics.indexOf(topic) === -1) {
                return { send: null, startTimer: false, stopTimer: false, ignored: "msg.topic " + JSON.stringify(topic) + " is not one of the slots " + JSON.stringify(topics) };
            }
            const first = Object.keys(latest).length === 0;
            latest[topic] = msg;
            if (mode === "combine-latest") return { send: build(msg, topics.every(function (t) { return t in latest; })), startTimer: false, stopTimer: false };
            if (topics.every(function (t) { return t in latest; })) {
                const out = build(msg, true);
                latest = {};
                return { send: out, startTimer: false, stopTimer: true };
            }
            return { send: null, startTimer: first && Number(node.timeout) > 0, stopTimer: false };
        },
        /** wait-all's timeout passed: send what is there (null when nothing arrived) and start over */
        timeout: function () {
            if (mode !== "wait-all" || !Object.keys(latest).length) return null;
            const out = build(null, false);
            latest = {};
            return out;
        },
        reset: function () { latest = {}; seq = []; }
    };
}
