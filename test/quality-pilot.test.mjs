import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildQualityPilot, runQualityPilot } from '../src/quality-pilot.mjs';

function workbook(rows) {
  const sheet = rows.map(([team, threshold, duration], index) => {
    const row = index + 1;
    const cell = (letter, value) => value == null ? '' : typeof value === 'number'
      ? '<c r="' + letter + row + '"><v>' + value + '</v></c>'
      : '<c r="' + letter + row + '" t="inlineStr"><is><t>' + value + '</t></is></c>';
    return '<row r="' + row + '">' + cell('A', team) + cell('B', threshold) + cell('C', duration) + '</row>';
  }).join('');
  const parts = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Команды" r:id="r1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet.xml" Type="http://test/worksheet"/></Relationships>',
    'xl/worksheets/sheet.xml': '<worksheet><sheetData>' + sheet + '</sheetData></worksheet>',
  };
  const data = [];
  const directory = [];
  let offset = 0;
  let directorySize = 0;
  for (const [path, xml] of Object.entries(parts)) {
    const filename = Buffer.from(path);
    const contents = Buffer.from(xml);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    offset += local.length + filename.length + contents.length;
    directorySize += central.length + filename.length;
    data.push(local, filename, contents);
    directory.push(central, filename);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...data, ...directory, end]);
}

const headers = ['Команда', 'Порог', 'Длительность'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (bytes, overrides = {}) => runQualityPilot(bytes, {
  sourceId: hash(bytes), sourceName: 'Проверочный набор.xlsx', period: 'Y26', asOf: '2026-10-30',
  sheet: 'Команды', startRow: 2, endRow: 51, teamColumn: 'A', thresholdColumn: 'B', durationColumn: 'C',
  unit: 'days', ...overrides,
});

test('reproduces two synthetic team-level snapshots and binds them to their inputs', () => {
  const teamRows = achieved => Array.from({ length: 50 }, (_, index) => [
    'Команда ' + (index + 1), 10 + index, (index < achieved ? 10 : 11) + index,
  ]);
  const first = workbook([headers, ...teamRows(45)]);
  const second = workbook([headers, ...teamRows(46)]);
  const report = run(first);
  assert.equal(report.goalId, 'SW26.3');
  assert.equal(report.methodId, 'quality-team-threshold-v1');
  assert.equal(report.source.sha256, hash(first));
  assert.deepEqual(report.totals, { applicable: 50, measured: 50, missing: 0, achieved: 45, exceeded: 5, ratio: 0.9, percent: 90 });
  assert.deepEqual(report.teams[45], { row: 47, team: 'Команда 46', threshold: 55, duration: 56, status: 'exceeded', deviation: 1 });
  assert.equal(report.teams[0].status, 'achieved');
  assert.equal(Object.isFrozen(report.teams[0]), true);
  assert.equal(run(first).id, report.id);
  assert.equal(run(first, { sourceName: 'Переименованный файл.xlsx' }).id, report.id);
  assert.notEqual(run(first, { asOf: '2026-11-06' }).id, report.id);
  const later = run(second, { asOf: '2026-11-06' });
  assert.equal(later.totals.percent, 92);
  assert.notEqual(later.id, report.id);
});

test('keeps missing measurements distinct and rejects ambiguous eligibility and invalid inputs', () => {
  const sample = workbook([headers, ['Альфа', 10, 8], ['Бета', 12, null]]);
  const partial = run(sample, { endRow: 3 });
  assert.deepEqual(partial.totals, { applicable: 2, measured: 1, missing: 1, achieved: 1, exceeded: 0, ratio: null, percent: null });
  assert.deepEqual(partial.teams[1], { row: 3, team: 'Бета', threshold: 12, duration: null, status: 'missing', deviation: null });
  assert.throws(() => run(workbook([headers, ['Альфа', 10, 8], [' альфа ', 12, 9]]), { endRow: 3 }), /повторяется/u);
  assert.throws(() => run(workbook([headers, ['Альфа', null, 8]]), { endRow: 2 }), /порог/iu);
  assert.throws(() => run(workbook([headers, ['Альфа', 10, 'не задано']]), { endRow: 2 }), /длительность/iu);
  assert.throws(() => run(workbook([headers, ['Альфа', 10, 8], [], ['Последняя', 9, 9]]), { endRow: 4 }), /Строка 3/u);
  assert.throws(() => run(sample, { endRow: 3, durationColumn: 'B' }), /разные столбцы/u);
  assert.throws(() => run(sample, { endRow: 4 }), /диапазон/iu);
  assert.throws(() => run(sample, { endRow: 3, asOf: '2026-02-31' }), /дату/iu);
  assert.throws(() => run(sample, { endRow: 3, sourceId: '0'.repeat(64) }), /контрольн/iu);
});

test('reads an injected original workbook without allowing its metadata to be supplied by the request', async () => {
  const bytes = workbook([headers, ['Альфа', 10, 8]]);
  const input = {
    sourceId: hash(bytes), sourceName: 'Подменённое имя.xlsx', period: 'Q4 2026', asOf: '2026-11-16',
    sheet: 'Команды', startRow: 2, endRow: 2, teamColumn: 'A', thresholdColumn: 'B', durationColumn: 'C', unit: 'hours',
  };
  const read = async sourceId => {
    assert.equal(sourceId, input.sourceId);
    return { source: { id: sourceId, name: 'Исходник.xlsx', type: 'xlsx' }, bytes };
  };
  const report = await buildQualityPilot(input, read);
  assert.equal(report.source.name, 'Исходник.xlsx');
  assert.equal(report.unit, 'hours');
  assert.equal(report.totals.percent, 100);
  await assert.rejects(buildQualityPilot(input, async () => ({ source: { type: 'html' }, bytes })), /XLSX/u);
});
