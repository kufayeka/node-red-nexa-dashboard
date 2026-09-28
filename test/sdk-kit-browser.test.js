'use strict';

// The SDK in a real browser (headless Chrome), through its own testkit and a
// fixture plugin (test/fixtures/sdk-plugin/plugin.js) that uses every feature:
// defineComponent, generic tags (a second provider), inputs (multiple,
// throttle), outputs, events, actions, internal state, timers, size, assets,
// preview, editor-interactive parts, migrations, the plugin's own inspector
// (bind, containers, a custom widget, ui.async, ui.dialog), the automatic
// inspector, the widget contract and the load order. Needs `npm run build`.
//   node test/sdk-kit-browser.test.js        (skipped when Chrome is not installed)

const assert = require('assert');
const path = require('path');
const { withHarness, withPage, startServer } = require('../sdk/testkit');

let passed = 0;
async function ok(label, fn) { await fn(); passed++; console.log('✔ ' + label); }

const TAG = '{sparkplug:Plant::Edge1::Mixer::Speed}';
const OPC = '{opcua:ns=2;s=Motor.Setpoint}';
const quiet = (logs) => logs.filter((l) => !/Lit is in dev mode/.test(l));

async function main() {
    const r1 = await withHarness({
        mounts: { '/acme/vendor': path.join(__dirname, 'fixtures', 'sdk-plugin') },
        modules: ['/acme/vendor/plugin.js']
    }, async ({ js, type, key, logs }) => {
        const settle = () => js('NexaTest.settle()');
        const gauge = (name) => js(`(function () { var r = NexaTest.wc(${JSON.stringify(name)}).renderRoot, t = function (s) { return r.querySelector(s).textContent; };
            return { value: t(".value"), peak: t(".peak"), pens: t(".pens"), size: t(".size"), doubled: t(".doubled"), alarm: r.querySelector(".g").classList.contains("alarm") }; })()`);

        await ok('a module plugin imports the SDK facade; defineComponent registers a complete def', async () => {
            const d = await js(`(function () { var d = NEXA.getComponent("acme-gauge"); return { label: d.label, version: d.version, actions: d.actions,
                events: d.events.map(function (e) { return e.name; }), inputs: d.nexa.inputs.map(function (i) { return i.key; }), outputs: d.nexa.outputs.map(function (o) { return o.key + "<" + o.fallbackKey; }),
                tag: d.tag, sdk: NexaSDK.version, providers: NexaSDK.listTagProviders().map(function (p) { return p.name; }) }; })()`);
            assert.deepStrictEqual(d, {
                label: 'Test Gauge', version: 3, actions: [{ name: 'reset', label: 'Reset peak' }, { name: 'bump', label: 'Bump' }],
                events: ['overMax', 'tick'], inputs: ['inputValue', 'inputPens', 'inputSetpoint'], outputs: ['outputSetpoint<inputSetpoint'],
                tag: 'nx-c-acme-gauge', sdk: '1.0.0', providers: ['sparkplug', 'opcua']
            });
        });

        await ok('runtime: typed inputs, multiple inputs, internal state, size, assets (script once, style in the shadow root)', async () => {
            await js(`NexaTest.mount("g", "acme-gauge", { inputValue: ${JSON.stringify(TAG)}, inputPens: [${JSON.stringify(TAG)}, "{sparkplug:Plant::Edge1::Mixer::Temp}"], inputSetpoint: ${JSON.stringify(OPC)} }, { width: 200, height: 120 })`);
            await js('NexaTest.mount("g2", "acme-gauge", {}, { width: 100, height: 50 })');
            await js('NexaTest.setTag("g", "30")');
            await js('NexaTest.setTag("g", "7", "inputPens[1]")');
            await js('NexaTest.wc("g").ready'); await settle();
            // "30" may be held back by the input's 150 ms throttle (the mount already showed "???")
            await js('new Promise(function (r) { setTimeout(r, 250); })'); await settle();
            const s = await gauge('g');
            assert.deepStrictEqual([s.value, s.peak, s.pens, s.size, s.doubled], ['30', '30', '?,7', '200x120', '60']);
            assert.strictEqual(await js('window.__vendorLibLoads'), 1, 'two instances, one script load');
            const outline = await js('getComputedStyle(NexaTest.wc("g").renderRoot.querySelector(".g")).outlineColor');
            assert.strictEqual(outline, 'rgb(1, 2, 3)');
            assert.strictEqual((await gauge('g2')).value, '???', 'unbound input -> null');
        });

        await ok('an input bound to a variable / template param, the message or an expression (not only a tag)', async () => {
            await js('NexaTest.setVariable("param1", { speed: 12, name: "M1" })');
            await js('NexaTest.mount("gv", "acme-gauge", { inputValue: "{param1.speed}" })');
            await js('NexaTest.mount("gm", "acme-gauge", { inputValue: "{msg.payload.v}" })');
            await js('NexaTest.mount("gn", "acme-gauge", { inputValue: "{notDeclared}" })');
            await js('NexaTest.setMessage("gm", { payload: { v: "7" } })');
            await js('new Promise(function (r) { setTimeout(r, 200); })'); await settle();
            const r = await js(`(function () {
                function st(n) { var w = NexaTest.wc(n); var s = w.status("value"); return [w.in.value, s.bound, s.unknown]; }
                return { v: st("gv"), m: st("gm"), n: st("gn") };
            })()`);
            assert.deepStrictEqual(r.v, [12, true, false], '{param1.speed} -> 12, typed as a number');
            assert.deepStrictEqual(r.m, [7, true, false], '{msg.payload.v} -> 7');
            assert.deepStrictEqual(r.n, [null, true, true], 'not resolvable: bound but unknown, never its text');
            await js('NexaTest.setVariable("param1", { speed: 30 })');
            await js('new Promise(function (r) { setTimeout(r, 200); })'); await settle();
            assert.strictEqual(await js('NexaTest.wc("gv").in.value'), 30, 'follows the variable');
        });

        await ok('the Read / Write Tag picker (nx-tag) offers the sources: an input all four, an output Variable / Tag', async () => {
            const r = await js(`(async function () {
                var ins = NexaTest.inspector("acme-gauge", {}), box = ins.box;
                await NexaTest.wait(80);
                var tags = Array.from(box.querySelectorAll("nx-tag:not([tags-only])"));
                function sources(t) { return Array.from(t.querySelectorAll(".nx-binding-source button")).map(function (b) { return b.textContent.trim(); }); }
                var out = { input: sources(tags[0]), output: sources(tags[2]), labels: tags.map(function (t) { return t.label; }) };
                // Variable, then a name: the input is bound to it
                Array.from(tags[0].querySelectorAll(".nx-binding-source button")).find(function (b) { return b.textContent.trim() === "Variable"; }).click();
                await NexaTest.wait();
                var cb = tags[0].querySelector("nx-combobox input");
                cb.value = "param1.speed"; cb.dispatchEvent(new Event("input")); cb.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                await NexaTest.wait();
                out.saved = ins.props.inputValue;
                ins.destroy();
                return out;
            })()`);
            assert.deepStrictEqual(r.input, ['Variable', 'Tag', 'Message', 'Expression']);
            assert.deepStrictEqual(r.output, ['Variable', 'Tag'], 'a write target: only what can be written');
            assert.deepStrictEqual(r.labels, ['Value', 'Setpoint (OPC UA)', 'Setpoint write'], 'each keeps its own label');
            assert.strictEqual(r.saved, '{param1.speed}');
        });

        await ok('throttle: a burst of changes reaches the view at most every 150 ms, ending on the last value', async () => {
            await js('new Promise(function (r) { setTimeout(r, 200); })');
            const seen = await js(`(async function () {
                var shown = [];
                for (var i = 1; i <= 5; i++) { NexaTest.setTag("g", String(40 + i)); await NexaTest.settle(); shown.push(NexaTest.wc("g").in.value); }
                await new Promise(function (r) { setTimeout(r, 220); }); await NexaTest.settle();
                shown.push(NexaTest.wc("g").in.value);
                return shown;
            })()`);
            assert.strictEqual(seen[0], 41, 'the first change goes through');
            assert.ok(seen.slice(1, 5).every((v) => v === 41), 'the rest is held back: ' + JSON.stringify(seen));
            assert.strictEqual(seen[5], 45, 'then the last value');
        });

        await ok('events, actions (from Logic), timers, onDestroy', async () => {
            await js('NexaTest.setProps("g", { max: 40 })'); await settle();
            const ev = await js('NexaTest.item("g").events.filter(function (e) { return e[0] === "overMax"; }).pop()');
            assert.deepStrictEqual(ev, ['overMax', { value: 45 }]);
            assert.strictEqual(await js('NexaTest.invoke("g", "bump", { by: 5 })'), 50);
            // a throttled input still on its way (150 ms, later on a busy machine) would raise the peak again
            await js('new Promise(function (r) { setTimeout(r, 400); })'); await settle();
            await js('NexaTest.invoke("g", "reset")'); await settle();
            assert.strictEqual((await gauge('g')).peak, '0');
            assert.ok(await js('NexaTest.wc("g").ticks > 0'), 'every() is running');
            const bad = await js('(function () { try { NexaTest.invoke("g", "nope"); return null; } catch (e) { return e.message; } })()');
            assert.ok(/has no action "nope"/.test(bad), bad);
            await js('(function () { NexaTest.wc("g2").remove(); return true; })()');
            const t1 = await js('new Promise(function (r) { setTimeout(function () { r(NexaTest.item("g2").el.firstElementChild ? -1 : window.__gaugeDestroyed); }, 50); })');
            assert.strictEqual(t1, 1, 'onDestroy ran once');
        });

        await ok('outputs: the knob writes the OPC UA setpoint (output empty -> its fallback input); status() is generic', async () => {
            await js('NexaTest.setTag("g", "10", "inputSetpoint")'); await settle();
            await js('NexaTest.wc("g").renderRoot.querySelector(".knob").click()');
            assert.deepStrictEqual(await js('NexaTest.item("g").writes'), [['inputSetpoint', 11]]);
            await js('NexaTest.setProps("g", { outputSetpoint: "{opcua:ns=2;s=Motor.Cmd}" })'); await settle();
            await js('NexaTest.wc("g").renderRoot.querySelector(".knob").click()');
            assert.deepStrictEqual((await js('NexaTest.item("g").writes'))[1], ['outputSetpoint', 11]);
            const st = await js('NexaTest.wc("g").status("setpoint")');
            assert.deepStrictEqual([st.bound, st.provider, st.valid, st.display, st.providerLabel], [true, 'opcua', true, 'ns2 Motor.Setpoint', 'OPC UA']);
        });

        await ok('editor: preview input value, preview state, only the `interactive` part takes clicks', async () => {
            await js('NexaTest.mount("e", "acme-gauge", { __previewState: "alarm" }, { design: true, width: 200, height: 120 })'); await settle();
            const s = await gauge('e');
            assert.deepStrictEqual([s.value, s.alarm], ['42', true]);
            const r = await js(`(function () { var wc = NexaTest.wc("e"), knob = wc.renderRoot.querySelector(".knob"), g = wc.renderRoot.querySelector(".g");
                var reached = []; var h = function (e) { reached.push(e.composedPath()[0].className); };
                document.addEventListener("mousedown", h);
                knob.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
                g.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
                document.removeEventListener("mousedown", h);
                return { pointer: wc.style.pointerEvents, reached: reached }; })()`);
            assert.strictEqual(r.pointer, 'auto');
            assert.deepStrictEqual(r.reached, ['g from-asset-css alarm'], 'the knob\'s mousedown stops at the component, the rest reaches the canvas');
        });

        await ok('migrate: v1 props (color, no max) -> v3', async () => {
            const m = await js('NEXA.getComponent("acme-gauge").migrateProps({ color: "red" })');
            assert.deepStrictEqual(m, { barColor: 'red', max: 100, __v: 3 });
        });

        await ok('the plugin\'s own inspector: tabs, generic tag pickers, list of tags, custom widget, ui.async, ui.alert, ui.dialog', async () => {
            const r = await js(`(async function () {
                var ins = NexaTest.inspector("acme-gauge", {}), box = ins.box, out = {};
                await NexaTest.wait(80);
                var tab = function (l) { Array.from(box.querySelectorAll(".nx-tab")).find(function (b) { return b.textContent.trim() === l; }).click(); };
                out.tabs = Array.from(box.querySelectorAll(".nx-tab")).map(function (b) { return b.textContent.trim(); });
                var tags = Array.from(box.querySelectorAll("nx-tab:not([hidden]) > nx-tag"));
                out.valueChips = tags[0].querySelectorAll(".nx-tag-providers .nx-state").length;
                out.setpointChips = tags[1].querySelectorAll(".nx-tag-providers .nx-state").length;
                tags[1].querySelector("input").focus(); await NexaTest.wait();
                out.suggestions = Array.from(tags[1].querySelectorAll(".nx-menu-item span")).map(function (s) { return s.textContent; });
                tags[1].querySelector(".nx-menu-item").click(); await NexaTest.wait();
                out.setpoint = ins.props.inputSetpoint;
                out.setpointStatus = tags[1].querySelector(".nx-tag-status").textContent.trim();
                var pens = box.querySelector("nx-list");
                pens.querySelector(".nx-list-foot .nx-btn").click(); await NexaTest.wait();
                pens.querySelector(".nx-list-foot .nx-btn").click(); await NexaTest.wait();
                out.penRows = pens.querySelectorAll(".nx-list-row nx-tag:not([tags-only])").length;
                out.pens = ins.props.inputPens;
                tab("Scale"); await NexaTest.wait(80);
                var stepper = box.querySelector("acme-stepper");
                out.stepperLabel = stepper.label;
                stepper.querySelector(".inc").click(); await NexaTest.wait();
                out.steps = ins.props.steps;
                out.units = Array.from(box.querySelector("nx-tab:not([hidden]) nx-select").querySelectorAll("option")).map(function (o) { return o.textContent; });
                var max = box.querySelector("nx-tab:not([hidden]) nx-number input");
                max.value = "5000"; max.dispatchEvent(new Event("change")); await NexaTest.wait();
                out.alert = !!box.querySelector("nx-tab:not([hidden]) nx-alert");
                max.value = ""; max.dispatchEvent(new Event("change")); await NexaTest.wait();
                out.required = (box.querySelector("nx-tab:not([hidden]) nx-number .nx-message") || {}).textContent;
                Array.from(box.querySelectorAll("nx-tab:not([hidden]) .nx-btn")).find(function (b) { return /Pick max/.test(b.textContent); }).click(); await NexaTest.wait();
                out.dialogTitle = document.querySelector(".nx-dialog-title").textContent;
                Array.from(document.querySelectorAll(".nx-dialog-foot .nx-btn")).find(function (b) { return b.textContent === "Yes"; }).click(); await NexaTest.wait();
                out.dialogResult = window.__dialogResult;
                out.dialogGone = !document.querySelector(".nx-dialog");
                tab("Style"); await NexaTest.wait();
                Array.from(box.querySelectorAll(".nx-state")).find(function (b) { return b.textContent.trim() === "Alarm"; }).click(); await NexaTest.wait();
                out.preview = ins.props.__previewState;
                out.alarmBadge = Array.from(box.querySelectorAll("nx-code")).find(function (e) { return e.label === "Alarm CSS"; }).badge;
                ins.destroy();
                return out;
            })()`);
            assert.deepStrictEqual(r.tabs, ['Data', 'Scale', 'Style']);
            assert.deepStrictEqual([r.valueChips, r.setpointChips], [2, 0], 'any provider -> chips; OPC-UA-only input -> none');
            assert.deepStrictEqual(r.suggestions, ['Motor.Speed', 'Motor.Setpoint'], 'suggestions come from the provider');
            assert.strictEqual(r.setpoint, '{opcua:ns=2;s=Motor.Speed}');
            assert.strictEqual(r.setpointStatus, 'OPC UA: ns2 Motor.Speed');
            assert.deepStrictEqual([r.penRows, r.pens], [2, ['', '']]);
            assert.deepStrictEqual([r.stepperLabel, r.steps], ['Steps (custom widget)', 5]);
            assert.deepStrictEqual(r.units, ['None', 'rpm'], 'ui.async options arrived');
            assert.ok(r.alert, 'ui.alert follows p');
            assert.strictEqual(r.required, 'Required');
            assert.deepStrictEqual([r.dialogTitle, r.dialogResult, r.dialogGone], ['Max', 500, true]);
            assert.deepStrictEqual([r.preview, r.alarmBadge], ['alarm', 'previewing']);
        });

        await ok('the automatic inspector: sections by group, validation, reset, bind toggle, visibleWhen live (focus kept)', async () => {
            const r = await js(`(async function () {
                var ins = NexaTest.inspector("acme-plain", { a: 5 }), box = ins.box, out = {};
                await NexaTest.wait();
                var w = function (label) { return Array.from(box.querySelectorAll("*")).find(function (e) { return e.localName.indexOf("nx-") === 0 && e.label === label; }); };
                out.headings = Array.from(box.querySelectorAll(".nx-section-head .nx-title")).map(function (t) { return t.textContent; });
                out.bRequired = (w("B").querySelector(".nx-message") || {}).textContent;
                out.aModified = !!w("A").querySelector(".nx-dot") && !!w("A").querySelector("[title='Reset to default']");
                var bInput = w("B").querySelector("input"); bInput.focus();
                ins.props.c = true; ins.update(); await NexaTest.wait();
                out.focusKept = document.activeElement === bInput;
                out.dShown = !!w("D");
                ins.props.a = 50; ins.update(); await NexaTest.wait();
                out.aMax = (w("A").querySelector(".nx-message") || {}).textContent;
                w("A").querySelector("[title='Reset to default']").click(); await NexaTest.wait();
                out.aReset = ins.props.a;
                w("Fill").querySelector("[title^='Bind']").click(); await NexaTest.wait();
                out.bindMode = w("Fill").binding === "" && !!w("Fill").querySelector("nx-binding");
                var tagIn = w("Fill").querySelector("nx-binding nx-combobox input");   // the Variable source
                tagIn.focus(); tagIn.value = "{color}"; tagIn.dispatchEvent(new Event("input")); tagIn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
                await NexaTest.wait();
                out.fill = ins.props.fill;
                ins.destroy();
                return out;
            })()`);
            assert.deepStrictEqual(r.headings, ['One', 'Two']);
            assert.strictEqual(r.bRequired, 'Required');
            assert.ok(r.aModified);
            assert.ok(r.focusKept && r.dShown, 'visibleWhen re-evaluated in place');
            assert.deepStrictEqual([r.aMax, r.aReset], ['Maximum is 10', 1]);
            assert.ok(r.bindMode, 'the same widget switches to the binding editor');
            assert.strictEqual(r.fill, '{color}');
        });

        await ok('widget contract: nx-text applies on Enter (once) and on blur, never while typing; nx-number keeps 0 and "" apart', async () => {
            await js(`(function () { var k = document.createElement("div"); k.id = "kit"; k.style.width = "300px"; document.body.appendChild(k);
                window.KE = []; k.addEventListener("nx-change", function (e) { KE.push({ tag: e.target.localName, value: e.detail.value }); });
                k.innerHTML = '<nx-text label="Name"></nx-text>'; return true; })()`);
            await js('NexaTest.wait()');
            await js('document.querySelector("#kit nx-text input").focus()');
            await type('abc');
            await js('NexaTest.wait(600)');
            assert.deepStrictEqual(await js('KE'), [], 'nothing while typing, however long the pause');
            await key('Enter');
            await js('NexaTest.wait(450)');
            assert.deepStrictEqual(await js('KE'), [{ tag: 'nx-text', value: 'abc' }], 'Enter applies, once');
            await type('d'); await js('NexaTest.wait(600)');
            assert.deepStrictEqual(await js('KE.map(function (e) { return e.value; })'), ['abc'], 'still nothing while typing');
            await js('(function () { document.querySelector("#kit nx-text input").blur(); return NexaTest.wait(); })()');
            assert.deepStrictEqual(await js('KE.map(function (e) { return e.value; })'), ['abc', 'abcd'], 'leaving the field applies');
            await js('(function () { KE.length = 0; document.getElementById("kit").innerHTML = \'<nx-number label="N"></nx-number>\'; return NexaTest.wait(); })()');
            await js('(function () { var i = document.querySelector("#kit nx-number input"); i.focus(); i.select(); })()');
            await type('0'); await key('Enter');
            await js('(function () { document.querySelector("#kit nx-number input").select(); })()');
            await key('Backspace'); await key('Enter');
            assert.deepStrictEqual(await js('KE.map(function (e) { return e.value; })'), [0, '']);
        });

        await ok('widget contract: select / segmented keep any value type; checkbox, color, slider; nx-list add / remove / drag', async () => {
            const r = await js(`(async function () {
                var k = document.getElementById("kit"), mount = function (h) { KE.length = 0; k.innerHTML = h; return k.firstElementChild; };
                var sel = mount("<nx-select></nx-select>"); sel.options = [{ value: 1, label: "one" }, { value: true, label: "yes" }]; sel.value = true; await NexaTest.wait();
                var shown = sel.querySelector("select").selectedOptions[0].textContent;
                var seg = mount("<nx-segmented></nx-segmented>"); seg.options = [{ value: "a", label: "A" }, { value: "b", label: "B" }]; seg.value = "a"; await NexaTest.wait();
                seg.querySelectorAll(".nx-seg-item")[1].click(); var segEv = KE.slice();
                var cb = mount('<nx-checkbox label="On"></nx-checkbox>'); await NexaTest.wait(); cb.querySelector("input").click(); var cbEv = KE.slice();
                var col = mount("<nx-color></nx-color>"); col.value = "rgba(0,0,0,0.2)"; await NexaTest.wait();
                var hex = col.querySelector("input[type=color]").value;
                var sl = mount("<nx-slider></nx-slider>"); sl.min = 0; sl.max = 1; sl.step = 0.1; sl.value = 1; await NexaTest.wait();
                var rg = sl.querySelector("input[type=range]"); rg.value = "0"; rg.dispatchEvent(new Event("input")); var slEv = KE.slice();
                var l = mount('<nx-list label="Items"></nx-list>'); l.value = ["a", "b", "c"]; l.newItem = function () { return "new"; }; l.renderItem = function (it) { return it; };
                await NexaTest.wait();
                l.querySelector(".nx-list-foot .nx-btn").click(); await NexaTest.wait(); var afterAdd = l.value.slice();
                l.querySelectorAll(".nx-list-row .nx-icon-btn")[0].click(); await NexaTest.wait(); var afterRemove = l.value.slice();
                var rows = l.querySelectorAll(".nx-list-row"), grip = rows[2].querySelector(".nx-list-grip"), top = rows[0].getBoundingClientRect();
                grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientY: rows[2].getBoundingClientRect().top + 2 }));
                window.dispatchEvent(new PointerEvent("pointermove", { clientY: top.top + 1 }));
                window.dispatchEvent(new PointerEvent("pointerup", {}));
                await NexaTest.wait();
                return { shown: shown, segEv: segEv, cbEv: cbEv, hex: hex, slEv: slEv, afterAdd: afterAdd, afterRemove: afterRemove, afterMove: l.value.slice() };
            })()`);
            assert.strictEqual(r.shown, 'yes');
            assert.deepStrictEqual(r.segEv, [{ tag: 'nx-segmented', value: 'b' }]);
            assert.deepStrictEqual(r.cbEv, [{ tag: 'nx-checkbox', value: true }]);
            assert.strictEqual(r.hex, '#000000');
            assert.deepStrictEqual(r.slEv, [{ tag: 'nx-slider', value: 0 }], 'opacity 0 is a real value');
            assert.deepStrictEqual([r.afterAdd, r.afterRemove, r.afterMove], [['a', 'b', 'c', 'new'], ['b', 'c', 'new'], ['new', 'b', 'c']]);
        });

        await ok('regression: a list that changes position is removed cleanly (NxList must not shadow Element.remove)', async () => {
            const r = await js(`(async function () {
                var root = document.createElement("div"); document.body.appendChild(root);
                var props = { rows: ["a"] };
                var meta = { id: "rg", stateList: [{ name: "off", label: "Off" }, { name: "on", label: "On" }], inputs: [], outputs: [], props: {
                    t: { key: "t", type: "string", label: "T", default: "", perState: "on", bindable: true },
                    rows: { key: "rows", type: "list", label: "Rows", default: [], item: { type: "string" } } } };
                var h = NexaKit.renderInspector(root, { meta: meta, props: props, set: function (k, v) { props[k] = v; } });
                await NexaTest.wait();
                props.__previewState = "on"; h.update(); await NexaTest.wait();
                var out = [root.querySelectorAll("nx-list").length, Array.from(root.querySelectorAll("nx-text")).filter(function (e) { return !e.closest("nx-list"); }).length, JSON.stringify(props.rows)];
                h.destroy(); root.remove();
                return out;
            })()`);
            assert.deepStrictEqual(r, [1, 1, '["a"]']);
        });

        await ok('regression: two quick edits in one list row both stay (a row merges into its current value), then add', async () => {
            const r = await js(`(async function () {
                var root = document.createElement("div"); document.body.appendChild(root);
                var props = { rows: [{ name: "a", type: "string" }] }, sets = [];
                var meta = { id: "rw", stateList: [], inputs: [], outputs: [], props: {
                    rows: { key: "rows", type: "list", label: "Rows", default: [], item: { row: true, fields: {
                        name: { type: "string", default: "" }, type: { type: "enum", default: "string", options: [{ value: "string", label: "string" }, { value: "number", label: "number" }] } } } } } };
                // like an owner that saves elsewhere: it doesn't hand the kit a fresh props object
                var h = NexaKit.renderInspector(root, { meta: meta, props: props, set: function (k, v) { sets.push(JSON.stringify(v)); props[k] = v; } });
                await NexaTest.wait();
                var input = root.querySelector("nx-list nx-text input");
                input.value = "speed"; input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                // straight away, before any re-render: the type of the same row
                var sel = root.querySelector("nx-list nx-select select");
                sel.value = "1"; sel.dispatchEvent(new Event("change", { bubbles: true }));
                await NexaTest.wait();
                root.querySelector("nx-list .nx-list-foot button").click();
                await NexaTest.wait();
                var out = { rows: JSON.stringify(props.rows), shown: Array.from(root.querySelectorAll("nx-list nx-text input")).map(function (i) { return i.value; }) };
                h.destroy(); root.remove();
                return out;
            })()`);
            assert.strictEqual(r.rows, '[{"name":"speed","type":"number"},{"name":"","type":"string"}]');
            assert.deepStrictEqual(r.shown, ['speed', ''], 'the list shows both rows at once');
        });

        await ok('nx-binding: the source is read from the value; Variable / Tag / Message / Expression each write the right syntax', async () => {
            const r = await js(`(async function () {
                NexaKit.setHost({ listVariables: function () { return [{ name: "line", value: "L1", owner: { name: "screen", kind: "screen" } }]; } });
                var b = document.createElement("nx-binding"); document.body.appendChild(b);
                var got = []; b.addEventListener("nx-change", function (e) { got.push(e.detail.value); });
                var src = function () { return b.querySelector(".nx-binding-source").value; };
                var out = {};
                var seen = [];
                b.value = "{line}"; await NexaTest.wait(); seen.push(src());
                b.value = "{sparkplug:G::N::D::Speed}"; await NexaTest.wait(); seen.push(src());
                b.value = "{msg.payload.speed}"; await NexaTest.wait(); seen.push(src());
                b.value = "Line {line}: {sparkplug:G::N::D::Speed} rpm"; await NexaTest.wait(); seen.push(src());
                out.preview = (b.querySelector(".nx-tag-status") || {}).textContent.trim();
                out.seen = seen;
                // paths INSIDE something known are fine: a URL query parameter, a member
                NexaKit.setHost({ listVariables: function () { return [{ name: "$route.query", value: "(?a=1)", owner: { name: "the URL", kind: "route" } }, { name: "M101", value: "(Motor)", owner: { name: "App", kind: "app" } }]; } });
                b.value = "path: {$route.query.a}, speed {M101.Speed}"; await NexaTest.wait();
                var st = b.querySelector(".nx-tag-status");
                out.pathOk = st.classList.contains("nx-ok") && !/not declared/.test(st.textContent);
                b.value = "{nope.x}"; await NexaTest.wait();
                out.unknownFlagged = /not declared/.test(b.querySelector(".nx-tag-status").textContent);
                NexaKit.setHost({ listVariables: function () { return [{ name: "line", value: "L1", owner: { name: "screen", kind: "screen" } }]; } });
                // Message: type a path -> {msg.<path>}
                b.value = ""; await NexaTest.wait();
                b.querySelector(".nx-binding-source button[title='Message']").click(); await NexaTest.wait();
                var mi = b.querySelector("nx-text input"); mi.value = "payload.temp"; mi.dispatchEvent(new Event("input")); mi.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
                await NexaTest.wait();
                // Expression: insert a binding at the caret, then Enter
                b.querySelector(".nx-binding-source button[title='Expression']").click(); await NexaTest.wait();
                var ta = b.querySelector(".nx-binding-expr textarea"); ta.value = "Temp  C"; ta.selectionStart = 5; ta.dispatchEvent(new Event("click"));
                var sel = b.querySelector(".nx-binding-expr nx-select select");
                sel.value = String(Array.from(sel.options).findIndex(function (o) { return o.text.indexOf("{line}") === 0; })); sel.dispatchEvent(new Event("change"));
                await NexaTest.wait();
                out.got = got;
                b.remove();
                return out;
            })()`);
            assert.deepStrictEqual(r.seen, ['var', 'tag', 'msg', 'expr']);
            assert.ok(r.pathOk, '{$route.query.a} / {M101.Speed}: paths inside known bindings are not "not declared"');
            assert.ok(r.unknownFlagged, 'an unknown name is still flagged');
            assert.ok(/^Line L1: ‹.*› rpm$/.test(r.preview), r.preview);
            assert.deepStrictEqual(r.got, ['{msg.payload.temp}', 'Temp {line} C']);
        });

        await ok('nx-tree: nested rows, select, collapse, actions, rename, drag & drop (never into itself)', async () => {
            const r = await js(`(async function () {
                var t = document.createElement("nx-tree"); document.body.appendChild(t);
                var ev = [];
                ["nx-tree-select", "nx-tree-action", "nx-tree-rename", "nx-tree-move", "nx-tree-open"].forEach(function (n) {
                    t.addEventListener(n, function (e) { ev.push([n.slice(8), e.detail]); });
                });
                t.nodes = [
                    { id: "g", label: "Group 1", container: true, actions: [{ id: "vis", icon: "fa fa-eye", on: true }], children: [
                        { id: "a", label: "Rect" }, { id: "g2", label: "Inner", container: true, children: [{ id: "b", label: "Text" }] }] },
                    { id: "c", label: "Button", muted: true }];
                t.selected = ["a"];
                await NexaTest.wait();
                var row = function (id) { return t.querySelector('.nx-tree-row[data-id="' + id + '"]'); };
                var out = {};
                out.rows = Array.from(t.querySelectorAll(".nx-tree-row")).map(function (e) { return e.dataset.id; });
                out.indentB = row("b").querySelector(".nx-tree-indent").style.width;
                out.sel = row("a").classList.contains("nx-on") && !row("c").classList.contains("nx-on");
                out.muted = row("c").classList.contains("nx-muted");
                row("c").dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
                row("g").querySelector(".nx-tree-caret").click(); await NexaTest.wait();
                out.collapsed = !row("a") && !!row("g") && row("g").getAttribute("aria-expanded") === "false";
                row("g").querySelector(".nx-tree-caret").click(); await NexaTest.wait();
                row("g").querySelector(".nx-tree-actions button").click();
                row("a").querySelector(".nx-tree-label").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
                await NexaTest.wait();
                var input = t.querySelector(".nx-tree-rename"); out.renameFocused = document.activeElement === input;
                input.value = "  Big rect "; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                await NexaTest.wait();
                function drag(id, targetId, frac) {
                    var dt = new DataTransfer(), target = row(targetId), rect = target.getBoundingClientRect();
                    var y = rect.top + rect.height * frac;
                    row(id).dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
                    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
                    return NexaTest.wait().then(function () {
                        var shown = target.className.match(/nx-drop-(\\w+)/);
                        target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
                        row(id) && row(id).dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
                        return shown ? shown[1] : null;
                    });
                }
                out.dropInside = await drag("c", "g2", 0.5);
                out.dropBefore = await drag("c", "a", 0.1);
                out.dropLeafMiddle = await drag("c", "a", 0.6);
                out.dropIntoOwnChild = await drag("g", "b", 0.5);
                t.remove();
                out.ev = ev;
                return out;
            })()`);
            assert.deepStrictEqual(r.rows, ['g', 'a', 'g2', 'b', 'c'], 'rows start expanded, depth first');
            assert.strictEqual(r.indentB, '28px');
            assert.ok(r.sel && r.muted && r.collapsed && r.renameFocused);
            assert.deepStrictEqual([r.dropInside, r.dropBefore, r.dropLeafMiddle, r.dropIntoOwnChild], ['inside', 'before', 'after', null]);
            assert.deepStrictEqual(r.ev, [
                ['select', { id: 'c', additive: true }],
                ['action', { id: 'g', action: 'vis' }],
                ['rename', { id: 'a', name: 'Big rect' }],
                ['move', { id: 'c', targetId: 'g2', position: 'inside' }],
                ['move', { id: 'c', targetId: 'a', position: 'before' }],
                ['move', { id: 'c', targetId: 'a', position: 'after' }]
            ]);
        });

        await ok('responsive (📱): every bound field offers breakpoint chips; a chip edits that breakpoint (the host keeps it), × inherits again', async () => {
            const r = await js(`(async function () {
                var root = document.createElement("div"); document.body.appendChild(root);
                var props = { gap: 8 }, calls = [];
                var over = {};   // the host's values per breakpoint: { md: { gap: 4 } }
                var bands = [{ id: "xl", name: "xl", design: true, range: "1280 – 1535 px" }, { id: "md", name: "md", range: "768 – 1023 px" }, { id: "sm", name: "sm", range: "640 – 767 px" }];
                var responsive = {
                    list: function () { return bands; }, active: function () { return "xl"; },
                    canVary: function (k) { return k !== "fixed"; },
                    valueAt: function (k, id) { if (id === "sm" && over.sm && k in over.sm) return over.sm[k]; if ((id === "md" || id === "sm") && over.md && k in over.md) return over.md[k]; return props[k]; },
                    has: function (k, id) { return !!(over[id] && k in over[id]); },
                    setAt: function (k, id, v) { calls.push(["setAt", k, id, v]); over[id] = Object.assign({}, over[id], { [k]: v }); },
                    clearAt: function (k, id) { calls.push(["clearAt", k, id]); if (over[id]) delete over[id][k]; }
                };
                var meta = { id: "rs", stateList: [], inputs: [], outputs: [], props: {
                    gap: { key: "gap", type: "number", label: "Gap", default: 0 },
                    fixed: { key: "fixed", type: "number", label: "Fixed", default: 0 } } };
                var h = NexaKit.renderInspector(root, { meta: meta, props: props, responsive: responsive, set: function (k, v) { calls.push(["set", k, v]); props[k] = v; } });
                await NexaTest.wait();
                var field = function (label) { return Array.from(root.querySelectorAll("nx-number")).filter(function (e) { return e.label === label; })[0]; };
                var chips = function () { return Array.from(field("Gap").querySelectorAll(".nx-bp-chip")).map(function (c) { return c.getAttribute("data-bp") + (c.classList.contains("nx-sel") ? "*" : "") + (c.classList.contains("nx-set") ? "!" : "") + ":" + c.textContent.trim(); }); };
                var type = async function (label, v) { var i = field(label).querySelector("input"); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await NexaTest.wait(); };
                var out = {};
                out.toggles = [!!field("Gap").querySelector(".nx-bp-toggle"), !!field("Fixed").querySelector(".nx-bp-toggle")];
                out.closed = chips().length;
                field("Gap").querySelector(".nx-bp-toggle").click(); await NexaTest.wait();
                out.open = chips();
                field("Gap").querySelector('.nx-bp-chip[data-bp="md"]').click(); await NexaTest.wait();
                out.mdShows = field("Gap").querySelector("input").value;
                await type("Gap", "4");
                out.afterMd = chips();
                field("Gap").querySelector('.nx-bp-chip[data-bp="sm"]').click(); await NexaTest.wait();
                out.smShows = field("Gap").querySelector("input").value;
                field("Gap").querySelector('.nx-bp-chip[data-bp="xl"]').click(); await NexaTest.wait();
                await type("Gap", "12");
                field("Gap").querySelector('.nx-bp-chip[data-bp="md"]').click(); await NexaTest.wait();
                field("Gap").querySelector('.nx-bp-chip[data-bp="md"] .nx-bp-x').click(); await NexaTest.wait();
                out.cleared = chips();
                out.calls = calls;
                h.destroy(); root.remove();
                return out;
            })()`);
            assert.deepStrictEqual(r.toggles, [true, false], 'a field the host says cannot vary has no 📱');
            assert.strictEqual(r.closed, 0, 'no chips until asked (or set somewhere)');
            assert.deepStrictEqual(r.open, ['xl*:xl8', 'md:md', 'sm:sm']);
            assert.strictEqual(r.mdShows, '8', 'md inherits the design');
            assert.deepStrictEqual(r.afterMd, ['xl:xl8', 'md*!:md4', 'sm:sm']);
            assert.strictEqual(r.smShows, '4', 'sm inherits md');
            assert.deepStrictEqual(r.cleared, ['xl:xl12', 'md*:md', 'sm:sm'], 'kept open while picked; md inherits again');
            assert.deepStrictEqual(r.calls, [['setAt', 'gap', 'md', 4], ['set', 'gap', 12], ['clearAt', 'gap', 'md']]);
        });

        await ok('fallback: a bound field (⛓) and a tag input edit their fallback (props.__fallback) below the binding', async () => {
            const r = await js(`(async function () {
                var root = document.createElement("div"); document.body.appendChild(root);
                var props = { label: "{speed}", inputValue: "{sparkplug:G::N::D::Speed}", outputValue: "{sparkplug:G::N::D::Set}" }, calls = [];
                var meta = { id: "fb", stateList: [], inputs: [], outputs: [], props: {
                    label: { key: "label", type: "string", label: "Label", default: "", bindable: true },
                    inputValue: { key: "inputValue", type: "tag", label: "Read tag", default: "" },
                    outputValue: { key: "outputValue", type: "tag", label: "Write tag", default: "", access: "write" } } };
                var h = NexaKit.renderInspector(root, { meta: meta, props: props, set: function (k, v) { calls.push([k, JSON.stringify(v)]); props[k] = v; } });
                await NexaTest.wait();
                var byLabel = function (sel, label) { return Array.from(root.querySelectorAll(sel)).filter(function (e) { return e.label === label; })[0]; };
                var label = byLabel("nx-text", "Label"), read = byLabel("nx-tag", "Read tag"), write = byLabel("nx-tag", "Write tag");
                var out = { hasFallback: [!!label.querySelector(".nx-fallback"), !!read.querySelector(".nx-fallback"), !!write.querySelector(".nx-fallback")] };
                var type = async function (input, v) { input.value = v; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await NexaTest.wait(); };
                await type(label.querySelector(".nx-fallback input"), "n/a");
                await type(read.querySelector(".nx-fallback input"), "0");
                out.shown = [label.querySelector(".nx-fallback input").value, read.querySelector(".nx-fallback input").value];
                out.binding = props.label;
                out.calls = calls;
                h.destroy(); root.remove();
                return out;
            })()`);
            assert.deepStrictEqual(r.hasFallback, [true, true, false], 'an output (a write target) has none');
            assert.deepStrictEqual(r.calls, [['__fallback', '{"label":"n/a"}'], ['__fallback', '{"label":"n/a","inputValue":"0"}']]);
            assert.deepStrictEqual(r.shown, ['n/a', '0']);
            assert.strictEqual(r.binding, '{speed}', 'the binding itself is untouched');
        });

        await ok('theme tokens (◆): a colour field picks one ({token:…}), shows it as a chip, × gives its value back; a number field only with `tokens`', async () => {
            const r = await js(`(async function () {
                var root = document.createElement("div"); document.body.appendChild(root);
                var props = { color: "#ff0000", size: 12, count: 3 }, calls = [];
                var meta = { id: "tk", stateList: [], inputs: [], outputs: [], props: {
                    color: { key: "color", type: "color", label: "Colour", default: "#000000" },
                    size: { key: "size", type: "number", label: "Size", default: 12, tokens: "fontSizes" },
                    count: { key: "count", type: "number", label: "Count", default: 0 } } };
                var h = NexaKit.renderInspector(root, { meta: meta, props: props, set: function (k, v) { calls.push([k, v]); props[k] = v; h.update(); } });
                await NexaTest.wait();
                var by = function (sel, label) { return Array.from(root.querySelectorAll(sel)).filter(function (e) { return e.label === label; })[0]; };
                var out = { buttons: [!!by("nx-color", "Colour").querySelector(".nx-token-btn"), !!by("nx-number", "Size").querySelector(".nx-token-btn"), !!by("nx-number", "Count").querySelector(".nx-token-btn")] };
                by("nx-color", "Colour").querySelector(".nx-token-btn").click(); await NexaTest.wait();
                out.listed = Array.from(by("nx-color", "Colour").querySelectorAll(".nx-token-item")).some(function (b) { return b.getAttribute("data-token") === "colors.primary.solid"; });
                by("nx-color", "Colour").querySelector('.nx-token-item[data-token="colors.primary.solid"]').click(); await NexaTest.wait();
                out.chip = by("nx-color", "Colour").querySelector(".nx-token-chip").textContent.replace(/\\s+/g, " ").trim();
                by("nx-color", "Colour").querySelector(".nx-token-chip button").click(); await NexaTest.wait();
                out.calls = calls;
                h.destroy(); root.remove();
                return out;
            })()`);
            assert.deepStrictEqual(r.buttons, [true, true, false]);
            assert.strictEqual(r.listed, true);
            assert.strictEqual(r.chip.replace(/\s/g, ''), 'colors.primary.solid#0f62fe');
            assert.deepStrictEqual(r.calls, [['color', '{token:colors.primary.solid}'], ['color', '#0f62fe']]);
        });

        await ok('no JavaScript errors or warnings in the page', async () => {
            assert.deepStrictEqual(quiet(logs), []);
        });
    });
    if (r1 === null) return null;

    // Load order: a module plugin and the property kit BEFORE the registry + SDK.
    const server = await startServer({ mounts: { '/fx': path.join(__dirname, 'fixtures') } });
    try {
        await withPage(server.url + '/fx/order.html', async ({ js, logs }) => {
            await ok('load order: a module plugin and the kit loaded BEFORE the SDK wait for it, then work', async () => {
                await js('new Promise(function (r) { setTimeout(r, 200); })');
                const r = await js(`(async function () {
                    var el = document.createElement("nx-text"); el.label = "X"; document.getElementById("kit").appendChild(el);
                    await new Promise(function (res) { setTimeout(res, 60); });
                    return [window.__kitBeforeSdk, !!window.NexaKit, !!el.querySelector("input.nx-control"), !!window.__earlyDone, !!NEXA.getComponent("early-bird")];
                })()`);
                assert.deepStrictEqual(r, [false, true, true, true, true]);
                assert.deepStrictEqual(quiet(logs), []);
            });
            await ok('a legacy plugin loading after a plain-script SDK plugin still finds NEXA.registerComponent in the shim', async () => {
                const r = await js(`(function () {
                    var saved = window.NEXA; window.NEXA = undefined;
                    var NEXA = window.NEXA = window.NEXA || { _q: [], registerComponent: function (id, d) { this._q.push([id, d]); } }; NEXA.defineComponent = NEXA.defineComponent || function (d) { (NEXA._c = NEXA._c || []).push(d); };
                    NEXA.defineComponent({ id: "x-sdk" });
                    window.NEXA = window.NEXA || { _q: [], registerComponent: function (id, def) { this._q.push([id, def]); } };
                    window.NEXA.registerComponent("x-legacy", { render: function () {} });
                    var r = [window.NEXA._q.length, window.NEXA._c.length];
                    window.NEXA = saved;
                    return r;
                })()`);
                assert.deepStrictEqual(r, [1, 1]);
            });
        }, { ready: '!!window.T', readyTries: 100 });
    } finally {
        await server.close();
    }
    console.log(`\n${passed} passed\nALL OK`);
    return true;
}

main().then((r) => { if (r === null) console.log('ALL OK'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
