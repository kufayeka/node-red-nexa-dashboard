'use strict';

// URL -> screen (src/model/routes.js): what the screen worker serves and what the page
// navigates to, without a server or a browser.
//   node test/model-routes.test.js

const path = require('path');
const esbuild = require('esbuild');
const out = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'model', 'index.js')], bundle: true, format: 'cjs', platform: 'neutral', write: false });
const m = { exports: {} };
new Function('module', 'exports', out.outputFiles[0].text)(m, m.exports);
const R = m.exports;

let failures = 0;
function check(label, ok, actual) {
    if (!ok) failures++;
    console.log(label + '?', !!ok, '(actual: ' + JSON.stringify(actual) + ')');
}

const screens = [
    { id: 'home', name: 'Home', path: '/home', logic: { nodes: [{ id: 'g', type: 'navigate', screenId: 'detail' }] } },
    { id: 'detail', name: 'Detail', path: '/line/:id' },
    { id: 'oops', name: 'Oops', path: '/oops' },
    { id: 'secret', name: 'Secret', path: '/secret' },
    { id: 'off', name: 'Off', path: '/off', disabled: true }
];
const flow = {
    id: 'f1', name: 'Plant', endpoint: 'plant', isDefault: true,
    logic: {
        nodes: [
            { id: 'rt', type: 'route-trigger' }, { id: 'rs', type: 'render-screen', screenId: 'home' },
            { id: 'nf', type: 'route-not-found' }, { id: 'rs2', type: 'render-screen', screenId: 'oops' }
        ],
        wires: [{ from: 'rt', to: 'rs' }, { from: 'nf', to: 'rs2' }]
    }
};
// written the old way (config flat on the node), migrated like the screen worker does
const project = R.migrateProject({ screens, flows: [flow, { id: 'f2', endpoint: '', logic: { nodes: [] } }] });

check('matchScreenPath with a param', JSON.stringify(R.matchScreenPath('/line/:id', '/line/7%20A')) === '{"id":"7 A"}', R.matchScreenPath('/line/:id', '/line/7%20A'));
check('matchScreenPath: no match', R.matchScreenPath('/a/b', '/a') === null, null);
check('flowScreenIds: Render Screen + the Goto Screen they reach', JSON.stringify(R.flowScreenIds(flow, screens)) === '["home","detail","oops"]', R.flowScreenIds(flow, screens));
check('migrated: the config is in node.props', flow.logic.nodes[1].props.screenId === 'home' && flow.logic.nodes[1].screenId === undefined, flow.logic.nodes[1]);
check('flowEndpoint: "plant" -> "/plant", empty -> "/flow<n>"', R.flowEndpoint(flow, 0) === '/plant' && R.flowEndpoint({ endpoint: '' }, 1) === '/flow2', null);

let r = R.resolveScreenRoute(project, '/', { search: '?line=2' });
check('"/" redirects to the default flow, keeping the query', r.kind === 'redirect' && r.location === '/nexa/plant?line=2', r);
r = R.resolveScreenRoute(project, '/plant');
check('the flow endpoint: the screen after its Route Trigger', r.kind === 'screen' && r.screen.id === 'home' && r.flow.id === 'f1', r.screen && r.screen.id);
r = R.resolveScreenRoute(project, '/plant/line/42');
check('a screen under the flow, with its params', r.kind === 'screen' && r.screen.id === 'detail' && r.params.id === '42', r.params);
r = R.resolveScreenRoute(project, '/plant/secret');
check('a screen the flow does not name: 404 "not accessible"', r.kind === 'not-found' && /not accessible/.test(r.text), r.text);
r = R.resolveScreenRoute(project, '/plant/nothing-here');
check('an unknown sub-path: the Route Not Found screen, with the path', r.kind === 'screen' && r.screen.id === 'oops' && r.params.notFound === true && r.params.path === '/nothing-here', r.params);
r = R.resolveScreenRoute(project, '/flow2');
check('a flow with no screens: 404 that says so', r.kind === 'not-found' && /No accessible screens/.test(r.text), r.text);
r = R.resolveScreenRoute(project, '/home');
check('a screen path without its flow: 404 (flows are the gateway)', r.kind === 'not-found' && /Direct screen access is disabled/.test(r.text), r.text);

const fanOut = R.migrateProject({ flows: [{ id: 'f', endpoint: '/x', logic: { nodes: [{ id: 'rt', type: 'route-trigger' }, { id: 'a', type: 'render-screen', screenId: 'home' }, { id: 'b', type: 'render-screen', screenId: 'oops' }], wires: [{ from: 'rt', to: 'a' }, { from: 'rt', to: 'b' }] } }], screens });
r = R.resolveScreenRoute(fanOut, '/x');
check('a Route Trigger wired to two Render Screens: the first, with a warning', r.kind === 'screen' && r.screen.id === 'home' && r.warnings.length === 1, r.warnings);

const legacy = { screens, flows: [] };
r = R.resolveScreenRoute(legacy, '/line/9');
check('no flows: a screen by its own path', r.kind === 'screen' && r.screen.id === 'detail' && r.params.id === '9' && r.flow === null, r.params);
r = R.resolveScreenRoute(legacy, '/off');
check('no flows: a disabled screen is 404', r.kind === 'not-found' && /disabled/.test(r.text), r.text);

if (!failures) console.log('ALL OK');
process.exit(failures ? 1 : 0);
