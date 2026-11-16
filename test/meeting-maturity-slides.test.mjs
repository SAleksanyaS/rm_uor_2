import assert from 'node:assert/strict';
import test from 'node:test';

const metric = (name, sourceRow, passed, extras = {}) => ({ group: 'Управление', name, sourceRow, passed, ...extras });
const team = (name, sourceRow, reached, metrics) => ({
  name, sourceRow, teamsReached: reached ? 1 : 0, teamsTotal: 1,
  metricsReached: metrics.filter(entry => entry.passed).length,
  metricsTotal: metrics.filter(entry => entry.passed != null).length,
  metrics,
});
const cluster = (id, name, sourceRow, teams) => ({
  id, name, sourceRow,
  teamsReached: teams.reduce((sum, item) => sum + item.teamsReached, 0), teamsTotal: teams.length,
  metricsReached: teams.reduce((sum, item) => sum + item.metricsReached, 0),
  metricsTotal: teams.reduce((sum, item) => sum + item.metricsTotal, 0),
  teams,
});
const alpha = cluster('alpha', 'Кластер А', 10, [
  team('Команда 1', 11, true, [metric('Полнота', 12, true), metric('Надёжность', 13, true)]),
  team('Команда 2', 14, false, [metric('Полнота', 15, false, { reason: 'Неполное покрытие', value: 0, threshold: 80 }), metric('Надёжность', 16, null, { reason: 'В исключениях' })]),
]);
const beta = cluster('beta', 'Кластер Б', 20, [team('Команда 3', 21, true, [metric('Полнота', 22, true)])]);
const register = {
  sheet: 'Зрелость Q4',
  totals: { teamsReached: 2, teamsTotal: 3, metricsReached: 3, metricsTotal: 4 },
  clusters: [alpha, beta],
};

test('reports official aggregate totals, eligible metrics and traceable reasons', async () => {
  const { buildMaturitySlides } = await import('../src/meeting-maturity-slides.mjs');
  const slides = buildMaturitySlides({ register, scopeLabel: 'Весь ДИТ', sourceName: 'Зрелость.xlsx', asOf: '2026-11-16' });
  assert.equal(slides[0].kind, 'summary');
  assert.equal(slides[0].kpis[0].value, '2 из 3');
  assert.equal(slides[0].kpis[1].value, '3 из 4');
  assert.match(slides[0].subtitle, /16\.11\.2026/);
  for (const slide of slides) assert.match(slide.footer, /Зрелость\.xlsx.*Зрелость Q4/);
  const tableRows = slides.filter(slide => slide.kind === 'table').flatMap(slide => slide.rows);
  assert.ok(tableRows.some(row => row[0] === 'Кластер Б' && row.at(-1).includes('20')));
  assert.ok(tableRows.some(row => row.includes('Полнота') && row.includes('2 из 3')));
  assert.ok(tableRows.some(row => row.includes('Надёжность') && row.includes('1 из 1') && row.includes('1')));
  const reason = tableRows.find(row => row.some(value => value.includes('Неполное покрытие')));
  assert.match(reason.join(' '), /0% \/ 80%.*стр\. 15/);
  const gapSlides = slides.filter(slide => slide.title === 'Команды ниже порога');
  assert.doesNotMatch(JSON.stringify(gapSlides), /В исключениях|стр\. 16/);
});

test('limits a leader deck to matched clusters and shows no numbers when matching is missing', async () => {
  const { buildMaturitySlides } = await import('../src/meeting-maturity-slides.mjs');
  const partial = buildMaturitySlides({
    register, scopeLabel: 'ИТ-лидер А', selectedClusters: [alpha], missingClusters: [beta],
    sourceName: 'Зрелость.xlsx', leaderScoped: true,
  });
  assert.equal(partial[0].kpis[0].value, '1 из 2');
  assert.equal(partial[0].kpis[1].value, '2 из 3');
  assert.match(partial[0].subtitle, /не подтверждена/);
  assert.match(partial[0].note, /[Нн]е сопоставлено.*1/);
  assert.doesNotMatch(JSON.stringify(partial), /Кластер Б|Команда 3/);
  const empty = buildMaturitySlides({ register, scopeLabel: 'ИТ-лидер А', selectedClusters: [], leaderScoped: true });
  assert.equal(empty.length, 1);
  assert.deepEqual(empty[0].kpis, []);
  assert.match(empty[0].note, /сопоставлен/u);
});

test('paginates all detail rows for the editable PowerPoint renderer', async () => {
  const { buildMaturitySlides } = await import('../src/meeting-maturity-slides.mjs');
  const { renderMeetingPptx } = await import('../src/meeting-pptx.mjs');
  const metrics = Array.from({ length: 16 }, (_, index) => metric('Показатель ' + index, 31 + index, false, { reason: 'Причина ' + index }));
  const selected = cluster('many', 'Кластер', 29, [team('Команда', 30, false, metrics)]);
  const data = { sheet: 'Зрелость', totals: { teamsReached: 0, teamsTotal: 1, metricsReached: 0, metricsTotal: 16 }, clusters: [selected] };
  const slides = buildMaturitySlides({ register: data, scopeLabel: 'Весь ДИТ', sourceName: 'Зрелость.xlsx' });
  const tables = slides.filter(slide => slide.kind === 'table');
  assert.ok(tables.every(slide => slide.rows.length <= 7 && slide.rows.every(row => row.length === slide.columns.length)));
  assert.equal(tables.flatMap(slide => slide.rows).filter(row => row.some(value => /^Причина \d+$/u.test(value))).length, 16);
  const file = renderMeetingPptx({ title: 'Отчёт ДИТ', slides });
  assert.ok(file.length > 4000);
});
