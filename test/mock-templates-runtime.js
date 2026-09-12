// Verifies Reusable Screen Templates' params mechanism ("Phase 3 revision" —
// modeled on Node-RED's own Subflow env-vars + Input port, NOT the earlier
// targetNodeId/throughInstanceId design): {name} interpolation in component
// props, per-instance static paramValues, the "param-input" source node
// (Subflow-Input analogue) firing on mount and on every change, the
// "set-template-param" sink updating exactly one instance's state, and
// nested pass-through composing through ordinary wiring with NO chain-
// walking code — a Group template's own param-input -> Function ->
// set-template-param targeting one of its nested Card instances.
// Same lightweight plain-DOM mock style as mock-runtime-client.js (no
// jQuery — nexa-runtime-client.js itself never uses it).
const elements = [];
function makeEl(tag) {
  const el = {
    tag: tag, style: {}, children: [], attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(child) { this.children.push(child); },
    querySelector(sel) { return this.children.find(c => c.tag === sel) || null; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; }
  };
  elements.push(el);
  return el;
}
const artboard = makeEl('div');
artboard.id = 'nexa-runtime-artboard';
global.document = {
  createElement(tag) { return makeEl(tag); },
  getElementById(id) { return id === 'nexa-runtime-artboard' ? artboard : null; },
  querySelector(sel) {
    const m = /\[data-id="([^"]+)"\]/.exec(sel);
    return m ? (elements.find(e => e.attrs['data-id'] === m[1]) || null) : null;
  }
};
global.window = global;
global.console = console;
global.window.addEventListener = function () {};

const fs = require('fs');
eval(fs.readFileSync(process.argv[2], 'utf8')); // nexa-registry-client.js

NEXA.registerComponent('mock-text-in-template', {
  category: 'Test', label: 'Text', defaultSize: { w: 200, h: 40 },
  defaults: { text: { value: '', type: 'text' } },
  bindable: ['props.text'],
  render: function (el, props) { el.textContent = props.text || ''; },
  onBind: function (el, target, value) { if (target === 'props.text') el.textContent = value; }
});

// tA ("Card"): declares one param "value" (default "default"). `txt`
// demonstrates AUTOMATIC {value} interpolation (no wiring at all); `txt2`
// demonstrates the explicit param-input -> Function -> ui-update path (the
// "harus bisa lewat node" ask) driven by the SAME underlying param.
const tA = {
  id: 'tA', name: 'Card', width: 200, height: 100,
  layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [
    { id: 'txt', type: 'mock-text-in-template', x: 0, y: 0, w: 200, h: 40, rotation: 0, locked: false, layerId: 'default', props: { text: 'Value: {value}' } },
    { id: 'txt2', type: 'mock-text-in-template', x: 0, y: 40, w: 200, h: 40, rotation: 0, locked: false, layerId: 'default', props: { text: 'static' } }
  ],
  logic: {
    nodes: [
      { id: 'paramIn', type: 'param-input' },
      { id: 'fnIn', type: 'function', code: 'return {payload: {text: "Internal: " + msg.payload.value}};' },
      { id: 'updTxt2', type: 'ui-update', compId: 'txt2', config: {} }
    ],
    wires: [
      { id: 'w1', from: 'paramIn', to: 'fnIn' },
      { id: 'w2', from: 'fnIn', to: 'updTxt2' }
    ]
  },
  params: [{ id: 'p1', name: 'value', label: 'Value', type: 'text', defaultValue: 'default' }]
};

// tB ("Group"): nests ONE tA instance and declares its own "groupValue"
// param, wiring its own param-input straight through to the nested
// instance's "value" param — plain wiring, no special pass-through code.
const tB = {
  id: 'tB', name: 'Group', width: 400, height: 100,
  layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [
    { id: 'card1', type: '@template', templateId: 'tA', x: 0, y: 0, w: 200, h: 100, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: {} }
  ],
  logic: {
    nodes: [
      { id: 'groupParamIn', type: 'param-input' },
      { id: 'groupFn', type: 'function', code: 'return {payload: msg.payload.groupValue};' },
      { id: 'setCard1', type: 'set-template-param', instanceId: 'card1', paramName: 'value' }
    ],
    wires: [
      { id: 'w1', from: 'groupParamIn', to: 'groupFn' },
      { id: 'w2', from: 'groupFn', to: 'setCard1' }
    ]
  },
  params: [{ id: 'gp1', name: 'groupValue', label: 'Group Value', type: 'text', defaultValue: 'g-default' }]
};

const tC = {
  id: 'tC', name: 'Self', width: 100, height: 100,
  layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
  components: [
    { id: 'selfRef', type: '@template', templateId: 'tC', x: 0, y: 0, w: 100, h: 100, rotation: 0, locked: false, layerId: 'default', props: {} }
  ],
  logic: { nodes: [], wires: [] },
  params: []
};

// Every Function node is unconditionally async (wrapped so `await fetch(...)`
// works) — its result NEVER resolves synchronously within the eval() that
// triggers it, same reason mock-runtime-client.js needs this exact pattern.
const tick = () => new Promise(r => setTimeout(r, 30));

(async function () {
  console.log('--- sibling instances: static paramValues + automatic {value} interpolation on mount, independently ---');
  const screen1 = {
    width: 500, height: 100,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [
      { id: 'inst1', type: '@template', templateId: 'tA', x: 0, y: 0, w: 200, h: 100, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: { value: 'A' } },
      { id: 'inst2', type: '@template', templateId: 'tA', x: 200, y: 0, w: 200, h: 100, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: { value: 'B' } }
    ],
    logic: { nodes: [], wires: [] } // no onload/set-template-param here on purpose — a separate mount below tests that, since both resolve within the same microtask tick and would otherwise race against these "as freshly mounted" checks
  };
  window.__NEXA_SCREEN__ = screen1;
  window.__NEXA_TEMPLATES__ = [tA];
  eval(fs.readFileSync(process.argv[3], 'utf8')); // nexa-runtime-client.js (mounts, fires param-input on each instance)
  await tick();

  console.log('inst1 {value} interpolated to its own static "A" on mount?', document.querySelector('[data-id="inst1::txt"]').textContent === 'Value: A');
  console.log('inst2 {value} interpolated to its own static "B" on mount, independently?', document.querySelector('[data-id="inst2::txt"]').textContent === 'Value: B');
  console.log('inst1\'s param-input node fired on mount with the right value ("Internal: A")?', document.querySelector('[data-id="inst1::txt2"]').textContent === 'Internal: A');
  console.log('inst2\'s param-input node fired on mount with ITS OWN value ("Internal: B")?', document.querySelector('[data-id="inst2::txt2"]').textContent === 'Internal: B');

  console.log('--- "set-template-param" live update (separate mount with DIFFERENT instance ids, so it isn\'t racing the "on mount" checks above nor colliding in the never-cleared mock DOM) ---');
  const screen1b = {
    width: 500, height: 100,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [
      { id: 'inst1b', type: '@template', templateId: 'tA', x: 0, y: 0, w: 200, h: 100, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: { value: 'A' } },
      { id: 'inst2b', type: '@template', templateId: 'tA', x: 200, y: 0, w: 200, h: 100, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: { value: 'B' } }
    ],
    logic: {
      nodes: [
        { id: 'onload1', type: 'onload' },
        { id: 'fnSet', type: 'function', code: 'return {payload: "UPDATED"};' },
        { id: 'setInst1', type: 'set-template-param', instanceId: 'inst1b', paramName: 'value' }
      ],
      wires: [
        { id: 'w1', from: 'onload1', to: 'fnSet' },
        { id: 'w2', from: 'fnSet', to: 'setInst1' }
      ]
    }
  };
  window.__NEXA_SCREEN__ = screen1b;
  window.__NEXA_TEMPLATES__ = [tA];
  eval(fs.readFileSync(process.argv[3], 'utf8'));
  // onload -> fnSet -> setInst1 -> re-fired param-input -> fnIn is two
  // Function-node async hops — give it enough ticks to fully settle.
  await tick(); await tick();
  console.log('a "set-template-param" node updates ONLY the targeted instance\'s interpolated text ("Value: UPDATED")?', document.querySelector('[data-id="inst1b::txt"]').textContent === 'Value: UPDATED');
  console.log('...and re-fires that instance\'s OWN param-input node too ("Internal: UPDATED")?', document.querySelector('[data-id="inst1b::txt2"]').textContent === 'Internal: UPDATED');
  console.log('the sibling instance (inst2b) is completely unaffected?', document.querySelector('[data-id="inst2b::txt"]').textContent === 'Value: B' && document.querySelector('[data-id="inst2b::txt2"]').textContent === 'Internal: B');

  console.log('--- nested pass-through: a Group\'s own param-input -> Function -> a nested Card instance\'s set-template-param, pure wiring, no chain-walking code ---');
  const screen2 = {
    width: 400, height: 100,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [
      { id: 'grp', type: '@template', templateId: 'tB', x: 0, y: 0, w: 400, h: 100, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: { groupValue: 'INITIAL' } }
    ],
    logic: { nodes: [], wires: [] }
  };
  window.__NEXA_SCREEN__ = screen2;
  window.__NEXA_TEMPLATES__ = [tA, tB];
  eval(fs.readFileSync(process.argv[3], 'utf8'));
  // Group's own param-input -> groupFn (async #1) -> setCard1 -> re-fires
  // card1's own param-input -> fnIn (async #2) -> updTxt2 — two async hops.
  await tick(); await tick();

  console.log('the nested "card1" instance\'s {value} interpolation picked up the OUTER Group\'s param via plain wiring ("Value: INITIAL")?', document.querySelector('[data-id="grp::card1::txt"]').textContent === 'Value: INITIAL');
  console.log('...and its own internal param-input node re-fired too ("Internal: INITIAL")?', document.querySelector('[data-id="grp::card1::txt2"]').textContent === 'Internal: INITIAL');

  console.log('--- typed params + deep path interpolation: {a.b.c}, {a[0].b}, and mixed, on OBJECT/ARRAY-typed params ---');
  const tD = {
    id: 'tD', name: 'Typed', width: 200, height: 120,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [
      { id: 'objTxt', type: 'mock-text-in-template', x: 0, y: 0, w: 200, h: 30, rotation: 0, locked: false, layerId: 'default', props: { text: 'Name: {info.name}, RPM: {info.specs.rpm}' } },
      { id: 'arrTxt', type: 'mock-text-in-template', x: 0, y: 30, w: 200, h: 30, rotation: 0, locked: false, layerId: 'default', props: { text: 'First: {list[0]}, Last: {list[2]}' } },
      { id: 'mixedTxt', type: 'mock-text-in-template', x: 0, y: 60, w: 200, h: 30, rotation: 0, locked: false, layerId: 'default', props: { text: 'Item 1: {items[1].label}' } },
      { id: 'missingTxt', type: 'mock-text-in-template', x: 0, y: 90, w: 200, h: 30, rotation: 0, locked: false, layerId: 'default', props: { text: 'Missing: {items[5].label}' } }
    ],
    logic: { nodes: [], wires: [] },
    params: [
      { id: 'pInfo', name: 'info', label: 'Info', type: 'object', defaultValue: { name: 'Motor1', specs: { rpm: 1500 } } },
      { id: 'pList', name: 'list', label: 'List', type: 'array', defaultValue: [10, 20, 30] },
      { id: 'pItems', name: 'items', label: 'Items', type: 'array', defaultValue: [{ label: 'A' }, { label: 'B' }] }
    ]
  };
  const screenTyped = {
    width: 200, height: 120,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [{ id: 'typedInst', type: '@template', templateId: 'tD', x: 0, y: 0, w: 200, h: 120, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: {} }],
    logic: { nodes: [], wires: [] }
  };
  window.__NEXA_SCREEN__ = screenTyped;
  window.__NEXA_TEMPLATES__ = [tD];
  eval(fs.readFileSync(process.argv[3], 'utf8'));
  console.log('object param dot-path interpolation ({info.name}, {info.specs.rpm})?', document.querySelector('[data-id="typedInst::objTxt"]').textContent === 'Name: Motor1, RPM: 1500');
  console.log('array param bracket-index interpolation ({list[0]}, {list[2]})?', document.querySelector('[data-id="typedInst::arrTxt"]').textContent === 'First: 10, Last: 30');
  console.log('mixed array-of-objects path ({items[1].label})?', document.querySelector('[data-id="typedInst::mixedTxt"]').textContent === 'Item 1: B');
  console.log('an out-of-range/unresolvable path is left as the literal text, not "undefined"?', document.querySelector('[data-id="typedInst::missingTxt"]').textContent === 'Missing: {items[5].label}');

  console.log('--- declarative nested param passing: a paramValue that IS a {path} binding, no Logic-node wiring needed at all ---');
  // "Leaf" is the innermost template, its OWN params ("a" string, "rpm"
  // number) driven entirely by whatever its instance's paramValues say —
  // exactly like every earlier test. The interesting part is "Outer",
  // which nests a Leaf instance whose paramValues are BINDINGS ({x},
  // {info.specs.rpm}) into Outer's OWN params, authored purely as data —
  // no param-input/Function/set-template-param anywhere inside "Outer".
  const tLeaf = {
    id: 'tLeaf', name: 'Leaf', width: 200, height: 80,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [
      { id: 'txtA', type: 'mock-text-in-template', x: 0, y: 0, w: 200, h: 40, rotation: 0, locked: false, layerId: 'default', props: { text: 'A={a}' } },
      { id: 'txtRpm', type: 'mock-text-in-template', x: 0, y: 40, w: 200, h: 40, rotation: 0, locked: false, layerId: 'default', props: { text: 'RPM={rpm}' } }
    ],
    logic: { nodes: [], wires: [] },
    params: [
      { id: 'lp1', name: 'a', label: 'A', type: 'string', defaultValue: '' },
      { id: 'lp2', name: 'rpm', label: 'RPM', type: 'number', defaultValue: 0 }
    ]
  };
  const tOuter = {
    id: 'tOuter', name: 'Outer', width: 400, height: 80,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [
      { id: 'leafInst', type: '@template', templateId: 'tLeaf', x: 0, y: 0, w: 200, h: 80, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: { a: '{x}', rpm: '{info.specs.rpm}' } }
    ],
    logic: { nodes: [], wires: [] }, // deliberately empty — the pass-through needs no wiring at all
    params: [
      { id: 'op1', name: 'x', label: 'X', type: 'string', defaultValue: 'default-x' },
      { id: 'op2', name: 'info', label: 'Info', type: 'object', defaultValue: { specs: { rpm: 999 } } }
    ]
  };
  const screenBind = {
    width: 400, height: 80,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [
      { id: 'outerInst', type: '@template', templateId: 'tOuter', x: 0, y: 0, w: 400, h: 80, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: { x: 'HELLO', info: { specs: { rpm: 1500 } } } }
    ],
    logic: {
      nodes: [
        { id: 'onload1', type: 'onload' },
        { id: 'fnNewX', type: 'function', code: 'return {payload: "CHANGED"};' },
        { id: 'setX', type: 'set-template-param', instanceId: 'outerInst', paramName: 'x' }
      ],
      wires: [{ id: 'w1', from: 'onload1', to: 'fnNewX' }, { id: 'w2', from: 'fnNewX', to: 'setX' }]
    }
  };
  window.__NEXA_SCREEN__ = screenBind;
  window.__NEXA_TEMPLATES__ = [tLeaf, tOuter];
  eval(fs.readFileSync(process.argv[3], 'utf8'));
  console.log('the nested Leaf instance\'s bound "a" param picked up Outer\'s static "x" value at mount ("A=HELLO")?', document.querySelector('[data-id="outerInst::leafInst::txtA"]').textContent === 'A=HELLO');
  console.log('a deep-path binding {info.specs.rpm} resolves to the ACTUAL nested number (not a stringified fragment) ("RPM=1500")?', document.querySelector('[data-id="outerInst::leafInst::txtRpm"]').textContent === 'RPM=1500');

  // onload -> fnNewX (one async hop) -> setX -> cascadeBoundChildParams
  await tick(); await tick();
  console.log('a live "set-template-param" on the OUTER instance automatically cascades into the bound nested param, with ZERO wiring inside "Outer" ("A=CHANGED")?', document.querySelector('[data-id="outerInst::leafInst::txtA"]').textContent === 'A=CHANGED');

  console.log('--- reported bug repro: TWO SIBLING top-level instances of the SAME outer template, each independently wired, each with a nested bound child ---');
  // Mirrors the user's real flows.json: two separate "Template 1" (tOuter)
  // instances on one screen, EACH with its own onload->Function->
  // set-template-param wiring driving a DIFFERENT value into the same
  // param name "x", and each containing its own nested Leaf instance bound
  // via {x}. The claim is that the SECOND outer instance's nested child
  // shows the FIRST outer instance's value instead of its own.
  const screenSiblings = {
    width: 800, height: 80,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [
      { id: 'outerFirst', type: '@template', templateId: 'tOuter', x: 0, y: 0, w: 400, h: 80, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: {} },
      { id: 'outerSecond', type: '@template', templateId: 'tOuter', x: 400, y: 0, w: 400, h: 80, rotation: 0, locked: false, layerId: 'default', props: {}, paramValues: {} }
    ],
    logic: {
      nodes: [
        { id: 'onloadS', type: 'onload' },
        { id: 'fnFirst', type: 'function', code: 'return {payload: "FIRST-VALUE"};' },
        { id: 'setFirst', type: 'set-template-param', instanceId: 'outerFirst', paramName: 'x' },
        { id: 'fnSecond', type: 'function', code: 'return {payload: "SECOND-VALUE"};' },
        { id: 'setSecond', type: 'set-template-param', instanceId: 'outerSecond', paramName: 'x' }
      ],
      wires: [
        { id: 'w1', from: 'onloadS', to: 'fnFirst' }, { id: 'w2', from: 'fnFirst', to: 'setFirst' },
        { id: 'w3', from: 'onloadS', to: 'fnSecond' }, { id: 'w4', from: 'fnSecond', to: 'setSecond' }
      ]
    }
  };
  window.__NEXA_SCREEN__ = screenSiblings;
  window.__NEXA_TEMPLATES__ = [tLeaf, tOuter];
  eval(fs.readFileSync(process.argv[3], 'utf8'));
  await tick(); await tick();
  const firstText = document.querySelector('[data-id="outerFirst::leafInst::txtA"]').textContent;
  const secondText = document.querySelector('[data-id="outerSecond::leafInst::txtA"]').textContent;
  console.log('outerFirst nested leaf shows its OWN parent value ("A=FIRST-VALUE")? got:', firstText, '->', firstText === 'A=FIRST-VALUE');
  console.log('outerSecond nested leaf shows its OWN parent value ("A=SECOND-VALUE"), NOT the first sibling\'s? got:', secondText, '->', secondText === 'A=SECOND-VALUE');

  console.log('--- defensive cycle guard: a template containing an instance of ITSELF must not hang, and should render a clear error ---');
  const screen4 = {
    width: 100, height: 100,
    layers: [{ id: 'default', name: 'Default', parentId: null, visible: true }],
    components: [{ id: 'topSelf', type: '@template', templateId: 'tC', x: 0, y: 0, w: 100, h: 100, rotation: 0, locked: false, layerId: 'default', props: {} }],
    logic: { nodes: [], wires: [] }
  };
  window.__NEXA_SCREEN__ = screen4;
  window.__NEXA_TEMPLATES__ = [tC];
  const startTime = Date.now();
  eval(fs.readFileSync(process.argv[3], 'utf8'));
  const elapsedMs = Date.now() - startTime;
  console.log('self-referencing template mounts without hanging (<1s)?', elapsedMs < 1000);
  const selfRefEl = elements.find(e => (e.textContent || '').indexOf('circular template reference') !== -1);
  console.log('a clear "circular template reference" message was rendered somewhere in the tree?', !!selfRefEl);

  console.log('ALL OK');
  process.exit(0);
})();
