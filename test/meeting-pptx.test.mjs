import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

function unzip(bytes) {
  const files = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6);
    assert.equal(flags & 8, 0);
    const method = bytes.readUInt16LE(offset + 8);
    const compressedLength = bytes.readUInt32LE(offset + 18);
    const length = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    const compressed = bytes.subarray(start, start + compressedLength);
    const raw = method === 8 ? inflateRawSync(compressed) : compressed;
    assert.equal(raw.length, length);
    files.set(name, raw.toString());
    offset = start + compressedLength;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), files.size);
  assert.equal(bytes.readUInt32LE(bytes.length - 6), offset);
  return files;
}

const report = {
  title: 'Еженедельный отчёт',
  subtitle: '16–22 ноября 2026',
  slides: [{
    kind: 'summary', title: 'Сводка ДИТ & УОР', kpis: [
      { label: 'Команды в цели', value: '56 / 58', tone: 'positive' },
      { label: 'Под риском', value: 2, tone: 'risk' },
    ],
    note: 'Срез на 22 ноября',
  }, {
    kind: 'bars', title: 'Кластеры', groups: [
      { label: 'Кластер 1', segments: [{ label: 'Выполнено', value: 5, tone: 'positive' }, { label: 'Под риском', value: 1, tone: 'risk' }] },
      { label: 'Кластер 2', segments: [{ label: 'Выполнено', value: 0, tone: 'positive' }] },
    ],
  }, {
    kind: 'table', title: 'Отклонения', columns: [{ label: 'Кластер' }, { label: 'Задача', width: 2.5 }], rows: [
      ['Кластер 1', 'Разобрать <лидеров>'],
      ['Кластер 2', 'Проверить\nсрез'],
    ],
  }, {
    kind: 'columns', title: 'Поручения', blocks: [
      { title: 'Действия', items: ['Сверить факт'] },
      { title: 'Решения', items: ['Согласовать срок'] },
    ],
  }],
};

test('writes an editable widescreen OOXML presentation with valid package relationships', async () => {
  const { renderMeetingPptx } = await import('../src/meeting-pptx.mjs');
  const bytes = renderMeetingPptx(report);
  assert.ok(Buffer.isBuffer(bytes));
  assert.deepEqual(renderMeetingPptx(report), bytes, 'identical reports render identically');
  const files = unzip(bytes);
  const presentation = files.get('ppt/presentation.xml');
  assert.match(presentation, /<p:sldSz cx="12192000" cy="6858000"/);
  assert.equal((presentation.match(/<p:sldId /g) ?? []).length, 4);
  assert.match(files.get('_rels/.rels'), /Target="ppt\/presentation.xml"/);
  for (let i = 1; i <= report.slides.length; i++) {
    const slide = files.get(`ppt/slides/slide${i}.xml`);
    assert.match(slide, /<p:sp>/);
    assert.doesNotMatch(slide, /<p:pic>|External/);
    assert.match(files.get(`ppt/slides/_rels/slide${i}.xml.rels`), /Target="..\/slideLayouts\/slideLayout1.xml"/);
    assert.match(files.get('ppt/_rels/presentation.xml.rels'), new RegExp(`Target="slides/slide${i}.xml"`));
    assert.match(files.get('[Content_Types].xml'), new RegExp(`PartName="/ppt/slides/slide${i}.xml"`));
  }
  assert.match(files.get('ppt/slideMasters/_rels/slideMaster1.xml.rels'), /Target="..\/theme\/theme1.xml"/);
  assert.match(files.get('ppt/slides/slide1.xml'), /Сводка ДИТ &amp; УОР.*56 \/ 58/s);
  assert.match(files.get('ppt/slides/slide1.xml'), /009B78/);
  assert.match(files.get('ppt/slides/slide2.xml'), /Кластер 2.*>0<\/a:t>/s);
  assert.match(files.get('ppt/slides/slide3.xml'), /Разобрать &lt;лидеров&gt;/);
  assert.match(files.get('ppt/slides/slide4.xml'), /Действия.*Сверить факт.*Решения.*Согласовать срок/s);
});

test('rejects overfull table and invalid bar inputs without dropping rows', async () => {
  const { renderMeetingPptx } = await import('../src/meeting-pptx.mjs');
  const table = report.slides[2];
  assert.throws(() => renderMeetingPptx({ ...report, slides: [{ ...table, rows: Array(9).fill(['a', 'b']) }] }), /строк/u);
  const bars = report.slides[1];
  assert.throws(() => renderMeetingPptx({ ...report, slides: [{
    ...bars, groups: [{ label: 'А', segments: [{ label: 'Отрицательное', value: -3 }] }],
  }] }), /сегмент/u);
});
