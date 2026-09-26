// window.NexaTest — drive a component like the Nexa host does, with fake tags.
//   NexaTest.mount("f", "acme-gauge", { readTag: "{sparkplug:G::E::D::m}", decimals: 2 })
//   NexaTest.setTag("f", "12.5")        value of the component's first input (or pass a prop key)
//   NexaTest.setProps("f", { decimals: 1 })
//   NexaTest.item("f").writes / .events
//   NexaTest.ack("f", true | false, message)   resolve / reject the oldest pending write
//   NexaTest.wc("f")                     the component's element
//   NexaTest.settle()                    wait for Lit updates
//   NexaTest.inspector("acme-gauge", props, host?) -> { box, props, sets, update, destroy }
// { design: true } mounts in editor mode (not interactive, previews).
(function () {
    function sdk() { return window.NexaSDK; }

    var T = window.NexaTest = {
        ready: false,
        items: {},
        slot: function (opts) {
            var el = document.createElement("div");
            el.className = "nexa-test-slot";
            if (opts && opts.width) el.style.width = opts.width + "px";
            if (opts && opts.height) el.style.height = opts.height + "px";
            document.getElementById("root").appendChild(el);
            return el;
        },
        mount: function (name, type, rawProps, opts) {
            opts = opts || {};
            var def = NEXA.getComponent(type);
            if (!def) throw new Error("[nexa-test] unknown component " + type);
            var item = { name: name, type: type, def: def, el: T.slot(opts), raw: Object.assign({}, rawProps), tags: {}, writes: [], events: [], acks: [] };
            var base = { namespace: name, getRawProps: function () { return item.raw; } };
            item.ctx = opts.design
                ? Object.assign(base, { mode: "editor", emit: function () {} })
                : Object.assign(base, {
                    mode: "runtime",
                    emit: function (n, p) { item.events.push([n, p]); },
                    setBindableValue: function (k, v) { item.raw[k] = v; },
                    writeTag: function (key, value) {
                        item.writes.push([key, value]);
                        return new Promise(function (res, rej) { item.acks.push({ res: res, rej: rej }); });
                    }
                });
            T.items[name] = item;
            T.render(name);
            return true;
        },
        // raw props with every tag reference replaced by its fake value ("???" = unknown)
        resolved: function (item) {
            var p = Object.assign({}, item.raw);
            Object.keys(p).forEach(function (k) {
                var v = p[k];
                if (Array.isArray(v)) {
                    p[k] = v.map(function (x, i) { return sdk().parseTag(x) ? (item.tags[k + "[" + i + "]"] !== undefined ? item.tags[k + "[" + i + "]"] : "???") : x; });
                } else if (sdk().parseTag(v)) {
                    p[k] = item.tags[k] !== undefined ? item.tags[k] : "???";
                }
            });
            return p;
        },
        render: function (name) {
            var i = T.items[name];
            i.def.render(i.el, T.resolved(i), i.ctx);
        },
        firstInputKey: function (item) {
            var ins = item.def.nexa && item.def.nexa.inputs;
            return ins && ins[0] ? ins[0].key : null;
        },
        setTag: function (name, value, key) {
            var i = T.items[name];
            i.tags[key || T.firstInputKey(i)] = value;
            T.render(name);
            return true;
        },
        setProps: function (name, patch) {
            Object.assign(T.items[name].raw, patch);
            T.render(name);
            return true;
        },
        item: function (name) { return T.items[name]; },
        wc: function (name) { return T.items[name].el.firstElementChild; },
        ack: function (name, ok, msg) {
            var a = T.items[name].acks.shift();
            if (a) { if (ok) a.res({ ok: true }); else a.rej(new Error(msg || "rejected")); }
            return !!a;
        },
        invoke: function (name, action, params) {
            var i = T.items[name];
            return i.def.invoke(i.el, action, params);
        },
        settle: function () {
            var wait = function () {
                return Promise.all(Object.keys(T.items).map(function (n) { var w = T.wc(n); return w && w.updateComplete; }));
            };
            return wait().then(function () { return new Promise(function (r) { setTimeout(r, 0); }); }).then(wait).then(function () { return true; });
        },
        inspector: function (type, props, host) {
            var def = NEXA.getComponent(type);
            var box = document.createElement("div");
            box.className = "nexa-test-inspector";
            document.body.appendChild(box);
            if (host) window.NexaKit.setHost(host);
            var state = { box: box, props: props || {}, sets: [] };
            Object.keys(def.defaults).forEach(function (k) { if (state.props[k] === undefined) state.props[k] = JSON.parse(JSON.stringify(def.defaults[k].value === undefined ? null : def.defaults[k].value)); });
            var h = window.NexaKit.renderInspector(box, {
                meta: def.nexa, props: state.props, persistKey: "test-" + type + "-" + Date.now(),
                set: function (k, v) { state.props[k] = v; state.sets.push([k, v]); },
                preview: function (k, v) { state.props[k] = v; }
            });
            state.update = h.update;
            state.destroy = function () { h.destroy(); box.remove(); };
            return state;
        },
        wait: function (ms) { return new Promise(function (r) { setTimeout(r, ms || 60); }); }
    };
})();
