import { ditValue } from './goal-status.js';

export function compareDitDates(events, period, earlier, later) {
  const at = (date) => {
    const recent = new Map();
    for (const event of events) {
      if (event.period !== period || event.date !== date) continue;
      const present = recent.get(event.goalId);
      if (!present || event.recordedAt >= present.recordedAt) recent.set(event.goalId, event);
    }
    return recent;
  };
  const before = at(earlier);
  const after = at(later);
  return [...new Set([...before.keys(), ...after.keys()])].sort().map(goalId => {
    const previous = before.get(goalId) ?? null;
    const current = after.get(goalId) ?? null;
    const left = previous?.measurement;
    const right = current?.measurement;
    const comparable = Number.isFinite(left?.fact) && Number.isFinite(right?.fact) && left.unit === right.unit;
    return { goalId, before: previous, after: current,
      delta: comparable ? Number((right.fact - left.fact).toFixed(6)) : null };
  });
}

function cell(event, helpers) {
  if (!event) return '<p class="muted small">Нет записи на эту дату</p>';
  const { escape, dateText } = helpers;
  const measurement = event.measurement;
  const source = measurement?.origin?.name || measurement?.origin?.reference;
  const hint = [event.published ? 'Опубликовано' : 'Локальная запись',
    measurement?.asOf && 'факт от ' + dateText(measurement.asOf), source].filter(Boolean).join(' · ');
  return `<p>План ${ditValue(measurement?.plan, measurement?.unit, helpers)} · Факт ${ditValue(measurement?.fact, measurement?.unit, helpers)}</p>
    <p>${escape(event.status || 'Статус отдельно не задан')}</p><p class="muted small">${escape(hint)}</p>`;
}

export function renderDitHistory({ events, goals, filters }, helpers) {
  const { escape, option, dateText } = helpers;
  if (!events.length) return '<section class="panel panel-inner stack"><h2>История по датам</h2><p class="muted">Срезы появятся после сохранения факта или статуса ДИТ.</p></section>';
  const periods = [...new Set(events.map(event => event.period))].sort();
  const period = periods.includes(filters.period) ? filters.period : periods[0];
  const dates = [...new Set(events.filter(event => event.period === period).map(event => event.date))].sort().reverse();
  const later = dates.includes(filters.later) ? filters.later : dates[0];
  const earlierDates = dates.filter(date => date < later);
  const earlier = filters.earlier === '' ? '' : earlierDates.includes(filters.earlier) ? filters.earlier : earlierDates[0] || '';
  const names = new Map(goals.map(goal => [goal.id, goal.title]));
  const rows = compareDitDates(events, period, earlier, later);
  return `<section class="panel panel-inner stack">
    <h2>История по датам</h2>
    <div class="form-grid">
      <label class="field"><span>Период</span><select id="dit-history-period">${periods.map(p => option(p, p, period)).join('')}</select></label>
      <label class="field"><span>Дата среза</span><select id="dit-history-later">${dates.map(date => option(date, dateText(date), later)).join('')}</select></label>
      <label class="field"><span>Сравнить с датой</span><select id="dit-history-earlier">${option('', 'Один срез', earlier)}${earlierDates.map(date => option(date, dateText(date), earlier)).join('')}</select></label>
    </div>
    <p class="muted small">Показываются записи выбранных дат. Значения из других дат отмечены в источнике факта.</p>
    <div class="table-wrap"><table aria-label="История показателей ДИТ"><thead><tr><th scope="col">Цель</th>
      ${earlier ? `<th scope="col">${escape(dateText(earlier))}</th>` : ''}
      <th scope="col">${escape(dateText(later))}</th>${earlier ? '<th scope="col">Изменение факта</th>' : ''}</tr></thead>
      <tbody>${rows.map(row => `<tr><th scope="row">${escape(names.get(row.goalId) ?? row.goalId)}</th>
        ${earlier ? `<td>${cell(row.before, helpers)}</td>` : ''}<td>${cell(row.after, helpers)}</td>${earlier
          ? `<td>${row.delta == null ? '—' : (row.delta > 0 ? '+' : '') + ditValue(row.delta, row.after?.measurement?.unit === '%' ? 'п. п.' : row.after?.measurement?.unit, helpers)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
  </section>`;
}
