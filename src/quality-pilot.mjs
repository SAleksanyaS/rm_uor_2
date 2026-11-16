import { createHash } from 'node:crypto';
import { openWorkbook } from './imports.mjs';

const sha256 = /^[a-f0-9]{64}$/u;
const methodId = 'quality-team-threshold-v1';
const goalId = 'SW26.3';
const rowLimit = 5_000;
const pageSize = 200;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function text(value, limit, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Проверьте поле «' + label + '».');
  }
  return value.trim();
}

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('Укажите дату среза.');
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Проверьте дату среза.');
  return value;
}

function column(value, label) {
  const letter = text(value, 2, label).toUpperCase();
  if (!/^[A-Z]{1,2}$/u.test(letter)) throw new Error('Укажите столбец Excel от A до IV.');
  const offset = [...letter].reduce((index, part) => index * 26 + part.charCodeAt(0) - 64, 0) - 1;
  if (offset >= 256) throw new Error('Укажите столбец Excel от A до IV.');
  return { letter, offset };
}

function settings(input) {
  const { sourceId, startRow, endRow, unit, period } = input ?? {};
  if (typeof sourceId !== 'string' || !sha256.test(sourceId)) throw new Error('Выберите исходную книгу XLSX.');
  if (typeof period !== 'string' || !/^(?:Q[1-4] 20\d{2}|Y\d{2})$/u.test(period)) throw new Error('Укажите период расчёта.');
  if (!['days', 'hours'].includes(unit)) throw new Error('Выберите единую единицу длительности.');
  if (!Number.isInteger(startRow) || !Number.isInteger(endRow) || startRow < 1 || endRow < startRow ||
      endRow > 1_048_576 || endRow - startRow + 1 > rowLimit) {
    throw new Error('Укажите диапазон от 1 до 5000 строк с командами.');
  }
  const team = column(input.teamColumn, 'Столбец команды');
  const threshold = column(input.thresholdColumn, 'Столбец порога');
  const duration = column(input.durationColumn, 'Столбец длительности');
  const indexes = [team.offset, threshold.offset, duration.offset];
  if (new Set(indexes).size !== 3) throw new Error('Выберите три разные столбцы исходника.');
  return {
    sourceId, asOf: date(input.asOf), period, unit, sheet: text(input.sheet, 80, 'Лист'),
    recipe: { startRow, endRow, teamColumn: team.letter, thresholdColumn: threshold.letter, durationColumn: duration.letter },
    indexes,
  };
}

function teamKey(team) {
  return team.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim();
}

function supportedNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12;
}

function teamResult(row, values, [teamIndex, thresholdIndex, durationIndex], seen) {
  const team = text(values[teamIndex], 160, 'Строка ' + row + ' · команда');
  const key = teamKey(team);
  if (seen.has(key)) throw new Error('Строка ' + row + '. Команда повторяется, первая запись в строке ' + seen.get(key) + '.');
  seen.set(key, row);
  const threshold = values[thresholdIndex];
  if (!supportedNumber(threshold) || threshold === 0) throw new Error('Строка ' + row + '. Порог команды должен быть положительным числом.');
  const raw = values[durationIndex];
  const missing = raw == null || (typeof raw === 'string' && !raw.trim());
  if (!missing && !supportedNumber(raw)) throw new Error('Строка ' + row + '. Длительность должна быть числом от нуля или пустой ячейкой.');
  const duration = missing ? null : raw;
  const status = missing ? 'missing' : duration <= threshold ? 'achieved' : 'exceeded';
  return Object.freeze({ row, team, threshold, duration, status, deviation: missing ? null : duration - threshold });
}

export function runQualityPilot(bytes, input) {
  const { sourceId, asOf, period, unit, sheet, recipe, indexes } = settings(input);
  if (!(bytes instanceof Uint8Array) || digest(bytes) !== sourceId) throw new Error('Исходная книга не совпадает с контрольной суммой.');
  const book = openWorkbook(bytes);
  const tab = book.sheets.find(item => item.name === sheet);
  if (!tab) throw new Error('Выбранный лист отсутствует в книге.');
  if (recipe.endRow > tab.rows || indexes.some(index => index >= tab.columns)) {
    throw new Error('Выбранный диапазон выходит за пределы данных листа.');
  }

  const seen = new Map();
  const teams = [];
  for (let offset = recipe.startRow - 1; offset < recipe.endRow; offset += pageSize) {
    const page = book.preview(sheet, offset, Math.min(pageSize, recipe.endRow - offset));
    for (const [index, values] of page.rows.entries()) {
      teams.push(teamResult(offset + index + 1, values, indexes, seen));
    }
  }

  const applicable = teams.length;
  const achieved = teams.filter(team => team.status === 'achieved').length;
  const exceeded = teams.filter(team => team.status === 'exceeded').length;
  const measured = achieved + exceeded;
  const missing = applicable - measured;
  const ratio = missing ? null : achieved / applicable;
  const percent = ratio == null ? null : Number((ratio * 100).toFixed(6));
  const identity = { schemaVersion: 1, goalId, methodId, period, asOf, unit, sourceId, sheet, recipe };
  const source = { id: sourceId, sha256: sourceId, sheet };
  if (input.sourceName !== undefined) source.name = text(input.sourceName, 255, 'Имя книги');
  return Object.freeze({
    schemaVersion: 1, id: digest(JSON.stringify(identity)), goalId, methodId, period, asOf, unit,
    source: Object.freeze(source), recipe: Object.freeze(recipe),
    totals: Object.freeze({ applicable, measured, missing, achieved, exceeded, ratio, percent }),
    teams: Object.freeze(teams),
  });
}

export async function buildQualityPilot(input, readOriginal) {
  if (typeof input?.sourceId !== 'string' || !sha256.test(input.sourceId)) throw new Error('Выберите исходную книгу XLSX.');
  const { source, bytes } = await readOriginal(input.sourceId);
  if (source?.type !== 'xlsx' || source.id !== input.sourceId) throw new Error('Выберите исходную книгу XLSX.');
  return runQualityPilot(bytes, { ...input, sourceName: source.name });
}
