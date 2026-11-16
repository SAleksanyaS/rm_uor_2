import { createHash } from 'node:crypto';
import { projectDitGoalStatuses, projectGoalStatuses } from '../public/goal-status.js';
import { isMeetingPeriod, normalizeMeetingConfig } from '../public/meeting-config.js';

const rangeColumns = [
  { label: 'Цель', width: 3.4 }, { label: 'Статус', width: 1.4 }, { label: 'План', width: 1 },
  { label: 'Факт', width: 1 }, { label: 'Данные и источник', width: 2 },
];
const states = new Map([
  ['Выполнено', 'positive'], ['Под риском', 'risk'], ['В плане', 'neutral'],
  ['Не выполнено', 'negative'], ['Нет методики', 'muted'], ['Нет статуса', 'muted'],
]);
const formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 6 });
const present = value => value != null && value !== '';
const valueText = (value, unit) => present(value)
  ? (typeof value === 'number' ? formatter.format(value) : String(value)) + (unit ? (unit === '%' ? '%' : ' ' + unit) : '') : '—';
const entryKey = entry => JSON.stringify([entry.goalId, entry.scopeId]);
const status = entry => entry?.status || 'Нет статуса';
const day = value => value ? value.split('-').reverse().join('.') : '';
const text = value => String(value ?? '').replace(/\s+/gu, ' ').trim();

function pages(items, limit) {
  return Array.from({ length: Math.ceil(items.length / limit) }, (_, index) => items.slice(index * limit, (index + 1) * limit));
}

function asTable(title, columns, rows, subtitle, emptyNote = '') {
  if (!rows.length) return emptyNote ? [{ kind: 'table', title, columns, rows: [], subtitle, note: emptyNote }] : [];
  const weights = columns.map(column => column.width ?? 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const groups = [];
  let page = [];
  let used = 0;
  for (const row of rows) {
    const cost = Math.max(2, ...row.map((value, index) => String(value).split('\n')
      .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / (105 * weights[index] / total))), 0)));
    if (page.length && (page.length === 7 || used + cost > 24)) {
      groups.push(page);
      page = [];
      used = 0;
    }
    page.push(row);
    used += cost;
  }
  groups.push(page);
  return groups.map((page, index) => ({ kind: 'table', title,
    subtitle: [subtitle, groups.length > 1 ? (index + 1) + ' / ' + groups.length : ''].filter(Boolean).join(' · '),
    columns, rows: page }));
}

function cells(entry) {
  if (entry.scopeId === 'dit') return [valueText(entry.plan, entry.unit), valueText(entry.fact, entry.unit)];
  if (entry.rows.length > 1) return [entry.rows.length + ' КР', 'См. строки Excel'];
  return [valueText(entry.rows[0]?.plan), valueText(entry.rows[0]?.fact)];
}

function evidence(entry, register) {
  const lines = entry.rows.map(row => row.sourceRow).filter(Number.isInteger);
  const origin = entry.measurement?.origin;
  const dated = entry.factDate ? 'факт от ' + day(entry.factDate) : '';
  if (entry.scopeId === 'dit') {
    const reference = origin ? [origin.name || origin.reference, dated].filter(Boolean).join(' · ') : dated;
    const total = entry.statusSourceId || (!entry.measurement && entry.rows.some(row => row.scopeId === 'dit'));
    return [reference, total && lines.length ? 'Excel, стр. ' + lines.join(', ') : '', !reference && !total ? entry.basis : '']
      .filter(Boolean).join(' · ') || '—';
  }
  return lines.length ? [register?.sheet ? 'Excel' : '', 'стр. ' + lines.join(', '),
    entry.preliminary ? 'предв.' : ''].filter(Boolean).join(' · ') : '—';
}

function tableRow(entry, register) {
  return [entry.goalId + ' · ' + entry.objective, status(entry), ...cells(entry), evidence(entry, register)];
}

function distribution(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(status(entry), (counts.get(status(entry)) ?? 0) + 1);
  return [...states].map(([label, tone]) => ({ label, tone, value: counts.get(label) ?? 0 }));
}

function metrics(entries, excluded = 0) {
  const kpis = distribution(entries);
  return [
    { label: 'Выполнено', value: kpis[0].value + ' из ' + entries.length, tone: 'positive' },
    kpis[1],
    { label: 'С фактом', value: entries.filter(entry => entry.scopeId === 'dit' ? present(entry.fact) : entry.rows.some(row => present(row.fact))).length, tone: 'neutral' },
    kpis[5],
    ...(excluded ? [{ label: 'Не оцениваются', value: excluded, tone: 'muted' }] : []),
  ];
}

function curatorSlide(week) {
  const entries = [
    ['achievements', 'Достижения'], ['attention', 'Требует внимания'], ['plans', 'Планы'], ['insights', 'Инсайты']
  ];
  const blocks = entries.map(([key, title]) => ({
    title,
    items: (week?.summary?.[key] ?? []).slice(0, 3).map(item => text((item.curator ? item.curator + ' · ' : '') + item.text))
  }));
  if (!blocks.some(block => block.items.length)) return [];
  return [{ kind: 'columns', title: 'Сводка кураторов', subtitle: week?.week ? 'Неделя с ' + day(week.week) : '',
    blocks, footer: 'Отчёты кураторов за выбранную неделю' }];
}

function differences(previous, current, register, older, perLeader) {
  const lookup = new Map(previous.map(item => [entryKey(item), item]));
  const changes = [];
  for (const entry of current) {
    const past = lookup.get(entryKey(entry));
    if (!past) continue;
    const left = cells(past);
    const right = cells(entry);
    if (status(past) === status(entry) && left.every((value, index) => value === right[index])) continue;
    if (status(past) === 'Нет статуса' && left.every(value => value === '—')) continue;
    changes.push([
      entry.goalId + ' · ' + entry.objective + (perLeader ? '\n' + entry.leader : ''),
      status(past) + ' → ' + status(entry),
      left[0] + ' → ' + right[0], left[1] + ' → ' + right[1],
    ]);
  }
  return asTable('Изменения между срезами',
    [{ label: 'Цель', width: 3.6 }, { label: 'Статус', width: 2.1 }, { label: 'План', width: 1.15 }, { label: 'Факт', width: 1.15 }],
    changes, day(older.asOf) + ' → ' + day(register.asOf), 'Сопоставимых изменений нет.');
}

function ditAtDate(state, register, period) {
  const rows = new Map();
  for (const event of state.ditTimeline ?? []) {
    if (event.date !== register.asOf || event.period !== period) continue;
    const existing = rows.get(event.goalId);
    if (!existing || event.recordedAt >= existing.recordedAt) rows.set(event.goalId, event);
  }
  return projectDitGoalStatuses(state.goals, state.directory, register, [period], [...rows.values()], state.ditExcluded);
}

export function buildMeetingReport({ config, state, register = null, previous = null, curatorWeek = null }) {
  config = normalizeMeetingConfig(config);
  const { period, leaderId } = config;
  if (!isMeetingPeriod(period)) throw new Error('Выберите период презентации.');
  const { goals, directory, ditStatuses = [], ditExcluded = [], riskActions = [] } = state;
  const assignedIds = new Set(goals.flatMap(goal => (goal.assignments ?? []).filter(item => item.active !== false).map(item => item.leaderId)));
  const leaders = directory.filter(item => item.type === 'leader' && assignedIds.has(item.id));
  const leader = leaders.find(item => item.id === leaderId);
  if (leaderId && !leader) throw new Error('Выберите ИТ-лидера из карты.');
  const scope = leader?.name || 'Весь ДИТ';
  const title = config.title || (leader ? 'Статусы целей ИТ-лидера' : 'Статусы целей ДИТ');
  const registerOutOfPeriod = register && !register.periods?.includes(period);
  if (registerOutOfPeriod) register = null;
  const all = projectGoalStatuses(goals, directory, register, [period]);
  const dit = projectDitGoalStatuses(goals, directory, register, [period], ditStatuses, ditExcluded);
  const scoped = leader ? all.filter(entry => entry.scopeId === leaderId) : dit;
  const goalList = leader ? goals.filter(goal => goal.assignments?.some(item => item.leaderId === leaderId && item.active !== false)) : goals;
  const applicable = new Map(scoped.map(entry => [entry.goalId, entry]));
  const date = register?.asOf ? 'Срез Excel от ' + day(register.asOf) : register ? 'Дата среза Excel не подтверждена'
    : registerOutOfPeriod ? 'В Excel нет выбранного периода' : 'Excel со статусами не выбран';
  const book = register?.source?.name;
  const local = !leader && state.ditDrafts?.some(item => item.period === period && scoped.some(entry => entry.goalId === item.goalId))
    ? 'Включены локальные правки ДИТ' : '';
  const notes = [date, book ? 'Источник: ' + book : '', local].filter(Boolean);
  const subtitle = period + ' · ' + scope;
  const footer = [period, date, book, local].filter(Boolean).join(' · ');
  const actionList = riskActions.filter(item => item.period === period && item.status !== 'done' && (!leader || item.scopeId === leaderId))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title, 'ru'));
  const actionsByGoal = new Map();
  for (const action of actionList) {
    const key = entryKey(action);
    if (!actionsByGoal.has(key)) actionsByGoal.set(key, action);
  }
  const riskEntries = (leader ? scoped : [...dit, ...all]).filter(item => status(item) === 'Под риском');
  const appendix = goalList.map(goal => applicable.has(goal.id) ? tableRow(applicable.get(goal.id), register)
    : [goal.id + ' · ' + goal.title, 'Не оценивается', valueText(goal.target || goal.metric), '—', 'Карта целей']);
  const comparisonAvailable = Boolean(register?.asOf && previous?.asOf && previous.asOf < register.asOf
    && previous.periods?.includes(period) && register.periods?.includes(period));
  const make = {
    overview: () => [{
      kind: 'summary', title, subtitle: [subtitle, date].join(' · '),
      kpis: metrics(scoped, goalList.length - scoped.length),
      note: [distribution(scoped).slice(2, 5).map(kpi => kpi.label + ' · ' + kpi.value).join('   /   '), config.note]
        .filter(Boolean).join('\n'),
    }],
    leaders: () => leader ? [] : pages(leaders, 8).map(items => ({
      kind: 'bars', title: 'Все ИТ-лидеры', subtitle, groups: items.map(row => ({
        label: row.name, segments: distribution(all.filter(entry => entry.scopeId === row.id)),
      })),
    })),
    risks: () => asTable('Цели под риском',
      [{ label: 'Цель и уровень', width: 3.3 }, { label: 'План', width: 0.9 }, { label: 'Факт', width: 1 }, { label: 'Причина / источник', width: 2 }, { label: 'Следующий шаг', width: 1.8 }],
      riskEntries.map(item => {
        const context = item.rows.find(row => (item.scopeId !== 'dit' || (item.statusSourceId && row.scopeId === 'dit'))
          && (row.risk || row.comment));
        const action = actionsByGoal.get(entryKey(item));
        return [item.goalId + ' · ' + item.objective + '\n' + (item.scopeId === 'dit' ? 'Весь ДИТ' : item.leader),
          ...cells(item), text(context?.risk || context?.comment) || evidence(item, register),
          action ? action.owner + ' · ' + day(action.dueOn) + '\n' + action.nextAction : '—'];
      }), subtitle, 'Целей со статусом «Под риском» в выбранном охвате нет.'),
    'leader-details': () => (leader ? [leader] : leaders).flatMap(item => {
      const entries = all.filter(entry => entry.scopeId === item.id);
      if (leader && config.sections.some(section => section.id === 'appendix' && section.enabled)) return [];
      const summary = metrics(entries).slice(0, 2).map(kpi => kpi.label + ' ' + kpi.value).join(' · ');
      return asTable(item.name, rangeColumns, entries.map(entry => tableRow(entry, register)),
        [period, summary].join(' · '), 'В выбранном периоде нет оцениваемых назначений.');
    }),
    comparison: () => {
      if (!comparisonAvailable) return [];
      const earlier = projectGoalStatuses(goals, directory, previous, [period]);
      if (leader) return differences(earlier, scoped, register, previous, false);
      return differences([...ditAtDate(state, previous, period), ...earlier],
        [...ditAtDate(state, register, period), ...all], register, previous, true);
    },
    curators: () => leader ? [] : curatorSlide(curatorWeek),
    actions: () => asTable('Открытые поручения',
      [{ label: 'Задача', width: 2.5 }, { label: 'Ответственный', width: 1.4 }, { label: 'Срок', width: 1 }, { label: 'Следующий шаг', width: 3.2 }],
      actionList.map(action => [action.goalId + '\n' + action.title, action.owner, day(action.dueOn), action.nextAction]), subtitle),
    appendix: () => asTable(leader ? 'Все цели лидера' : 'Все цели ДИТ', rangeColumns, appendix, subtitle, 'Цели для выбранного охвата отсутствуют.'),
  };
  const omitted = [];
  const slides = config.sections.filter(section => section.enabled).flatMap(({ id }) => {
    const items = make[id]();
    if (!items.length) omitted.push(id);
    return items.map(slide => ({ section: id, footer, ...slide }));
  });
  if (!slides.length) throw new Error('Выбранные разделы пусты. Включите сводку или приложение.');
  if (slides.length > 240) throw new Error('Слишком много слайдов. Выберите отдельного лидера или сократите состав презентации.');
  return { title, subtitle, source: notes.join(' · '), omitted, slides };
}

export function meetingReportId(report) {
  return createHash('sha256').update(JSON.stringify(report)).digest('hex');
}
