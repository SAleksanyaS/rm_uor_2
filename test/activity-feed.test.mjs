import assert from 'node:assert/strict';
import test from 'node:test';
import { markActivityRead, readActivity, reconcileActivity, writeActivity } from '../public/activity-feed.js';

test('activity keeps read items read across reloads and does not invent events without a source', () => {
  let stored;
  const storage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  const inputs = {
    state: {
      shared: { history: [{ version: 1, author: 'ИТ', at: '2026-11-15T00:00:00Z' }] },
      riskActions: [{ id: 'a', title: 'Проверить срез', dueOn: '2026-11-16', status: 'open' },
        { id: 'b', dueOn: '2026-11-17', status: 'open' }, { id: 'c', dueOn: '2026-11-15', status: 'done' }]
    },
    browser: { jobs: [{ id: 'j', kind: 'read', connectorId: 'report', state: 'error' }] },
    today: '2026-11-17'
  };
  const items = reconcileActivity(readActivity(storage), inputs);
  assert.deepEqual(items.map(x => x.route).sort(), ['connectors', 'history', 'risk-actions']);
  assert.equal(items.find(x => x.route === 'connectors').at, null);
  writeActivity(storage, markActivityRead(items));
  assert.deepEqual(reconcileActivity(readActivity(storage), inputs), markActivityRead(items));
});
