import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMaturityLinks } from '../src/maturity-links.mjs';
import { normalizeMeetingConfig, normalizeMeetingMaturity } from '../public/meeting-config.js';

const directory = [
  { type: 'leader', id: 'a', name: 'А' }, { type: 'leader', id: 'b', name: 'Б' },
  { type: 'team', id: 'a1', name: 'Команда А', aliases: ['Команда Альфа'] },
];
const goals = [{ id: 'SW26.1', assignments: [{ leaderId: 'a', teamIds: ['a1'], teams: ['Тёплый  кластер', 'Общий'] },
  { leaderId: 'b', teams: ['Общий'] }] }, { id: 'OTHER', assignments: [{ leaderId: 'b', teams: ['Похожий кластер'] }] }];
const clusters = ['Теплый кластер', 'Общий', 'Похожий кластер', 'Команда Альфа'].map((name, index) => ({ id: String(index), name }));

test('maturity matching uses exact names from SW26.1, detects collisions and respects overrides', () => {
  const result = resolveMaturityLinks(clusters, goals, directory, []);
  assert.deepEqual(result.map(row => row.leaderId), ['a', '', '', 'a']);
  const overrides = resolveMaturityLinks(clusters, goals, directory, [{ clusterId: '0', leaderId: '' }, { clusterId: '2', leaderId: 'b' }]);
  assert.deepEqual(overrides.map(row => row.leaderId), ['', '', 'b', 'a']);
  assert.equal(overrides[0].proposedLeaderId, 'a');
  assert.equal(overrides[2].method, 'manual');
  const duplicate = resolveMaturityLinks([...clusters, { id: '4', name: 'Теплый кластер', tribe: 'Другой' }], goals, directory, []);
  assert.deepEqual([duplicate[0].proposedLeaderId, duplicate[4].proposedLeaderId], ['', '']);
});

test('older presets gain the inactive section, and date and override keys are validated', () => {
  const config = normalizeMeetingConfig({ sections: [{ id: 'overview', enabled: true }] });
  assert.deepEqual(config.sections.find(row => row.id === 'maturity'), { id: 'maturity', enabled: false });
  assert.throws(() => normalizeMeetingMaturity({ asOf: '2026-02-30' }), /дат/iu);
  assert.throws(() => normalizeMeetingMaturity({ links: [{ clusterId: 'one', leaderId: 'a' }, { clusterId: 'one', leaderId: 'b' }] }), /привяз/iu);
});
