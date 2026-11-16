import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderRestoreControl, renderRestorePreview } from '../public/restore-view.js';
import { parseWorkspaceBackup, workspaceRestoreToken } from '../src/workspace-restore.mjs';

const seedDirectory = new URL('../seed/', import.meta.url);
const seed = JSON.parse(await readFile(new URL('workspace.json', seedDirectory), 'utf8'));
const originals = await Promise.all(seed.sources.map(async ({ id }) => ({ id,
  base64: (await readFile(new URL(`sources/${id}`, seedDirectory))).toString('base64')
})));

function backup(edit = () => {}) {
  const payload = { format: 'rm-uor-workspace-v1', exportedAt: '2026-11-16T10:00:00.000Z',
    workspace: structuredClone(seed), originals: structuredClone(originals) };
  edit(payload);
  return Buffer.from(JSON.stringify(payload));
}

test('checks every original and retains the full business workspace', () => {
  const bytes = backup();
  const restored = parseWorkspaceBackup(bytes);
  assert.equal(restored.digest, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(restored.summary.goals, 30);
  assert.equal(restored.summary.sources, 2);
  assert.equal(restored.workspace.catalogSourceId, seed.catalogSourceId);
  assert.deepEqual(restored.workspace.catalog, seed.catalog);
  assert.deepEqual(restored.workspace.drafts, seed.drafts);
  for (const { id, bytes: original } of restored.originals) {
    assert.equal(createHash('sha256').update(original).digest('hex'), id);
  }
});

test('preserves legacy map and DIT data and keeps orphaned overlays', () => {
  const row = { goalId: 'gone', period: 'Q4 2026', status: 'В плане', revision: 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12) };
  const restored = parseWorkspaceBackup(backup(({ workspace }) => {
    delete workspace.profile.gitExecutable;
    delete workspace.profile.gitAuth;
    delete workspace.catalogSourceId;
    delete workspace.ditDrafts;
    workspace.ditStatuses = [row];
    workspace.qualityReports = [{ id: 'one' }];
    workspace.riskActions = [];
    workspace.ditTimeline = [];
  }));
  assert.deepEqual(restored.workspace.ditStatuses, [row]);
  assert.equal(restored.summary.ditStatuses, 1);
  assert.deepEqual(restored.workspace.qualityReports, [{ id: 'one' }]);
});

test('rejects changed, absent, extra, repeated, or path-like originals', () => {
  const edit = [
    data => { data.originals[0].base64 = Buffer.alloc(seed.sources[0].size).toString('base64'); },
    data => { data.originals[0].base64 += '\n'; },
    data => { data.originals.pop(); },
    data => { data.originals.push({ id: 'a'.repeat(64), base64: 'YQ==' }); },
    data => { data.originals[0].id = data.originals[1].id; },
    data => { data.originals[0].id = '../workspace.json'; },
    data => { data.workspace.sources[0].size++; },
  ];
  for (const mutation of edit) assert.throws(() => parseWorkspaceBackup(backup(mutation)), { code: 'INVALID_BACKUP' });
});

test('rejects broken business references and state that could poison later operations', () => {
  const invalid = [
    data => { data.workspace.catalogSourceId = data.workspace.sources.find(source => source.type === 'xlsx').id; },
    data => { data.workspace.catalog[0].assignments = [null]; },
    data => { data.workspace.directory.push(data.workspace.directory[0]); },
    data => { data.workspace.statusDates = { ['a'.repeat(64)]: { asOf: '2026-01-01' } }; },
    data => { data.workspace.drafts = { SW26: [null] }; },
    data => { data.workspace.visualization = { cards: [null] }; },
    data => { data.workspace.profile.remote = 'https://secret@example.test/data.git'; },
    data => { data.workspace.browser = { profiles: {} }; },
    data => { data.workspace.runs = JSON.parse('{"__proto__":{}}'); },
  ];
  for (const mutation of invalid) assert.throws(() => parseWorkspaceBackup(backup(mutation)), { code: 'INVALID_BACKUP' });
});

test('binds preview to both the file bytes and the exact local state', () => {
  const { digest } = parseWorkspaceBackup(backup());
  const token = workspaceRestoreToken(digest, seed);
  assert.match(token, /^[a-f0-9]{64}$/u);
  assert.equal(workspaceRestoreToken(digest, structuredClone(seed)), token);
  assert.notEqual(workspaceRestoreToken(digest, { ...seed, profile: { ...seed.profile, theme: 'dark' } }), token);
  assert.notEqual(workspaceRestoreToken('a'.repeat(64), seed), token);
});

test('shows the reviewed sizes and requires explicit confirmation of replacement', () => {
  const { digest, summary } = parseWorkspaceBackup(backup());
  const token = workspaceRestoreToken(digest, seed);
  const html = renderRestorePreview({ token, summary, connectionPending: true }, {
    escape: value => String(value), dateText: () => '16.11.2026'
  });
  assert.match(renderRestoreControl(), /id="workspace-restore-file" type="file"/u);
  assert.match(html, /16\.11\.2026/u);
  assert.match(html, /<dt>Цели<\/dt><dd>30<\/dd>/u);
  assert.match(html, new RegExp('id="restore-confirm-form"[^>]+data-token="' + token + '"'));
  assert.match(html, /Заменить данные копией/u);
  assert.match(html, /Профиль и Git/u);
});
