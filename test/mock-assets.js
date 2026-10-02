// lib/assets.js — the app's image assets on disk (the Assets tab): no Node-RED, a temp dir.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAssetStore, assetHeaders, cleanSvg, sniff, dimensions, MAX_BYTES } = require('../src/server/assets.js');

let failures = 0;
function check(label, ok, actual) {
  if (!ok) failures++;
  console.log(label + '?', ok, actual !== undefined ? '(actual: ' + JSON.stringify(actual) + ')' : '');
}
function throws(fn) { try { fn(); return null; } catch (e) { return e; } }

// a 3 x 2 PNG header (enough for the type and the size), a GIF, a JPEG with a SOF0, a WEBP (VP8X)
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0])]);
const gif = Buffer.from('GIF89a\x05\x00\x04\x00\x00\x00\x00', 'latin1');
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 30, 3, 1, 1, 1]);
const webp = Buffer.concat([Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8X', 'latin1'), Buffer.alloc(8), Buffer.from([99, 0, 0, 49, 0, 0])]);
const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><path d="M0 0h24v16z" onclick="x()"/></a><foreignObject><iframe src="x"></iframe></foreignObject></svg>');

console.log('--- the type from the bytes, and the size ---');
check('png / gif / jpg / webp / svg sniffed', [png, gif, jpg, webp, svg].map(sniff).join() === 'png,gif,jpg,webp,svg', [png, gif, jpg, webp, svg].map(sniff));
check('text that is not an SVG: not an image', sniff(Buffer.from('<html><script>x</script></html>')) === null);
check('png 3 x 2', JSON.stringify(dimensions(png, 'png')) === '{"w":3,"h":2}', dimensions(png, 'png'));
check('gif 5 x 4', JSON.stringify(dimensions(gif, 'gif')) === '{"w":5,"h":4}', dimensions(gif, 'gif'));
check('jpg 30 x 20', JSON.stringify(dimensions(jpg, 'jpg')) === '{"w":30,"h":20}', dimensions(jpg, 'jpg'));
check('webp 100 x 50', JSON.stringify(dimensions(webp, 'webp')) === '{"w":100,"h":50}', dimensions(webp, 'webp'));
check('svg from its viewBox 24 x 16', JSON.stringify(dimensions(svg, 'svg')) === '{"w":24,"h":16}', dimensions(svg, 'svg'));

console.log('--- an SVG runs nothing ---');
const clean = cleanSvg(svg.toString());
check('no script, handlers, javascript: links, foreignObject', !/script|onload|onclick|javascript:|foreignObject|iframe/i.test(clean), clean);
check('the drawing stays', /<path d="M0 0h24v16z"\/>/.test(clean));

console.log('--- the store ---');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-assets-'));
const store = createAssetStore(dir);
const a = store.add('icons/motor-on', png);
check('imported: a content-named file, its type and size', /^[a-f0-9]{16}\.png$/.test(a.file) && a.type === 'image/png' && a.w === 3 && a.h === 2 && fs.existsSync(path.join(dir, a.file)), a);
const s = store.add('logo', svg);
check('an SVG is stored cleaned', !/script/i.test(fs.readFileSync(path.join(dir, s.file), 'utf8')));
const again = store.add('icons/motor-on', gif);
check('the same name again: the same asset (id), a new file; the old file is removed', again.id === a.id && again.file !== a.file && !fs.existsSync(path.join(dir, a.file)) && store.list().length === 2);
check('rename', store.rename(a.id, 'icons/motor-running').name === 'icons/motor-running');
check('rename to a name that is taken: refused (409)', (throws(() => store.rename(a.id, 'logo')) || {}).status === 409);
check('a bad name: refused (400)', ['../x', '/abs', 'a//b', '', 'x/..'].every((n) => (throws(() => store.add(n, png)) || {}).status === 400));
check('not an image: refused (415)', (throws(() => store.add('x', Buffer.from('hello'))) || {}).status === 415);
check('empty: refused (400)', (throws(() => store.add('x', Buffer.alloc(0))) || {}).status === 400);
check('over 10 MB: refused (413)', (throws(() => store.add('big', Buffer.concat([png, Buffer.alloc(MAX_BYTES)]))) || {}).status === 413);
check('filePath only for stored file names (no traversal)', store.filePath(s.file) === path.join(dir, s.file) && store.filePath('../assets.json') === null && store.filePath('assets.json') === null);
const removed = store.remove(s.id);
check('remove: gone from the list and its file deleted', removed.name === 'logo' && store.list().length === 1 && !fs.existsSync(path.join(dir, s.file)));
check('headers: cached forever; an SVG with a CSP that runs nothing', assetHeaders('0123456789abcdef.svg')['Cache-Control'].indexOf('immutable') !== -1 && /default-src 'none'/.test(assetHeaders('0123456789abcdef.svg')['Content-Security-Policy']) && !assetHeaders('0123456789abcdef.png')['Content-Security-Policy']);
fs.rmSync(dir, { recursive: true, force: true });

if (!failures) console.log('ALL OK');
process.exit(failures ? 1 : 0);
