import { randomUUID } from 'node:crypto';

export const riskActionStatuses = Object.freeze(['open', 'in-progress', 'done']);
const anchorFields = ['goalId', 'scopeId', 'period', 'snapshotId', 'week'];
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;

function issue(message, code = 'INVALID', status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function requiredText(value, max, label, multiline = false) {
  const control = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || control.test(value)) {
    throw issue(`Проверьте поле «${label}».`);
  }
  return value.trim();
}

function date(value, label) {
  const day = requiredText(value, 10, label);
  const parsed = new Date(day);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== day) {
    throw issue(`Проверьте дату в поле «${label}».`);
  }
  return day;
}

function optionalText(value, max, label) {
  return value == null || value === '' ? null : requiredText(value, max, label);
}

export function saveRiskAction(actions, input, { author, now = new Date().toISOString(), makeId = randomUUID } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw issue('Проверьте параметры задачи.');
  const id = optionalText(input.id, 80, 'Задача');
  const expectedRevision = optionalText(input.expectedRevision, 80, 'Ревизия задачи');
  const existing = id === null ? null : actions.find(action => action.id === id);
  if (id !== null && !existing) throw issue('Задача не найдена.', 'NOT_FOUND', 404);
  if (expectedRevision !== (existing?.revision ?? null)) {
    throw issue('Задача изменилась. Откройте её заново перед сохранением.', 'CONFLICT', 409);
  }

  const anchor = {
    goalId: requiredText(input.goalId, 200, 'Цель'),
    scopeId: requiredText(input.scopeId, 200, 'Уровень'),
    period: requiredText(input.period, 60, 'Период'),
    snapshotId: optionalText(input.snapshotId, 200, 'Срез'),
    week: input.week == null || input.week === '' ? null : date(input.week, 'Неделя'),
  };
  if (existing && anchorFields.some(field => (existing[field] ?? null) !== anchor[field])) {
    throw issue('Изменить привязку задачи нельзя. Создайте задачу для нужного риска.', 'CONFLICT', 409);
  }
  if (!riskActionStatuses.includes(input.status)) throw issue('Выберите состояние задачи.');
  const updatedBy = requiredText(author, 120, 'Автор');
  const row = {
    ...anchor,
    id: existing?.id ?? makeId(),
    title: requiredText(input.title, 250, 'Название задачи'),
    owner: requiredText(input.owner, 160, 'Ответственный'),
    dueOn: date(input.dueOn, 'Срок'),
    nextAction: requiredText(input.nextAction, 3000, 'Следующее действие', true),
    status: input.status,
    revision: makeId(),
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? updatedBy,
    updatedAt: now,
    updatedBy,
  };
  return existing ? actions.map(action => action.id === id ? row : action) : [...actions, row];
}

// Stable command for a configured task provider. Mapping to its API is separate.
export function riskTaskRequest(action) {
  const { id: operationId, title, owner, dueOn, nextAction } = action;
  const anchor = Object.fromEntries(anchorFields.map(field => [field, action[field] ?? null]));
  return { operationId, title, owner, dueOn, nextAction, anchor };
}

export function validateRiskActions(actions) {
  if (!Array.isArray(actions)) throw issue('Некорректный список поручений.');
  const ids = new Set();
  for (const row of actions) {
    if (typeof row?.id !== 'string' || !uuid.test(row.id) || typeof row.revision !== 'string'
      || !uuid.test(row.revision) || ids.has(row.id)) throw issue('Некорректная ревизия поручения.');
    ids.add(row.id);
    date(row.dueOn, 'Срок');
    requiredText(row.createdBy, 120, 'Автор');
    if (![row.createdAt, row.updatedAt].every(value => {
      const time = new Date(value);
      return Number.isFinite(+time) && time.toISOString() === value;
    }) || row.updatedAt < row.createdAt) throw issue('Некорректное время поручения.');
    saveRiskAction([], { ...row, id: null }, { author: row.updatedBy, makeId: () => row.id });
  }
}
