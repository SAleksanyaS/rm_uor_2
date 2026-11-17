import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { defaultMeetingConfig } from '../public/meeting-config.js';
import { seedWorkspace } from '../src/seed-workspace.mjs';
import { startServer } from '../src/server.mjs';
import { openWorkspace } from '../src/workspace.mjs';

const seed = fileURLToPath(new URL('../seed/', import.meta.url));

test('the bundled status release reaches clean and existing installs without replacing local work', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'rmuor-status-release-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const release = JSON.parse(await readFile(join(seed, 'status-register.json'), 'utf8'));

  await seedWorkspace(seed, dataDir);
  const local = await openWorkspace({ dataDir });
  const old = await local.statusRegister();
  assert.notEqual(old.source.id, release.id);
  const goalId = local.getState().goals.find(goal => goal.id === 'SW26.1').id;
  await local.execute('dit-status', {
    period: 'Q4 2026', changes: [{ goalId, status: 'Под риском', expectedRevision: null }]
  });
  const previous = await local.execute('theme', { theme: 'dark' });
  const { server, url, workspace } = await startServer({ port: 0, seedDir: seed, dataDir, background: false });
  t.after(() => { server.closeAllConnections(); server.close(); });

  const current = await (await fetch(url + '/api/status-register')).json();
  assert.equal(current.source.id, release.id);
  assert.equal(current.asOf, null);
  assert.deepEqual(current.periods, ['Q4 2026', 'Y26']);
  assert.ok(current.entries.some(entry => entry.fact !== old.entries.find(row => row.id === entry.id)?.fact));
  const state = workspace.getState();
  assert.equal(state.bundledStatusSourceId, release.id);
  assert.equal(state.sources.filter(source => source.id === release.id).length, 1);
  assert.deepEqual(state.ditStatuses, previous.ditStatuses);
  assert.deepEqual(state.profile, previous.profile);
  assert.equal((await workspace.statusRegister(old.source.id)).source.id, old.source.id);

  const config = defaultMeetingConfig({ period: 'Q4 2026', title: 'К встрече' });
  const send = (route, input) => fetch(url + '/api/' + route, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-rmuor': '1' }, body: JSON.stringify(input)
  });
  const previewResponse = await send('meeting-preview', { config });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.ok(preview.report.source.includes(release.name));
  const deck = await send('meeting-pptx', { config, reportId: preview.reportId });
  assert.equal(deck.status, 200);
  assert.match(deck.headers.get('content-type'), /presentationml/);
  assert.equal(Buffer.from(await deck.arrayBuffer()).readUInt32LE(), 0x04034b50);

  const stateBeforeRestart = await readFile(join(dataDir, 'workspace.json'));
  const second = await startServer({ port: 0, seedDir: seed, dataDir, background: false });
  t.after(() => second.server.close());
  assert.deepEqual(await readFile(join(dataDir, 'workspace.json')), stateBeforeRestart);
  assert.equal((await second.workspace.statusRegister()).source.id, release.id);
  const cleanDir = join(dataDir, 'new-install');
  const fresh = await startServer({ port: 0, seedDir: seed, dataDir: cleanDir, background: false });
  t.after(() => fresh.server.close());
  assert.equal((await fresh.workspace.statusRegister()).source.id, release.id);
  assert.deepEqual(fresh.workspace.getState().goals.map(goal => goal.id), state.goals.map(goal => goal.id));
});
