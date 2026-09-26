// FIXTURE: the pre-SDK @kufayeka/nexa-component-buttons (NEXA.registerComponent,
// hand-written inspector). Kept so the runtime tests keep proving that a
// legacy plugin still works next to the SDK. Do not edit.
(function () {
    // Required first line for any Nexa component plugin: safely queue registrations
    // if core NEXA.registerComponent hasn't finished loading yet.
    window.NEXA = window.NEXA || { _q: [], registerComponent: function (id, def) { this._q.push([id, def]); } };

    // Both buttons are a plain boolean (true/false) control with a BUILT-IN
    // Sparkplug binding — no Logic wiring needed for the common case:
    //   readTag  "{sparkplug:...}"  -> its value drives the button's state
    //   writeTag "{sparkplug:...}"  <- user interaction writes true/false
    //            (empty = write back to readTag)
    //   Latch:     click toggles        -> writes !state
    //   Momentary: press / release      -> writes true / false
    // Logic events still fire for anything extra (see BUTTON_EVENTS).
    //
    // Styling: `css` is the full base stylesheet; cssTrue/cssFalse/cssHover/
    // cssPressed/cssDisabled are per-state DECLARATIONS (e.g.
    // "background-color: green; color: white;") wrapped into the right
    // selector by buildStylesheet() — or full rules if they contain "{".

    var DEFAULT_BUTTON_CSS = [
        "button {",
        "  font-size: 13px;",
        "  font-weight: 600;",
        "  color: #1e293b;",
        "  background-color: #e2e8f0;",
        "  border: 1px solid #94a3b8;",
        "  border-radius: 4px;",
        "  transition: background-color 80ms ease, border-color 80ms ease, color 80ms ease, box-shadow 80ms ease, filter 80ms ease;",
        "}",
        "button.state-unknown {",
        "  opacity: 0.6;",
        "}"
    ].join("\n");

    var DEFAULT_CSS_TRUE = "color: #ffffff;\nbackground-color: #16a34a;\nborder-color: #15803d;";
    var DEFAULT_CSS_FALSE = "";
    var DEFAULT_CSS_HOVER = "filter: brightness(0.95);";
    var DEFAULT_CSS_PRESSED = "box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.25);\ntransform: translateY(1px);";
    var DEFAULT_CSS_DISABLED = "opacity: 0.6;";

    // Specificity is deliberate: state (0,2,1) < hover/pressed (0,3,1), and
    // each later block wins a tie — so hover/press always show on top of
    // the true/false colours, and disabled wins over everything.
    var STATE_SELECTORS = [
        ["cssFalse", "button.nexa-btn.state-false"],
        ["cssTrue", "button.nexa-btn.state-true"],
        ["cssHover", "button.nexa-btn:not(:disabled):hover"],
        ["cssPressed", "button.nexa-btn.pressed:not(:disabled)"],
        ["cssDisabled", "button.nexa-btn.nexa-btn:disabled"]
    ];

    function buildStylesheet(props) {
        var out = [(props.css !== undefined && props.css !== "") ? props.css : DEFAULT_BUTTON_CSS];
        STATE_SELECTORS.forEach(function (pair) {
            var block = props[pair[0]];
            if (block === undefined || block === null || String(block).trim() === "") return;
            block = String(block);
            out.push(block.indexOf("{") !== -1 ? block : pair[1] + " {\n" + block + "\n}");
        });
        return out.join("\n");
    }

    // Resolved tag value (always a string by the time render() sees it —
    // "true"/"false"/"1"/"0"/"???"...) -> true / false / null (= unknown).
    function parseTagState(raw) {
        if (raw === undefined || raw === null) return null;
        if (typeof raw === "boolean") return raw;
        if (typeof raw === "number") return raw !== 0;
        var s = String(raw).trim().toLowerCase();
        if (s === "" || s === "???") return null;
        if (s === "false" || s === "0" || s === "off" || s === "null") return false;
        if (s === "true" || s === "1" || s === "on") return true;
        var n = Number(s);
        return isNaN(n) ? true : n !== 0;
    }

    function isBindingString(v) {
        return typeof v === "string" && v.indexOf("{sparkplug:") !== -1;
    }

    function readTagKey(rawProps) {
        // `stateValue` = this component's pre-readTag name for the same thing.
        if (rawProps.readTag !== undefined && rawProps.readTag !== "") return "readTag";
        if (rawProps.stateValue !== undefined && rawProps.stateValue !== "") return "stateValue";
        return null;
    }

    function labelFor(props, state) {
        var perState = state ? props.textTrue : props.textFalse;
        if (perState !== undefined && perState !== null && perState !== "") return perState;
        return props.text !== undefined ? props.text : (state ? "ON" : "OFF");
    }

    function mountButton(el, variant) {
        var wc = el.querySelector("nexa-action-button");
        if (!wc) {
            wc = document.createElement("nexa-action-button");
            el.appendChild(wc);
        }
        wc.__nexaVariant = variant;
        return wc;
    }

    function applyVisual(wc) {
        var s = wc.__nexa;
        wc.state = s.state;
        wc.unknown = s.unknown;
        wc.pressed = s.pressed;
        wc.text = labelFor(s.props, s.state);
    }

    // `props` = already-resolved props (tags replaced by their live value).
    function applyButtonProps(wc, props) {
        // In the Node-RED editor, make the inner button non-interactive so clicks
        // select and drag the component container on the canvas instead of clicking the button.
        var isEditor = !!(window.RED && (window.RED.editor || window.RED.tray));
        wc.interactive = !isEditor;
        wc.style.pointerEvents = isEditor ? "none" : "auto";

        props = props || {};
        var s = wc.__nexa = wc.__nexa || { state: false, unknown: false, pressed: false, props: {} };
        s.props = props;

        var key = props.readTag !== undefined && props.readTag !== "" ? "readTag"
            : (props.stateValue !== undefined && props.stateValue !== "" ? "stateValue" : null);
        if (key) {
            var tagState = parseTagState(props[key]);
            s.unknown = tagState === null;
            // A momentary held down stays true until release, whatever a
            // stale tag reading says in the meantime.
            if (tagState !== null && !(wc.__nexaVariant === "momentary" && s.pressed)) s.state = tagState;
            s.tagState = tagState;
        } else {
            s.unknown = false;
        }

        // In editor: allow previewing State 0 or State 1 via the State Switcher
        if (isEditor && props.__previewState !== undefined) {
            s.state = (props.__previewState === 1 || props.__previewState === true);
            s.unknown = false;
        }

        wc.opacity = props.opacity !== undefined ? props.opacity : 1;
        wc.disabled = !!props.disabled;
        wc.customCss = buildStylesheet(props);
        applyVisual(wc);
    }

    function writeState(wc, ctx, value) {
        if (!ctx || typeof ctx.writeSparkplugProp !== "function") return;
        var raw = ctx.getRawProps ? ctx.getRawProps() : {};
        var key = isBindingString(raw.writeTag) ? "writeTag" : readTagKey(raw);
        if (!key || !isBindingString(raw[key])) return; // no tag bound: local-only button
        ctx.writeSparkplugProp(key, value).catch(function (e) {
            console.error("[nexa-button] tag write failed:", e);
            // Snap back to the last value the read tag actually reported.
            var s = wc.__nexa;
            if (s.tagState !== null && s.tagState !== undefined && !s.pressed) {
                s.state = s.tagState;
                applyVisual(wc);
            }
        });
    }

    function emit(ctx, name, s, extra) {
        if (!ctx || !ctx.emit) return;
        var payload = { state: s.state, value: s.state };
        if (extra) Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
        ctx.emit(name, payload);
    }

    // State changed by the USER: write the tag + fire change/state events.
    function commitState(wc, ctx, next) {
        var s = wc.__nexa;
        s.state = next;
        applyVisual(wc);
        writeState(wc, ctx, next);
        emit(ctx, "change", s);
        emit(ctx, next ? "state1" : "state0", s);
    }

    function wireInput(wc, ctx) {
        wc.__nexaCtx = ctx; // re-rendered with a fresh ctx each time - always use the latest
        if (wc.__nexaInputWired) return;
        wc.__nexaInputWired = true;
        wc.addEventListener("nexa-button-input", function (e) {
            var ctx = wc.__nexaCtx;
            var s = wc.__nexa;
            var kind = e.detail && e.detail.kind;
            var momentary = wc.__nexaVariant === "momentary";
            if (kind === "press") {
                if (s.pressed) return;
                s.pressed = true;
                applyVisual(wc);
                emit(ctx, "pressed", s);
                if (momentary) commitState(wc, ctx, true);
            } else if (kind === "release") {
                if (!s.pressed) return; // pointerup + lostpointercapture both land here
                s.pressed = false;
                applyVisual(wc);
                emit(ctx, "released", s);
                if (momentary) commitState(wc, ctx, false);
            } else if (kind === "click") {
                if (!momentary) commitState(wc, ctx, !s.state);
                emit(ctx, "click", s);
            } else if (kind === "hover") {
                emit(ctx, "hover", s);
            } else if (kind === "leave") {
                emit(ctx, "leave", s);
            }
        });
    }

    var BUTTON_DEFAULTS = {
        readTag: { value: "", type: "text" },
        writeTag: { value: "", type: "text" },
        textTrue: { value: "ON", type: "text" },
        textFalse: { value: "OFF", type: "text" },
        opacity: { value: 1, type: "number" },
        disabled: { value: false, type: "checkbox" },
        css: { value: DEFAULT_BUTTON_CSS, type: "css" },
        cssTrue: { value: DEFAULT_CSS_TRUE, type: "css" },
        cssFalse: { value: DEFAULT_CSS_FALSE, type: "css" },
        cssHover: { value: DEFAULT_CSS_HOVER, type: "css" },
        cssPressed: { value: DEFAULT_CSS_PRESSED, type: "css" },
        cssDisabled: { value: DEFAULT_CSS_DISABLED, type: "css" }
    };

    var BUTTON_BINDABLE = [
        "props.readTag", "props.writeTag", "props.textTrue", "props.textFalse", "props.text",
        "props.opacity", "props.disabled", "props.stateValue",
        "props.css", "props.cssTrue", "props.cssFalse", "props.cssHover", "props.cssPressed", "props.cssDisabled"
    ];

    // Every event's msg.payload = { state: <true|false after the action>, value: <same> }.
    // "state1"/"state0" keep their original names so existing Logic nodes still match.
    var BUTTON_EVENTS = [
        { name: "state1", label: "On True (user set state to true)" },
        { name: "state0", label: "On False (user set state to false)" },
        { name: "change", label: "On Change (user changed state)" },
        { name: "click", label: "On Click" },
        { name: "pressed", label: "On Press" },
        { name: "released", label: "On Release" },
        { name: "hover", label: "On Hover" },
        { name: "leave", label: "On Leave" }
    ];

    function handleBind(el, target, value) {
        var wc = el.querySelector("nexa-action-button");
        if (!wc || !target || target.indexOf("props.") !== 0 || !wc.__nexa) return;
        var next = Object.assign({}, wc.__nexa.props);
        next[target.slice(6)] = value;
        applyButtonProps(wc, next);
    }

    // Custom Properties Inspector with State Switcher and Dedicated Sparkplug I/O
    function renderButtonProperties(container, comp, helpers) {
        var refreshComponentRender = helpers.refreshComponentRender;
        var markDirty = helpers.markDirty;
        var openCssCodeEditor = helpers.openCssCodeEditor;
        var listKnownSparkplugBindings = helpers.listKnownSparkplugBindings || function () { return []; };
        var previewText = helpers.previewText || function (c, def) { return c || def; };

        comp.props = comp.props || {};
        var props = comp.props;

        // Ensure default values exist
        if (props.textTrue === undefined) props.textTrue = "ON";
        if (props.textFalse === undefined) props.textFalse = "OFF";
        if (props.cssTrue === undefined) props.cssTrue = DEFAULT_CSS_TRUE;
        if (props.cssFalse === undefined) props.cssFalse = DEFAULT_CSS_FALSE;
        if (props.css === undefined) props.css = DEFAULT_BUTTON_CSS;
        if (props.readTag === undefined) props.readTag = props.stateValue || "";
        if (props.writeTag === undefined) props.writeTag = "";
        if (props.disabled === undefined) props.disabled = false;
        if (props.opacity === undefined) props.opacity = 1;

        // Active state in editor (0 = False/OFF, 1 = True/ON)
        var activeTab = (props.__previewState === 1 || props.__previewState === true) ? 1 : 0;
        props.__previewState = activeTab;

        function createHeader(icon, text, badge) {
            var h = window.$("<div>").css({
                "font-weight": "bold",
                "font-size": "11px",
                "text-transform": "uppercase",
                "letter-spacing": "0.5px",
                "color": "var(--red-ui-secondary-text-color, #64748b)",
                "margin": "14px 0 8px",
                "padding-top": "10px",
                "border-top": "1px solid var(--red-ui-form-input-border-color, #e2e8f0)",
                "display": "flex",
                "align-items": "center",
                "justify-content": "space-between"
            }).appendTo(container);
            var left = window.$("<div>").css({ "display": "flex", "align-items": "center", "gap": "6px" }).appendTo(h);
            if (icon) window.$("<i>").addClass(icon).appendTo(left);
            window.$("<span>").text(text).appendTo(left);
            if (badge) {
                window.$("<span>").css({
                    "font-size": "9px",
                    "font-weight": "600",
                    "padding": "1px 6px",
                    "border-radius": "10px",
                    "background": "#e0f2fe",
                    "color": "#0284c7"
                }).text(badge).appendTo(h);
            }
            return h;
        }

        // --- 1. SPARKPLUG I/O SECTION ---
        createHeader("fa fa-exchange", "Sparkplug I/O Binding");

        function createTagInput(label, propName, placeholder, helpText) {
            var wrap = window.$("<div>").css({ "margin-bottom": "10px" }).appendTo(container);
            window.$("<label>").css({
                "display": "block",
                "font-size": "11px",
                "font-weight": "600",
                "color": "var(--red-ui-primary-text-color, #334155)",
                "margin-bottom": "3px"
            }).text(label).appendTo(wrap);

            var known = listKnownSparkplugBindings();
            if (known && known.length > 0) {
                var pickSelect = window.$("<select>").css({
                    "width": "100%",
                    "margin-bottom": "4px",
                    "font-size": "11px",
                    "padding": "2px 4px",
                    "background": "var(--red-ui-form-input-background, #fff)",
                    "border": "1px solid var(--red-ui-form-input-border-color, #ccc)",
                    "border-radius": "3px"
                }).appendTo(wrap);
                window.$("<option>", { value: "" }).text("(Pick known tag shortcut)").appendTo(pickSelect);
                known.forEach(function (b) {
                    window.$("<option>", { value: b.binding }).text(b.label).appendTo(pickSelect);
                });
                pickSelect.on("change", function () {
                    var val = pickSelect.val();
                    if (val) {
                        tagInput.val(val).trigger("change");
                        pickSelect.val("");
                    }
                });
            }

            var inputRow = window.$("<div>").css({ "display": "flex", "gap": "4px" }).appendTo(wrap);
            var tagInput = window.$("<input>", {
                type: "text",
                placeholder: placeholder || "{sparkplug:Group::Node::Device::Metric}"
            }).css({
                "flex": "1",
                "font-size": "11px",
                "font-family": "monospace",
                "box-sizing": "border-box",
                "padding": "4px 6px"
            }).val(props[propName] || "").appendTo(inputRow);

            var clearBtn = window.$("<button>", {
                type: "button",
                title: "Clear Tag"
            }).css({
                "padding": "3px 8px",
                "font-size": "11px",
                "cursor": "pointer"
            }).html('<i class="fa fa-times"></i>').appendTo(inputRow);

            if (helpText) {
                window.$("<div>").css({
                    "font-size": "10px",
                    "color": "var(--red-ui-secondary-text-color, #64748b)",
                    "margin-top": "2px",
                    "line-height": "1.3"
                }).text(helpText).appendTo(wrap);
            }

            tagInput.on("change", function () {
                var v = tagInput.val().trim();
                props[propName] = v;
                markDirty();
                refreshComponentRender(comp);
            });

            clearBtn.on("click", function () {
                tagInput.val("");
                props[propName] = "";
                markDirty();
                refreshComponentRender(comp);
            });
        }

        createTagInput("Read Tag (Status / State)", "readTag", "{sparkplug:Group::Node::Device::Status}", "Controls State 0 (0 / OFF) vs State 1 (1 / ON) from PLC");
        createTagInput("Write Tag (Action / Command)", "writeTag", "{sparkplug:Group::Node::Device::Command}", "Writes new state on user interaction (leave empty to write back to Read Tag)");

        // --- 2. STATE DESIGNER SECTION (DX SWITCHER) ---
        createHeader("fa fa-sliders", "State Designer & Styling", "Active Preview");

        // Segmented Switcher UI
        var switcherWrap = window.$("<div>").css({
            "display": "flex",
            "background": "var(--red-ui-secondary-background, #f1f5f9)",
            "border": "1px solid var(--red-ui-form-input-border-color, #cbd5e1)",
            "border-radius": "6px",
            "padding": "3px",
            "gap": "4px",
            "margin-bottom": "12px"
        }).appendTo(container);

        var btnState0 = window.$("<button>", { type: "button" }).css({
            "flex": "1",
            "border": "none",
            "border-radius": "4px",
            "padding": "6px 8px",
            "font-size": "11px",
            "font-weight": "600",
            "cursor": "pointer",
            "display": "flex",
            "align-items": "center",
            "justify-content": "center",
            "gap": "6px",
            "transition": "all 0.15s ease"
        }).html('<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#94a3b8;"></span> State 0 (OFF / False)').appendTo(switcherWrap);

        var btnState1 = window.$("<button>", { type: "button" }).css({
            "flex": "1",
            "border": "none",
            "border-radius": "4px",
            "padding": "6px 8px",
            "font-size": "11px",
            "font-weight": "600",
            "cursor": "pointer",
            "display": "flex",
            "align-items": "center",
            "justify-content": "center",
            "gap": "6px",
            "transition": "all 0.15s ease"
        }).html('<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#22c55e;"></span> State 1 (ON / True)').appendTo(switcherWrap);

        // State dynamic container
        var stateFormContainer = window.$("<div>").appendTo(container);

        function updateSwitcherStyles() {
            if (activeTab === 0) {
                btnState0.css({
                    "background": "var(--red-ui-form-input-background, #ffffff)",
                    "color": "var(--red-ui-primary-text-color, #0f172a)",
                    "box-shadow": "0 1px 3px rgba(0,0,0,0.12)"
                });
                btnState1.css({
                    "background": "transparent",
                    "color": "var(--red-ui-secondary-text-color, #64748b)",
                    "box-shadow": "none"
                });
            } else {
                btnState1.css({
                    "background": "var(--red-ui-form-input-background, #ffffff)",
                    "color": "var(--red-ui-primary-text-color, #0f172a)",
                    "box-shadow": "0 1px 3px rgba(0,0,0,0.12)"
                });
                btnState0.css({
                    "background": "transparent",
                    "color": "var(--red-ui-secondary-text-color, #64748b)",
                    "box-shadow": "none"
                });
            }
        }

        function renderStateFields() {
            stateFormContainer.empty();
            updateSwitcherStyles();

            var isState1 = (activeTab === 1);
            var textProp = isState1 ? "textTrue" : "textFalse";
            var cssProp = isState1 ? "cssTrue" : "cssFalse";
            var stateTitle = isState1 ? "State 1 (Active / ON)" : "State 0 (Inactive / OFF)";

            // 1. Text Label Field
            var textRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(stateFormContainer);
            window.$("<label>").css({
                "display": "block",
                "font-size": "11px",
                "font-weight": "600",
                "color": "var(--red-ui-primary-text-color, #334155)",
                "margin-bottom": "3px"
            }).html('<i class="fa fa-font" style="margin-right:4px;"></i> Button Label (' + (isState1 ? "State 1" : "State 0") + ')').appendTo(textRow);

            var textInput = window.$("<input>", {
                type: "text",
                placeholder: isState1 ? "ON" : "OFF"
            }).css({
                "width": "100%",
                "box-sizing": "border-box",
                "padding": "4px 6px",
                "font-size": "12px"
            }).val(props[textProp] !== undefined ? props[textProp] : (isState1 ? "ON" : "OFF")).appendTo(textRow);

            textInput.on("change", function () {
                props[textProp] = textInput.val();
                markDirty();
                refreshComponentRender(comp);
            });

            // 2. State Scoped CSS Field
            var cssRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(stateFormContainer);
            window.$("<label>").css({
                "display": "block",
                "font-size": "11px",
                "font-weight": "600",
                "color": "var(--red-ui-primary-text-color, #334155)",
                "margin-bottom": "3px"
            }).html('<i class="fa fa-css3" style="margin-right:4px;"></i> Styling CSS (' + (isState1 ? "State 1" : "State 0") + ')').appendTo(cssRow);

            var cssPreview = window.$("<input>", {
                type: "text",
                readonly: "readonly"
            }).css({
                "width": "100%",
                "box-sizing": "border-box",
                "color": "#888",
                "background": "var(--red-ui-secondary-background, #f8fafc)",
                "font-size": "11px",
                "margin-bottom": "4px",
                "padding": "3px 6px"
            }).val(previewText(props[cssProp], isState1 ? "(Default: green active style)" : "(Default: slate inactive style)")).appendTo(cssRow);

            window.$("<button>", {
                type: "button"
            }).css({
                "width": "100%",
                "padding": "4px 8px",
                "font-size": "11px",
                "cursor": "pointer"
            }).html('<i class="fa fa-code"></i> Edit CSS for ' + (isState1 ? "State 1" : "State 0") + '...').on("click", function () {
                openCssCodeEditor(comp, cssProp, "Edit CSS (" + stateTitle + ")");
            }).appendTo(cssRow);
        }

        btnState0.on("click", function () {
            activeTab = 0;
            props.__previewState = 0;
            renderStateFields();
            refreshComponentRender(comp);
        });

        btnState1.on("click", function () {
            activeTab = 1;
            props.__previewState = 1;
            renderStateFields();
            refreshComponentRender(comp);
        });

        renderStateFields();

        // --- 3. BASE STYLING & BEHAVIOR SECTION ---
        createHeader("fa fa-cog", "Base Layout & Behavior");

        // Base CSS (Shared)
        var baseCssRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(container);
        window.$("<label>").css({
            "display": "block",
            "font-size": "11px",
            "font-weight": "600",
            "color": "var(--red-ui-primary-text-color, #334155)",
            "margin-bottom": "3px"
        }).text("Base CSS (Shared Sizing, Radius & Font)").appendTo(baseCssRow);

        window.$("<input>", {
            type: "text",
            readonly: "readonly"
        }).css({
            "width": "100%",
            "box-sizing": "border-box",
            "color": "#888",
            "background": "var(--red-ui-secondary-background, #f8fafc)",
            "font-size": "11px",
            "margin-bottom": "4px",
            "padding": "3px 6px"
        }).val(previewText(props.css, "(Default layout)")).appendTo(baseCssRow);

        window.$("<button>", {
            type: "button"
        }).css({
            "width": "100%",
            "padding": "4px 8px",
            "font-size": "11px",
            "cursor": "pointer"
        }).html('<i class="fa fa-code"></i> Edit Base CSS...').on("click", function () {
            openCssCodeEditor(comp, "css", "Edit Base CSS (Shared layout & fonts)");
        }).appendTo(baseCssRow);

        // Disabled
        var disabledRow = window.$("<div>").css({ "margin-bottom": "6px", "display": "flex", "align-items": "center", "gap": "6px" }).appendTo(container);
        var disabledInput = window.$("<input>", { type: "checkbox" }).prop("checked", !!props.disabled).appendTo(disabledRow);
        disabledRow.append(window.$("<label>").css({ "font-size": "11px", "color": "var(--red-ui-secondary-text-color, #475569)" }).text("Disabled"));
        disabledInput.on("change", function () {
            props.disabled = disabledInput.is(":checked");
            markDirty();
            refreshComponentRender(comp);
        });

        // Opacity
        var opacityRow = window.$("<div>").css({ "margin-bottom": "8px" }).appendTo(container);
        window.$("<label>").css({ "display": "block", "font-size": "11px", "color": "#888", "margin-bottom": "2px" }).text("Opacity (0 - 1)").appendTo(opacityRow);
        var opacityInput = window.$("<input>", { type: "number", step: "0.1", min: "0", max: "1" }).css({ "width": "100%", "box-sizing": "border-box" })
            .val(props.opacity !== undefined ? props.opacity : 1).appendTo(opacityRow);
        opacityInput.on("change", function () {
            props.opacity = parseFloat(opacityInput.val()) || 1;
            markDirty();
            refreshComponentRender(comp);
        });
    }

    function register(id, label, icon, variant) {
        window.NEXA.registerComponent(id, {
            category: "Action",
            label: label,
            icon: icon,
            defaultSize: { w: 120, h: 40 },
            capabilities: { resizable: true, rotatable: false, flippable: false, lockable: true },
            hideSparkplugWatch: true,
            renderProperties: renderButtonProperties,
            defaults: BUTTON_DEFAULTS,
            bindable: BUTTON_BINDABLE,
            events: BUTTON_EVENTS,
            render: function (el, props, ctx) {
                var wc = mountButton(el, variant);
                applyButtonProps(wc, props);
                wireInput(wc, ctx);
            },
            onBind: handleBind
        });
    }

    // MOMENTARY: true while held down, false on release.
    register("kufayeka-momentary-button", "Momentary Button", "fa fa-hand-pointer-o", "momentary");
    // LATCH: each click toggles true <-> false and stays there.
    register("kufayeka-latch-button", "Latch Button", "fa fa-toggle-on", "latch");
})();
