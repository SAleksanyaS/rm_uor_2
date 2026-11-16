const formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 });
const percent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, style: 'percent' });
const totalFields = ['teamsReached', 'teamsTotal', 'metricsReached', 'metricsTotal'];

const clusterColumns = [
  { label: 'Кластер', width: 3.1 }, { label: 'Команды в цели', width: 1.8 },
  { label: 'Метрики выполнены', width: 1.8 }, { label: 'Источник', width: 1.1 },
];
const metricColumns = [
  { label: 'Метрика', width: 3.1 }, { label: 'Группа', width: 2 },
  { label: 'Выполнено из оценённых', width: 1.8 }, { label: 'Не выполнено', width: 1.2 },
  { label: 'Без оценки', width: 1.1 },
];
const gapColumns = [
  { label: 'Команда и кластер', width: 2.4 }, { label: 'Метрика', width: 2.2 },
  { label: 'Факт / порог', width: 1.2 }, { label: 'Причина', width: 2.4 }, { label: 'Источник', width: 1.1 },
];

function valueText(value) {
  if (value == null || value === '') return '—';
  return typeof value === 'number' ? formatter.format(value) : String(value);
}

function ratio(numerator, denominator, showPercent = false) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) return '—';
  const counts = formatter.format(numerator) + ' из ' + formatter.format(denominator);
  return showPercent ? counts + ' · ' + percent.format(numerator / denominator) : counts;
}

function metricPercent(value) {
  return typeof value === 'number' ? formatter.format(value) + '%' : valueText(value);
}

function rowOrigin(row) {
  return Number.isSafeInteger(row) && row > 0 ? 'стр. ' + row : '—';
}

function tableSlides(title, subtitle, footer, columns, rows) {
  const widths = columns.map(column => column.width);
  const weightSum = widths.reduce((sum, width) => sum + width, 0);
  const groups = [];
  let page = [];
  let lines = 0;
  for (const row of rows) {
    const cost = Math.max(2, ...row.map((cell, i) => cell.split('\n').reduce((count, line) =>
      count + Math.max(1, Math.ceil(line.length / (113 * widths[i] / weightSum))), 0)));
    if (page.length && (page.length === 7 || lines + cost > 23)) {
      groups.push(page);
      page = [];
      lines = 0;
    }
    page.push(row);
    lines += cost;
  }
  if (page.length) groups.push(page);
  return groups.map((rows, index) => ({
    kind: 'table', title, subtitle: [subtitle, groups.length > 1 && `${index + 1} / ${groups.length}`].filter(Boolean).join(' · '),
    footer, columns, rows,
  }));
}

function selectedRegisterClusters(register, selectedClusters, leaderScoped) {
  if (!leaderScoped) return register.clusters;
  const ids = new Set((selectedClusters ?? []).map(cluster => cluster.id));
  return register.clusters.filter(cluster => ids.has(cluster.id));
}

function sumTotals(clusters) {
  return Object.fromEntries(totalFields.map(field => [field, clusters.reduce((sum, cluster) => sum + cluster[field], 0)]));
}

function metricRows(clusters) {
  const grouped = new Map();
  for (const cluster of clusters) {
    for (const team of cluster.teams) {
      for (const metric of team.metrics) {
        const key = JSON.stringify([metric.group ?? '', metric.name]);
        if (!grouped.has(key)) grouped.set(key, { name: metric.name, group: metric.group, reached: 0, missed: 0, unknown: 0 });
        const summary = grouped.get(key);
        if (metric.passed === true) summary.reached++;
        else if (metric.passed === false) summary.missed++;
        else summary.unknown++;
      }
    }
  }
  return [...grouped.values()].sort((left, right) =>
    right.missed - left.missed || right.unknown - left.unknown || left.name.localeCompare(right.name, 'ru'))
    .map(metric => [
      valueText(metric.name), valueText(metric.group), ratio(metric.reached, metric.reached + metric.missed),
      formatter.format(metric.missed), formatter.format(metric.unknown),
    ]);
}

function gapRows(clusters) {
  return clusters.flatMap(cluster => cluster.teams
    .filter(team => team.teamsTotal > team.teamsReached)
    .flatMap(team => {
      const label = valueText(team.name) + '\n' + valueText(cluster.name);
      const misses = team.metrics.filter(metric => metric.passed === false);
      if (!misses.length) return [[label, '—', '—', 'Причина не указана в строках метрик', rowOrigin(team.sourceRow)]];
      return misses.map(metric => [
        label, valueText(metric.name), metricPercent(metric.value) + ' / ' + metricPercent(metric.threshold),
        metric.reason ? String(metric.reason) : 'Порог метрики не достигнут',
        rowOrigin(metric.sourceRow),
      ]);
    }));
}

export function buildMaturitySlides({ register, scopeLabel, selectedClusters, missingClusters, automaticClusters = 0,
  sourceName, asOf, leaderScoped = false }) {
  const clusters = selectedRegisterClusters(register, selectedClusters, leaderScoped);
  const countMissing = Array.isArray(missingClusters) ? missingClusters.length : Number.isSafeInteger(missingClusters) ? missingClusters : 0;
  const date = asOf ? 'Срез от ' + asOf.split('-').reverse().join('.') : 'Дата среза не подтверждена';
  const context = [scopeLabel, date].filter(Boolean).join(' · ');
  const footer = [sourceName, register.sheet && 'Лист «' + register.sheet + '»', date].filter(Boolean).join(' · ');
  const summary = { kind: 'summary', title: 'Модель зрелости', subtitle: context, footer };
  const mappingNote = countMissing > 0 ? 'Не сопоставлено кластеров источника: ' + formatter.format(countMissing) + '.' : '';
  if (leaderScoped && !clusters.length) {
    return [{ ...summary, kpis: [], note: ['Для выбранного ИТ-лидера нет сопоставленных кластеров.', mappingNote].filter(Boolean).join(' ') }];
  }

  const totals = leaderScoped ? sumTotals(clusters) : register.totals;
  const gaps = gapRows(clusters);
  const scopeNote = leaderScoped
    ? 'Кластеры в отчёте: ' + formatter.format(clusters.length) + (automaticClusters ? ', по совпадению с картой: ' + formatter.format(automaticClusters) : '') + '.'
    : 'Итог охватывает всю книгу.';
  const summaryNote = [scopeNote, mappingNote, totals.teamsTotal > 0 && !gaps.length && 'В этом охвате нет команд ниже порога.'].filter(Boolean).join(' ');
  return [
    { ...summary, kpis: [
      { label: 'Команды в цели', value: ratio(totals.teamsReached, totals.teamsTotal), tone: 'positive' },
      { label: 'Метрики выполнены', value: ratio(totals.metricsReached, totals.metricsTotal), tone: 'neutral' },
    ], note: summaryNote },
    ...tableSlides('Модель зрелости по кластерам', context, footer, clusterColumns, clusters.map(cluster => [
      [valueText(cluster.name), cluster.tribe].filter(Boolean).join('\n'),
      ratio(cluster.teamsReached, cluster.teamsTotal, true),
      ratio(cluster.metricsReached, cluster.metricsTotal, true), rowOrigin(cluster.sourceRow),
    ])),
    ...tableSlides('Метрики модели зрелости', [scopeLabel, 'Расчёт по строкам метрик команд'].filter(Boolean).join(' · '), footer,
      metricColumns, metricRows(clusters)),
    ...tableSlides('Команды ниже порога', context, footer, gapColumns, gaps),
  ];
}
