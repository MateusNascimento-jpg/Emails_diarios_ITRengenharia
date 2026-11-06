'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { access, password, scenarios } = require('./fixtures');
const { render } = require('./template');
const directory = path.join(__dirname, 'previews');
function embed(html) {
    for (const [cid, filename] of [['logoITR', 'logo.png'], ['portalCta', 'portal-cta.png']]) {
        html = html.replace('cid:' + cid, 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', filename)).toString('base64'));
    }
    return html;
}
if (require.main === module) {
    fs.mkdirSync(directory, { recursive: true });
    for (const { preview, event, now } of scenarios()) fs.writeFileSync(path.join(directory, preview + '.html'), embed(render(event, now, access(event), null, password).html));
}
module.exports = { embed };
