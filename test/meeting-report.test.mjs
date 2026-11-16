import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMeetingConfig, normalizeMeetingConfig } from '../public/meeting-config.js';
import { buildMeetingReport } from '../src/meeting-report.mjs';

const period = 'Y26';
const goals = [
  { id: 'A', title: 'Нулевая метрика', target: '80%', status: 'active', assignments: [{ leaderId: 'one' }] },
  { id: 'B', title: 'Другая цель', target: '10', status: 'active', assignments: [{ leaderId: 'two' }] },
  { id: 'X', title: 'Исключённая', status: 'monitor', assignments: [{ leaderId: 'one' }] },
];
const state = {
  goals, directory: [{ id: 'one', name: 'Анна', type: 'leader' }, { id: 'two', name: 'Борис', type: 'leader' }],
  ditStatuses: [{ goalId: 'A', period, status: 'Выполнено', measurement: { fact: 0, plan: 80, asOf: '2026-11-06', unit: '%' } }],
  ditExcluded: [{ goalId: 'B', period }],
};
const register = {
  periods: [period], asOf: '2026-11-06', sheet: 'Реестр', source: { id: 'source', name: 'Прогноз.xlsx' },
  entries: [{ period, goalId: 'A', scopeId: 'one', status: 'Под риском', plan: 80, fact: 0, linkState: 'confirmed', sourceRow: 20 }]
};

test('company scope keeps DIT goals and leader risk separate and includes the complete appendix', () => {
  const report = buildMeetingReport({ config: defaultMeetingConfig({ period }), state, register });
  const summary = report.slides.find(slide => slide.kind === 'summary');
  assert.match(JSON.stringify(summary), /Выполнено.*1 из 1/);
  assert.match(JSON.stringify(summary), /06\.11\.2026/);
  const risk = report.slides.find(slide => slide.section === 'risks');
  assert.match(risk.rows[0][0], /Анна/);
  const appendix = report.slides.filter(slide => slide.section === 'appendix').flatMap(slide => slide.rows);
  assert.equal(appendix.length, goals.length);
  assert.match(appendix.find(row => row[0].includes('Нулевая'))[3], /0%/);
  assert.equal(appendix.filter(row => row[1] === 'Не оценивается').length, 2);
  assert.deepEqual(report.slides.find(slide => slide.kind === 'bars').groups.map(group => group.label), ['Анна', 'Борис']);
});

test('one leader never receives other leaders’ goals, supports unknown statuses and custom order', () => {
  const config = defaultMeetingConfig({ period, leaderId: 'one', title: 'Доклад' });
  config.sections = [...config.sections].reverse();
  const report = buildMeetingReport({ config, state, register: null });
  assert.equal(report.title, 'Доклад');
  assert.equal(report.slides[0].section, 'appendix');
  assert.doesNotMatch(JSON.stringify(report), /Борис|Другая цель/);
  assert.match(JSON.stringify(report), /Нет статуса/);
  assert.ok(report.slides.every(slide => (slide.rows?.length ?? 0) <= 8));
});

test('validates layout, rejects mismatched leader, and never adds an empty comparison', () => {
  assert.throws(() => normalizeMeetingConfig({ period: 'Last week' }), /период/iu);
  assert.throws(() => normalizeMeetingConfig({ sections: [{ id: 'bad', enabled: true }] }), /раздел/iu);
  assert.throws(() => buildMeetingReport({ config: defaultMeetingConfig({ period, leaderId: 'missing' }), state, register }), /лидер/iu);
  const report = buildMeetingReport({ config: defaultMeetingConfig({ period }), state, register });
  assert.ok(!report.slides.some(slide => slide.section === 'comparison'));
});
