import assert from 'node:assert/strict';
import test from 'node:test';

const anchor = {
  goalId: 'SW26.1', scopeId: 'leader-west', period: 'Q4 2026', snapshotId: 'a'.repeat(64), week: '2026-11-16',
};
const fields = {
  ...anchor, title: 'Уточнить охват', owner: 'Куратор УОР', dueOn: '2026-11-20',
  nextAction: 'Сверить две выгрузки', status: 'open',
};
const initial = { author: 'Редактор', now: '2026-11-16T10:00:00.000Z' };
const later = { author: 'Второй редактор', now: '2026-11-17T10:00:00.000Z' };

test('creates and edits a local action with stable anchor and optimistic revisions', async () => {
  const { saveRiskAction } = await import('../src/risk-actions.mjs');
  const [first] = saveRiskAction([], fields, initial);
  assert.deepEqual({ ...first, id: null, revision: null }, {
    ...fields, id: null, revision: null, createdBy: initial.author, updatedBy: initial.author,
    createdAt: initial.now, updatedAt: initial.now,
  });
  const original = Object.freeze([Object.freeze(first)]);
  const [edited] = saveRiskAction(original, {
    ...fields, id: first.id, expectedRevision: first.revision, status: 'in-progress', nextAction: 'Подтвердить состав команд',
  }, later);
  assert.equal(edited.id, first.id);
  assert.notEqual(edited.revision, first.revision);
  assert.equal(edited.createdAt, initial.now);
  assert.equal(edited.createdBy, initial.author);
  assert.equal(edited.updatedAt, later.now);
  assert.equal(edited.updatedBy, later.author);
  assert.equal(edited.status, 'in-progress');
  assert.equal(original[0].nextAction, 'Сверить две выгрузки');
  assert.throws(() => saveRiskAction([edited], {
    ...fields, id: first.id, expectedRevision: first.revision,
  }, later), { code: 'CONFLICT', status: 409 });
  assert.throws(() => saveRiskAction([edited], {
    ...fields, id: first.id, expectedRevision: edited.revision, scopeId: 'another-leader',
  }, later), { code: 'CONFLICT', status: 409 });
});

test('rejects unsupported states, bad dates and unbound update revisions', async () => {
  const { saveRiskAction } = await import('../src/risk-actions.mjs');
  for (const invalid of [
    { dueOn: '2026-02-29' }, { week: '2026-13-15' }, { status: 'sent' },
    { title: '' }, { owner: '' }, { nextAction: '' }, { scopeId: '' },
  ]) {
    assert.throws(() => saveRiskAction([], { ...fields, ...invalid }, initial), { code: 'INVALID', status: 400 });
  }
  const [withoutSnapshot] = saveRiskAction([], { ...fields, snapshotId: '', week: '' }, initial);
  assert.equal(withoutSnapshot.snapshotId, null);
  assert.equal(withoutSnapshot.week, null);
  assert.throws(() => saveRiskAction([], { ...fields, expectedRevision: withoutSnapshot.revision }, initial), { code: 'CONFLICT' });
  assert.throws(() => saveRiskAction([], { ...fields, id: withoutSnapshot.id, expectedRevision: withoutSnapshot.revision }, initial), { code: 'NOT_FOUND' });
});

test('constructs a stable provider request without credentials or local implementation fields', async () => {
  const { saveRiskAction, riskTaskRequest } = await import('../src/risk-actions.mjs');
  const [action] = saveRiskAction([], fields, initial);
  assert.deepEqual(riskTaskRequest({ ...action, credentials: { password: 'excluded' } }), {
    operationId: action.id, title: fields.title, owner: fields.owner, dueOn: fields.dueOn,
    nextAction: fields.nextAction, anchor,
  });
});

test('renders escaped action anchors and edit fields for the existing application dialog', async () => {
  const { renderRiskActionDialog, renderRiskActions, renderRiskActionCreateButton } = await import('../public/risk-actions-view.js');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const helpers = { escape, dateText: value => value };
  const action = { ...fields, title: '<caption>', id: 'test-id', revision: 'test-revision' };
  const dialog = renderRiskActionDialog({ action, anchor: { ...anchor, goalTitle: '<goal>' } }, helpers);
  assert.match(dialog, /id="risk-action-form"/);
  assert.match(dialog, /name="expectedRevision" value="test-revision"/);
  assert.match(dialog, /&lt;caption&gt;/);
  assert.doesNotMatch(dialog, /<goal>|<caption>/);
  const list = renderRiskActions([action], helpers);
  assert.match(list, /&lt;caption&gt;/);
  assert.doesNotMatch(list, /risk-action-edit/);
  assert.match(renderRiskActions([action], helpers, { editable: true }), /data-action="risk-action-edit"/);
  assert.match(renderRiskActionCreateButton(anchor, helpers), /data-goal="SW26.1".*data-scope="leader-west"/);
});
