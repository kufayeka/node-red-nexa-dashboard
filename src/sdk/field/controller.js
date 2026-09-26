// --- FieldController: the edit cycle of an input, as a Lit ReactiveController ---
//   view: class extends NexaElement {
//       field = new FieldController(this, { codec: "float", input: "value", output: "value" });
//       render() { return html`<input class="${this.field.classes}" @focus=${this.field.onFocus} ...>`; }
//   }
// The view renders its own markup; the controller owns the behaviour:
//
//   idle --focus--> editing --input--> (live validation: invalid)
//                     |  commit (Enter / Ctrl+Enter when multiline / blur if commitOnBlur)
//                     v
//             parse + validate --x--> invalid (stays in edit; blur = cancel)
//                     | ok
//             same as the current value? --> idle (no write)
//             confirmWrite? --declined--> idle
//                     v
//                  pending --write rejected--> error (shown ERROR_SHOW_MS, reverts)
//                     | ack
//             idle once the INPUT tag reports the written value, or ACK_CONFIRM_MS after the ack
//
// plus unknown (bound tag has no value) / readonly / disabled.
//
// Reads from the view's props: readonly, disabled, commitOnBlur, confirmWrite, confirmText,
// selectOnFocus, previewValue, clearAfterWrite, revealToggle and the codec's
// own props (FieldController.properties(codec) declares them all).
import { getCodec } from "./codecs.js";

var ACK_CONFIRM_MS = 3000;   // pending -> tag value, at the latest this long after the ack
var ERROR_SHOW_MS = 4000;

export class FieldController {
    /**
     * options: codec ("text" | "int" | "float" | a defineCodec name), input / output
     * (the names in the component's inputs / outputs, default "value"),
     * multiline (Enter = new line, Ctrl+Enter commits), sensitive (password:
     * never echoed back), validate: [(value, p) -> reason | null], kind (the
     * wrapper class, default from the codec).
     */
    constructor(host, options) {
        this.host = host;
        this.opts = Object.assign({ codec: "text", input: "value", output: "value", multiline: false, sensitive: false, validate: [] }, options || {});
        this.s = { editing: false, editValue: "", invalid: null, error: null, pending: null, localValue: null, tagValue: null, bound: false, revealed: false };
        this._shownEditing = false;
        var self = this;
        // bound once: usable directly as Lit event listeners (@focus=${this.field.onFocus})
        ["onFocus", "onBlur", "onInput", "onKeyDown", "toggleReveal"].forEach(function (m) { self[m] = self[m].bind(self); });
        host.addController(this);
    }

    get codec() { return getCodec(this.opts.codec); }
    get p() { return this.host.p || {}; }
    get kind() { return this.opts.kind || (this.opts.sensitive ? "password" : this.opts.multiline ? "textarea" : (this.codec.kind === "number" ? "number" : "text")); }
    get clearsAfterWrite() { return this.opts.sensitive && this.p.clearAfterWrite !== false; }
    get revealed() { return this.s.revealed; }
    get editing() { return this.s.editing; }
    get align() { var a = this.p.align; return a === "left" || a === "right" || a === "center" ? a : this.codec.align; }
    get inputMode() { return this.codec.inputMode(this.p); }
    get maxLength() { return this.codec.kind !== "number" && Number(this.p.maxLength) > 0 ? Number(this.p.maxLength) : 0; }
    get message() { return this.s.invalid || this.s.error || ""; }

    /** The value right now: pending write, else the tag, else the local value. */
    get value() {
        var s = this.s;
        if (s.pending) return s.pending.value;
        if (s.bound) return s.tagValue;
        return s.localValue;
    }

    /** What to show while not editing ("???" for an unknown tag). */
    get text() {
        var s = this.s;
        if (this.clearsAfterWrite && !s.bound) return "";
        var v = this.value;
        if (v === null || v === undefined || v === "") {
            if (this.host.isEditor && this.p.previewValue !== undefined && this.p.previewValue !== "") return this.codec.format(this.p.previewValue, this.p);
            return s.bound && s.tagValue === null && !s.pending ? "???" : "";
        }
        return this.codec.format(v, this.p);
    }

    /** State classes for the wrapper: focused invalid error pending unknown readonly disabled. */
    get classes() {
        var p = this.p, s = this.s, c = [this.kind];
        var preview = this.host.previewState;
        if (preview && preview !== "normal") {
            c.push(preview === "focus" ? "focused" : preview);
            if (p.disabled) c.push("disabled");
            return c.join(" ");
        }
        if (s.editing) c.push("focused");
        if (s.invalid) c.push("invalid");
        if (s.error) c.push("error");
        if (s.pending) c.push("pending");
        if (!s.editing && !s.pending && s.bound && s.tagValue === null) c.push("unknown");
        if (p.readonly) c.push("readonly");
        if (p.disabled) c.push("disabled");
        return c.join(" ");
    }

    // ---- ReactiveController -----------------------------------------------------------

    hostUpdate() {
        var s = this.s, st = this.host.status(this.opts.input);
        s.bound = st.bound;
        s.tagValue = st.bound ? this.host.in[this.opts.input] : null;
        // the tag now reports what was written: the write is confirmed
        if (s.pending && s.tagValue !== null && this._same(s.tagValue, s.pending.value)) {
            s.pending = null;
            this._clear("pendingTimer");
        }
        if (this.p.disabled && s.editing) { s.editing = false; s.invalid = null; }
    }

    hostDisconnected() {
        this._clear("pendingTimer");
        this._clear("errorTimer");
    }

    // ---- the machine ---------------------------------------------------------------------

    check(text) {
        var r = this.codec.parse(text, this.p);
        if (!r.ok) return r;
        var validators = this.opts.validate || [];
        for (var i = 0; i < validators.length; i++) {
            var reason = validators[i](r.value, this.p);
            if (reason) return { ok: false, reason: String(reason) };
        }
        return r;
    }

    begin() {
        var s = this.s, p = this.p;
        if (this.host.isEditor || p.disabled || p.readonly || s.editing) return;
        s.editing = true;
        s.invalid = null;
        var v = this.value;
        s.editValue = v === null || v === undefined || this.opts.sensitive ? "" : this.codec.editText(v, p);
        this.host.requestUpdate();
        this.host.emit("focus", { value: this.value });
    }

    input(text) {
        var s = this.s;
        if (!s.editing) return;
        var r = this.check(text);
        var next = r.ok || r.empty ? null : r.reason;
        if (next !== s.invalid) { s.invalid = next; this.host.requestUpdate(); }
    }

    commit(text, via) {
        var s = this.s;
        if (!s.editing) return;
        var r = this.check(text);
        if (r.empty) { s.invalid = null; this._stop(); return; } // nothing typed: keep the value
        if (!r.ok) {
            s.invalid = r.reason;
            this.host.emit("invalid", { text: text, reason: r.reason });
            if (via === "blur") { s.invalid = null; this._stop(); } else this.host.requestUpdate();
            return;
        }
        s.invalid = null;
        if (!this.opts.sensitive && this._same(r.value, this.value)) { this._stop(); return; }
        if (this.p.confirmWrite && typeof window.confirm === "function") {
            if (!window.confirm(this.confirmMessage(r.value))) { this._stop(); return; }
        }
        s.editing = false;
        s.editValue = "";
        this._write(r.value, text);
    }

    /**
     * The confirmation question for writing `value`: the `confirmText` prop with
     * {value} (the new value) and {old} (the current one) filled in, formatted
     * like the field shows them — or `Write "<value>"?` when it is empty. A
     * sensitive field never shows either value.
     */
    confirmMessage(value) {
        var sensitive = this.opts.sensitive;
        var fmt = (v) => (v === null || v === undefined || v === "" ? "" : this.codec.format(v, this.p));
        var shown = sensitive ? "the new password" : fmt(value);
        var tmpl = this.p.confirmText;
        if (tmpl === undefined || tmpl === null || String(tmpl).trim() === "") return "Write " + (sensitive ? shown : '"' + shown + '"') + "?";
        var old = sensitive ? "••••" : fmt(this.value);
        return String(tmpl).replace(/\{value\}/g, shown).replace(/\{old\}/g, old);
    }

    cancel() {
        if (!this.s.editing) return;
        this.s.invalid = null;
        this._stop();
    }

    end(text) {
        var s = this.s;
        if (s.editing) {
            if (this.p.commitOnBlur) this.commit(text, "blur");
            else { s.invalid = null; this._stop(); }
        }
        this.host.emit("blur", { value: this.value });
    }

    // ---- DOM helpers (use them as listeners, or call the machine yourself) ------------------

    onFocus() { this.begin(); }
    onBlur(e) { this.end(e.target.value); }

    onInput(e) {
        var el = e.target;
        var live = this.codec.live(this.p);
        if (live && !e.isComposing) {
            var r = live.format(el.value, el.selectionStart, e.data || null);
            if (r && typeof r.text === "string" && r.text !== el.value) {
                el.value = r.text;
                el.setSelectionRange(r.caret, r.caret);
            }
        }
        this.input(el.value);
    }

    onKeyDown(e) {
        if (e.key === "Escape") { e.preventDefault(); this.cancel(); return; }
        // Backspace / Delete right at an inserted separator would only remove it
        // for the live format to put it back: step over it.
        var live = this.codec.live(this.p);
        var sep = live && live.separator;
        if (sep && (e.key === "Backspace" || e.key === "Delete")) {
            var el = e.target, at = el.selectionStart;
            if (at === el.selectionEnd) {
                if (e.key === "Backspace" && at > 0 && el.value.charAt(at - 1) === sep) el.setSelectionRange(at - 1, at - 1);
                if (e.key === "Delete" && el.value.charAt(at) === sep) el.setSelectionRange(at + 1, at + 1);
            }
        }
        if (e.key !== "Enter") return;
        if (this.opts.multiline && !(e.ctrlKey || e.metaKey)) return; // a new line
        e.preventDefault();
        this.commit(e.target.value, "enter");
    }

    toggleReveal(e) {
        if (e) e.preventDefault();
        this.s.revealed = !this.s.revealed;
        this.host.requestUpdate();
    }

    /**
     * Call from the view's updated(): sets the control's text imperatively, so
     * a re-render caused by a tag update never overwrites what is being typed.
     */
    sync(el) {
        if (!el) return;
        var s = this.s;
        if (s.editing) {
            if (!this._shownEditing) {
                el.value = s.editValue || "";
                if (this.p.selectOnFocus !== false) el.select();
            }
        } else {
            var text = this.text;
            if (el.value !== text) el.value = text;
            var root = el.getRootNode && el.getRootNode();
            if (this._shownEditing && root && root.activeElement === el) el.blur();
        }
        this._shownEditing = s.editing;
    }

    // ---- internals -------------------------------------------------------------------------

    _same(a, b) {
        if (a === null || a === undefined || b === null || b === undefined) return false;
        return this.codec.equals(a, b, this.p);
    }

    _clear(name) {
        if (this.s[name]) { clearTimeout(this.s[name]); this.s[name] = null; }
    }

    _stop() {
        this.s.editing = false;
        this.s.editValue = "";
        this.host.requestUpdate();
    }

    _write(value, text) {
        var self = this, s = this.s, host = this.host, out = this.opts.output;
        this._clear("errorTimer");
        s.error = null;
        host.emit("change", { value: value, text: text });
        if (!host.out.canWrite(out)) {
            s.localValue = this.clearsAfterWrite ? null : value;
            host.requestUpdate();
            return;
        }
        var pending = { value: this.clearsAfterWrite ? null : value, acked: false };
        s.pending = pending.value === null ? null : pending;
        host.requestUpdate();
        host.out.write(out, value).then(function () {
            if (s.pending !== pending) return;
            pending.acked = true;
            self._clear("pendingTimer");
            s.pendingTimer = setTimeout(function () {
                if (s.pending === pending) { s.pending = null; host.requestUpdate(); }
            }, ACK_CONFIRM_MS);
        }).catch(function (e) {
            if (s.pending === pending) s.pending = null;
            s.error = "write failed: " + (e && e.message ? e.message : String(e));
            self._clear("errorTimer");
            s.errorTimer = setTimeout(function () { s.error = null; host.requestUpdate(); }, ERROR_SHOW_MS);
            host.requestUpdate();
            host.emit("writeError", { value: value, error: s.error });
        });
    }

    // ---- reusable declarations (spread them into defineComponent explicitly) -----------------

    /** The props a field reads, for `properties: { ...FieldController.properties("float"), ... }`. */
    static properties(codecName, extra) {
        var codec = getCodec(codecName || "text");
        var out = {};
        Object.keys(codec.props).forEach(function (k) { out[k] = Object.assign({}, codec.props[k]); });
        Object.assign(out, {
            prefix: { type: "string", default: "", group: "Display" },
            suffix: { type: "string", default: "", group: "Display" },
            align: {
                type: "enum", default: codec.align, group: "Display", style: "segmented",
                options: [{ value: "left", label: "Left", icon: "fa fa-align-left" }, { value: "center", label: "Center", icon: "fa fa-align-center" }, { value: "right", label: "Right", icon: "fa fa-align-right" }]
            },
            placeholder: { type: "string", default: "", group: "Display", placeholder: "shown when empty" },
            previewValue: { type: "string", default: "", group: "Display", label: "Preview value (editor only)", help: "Shown on the canvas when the tag has no value yet.", bindable: false },
            commitOnBlur: { type: "boolean", default: false, group: "Behaviour", label: "Write when the field loses focus (blur)", help: "Off: leaving the field cancels the edit; only Enter writes." },
            confirmWrite: { type: "boolean", default: false, group: "Behaviour", label: "Ask for confirmation before writing" },
            confirmText: {
                type: "string", default: "", group: "Behaviour", label: "Confirmation text", placeholder: "Write \"{value}\"?",
                help: "{value} = the new value, {old} = the current one. Empty = Write \"<value>\"?",
                visibleWhen: (p) => !!p.confirmWrite
            },
            selectOnFocus: { type: "boolean", default: true, group: "Behaviour", label: "Select all when editing starts" },
            readonly: { type: "boolean", default: false, group: "Behaviour", label: "Read-only" },
            disabled: { type: "boolean", default: false, group: "Behaviour" },
            opacity: { type: "range", default: 1, min: 0, max: 1, step: 0.05, group: "Behaviour", label: "Opacity" }
        });
        return Object.assign(out, extra || {});
    }

    /** The standard field states; their CSS targets the wrapper's state classes. */
    static states(wrapper) {
        var w = wrapper || ".nexa-field";
        // Rising specificity (repeated class), and a later block wins a tie:
        // unknown < pending < readonly < focus < invalid < error < disabled.
        return {
            normal: { label: "Normal" },
            unknown: { label: "Unknown (tag has no value)", selector: w + ".unknown", css: "color: #94a3b8;\nbackground-color: #f1f5f9;" },
            pending: { label: "Pending (written, waiting for the tag)", selector: w + ".pending", css: "color: #64748b;\nfont-style: italic;" },
            readonly: { label: "Read-only", selector: w + w + ".readonly", css: "background-color: #f8fafc;" },
            focus: { label: "Focus (editing)", selector: w + w + ".focused", css: "border-color: #2563eb;\nbox-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25);" },
            invalid: { label: "Invalid input", selector: w + w + w + ".invalid", css: "border-color: #dc2626;\nbox-shadow: 0 0 0 2px rgba(220, 38, 38, 0.2);" },
            error: { label: "Write error", selector: w + w + w + ".error", css: "border-color: #dc2626;\nbackground-color: #fef2f2;" },
            disabled: { label: "Disabled", selector: w + w + w + w + ".disabled", css: "opacity: 0.6;\ncursor: not-allowed;" }
        };
    }

    /** The Logic events a field fires. */
    static events() {
        return {
            change: { label: "On Change (value committed / written)", payload: { value: "any", text: "string" } },
            invalid: { label: "On Invalid Input", payload: { text: "string", reason: "string" } },
            writeError: { label: "On Write Error", payload: { value: "any", error: "string" } },
            focus: { label: "On Focus (edit started)", payload: { value: "any" } },
            blur: { label: "On Blur (edit ended)", payload: { value: "any" } }
        };
    }
}
