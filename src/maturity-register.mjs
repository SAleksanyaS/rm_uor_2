import { createHash } from 'node:crypto';
import { openWorkbook } from './imports.mjs';

const headers = [
  'Блок', 'Трайб', 'Кластер', 'Команда', 'Этап APP', 'Группа практик', 'Метрика',
  'Доля команд', 'Команд достигли', 'Всего команд', 'Доля метрик', 'Метрик достигли', 'Всего метрик',
  'Значение метрики', 'Цель метрики',
];
const metricReasons = new Set(['В исключениях', 'Нет PR', 'Нет данных']);
const aggregateReasons = new Set(['Не участвует', 'Нет данных']);
const maxRows = 20_000;

function clean(value) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim() : value;
}

function identity(parts) {
  return JSON.stringify(parts.map(part => part.toLocaleLowerCase('ru-RU')));
}

function present(value) {
  return value != null && value !== '';
}

function fail(row, message) {
  throw new Error('Строка ' + row + '. ' + message);
}

function percentage(value, row, label) {
  if (typeof value !== 'string' || !/^\d+(?:[,.]\d+)?%$/u.test(value)) {
    fail(row, label + ' должно быть процентом.');
  }
  const result = Number(value.slice(0, -1).replace(',', '.'));
  if (!Number.isFinite(result) || result < 0 || result > 100) fail(row, label + ' вне диапазона от 0% до 100%.');
  return result;
}

function pair(cells, index, row, label) {
  const values = [cells[index], cells[index + 1]];
  const numbers = values.map(value => typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value);
  const [reached, total] = numbers;
  if (!numbers.every(Number.isSafeInteger) || reached < 0 || total < reached) fail(row, 'Некорректные итоговые количества ' + label + '.');
  return { reached, total };
}

function requireEmpty(cells, from, to, row) {
  if (cells.slice(from, to).some(value => present(value) && value !== '-')) {
    fail(row, 'В этом уровне иерархии заполнены столбцы другого уровня.');
  }
}

function reportedCounts(cells, depth, row) {
  if (depth < 3) {
    requireEmpty(cells, 10, 15, row);
    percentage(cells[7], row, 'Доля команд');
    return pair(cells, 8, row, 'команд');
  }
  requireEmpty(cells, 7, 10, row);
  requireEmpty(cells, 13, 15, row);
  if (depth > 3 && aggregateReasons.has(cells[10]) && cells[10] === cells[11] && cells[10] === cells[12]) {
    return { reached: 0, total: 0 };
  }
  percentage(cells[10], row, 'Доля метрик');
  return pair(cells, 11, row, 'метрик');
}

function metricDetail(parts, cells, row) {
  requireEmpty(cells, 7, 13, row);
  const threshold = percentage(cells[14], row, 'Цель метрики');
  const reason = metricReasons.has(cells[13]) ? cells[13] : null;
  const value = reason === null ? percentage(cells[13], row, 'Значение метрики') : null;
  return { name: parts[6], group: parts[5], sourceRow: row, passed: value === null ? null : value >= threshold, reason, value, threshold };
}

function treeFor(rows) {
  const byKey = new Map();
  for (const [offset, original] of rows.slice(1).entries()) {
    const row = offset + 2;
    const cells = original.map(clean);
    if (!cells.some(present)) continue;
    const depth = cells.slice(0, 7).findLastIndex(present);
    const parts = cells.slice(0, depth + 1);
    if (depth < 0 || parts.some(part => typeof part !== 'string' || !part || part === '-' || part.length > 300)) {
      fail(row, 'Заполните путь иерархии от блока до нужного уровня без пропусков.');
    }
    const key = identity(parts);
    const previous = byKey.get(key);
    if (previous) fail(row, 'Повтор строки иерархии, первая запись в строке ' + previous.row + '.');
    const reported = depth === 6 ? null : reportedCounts(cells, depth, row);
    const metric = depth === 6 ? metricDetail(parts, cells, row) : null;
    byKey.set(key, { key, parts, depth, row, reported, metric, children: [] });
  }

  const roots = [];
  for (const item of byKey.values()) {
    if (item.depth === 0) {
      roots.push(item);
      continue;
    }
    const parent = byKey.get(identity(item.parts.slice(0, -1)));
    if (!parent) fail(item.row, 'Для элемента не найдена родительская строка иерархии.');
    parent.children.push(item);
  }
  if (roots.length !== 1) throw new Error('Книга должна содержать одну итоговую строку блока.');
  return roots[0];
}

function checkedCount(item, reached, total, label) {
  if (item.reported.reached !== reached || item.reported.total !== total) {
    fail(item.row, 'Итог ' + label + ' расходится с детализацией.');
  }
}

function sum(details) {
  const totals = { teamsReached: 0, teamsTotal: 0, metricsReached: 0, metricsTotal: 0 };
  for (const detail of details) for (const key of Object.keys(totals)) totals[key] += detail[key];
  return totals;
}

function measure(item) {
  if (item.metric) {
    return { teamsReached: 0, teamsTotal: 0, metricsReached: Number(item.metric.passed === true),
      metricsTotal: Number(item.metric.passed !== null), metrics: [item.metric] };
  }
  if (!item.children.length) fail(item.row, 'Для уровня иерархии нет детализации.');

  const detail = item.children.map(measure);
  const totals = sum(detail);
  if (item.depth >= 3) {
    checkedCount(item, totals.metricsReached, totals.metricsTotal, 'метрик');
    const metrics = detail.flatMap(entry => entry.metrics);
    if (item.depth > 3) return { ...totals, metrics };
    if (!totals.metricsTotal) fail(item.row, 'У команды нет измеренных метрик. Без правила применимости итог команд неоднозначен.');
    return {
      name: item.parts[3], sourceRow: item.row,
      ...totals, teamsReached: Number(totals.metricsReached === totals.metricsTotal), teamsTotal: 1, metrics,
    };
  }

  checkedCount(item, totals.teamsReached, totals.teamsTotal, 'команд');
  if (item.depth === 2) {
    return {
      id: createHash('sha256').update(item.key).digest('hex'),
      name: item.parts[2], tribe: item.parts[1], sourceRow: item.row, ...totals, teams: detail,
    };
  }
  const clusters = item.depth === 1 ? detail : detail.flatMap(entry => entry.clusters);
  return { ...totals, clusters };
}

export function readMaturityRegister(bytes) {
  const workbook = openWorkbook(bytes);
  const matches = workbook.sheets.filter(sheet => {
    if (sheet.hidden || sheet.columns !== headers.length) return false;
    const header = workbook.preview(sheet.name, 0, 1).rows[0];
    return headers.every((name, index) => clean(header?.[index]) === name);
  });
  if (matches.length !== 1) {
    throw new Error('Нужен один видимый лист выгрузки зрелости с заголовками от «Блок» до «Цель метрики».');
  }
  const [sheet] = matches;
  if (sheet.rows < 2 || sheet.rows > maxRows) throw new Error('Размер выгрузки зрелости должен быть от 2 до 20 000 строк.');
  const { clusters, ...totals } = measure(treeFor(workbook.getRows(sheet.name)));
  return { sheet: sheet.name, totals, clusters };
}
