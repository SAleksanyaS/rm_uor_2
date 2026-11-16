import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.mjs';
import { defaultMeetingConfig } from '../public/meeting-config.js';

test('meeting preview is the authority for download, and template survives backup', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'rm-uor-meeting-'));
  const { url, workspace, server } = await startServer({ dataDir: folder, port: 0, background: false });
  t.after(async () => {
    await new Promise(done => server.close(done));
    await rm(folder, { recursive: true, force: true });
  });
  const catalog = {
    goals: [{ id: 'A', title: 'Цель А', target: '80%', status: 'active' }],
    leaders: {}
  };
  await workspace.importSource('карта.html', Buffer.from('<script id="portal-data" type="application/json">' + JSON.stringify(catalog) + '</script>'));
  const headers = { 'content-type': 'application/json', 'x-rmuor': '1' };
  const send = (route, data, requestHeaders = headers) => fetch(url + '/api/' + route, {
    method: 'POST', headers: requestHeaders, body: JSON.stringify(data)
  });
  const config = defaultMeetingConfig({ period: 'Y26', title: 'К встрече', note: 'Правка только для одного отчёта' });
  assert.equal((await send('meeting-preview', { config }, { ...headers, origin: 'https://example.invalid' })).status, 403);
  const response = await send('meeting-preview', { config });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.match(preview.reportId, /^[a-f0-9]{64}$/);
  assert.match(preview.report.source, /Excel со статусами не выбран/);
  const file = await send('meeting-pptx', { config, reportId: preview.reportId });
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /presentationml/);
  assert.match(file.headers.get('content-disposition'), /\.pptx/);
  assert.equal(Buffer.from(await file.arrayBuffer()).readUInt32LE(), 0x04034b50);
  await workspace.execute('dit-status', {
    period: 'Y26', changes: [{ goalId: 'A', status: 'Под риском', expectedRevision: null }]
  });
  const stale = await send('meeting-pptx', { config, reportId: preview.reportId });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'STALE_VIEW');

  const stored = await send('meeting-template', { config, expectedRevision: null });
  assert.equal(stored.status, 200);
  const template = (await stored.json()).meetingTemplate;
  assert.equal(template.config.title, 'К встрече');
  assert.equal(template.config.period, '');
  assert.equal(template.config.note, '');
  assert.equal((await send('meeting-template', { config, expectedRevision: null })).status, 409);
  const backup = Buffer.from(await (await fetch(url + '/api/backup')).arrayBuffer());
  const restore = await workspace.restoreBackup(backup);
  assert.equal((await workspace.restoreBackup(backup, restore.token)).meetingTemplate.revision, template.revision);
});
