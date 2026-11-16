import { normalizeDitMeasurement } from './dit-measurement.mjs';

const periodPattern = /^(?:Q[1-4] 20\d{2}|Y\d{2})$/u;
const statuses = new Set(['', 'Выполнено', 'Под риском', 'В плане', 'Не выполнено', 'Нет методики']);
const revisionPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const time = new Date(value);
  return Number.isFinite(+time) && time.toISOString().slice(0, 10) === value;
}

function timestamp(value) {
  const time = new Date(value);
  return Number.isFinite(+time) && time.toISOString() === value;
}

export function appendDitEvent(events, row, { previous, recordedAt }) {
  if (!timestamp(recordedAt) || events.some(event => event.revision === row.revision)) return events;
  const { goalId, period, revision, status, measurement } = row;
  const changedMeasurement = measurement && measurement.id !== previous?.measurement?.id;
  const date = changedMeasurement ? measurement.asOf : recordedAt.slice(0, 10);
  return [...events, { goalId, period, revision, status, date, recordedAt, ...(measurement ? { measurement } : {}) }];
}

export function normalizeDitTimeline(events) {
  if (!Array.isArray(events) || events.length > 50_000) throw new Error('Некорректная история срезов ДИТ.');
  const seen = new Set();
  return events.map(row => {
    const { goalId, period, revision, status, date, recordedAt } = row ?? {};
    if (typeof goalId !== 'string' || !goalId.trim() || goalId.length > 200 || /[\u0000-\u001f\u007f]/u.test(goalId)
      || typeof period !== 'string' || !periodPattern.test(period) || typeof revision !== 'string' || !revisionPattern.test(revision)
      || !statuses.has(status) || !isoDate(date) || !timestamp(recordedAt) || seen.has(revision)) {
      throw new Error('Некорректная запись истории ДИТ.');
    }
    seen.add(revision);
    const measurement = row.measurement === undefined ? null : normalizeDitMeasurement(goalId, period, row.measurement);
    return { goalId, period, revision, status, date, recordedAt, ...(measurement ? { measurement } : {}) };
  });
}

export function timelineWithCurrent(snapshot) {
  let events = snapshot.ditTimeline ?? [];
  for (const row of snapshot.ditStatuses ?? []) {
    if (row.measurement && !events.some(event => event.measurement?.id === row.measurement.id)) {
      events = appendDitEvent(events, row, { recordedAt: row.measurement.recordedAt });
    }
  }
  return events;
}
