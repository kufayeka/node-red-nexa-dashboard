// lib/sparkplug/deltaBatcher.js — the editor-bound Sparkplug tree delta
// batcher: merges "data" metrics per device (last value wins), keeps
// birth/death as ordered barriers, one flush per window.
const { createDeltaBatcher } = require('../lib/sparkplug/deltaBatcher.js');

let failures = 0;
function check(label, ok, actual) {
  if (!ok) failures++;
  console.log(label + '?', ok, '(actual: ' + JSON.stringify(actual) + ')');
}
const data = (dev, metrics) => ({ type: 'data', groupId: 'G', edgeNodeId: 'E', deviceId: dev, metrics: metrics.map(([name, value]) => ({ name, value })) });

const flushes = [];
const b = createDeltaBatcher(batch => flushes.push(batch), 30);

for (let i = 1; i <= 100; i++) b.push(data('GP', [['Lantai_1/d', i]]));
b.push(data('GP', [['RuangBlower/MotorCommandON', true]]));
b.push(data('Plant1', [['x', 1]]));
check('nothing flushed synchronously', flushes.length === 0, flushes.length);

setTimeout(() => {
  check('one flush per window', flushes.length === 1, flushes.length);
  const batch = flushes[0] || [];
  check('100 data deltas for one device merged into ONE delta, last value wins, other metric kept',
    batch.length === 2 && JSON.stringify(batch[0].metrics) === JSON.stringify([{ name: 'Lantai_1/d', value: 100 }, { name: 'RuangBlower/MotorCommandON', value: true }]),
    batch.map(d => d.deviceId + ':' + JSON.stringify(d.metrics)));
  check('merged delta serializes without internal bookkeeping fields', !/_pos/.test(JSON.stringify(batch)), JSON.stringify(batch[0]));

  flushes.length = 0;
  b.push(data('GP', [['a', 1]]));
  b.push({ type: 'death', groupId: 'G', edgeNodeId: 'E', deviceId: 'GP' });
  b.push({ type: 'birth', groupId: 'G', edgeNodeId: 'E', deviceId: 'GP', metrics: [{ name: 'a', value: 0 }] });
  b.push(data('GP', [['a', 2]]));
  b.flushNow();
  const seq = (flushes[0] || []).map(d => d.type + (d.metrics ? ':' + d.metrics.map(m => m.value).join(',') : ''));
  check('birth/death are barriers: order kept, data after a barrier not merged into data before it',
    JSON.stringify(seq) === JSON.stringify(['data:1', 'death', 'birth:0', 'data:2']), seq);

  b.stop();
  if (!failures) console.log('ALL OK');
  process.exit(failures ? 1 : 0);
}, 80);
