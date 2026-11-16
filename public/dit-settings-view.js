import { ditValue } from './goal-status.js';

const statusOptions = [
  ['', 'По итогу ДИТ из Excel'],
  ['Выполнено', 'Выполнено'],
  ['Под риском', 'Под риском'],
  ['В плане', 'В плане'],
  ['Не выполнено', 'Не выполнено'],
  ['Нет методики', 'Нет методики'],
];

export function renderDitMeasurement(measurement, helpers) {
  if (!measurement) return '';
  const { escape, dateText } = helpers;
  const { origin, method } = measurement;
  const source = method === 'manual-v1' ? origin.reference
    : [origin.name, origin.sheet, origin.factCell?.address, origin.planCell && 'план ' + origin.planCell.address,
      origin.scale === 'fraction' && 'доля × 100 для плана/факта из ячейки'].filter(Boolean).join(' · ');
  const calculation = method === 'xlsx-ratio-v1'
    ? `<p class="small">${escape(origin.numerator.address)} (${ditValue(origin.numerator.value, '', helpers)}) ÷ ${escape(origin.denominator.address)} (${ditValue(origin.denominator.value, '', helpers)}) × 100</p>` : '';
  return `<p class="reading-meta">${escape(dateText(measurement.asOf))} · ${escape(source)} · ${escape(measurement.author)}</p>${calculation}`;
}

export function renderDitFactEditor({ goal, period, row, book, sources, sheets }, { escape, option }) {
  const current = row?.measurement;
  const method = current?.method ?? 'manual-v1';
  const origin = current?.origin;
  const options = [
    ['manual-v1', 'Ввести проверенное значение'], ['xlsx-cell-v1', 'Взять факт из ячейки XLSX'],
    ['xlsx-ratio-v1', 'Посчитать долю из двух ячеек XLSX'],
  ];
  return `<h2 id="dialog-title">Факт ДИТ · ${escape(goal.title)}</h2>
    <p class="muted">${escape(period)} · Сохранение создаёт локальную правку. Статус цели выбирается отдельно.</p>
    <form id="dit-fact-form" class="form-grid" data-goal="${escape(goal.id)}" data-period="${escape(period)}" data-revision="${escape(row?.revision)}" data-status="${escape(row?.status)}">
      <label class="field wide"><span>Способ получения</span><select name="method">${options.map(([value, label]) => option(value, label, method)).join('')}</select></label>
      <label class="field"><span>Дата факта</span><input name="asOf" type="date" required value="${escape(current?.asOf)}"></label>
      <label class="field" data-dit-methods="manual-v1 xlsx-cell-v1"><span>Единица измерения</span><input name="unit" maxlength="32" required placeholder="Например, %" value="${escape(current?.unit)}"></label>
      <label class="field"><span>План вручную (если есть)</span><input type="number" step="any" name="plan" value="${escape(origin?.planCell ? '' : current?.plan)}"></label>
      <label class="field" data-dit-methods="manual-v1"><span>Факт</span><input type="number" step="any" name="fact" required value="${escape(method === 'manual-v1' ? current?.fact : '')}"></label>
      <label class="field wide" data-dit-methods="manual-v1"><span>Источник или основание</span><input name="reference" required maxlength="240" value="${escape(origin?.reference)}" placeholder="Отчёт, срез или протокол сверки"></label>
      <label class="field wide" data-dit-methods="xlsx-cell-v1 xlsx-ratio-v1"><span>Книга XLSX</span><select name="sourceId" required>
        ${book ? '' : option('', sources.length ? 'Выберите книгу' : 'Сначала загрузите книгу в «Источники»', '')}${sources.map(source => option(source.id, source.name, book?.id)).join('')}</select>
        ${origin?.sourceId && !book ? 'Исходная книга отсутствует в этой установке.' : ''}</label>
      <label class="field" data-dit-methods="xlsx-cell-v1 xlsx-ratio-v1"><span>Лист</span><select name="sheet" required>${sheets}</select></label>
      <label class="field" data-dit-methods="xlsx-cell-v1 xlsx-ratio-v1"><span>Ячейка плана (приоритет над вводом)</span><input name="planCell" maxlength="10" placeholder="F136" value="${escape(origin?.planCell?.address)}"></label>
      <label class="field" data-dit-methods="xlsx-cell-v1 xlsx-ratio-v1"><span>План и факт в ячейках</span><select name="scale">
        ${option('number', 'Число как в Excel', origin?.scale ?? 'number')}${option('fraction', 'Доля 0,97 → 97%', origin?.scale)}</select></label>
      <label class="field" data-dit-methods="xlsx-cell-v1"><span>Ячейка факта</span><input name="factCell" maxlength="10" required placeholder="G136" value="${escape(origin?.factCell?.address)}"></label>
      <label class="field" data-dit-methods="xlsx-ratio-v1"><span>Ячейка числителя</span><input name="numerator" maxlength="10" required placeholder="G136" value="${escape(origin?.numerator?.address)}"></label>
      <label class="field" data-dit-methods="xlsx-ratio-v1"><span>Ячейка знаменателя</span><input name="denominator" maxlength="10" required placeholder="H136" value="${escape(origin?.denominator?.address)}"></label>
      <p class="muted small wide" data-dit-methods="xlsx-ratio-v1">Числитель ÷ знаменатель × 100. План для этого способа укажите в процентах.</p>
      <div class="actions wide">
        <button type="button" class="button" data-action="dialog-close">Отмена</button>
        ${current ? '<button type="submit" value="clear" formnovalidate class="button">Сбросить факт</button>' : ''}
        <button type="submit" class="button primary">Сохранить факт</button>
      </div>
    </form>`;
}

export function ditExportButton(goalId, period, { escape }) {
  return `<button class="button compact" type="button" data-action="dit-fact-export" data-id="${escape(goalId)}" data-period="${escape(period)}">Скачать JSON</button>`;
}

export function renderDitReports({ goals, rows, drafts, history = '' }, helpers) {
  const { escape, heading, empty } = helpers;
  const title = heading('Срезы ДИТ', 'Факт и методика по целям и периодам.');
  const reports = rows.filter(row => row.measurement).sort((a, b) =>
    b.measurement.asOf.localeCompare(a.measurement.asOf) || a.goalId.localeCompare(b.goalId));
  if (!reports.length) return title + `<div class="stack">${history}${empty('Текущих измерений пока нет', 'Укажите факт или рассчитайте его из XLSX в разделе «Статусы ДИТ».')}</div>`;
  const names = new Map(goals.map(goal => [goal.id, goal.title]));
  const local = new Set(drafts.map(row => row.revision));
  return title + `<div class="stack">${history}<h2>Текущие измерения</h2>${reports.map(row => `<article class="panel panel-inner stack">
    <div class="headline"><h2>${escape(names.get(row.goalId) ?? row.goalId)}</h2><span class="badge">${local.has(row.revision) ? 'Локальная правка' : 'Опубликовано'}</span></div>
    <p class="reading-meta">${escape(row.goalId)} · ${escape(row.period)}</p>
    <p class="excel-fact"><strong>Факт ${ditValue(row.measurement.fact, row.measurement.unit, helpers)}</strong>
      <span>План ${ditValue(row.measurement.plan, row.measurement.unit, helpers)}</span></p>
    ${renderDitMeasurement(row.measurement, helpers)}
    <div class="actions">${ditExportButton(row.goalId, row.period, helpers)}</div>
  </article>`).join('')}</div>`;
}

function goalRow(goal, manual, pending, applicable, helpers) {
  const { escape, option } = helpers;
  const initial = manual?.status ?? '';
  const title = goal.objective || goal.goalId;
  const status = applicable ? (goal.status || 'Нет статуса') : 'Не оценивается в этом периоде';
  const tone = status === 'Выполнено' ? ' success' : status === 'Под риском' ? ' warning' : '';
  return `<li class="dit-settings-row">
    <div class="dit-settings-goal">
      <div class="dit-settings-goal-title"><strong>${escape(title)}</strong><span class="muted small">${escape(goal.goalId)}</span></div>
      <div class="dit-settings-meta">
        <span>План <strong>${ditValue(goal.plan, goal.unit, helpers)}</strong></span>
        <span>Факт <strong>${ditValue(goal.fact, goal.unit, helpers)}</strong></span>
        <span class="badge${tone}">${escape(status)}</span>
        ${pending ? '<span class="muted small">Черновик</span>' : manual?.status || manual?.measurement ? '<span class="muted small">Опубликовано</span>' : ''}
        ${applicable ? `<button type="button" class="button compact" data-action="dit-fact-edit" data-id="${escape(goal.goalId)}">${goal.measurement ? 'Изменить факт' : 'Указать факт'}</button>` : ''}
        <button type="button" class="button compact" data-action="dit-applicability" data-applicable="${applicable}" data-id="${escape(goal.goalId)}">${applicable ? 'Исключить из периода' : 'Вернуть в период'}</button>
      </div>
    </div>
    <label class="field dit-settings-field"><span>Статус ДИТ</span><select name="status" aria-label="Статус ДИТ для цели ${escape(title)}"${applicable ? '' : ' disabled'}
        data-dit-goal="${escape(goal.goalId)}" data-revision="${escape(manual?.revision)}" data-initial="${escape(initial)}"${pending ? ' data-pending' : ''}>
      ${statusOptions.map(([value, label]) => option(value, label, initial)).join('')}</select></label>
  </li>`;
}

export function renderDitSettings({ dit = [], manual = [], period, periods = [], pendingCount = 0, pendingGoals = [], excluded = [], remote = '', manualRefresh = false }, helpers) {
  const { escape, heading, option } = helpers;
  const available = [...new Set([...periods, period, ...dit.map(goal => goal.period)].filter(Boolean))];
  const selected = period || available[0] || '';
  const goals = [...new Map(dit.filter(goal => goal.period === selected).map(goal => [goal.goalId, goal])).values()];
  const values = new Map(manual.filter(entry => entry.period === selected).map(entry => [entry.goalId, entry]));
  const inactive = new Set(excluded.filter(entry => entry.period === selected).map(entry => entry.goalId));
  const title = heading('Статусы ДИТ', 'Задайте статусы целей на уровне ДИТ за выбранный период.',
    remote && manualRefresh ? '<button type="button" class="button" data-action="refresh">Проверить обновления</button>' : '');
  const pending = Number.isSafeInteger(pendingCount) && pendingCount > 0 ? pendingCount : 0;
  const canPublish = pending > 0 && Boolean(remote);
  const publishNote = pending ? `Сохранено локально, ожидают публикации · ${pending}` : 'Изменений для публикации нет.';
  return `${title}<section class="panel panel-inner dit-settings stack" aria-label="Редактирование статусов ДИТ">
    <div class="dit-settings-toolbar">
      <div><h2>Цели ДИТ</h2><p class="muted small">Статус и факт ДИТ можно уточнять независимо. Сброс возвращает значение из итоговой строки Excel, если она есть.</p></div>
      <label class="field dit-settings-period"><span>Период</span><select id="dit-settings-period"${available.length ? '' : ' disabled'}>
        ${available.length ? available.map(value => option(value, value, selected)).join('') : option('', 'Нет периодов', '')}</select></label>
    </div>
    <form id="dit-status-form" class="dit-settings-form" data-period="${escape(selected)}">
      ${goals.length ? `<ul class="dit-settings-rows">${goals.map(goal => goalRow(goal, values.get(goal.goalId), pendingGoals.includes(goal.goalId), !inactive.has(goal.goalId), helpers)).join('')}</ul>` : '<p class="muted small">За выбранный период целей ДИТ нет.</p>'}
      <div class="dit-settings-save toolbar">
        <div class="muted small"><p>${publishNote}</p>${pending && !remote ? '<p>Укажите репозиторий в <a href="#settings">настройках Git</a>.</p>' : ''}</div>
        <button type="submit" class="button primary"${goals.length ? '' : ' disabled'}>Сохранить локально</button>
        <button type="button" class="button" data-action="dit-publish" data-period="${escape(selected)}"${canPublish ? '' : ' disabled'}>Отправить в Git</button>
      </div>
    </form>
  </section>`;
}
