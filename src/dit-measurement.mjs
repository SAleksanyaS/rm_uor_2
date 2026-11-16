import { createHash } from 'node:crypto';
import { openWorkbook } from './imports.mjs';

const methods = new Set(['manual-v1', 'xlsx-cell-v1', 'xlsx-ratio-v1']);
const sha = /^[a-f0-9]{64}$/u;

function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Проверьте поле «' + label + '».');
  }
  return value.trim();
}

function measure(value, label) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error('Укажите число в поле «' + label + '».');
  return value === 0 ? 0 : value;
}

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('Укажите дату факта.');
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Проверьте дату факта.');
  return value;
}

function coordinate(value, label) {
  const address = text(value, 10, label).toUpperCase();
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/u.exec(address);
  if (!match) throw new Error('Укажите ячейку Excel для поля «' + label + '», например G136.');
  const row = Number(match[2]);
  const column = [...match[1]].reduce((index, letter) => 26 * index + letter.charCodeAt(0) - 64, 0);
  if (row > 1048576 || column > 16384) throw new Error('Ячейка ' + address + ' находится за пределами листа Excel.');
  return { address, row: row - 1, column: column - 1 };
}

function cellValue(rows, input, label) {
  const { address, row, column } = coordinate(input, label);
  return { address, value: measure(rows[row]?.[column], label + ' ' + address) };
}

function storedCell(cell, label) {
  return { address: coordinate(cell?.address, label).address, value: measure(cell?.value, label) };
}

function ratio(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)
    || denominator <= 0 || numerator < 0 || numerator > denominator) {
    throw new Error('Для доли нужны целые значения: знаменатель больше нуля, числитель от нуля до знаменателя.');
  }
  return Number((numerator / denominator * 100).toFixed(6));
}

function scaled(value, scale) {
  return scale === 'fraction' ? Number((value * 100).toFixed(9)) : value;
}

function workbookScale(scale) {
  if (scale === undefined || scale === 'number') return 'number';
  if (scale === 'fraction') return scale;
  throw new Error('Укажите, как в Excel записано значение.');
}

function scope(goalId, period, method, plan, fact, unit, asOf, origin) {
  const data = { method, asOf: date(asOf), unit: method === 'xlsx-ratio-v1' ? '%' : text(unit, 32, 'Единица измерения'),
    plan: plan == null ? null : measure(plan, 'План'), fact: measure(fact, 'Факт'), origin };
  const { name: _filename, ...identity } = origin;
  const digest = JSON.stringify({ schemaVersion: 1, goalId, period, measurement: { ...data, origin: identity } });
  return { id: createHash('sha256').update(digest).digest('hex'), ...data };
}

export function normalizeDitMeasurement(goalId, period, input) {
  const { method, asOf, unit, plan, fact, origin, author, recordedAt } = input ?? {};
  if (!methods.has(method) || !origin || typeof origin !== 'object') throw new Error('Некорректная методика факта ДИТ.');
  let evidence;
  if (method === 'manual-v1') {
    evidence = { reference: text(origin.reference, 240, 'Источник') };
  } else {
    if (typeof origin.sourceId !== 'string' || !sha.test(origin.sourceId)) throw new Error('Проверьте контрольную сумму книги.');
    const planCell = origin.planCell == null ? null : storedCell(origin.planCell, 'Ячейка плана');
    const scale = workbookScale(origin.scale);
    if (planCell && scaled(planCell.value, scale) !== plan) throw new Error('План отличается от выбранной ячейки.');
    evidence = { sourceId: origin.sourceId, name: text(origin.name, 255, 'Книга'), sheet: text(origin.sheet, 80, 'Лист'), planCell, scale };
    if (method === 'xlsx-cell-v1') {
      evidence.factCell = storedCell(origin.factCell, 'Ячейка факта');
      if (fact !== scaled(evidence.factCell.value, scale)) throw new Error('Факт отличается от выбранной ячейки.');
    } else {
      evidence.numerator = storedCell(origin.numerator, 'Числитель');
      evidence.denominator = storedCell(origin.denominator, 'Знаменатель');
      if (fact !== ratio(evidence.numerator.value, evidence.denominator.value)) throw new Error('Результат доли отличается от расчёта.');
    }
  }
  const data = scope(goalId, period, method, plan, fact, unit, asOf, evidence);
  if (input.id !== data.id || unit !== data.unit) throw new Error('Данные факта ДИТ отличаются от подтверждённой версии.');
  const time = new Date(recordedAt);
  if (!Number.isFinite(+time) || time.toISOString() !== recordedAt) throw new Error('Проверьте время записи факта ДИТ.');
  return { ...data, author: text(author, 120, 'Автор'), recordedAt };
}

export async function buildDitMeasurement(goalId, period, input, { readOriginal, author, recordedAt }) {
  if (!methods.has(input?.method)) throw new Error('Выберите способ получения факта ДИТ.');
  const { method, asOf, unit } = input;
  let { plan, fact } = input;
  let origin;
  if (method === 'manual-v1') {
    origin = { reference: text(input.reference, 240, 'Источник') };
  } else {
    if (typeof input.sourceId !== 'string' || !sha.test(input.sourceId)) throw new Error('Выберите исходную книгу XLSX.');
    const { source, bytes } = await readOriginal(input.sourceId);
    if (source.type !== 'xlsx') throw new Error('Выберите исходную книгу XLSX.');
    if (createHash('sha256').update(bytes).digest('hex') !== input.sourceId) throw new Error('Исходная книга не совпадает с контрольной суммой.');
    const sheet = text(input.sheet, 80, 'Лист');
    const rows = openWorkbook(bytes).getRows(sheet);
    const planCell = input.planCell ? cellValue(rows, input.planCell, 'Ячейка плана') : null;
    const scale = workbookScale(input.scale);
    if (planCell) plan = scaled(planCell.value, scale);
    origin = { sourceId: source.id, name: source.name, sheet, planCell, scale };
    if (method === 'xlsx-cell-v1') {
      origin.factCell = cellValue(rows, input.factCell, 'Ячейка факта');
      fact = scaled(origin.factCell.value, scale);
    } else {
      origin.numerator = cellValue(rows, input.numerator, 'Числитель');
      origin.denominator = cellValue(rows, input.denominator, 'Знаменатель');
      fact = ratio(origin.numerator.value, origin.denominator.value);
    }
  }
  const data = scope(goalId, period, method, plan, fact, unit, asOf, origin);
  return normalizeDitMeasurement(goalId, period, { ...data, author, recordedAt });
}
