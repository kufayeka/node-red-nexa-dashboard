const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, "..", "dist", "nexa-plugin.html"), 'utf8');
const m = /<script type="text\/javascript">([\s\S]*)<\/script>/.exec(html);
if (!m) throw new Error('script tag not found in nexa-plugin.html');
fs.writeFileSync(path.join(__dirname, '.extracted-editor.js'), m[1], 'utf8');
console.log('Extracted ' + m[1].length + ' bytes to test/.extracted-editor.js');
