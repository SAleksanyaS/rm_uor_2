import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceHealth } from '../src/workspace-health.mjs';

test('workspace diagnostics retain the last successful report when a later read fails', async () => {
  const collectedAt = '2026-11-16T08:00:00Z';
  const checkedAt = '2026-11-16T10:00:00Z';
  const health = await createWorkspaceHealth({
    state: {
      appVersion: '0.1.0', goals: [{}],
      profile: { remote: 'https://example.invalid/work.git' }, shared: { checkedAt, version: 2 }
    },
    readRegister: async () => ({ source: { name: 'Статусы.xlsx' }, periods: ['Y26'], asOf: null }),
    readBrowser: async () => ({
      connectors: [{ id: 'a' }], reports: [{ collectedAt }],
      jobs: [{ connectorId: 'a', kind: 'read', state: 'error', finishedAt: checkedAt, message: 'Операция прервалась.' }]
    }),
    checkGit: async () => { throw new Error('git unavailable'); }
  });
  const checks = Object.fromEntries(health.checks.map(check => [check.id, check]));
  assert.equal(checks.register.status, 'warning');
  assert.equal(checks['git-executable'].status, 'warning');
  assert.equal(checks['git-sync'].action, 'activity-git-refresh');
  assert.equal(checks['git-sync'].at, checkedAt);
  assert.equal(checks.read.status, 'error');
  assert.equal(checks.read.lastSuccessAt, collectedAt);
  assert.equal(checks.collect.status, 'neutral');
});
