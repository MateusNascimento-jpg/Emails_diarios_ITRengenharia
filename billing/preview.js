'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { EVENTS, eventId } = require('./contract');
const { event, access } = require('./fixtures');
const { render } = require('./template');
const directory = path.join(__dirname, 'previews');
fs.mkdirSync(directory, { recursive: true });
const examples = EVENTS.map(type => ({ type, suffix: '', scheduledFor: '2026-11-10' }));
examples.push({ type: 'BOLETO_OVERDUE_REMINDER', suffix: '_D10', scheduledFor: '2026-11-15' });
examples.push({ type: 'BOLETO_UPDATED', suffix: '_DADOS' });
for (const { type, suffix, scheduledFor } of examples) {
    const p = event(type);
    if (type === 'BOLETO_OVERDUE_REMINDER') { p.scheduledFor = scheduledFor; p.eventId = eventId(p); }
    if (suffix === '_DADOS') { p.previous = { sha256: p.document.sha256, dueDate: '2026-10-30', amountCents: 140000 }; p.eventId = eventId(p); }
    const previewDate = type === 'BOLETO_OVERDUE_REMINDER' ? scheduledFor : type === 'BOLETO_DUE_TODAY' ? '2026-11-05' : '2026-11-04';
    let html = render(p, Date.parse(`${previewDate}T12:00:00Z`), access(p)).html;
    for (const [cid, filename] of [['logoITR', 'logo.png'], ['portalCta', 'portal-cta.png']]) {
        html = html.replace('cid:' + cid, 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', filename)).toString('base64'));
    }
    fs.writeFileSync(path.join(directory, type + suffix + '.html'), html);
}
