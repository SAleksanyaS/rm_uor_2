import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readMaturityRegister } from '../src/maturity-register.mjs';

const header = ['Блок', 'Трайб', 'Кластер', 'Команда', 'Этап APP', 'Группа практик', 'Метрика', 'Доля команд',
  'Команд достигли', 'Всего команд', 'Доля метрик', 'Метрик достигли', 'Всего метрик', 'Значение метрики', 'Цель метрики'];

function makeWorkbook(rows) {
  const files = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Sheet1" r:id="r1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet.xml" Type="http://test/worksheet"/></Relationships>',
    'xl/worksheets/sheet.xml': '<worksheet><sheetData>' + rows.map((values, index) =>
      '<row r="' + (index + 1) + '">' + values.map((value, column) => {
        if (value == null) return '';
        const address = String.fromCharCode(65 + column) + (index + 1);
        return typeof value === 'number' ? '<c r="' + address + '"><v>' + value + '</v></c>'
          : '<c r="' + address + '" t="inlineStr"><is><t>' + value + '</t></is></c>';
      }).join('') + '</row>').join('') + '</sheetData></worksheet>',
  };
  const locals = [];
  const central = [];
  let offset = 0;
  let directorySize = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    offset += local.length + nameBytes.length + data.length;
    directorySize += entry.length + nameBytes.length;
    locals.push(local, nameBytes, data);
    central.push(entry, nameBytes);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

const row = (parts, cells) => [...parts, ...Array(7 - parts.length).fill(null), ...cells];

function specimen() {
  const rows = [header, row(['Блок'], ['50%', 1, 2]), row(['Блок', 'Трайб'], ['50%', 1, 2]), row(['Блок', 'Трайб', 'Кластер'], ['50%', 1, 2])];
  for (const [team, value, pass] of [['Альфа', '91,1%', '1'], ['Бета', '60%', '0']]) {
    const path = ['Блок', 'Трайб', 'Кластер', team];
    const count = [null, null, null, pass === '1' ? '100%' : '0%', pass, '1'];
    rows.push(row(path, count), row([...path, 'Разработка'], count), row([...path, 'Разработка', 'Связь с кодом'], count));
    rows.push(row([...path, 'Разработка', 'Связь с кодом', 'Связь PR'], [null, null, null, null, null, null, value, '80%']));
    rows.push(row([...path, 'Разработка', 'Связь с кодом', 'Связь историй'], [null, null, null, null, null, null, 'В исключениях', '70%']));
  }
  return rows;
}

test('reconciles hierarchy without counting roll-ups twice and preserves explicit exclusions', () => {
  const result = readMaturityRegister(makeWorkbook(specimen()));
  assert.equal(result.sheet, 'Sheet1');
  assert.equal(Object.hasOwn(result, 'asOf'), false);
  assert.deepEqual(result.totals, { teamsReached: 1, teamsTotal: 2, metricsReached: 1, metricsTotal: 2 });
  const [cluster] = result.clusters;
  assert.equal(cluster.tribe, 'Трайб');
  assert.equal(cluster.sourceRow, 4);
  assert.ok(cluster.id);
  assert.equal(cluster.teams[0].teamsReached, 1);
  assert.equal(cluster.teams[1].teamsReached, 0);
  assert.deepEqual(cluster.teams[0].metrics[0], {
    name: 'Связь PR', group: 'Связь с кодом', sourceRow: 8, passed: true, reason: null, value: 91.1, threshold: 80,
  });
  assert.deepEqual(cluster.teams[0].metrics[1], {
    name: 'Связь историй', group: 'Связь с кодом', sourceRow: 9, passed: null, reason: 'В исключениях', value: null, threshold: 70,
  });
  assert.equal(cluster.teams[1].metrics[0].passed, false);
  const original = specimen();
  const moved = readMaturityRegister(makeWorkbook([original[0], ...original.slice(1).reverse()]));
  assert.equal(moved.clusters[0].id, cluster.id);
});

test('refuses heading substitutions, duplicate or orphan hierarchy rows, and inconsistent totals', () => {
  const wrongHeader = specimen();
  wrongHeader[0] = [...header.slice(0, -1), 'Комментарии'];
  assert.throws(() => readMaturityRegister(makeWorkbook(wrongHeader)), /заголовк/iu);
  const duplicate = specimen();
  duplicate.push([...duplicate.at(-1)]);
  assert.throws(() => readMaturityRegister(makeWorkbook(duplicate)), /повтор/iu);
  const orphan = specimen();
  orphan.splice(6, 1);
  assert.throws(() => readMaturityRegister(makeWorkbook(orphan)), /родительск/iu);
  const inconsistent = specimen();
  inconsistent[1][8] = 2;
  assert.throws(() => readMaturityRegister(makeWorkbook(inconsistent)), /итог/iu);
  const invalidReason = specimen();
  invalidReason[8][13] = 'Неведомый статус';
  assert.throws(() => readMaturityRegister(makeWorkbook(invalidReason)), /значение метрики/iu);
});

test('matches the actual workbook when the optional private source is available', {
  skip: !process.env.RMUOR_REAL_MATURITY_XLSX,
}, async () => {
  const result = readMaturityRegister(await readFile(process.env.RMUOR_REAL_MATURITY_XLSX));
  assert.deepEqual(result.totals, { teamsReached: 56, teamsTotal: 58, metricsReached: 271, metricsTotal: 273 });
  assert.equal(result.clusters.length, 24);
  const metrics = result.clusters.flatMap(cluster => cluster.teams.flatMap(team => team.metrics));
  assert.equal(metrics.length, 290);
  assert.deepEqual(Object.fromEntries(['В исключениях', 'Нет PR', 'Нет данных'].map(reason =>
    [reason, metrics.filter(metric => metric.reason === reason).length])), { 'В исключениях': 15, 'Нет PR': 1, 'Нет данных': 1 });
});
