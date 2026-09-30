'use strict';
// Deep debug: patch runtime to log paramState during component template populate
const path = require('path');
const fs   = require('fs');
const { withPage, startServer } = require('../sdk/testkit');

async function main() {
    const server = await startServer({ mounts: { '/lib': path.join(__dirname, '..', 'lib'), '/fx': path.join(__dirname, 'fixtures') } });
    try {
        const r = await withPage(server.url + '/fx/runtime-component-template.html', async ({ js, send, logs }) => {
            const wait = (ms) => js(`new Promise(function(r){ setTimeout(r,${ms}); })`);
            for (let i = 0; i < 40 && !(await js('!!window.__ctx && !!window.__ctx["ctl"]')); i++) await wait(100);

            // Emit and capture detailed debug
            const debugInfo = await js(`(function(){
                var log = [];
                // Patch resolveBindableValue to log calls
                var origRBV = null;
                // We can't easily patch internal functions, but let's inspect paramStates
                var ctx = window.__ctx["ctl"];
                if(!ctx) return { error: "no ctx" };
                
                // Emit
                ctx.emit("populate", [{id:1, name:"TestItem"}, {id:2, name:"AnotherItem"}]);
                return new Promise(function(resolve){
                    setTimeout(function(){
                        // Check paramStates stored on screen
                        var artboard = document.getElementById("nexa-runtime-artboard");
                        var screen = artboard && artboard.__nexaScreen;
                        var paramStates = screen && screen.__paramStates;
                        
                        // Get the component index
                        var comps = screen && screen.components;
                        var comp1 = comps && comps.filter(function(c){ return c.id === "list#1::lbl"; })[0];
                        
                        resolve({
                            hasScreen: !!screen,
                            paramStatesKeys: paramStates ? Object.keys(paramStates) : [],
                            ps_list1: paramStates && paramStates["list#1"] ? 
                                JSON.stringify(Object.getOwnPropertyNames(paramStates["list#1"])) : null,
                            ps_list1_row: paramStates && paramStates["list#1"] ? 
                                JSON.stringify(paramStates["list#1"]["row"]) : null,
                            comp1: comp1 ? {id: comp1.id, props: comp1.props, paramState: comp1.__paramState ? Object.getOwnPropertyNames(comp1.__paramState) : null} : null,
                            list1el_text: (document.querySelector('[data-id="list#1"]') || {}).textContent
                        });
                    }, 200);
                });
            })()`);
            console.log('debugInfo:', JSON.stringify(debugInfo, null, 2));

            const ss = await send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(path.join(__dirname, '..', 'debug-component-template-3.png'), Buffer.from(ss.result.data, 'base64'));
            console.log('screenshot: debug-component-template-3.png');
            console.log('logs:', JSON.stringify(logs));
            return true;
        }, { width: 800, height: 600, ready: '!!window.__ctx && !!window.__ctx["ctl"]', readyTries: 60 });
    } finally {
        await server.close();
    }
}
main().catch(console.error).then(() => process.exit(0));
