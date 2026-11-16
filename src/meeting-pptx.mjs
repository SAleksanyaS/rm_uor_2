import { deflateRawSync } from 'node:zlib';

const w = 960;
const h = 540;
const left = 48;
const width = w - 2 * left;
const font = 'Aptos';
const color = {
  ink: '24283A', secondary: '53617C', white: 'FFFFFF', paper: 'F6F7FB', line: 'DDE2EE',
  positive: '009B78', risk: 'C66A00', neutral: '7353D6', muted: '7D88A8', negative: 'B63C57',
};
const tint = { positive: 'E5F7F1', risk: 'FFF2E2', neutral: 'F0EBFF', muted: 'EEF1F7', negative: 'FCECF0' };
const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkg = 'http://schemas.openxmlformats.org/package/2006';
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const namespaces = `xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"`;
const emu = value => Math.round(value * 12700);
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const n = value => decimal.format(value);

function asText(value) {
  return String(value ?? '').replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '').replace(/\r\n?/gu, '\n');
}

function escape(value) {
  return asText(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function validList(list, max, label) {
  if (!Array.isArray(list) || list.length > max) throw new Error(`Проверьте количество ${label} на слайде. Допустимо до ${max}.`);
  return list;
}

const fill = hex => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
const noLine = '<a:ln><a:noFill/></a:ln>';
const rect = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
const groupRoot = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const rgb = tone => Object.hasOwn(tint, tone) ? color[tone] : color.neutral;
const pale = tone => Object.hasOwn(tint, tone) ? tint[tone] : tint.neutral;

function geometry(x, y, boxWidth, boxHeight) {
  return `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(boxWidth)}" cy="${emu(boxHeight)}"/></a:xfrm>${rect}`;
}

function estimatedWidth(line) {
  let total = 0;
  for (const char of line) {
    if (/\s/u.test(char)) total += 0.28;
    else if (/[.,:;!|ilI1'’]/u.test(char)) total += 0.29;
    else if (/[ШЩМЖЮФW@%]/iu.test(char)) total += 0.79;
    else if (/[А-ЯЁA-Z]/u.test(char)) total += 0.62;
    else total += 0.54;
  }
  return total;
}

function fitSize(lines, size, min, boxWidth, boxHeight) {
  const lineUnits = lines.map(estimatedWidth);
  for (let candidate = size; candidate >= min; candidate--) {
    const needed = lineUnits.reduce((sum, units) => sum + Math.max(1, Math.ceil(units * candidate / boxWidth)), 0);
    if (needed * candidate * 1.16 <= boxHeight) return candidate;
  }
  return min;
}

class Canvas {
  parts = [];
  nextId = 2;

  shape(name, x, y, boxWidth, boxHeight, background, border) {
    if (boxWidth <= 0 || boxHeight <= 0) return;
    const stroke = border ? `<a:ln w="9525">${fill(border)}</a:ln>` : noLine;
    this.parts.push(`<p:sp><p:nvSpPr><p:cNvPr id="${this.nextId++}" name="${escape(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${geometry(x, y, boxWidth, boxHeight)}${fill(background)}${stroke}</p:spPr></p:sp>`);
  }

  text(name, value, x, y, boxWidth, boxHeight, { size = 14, min = size, ink = color.ink, bold = false, align = 'l', anchor = 't' } = {}) {
    const content = asText(value);
    if (!content) return;
    const lines = content.split('\n');
    const fontSize = fitSize(lines, size, min, boxWidth, boxHeight) * 100;
    const paragraphs = lines.map(line => `<a:p><a:pPr algn="${align}"><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr><a:r><a:rPr lang="ru-RU" sz="${fontSize}" b="${bold ? 1 : 0}">${fill(ink)}<a:latin typeface="${font}"/><a:ea typeface="${font}"/><a:cs typeface="${font}"/></a:rPr><a:t>${escape(line)}</a:t></a:r><a:endParaRPr lang="ru-RU" sz="${fontSize}"/></a:p>`).join('');
    this.parts.push(`<p:sp><p:nvSpPr><p:cNvPr id="${this.nextId++}" name="${escape(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${geometry(x, y, boxWidth, boxHeight)}<a:noFill/>${noLine}</p:spPr><p:txBody><a:bodyPr wrap="square" anchor="${anchor}" lIns="0" tIns="0" rIns="0" bIns="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`);
  }

  draw(index, slide, report) {
    const title = asText(slide.title);
    if (!title.trim()) throw new Error(`Укажите заголовок слайда ${index + 1}.`);
    this.shape('Акцент отчёта', left, 35, 20, 4, color.neutral);
    const label = title === report.title ? 'ДИТ OPS · УОР' : report.title;
    this.text('Название отчёта', label, left + 29, 28, width - 95, 22, { size: 12, min: 10, ink: color.neutral, bold: true });
    this.text('Номер страницы', `${index + 1} / ${report.slides.length}`, w - left - 62, 28, 62, 18, { size: 11, ink: color.secondary, align: 'r' });
    this.text('Заголовок слайда', title, left, 61, width, 57, { size: 32, min: 22, bold: true });
    this.text('Подзаголовок', slide.subtitle ?? (index === 0 ? report.subtitle : ''), left, 120, width, 33, { size: 15, min: 11, ink: color.secondary });
    const top = 164;
    const bottom = slide.note ? 451 : 489;
    switch (slide.kind) {
      case 'summary': renderSummary(this, slide, top, bottom); break;
      case 'bars': renderBars(this, slide, top, bottom); break;
      case 'table': renderTable(this, slide, top, bottom); break;
      case 'columns': renderColumns(this, slide, top, bottom); break;
      default: throw new Error(`Неизвестный вид слайда ${index + 1}.`);
    }
    if (slide.note) {
      this.shape('Подложка примечания', left, 465, width, 28, tint.neutral);
      this.text('Примечание', slide.note, left + 10, 467, width - 20, 24, { size: 11, min: 9, ink: color.ink, anchor: 'ctr' });
    }
    this.shape('Линия подвала', left, 503, width, 0.7, color.line);
    this.text('Подвал слайда', slide.footer ?? report.subtitle, left, 512, width, 17, { size: 10, min: 9, ink: color.secondary });
  }
}

function renderSummary(canvas, { kpis }, top, bottom) {
  const entries = validList(kpis ?? [], 6, 'показателей');
  if (!entries.length) return;
  const columns = entries.length === 4 ? 2 : Math.min(entries.length, 3);
  const gap = 14;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = Math.min(130, (bottom - top - gap * (Math.ceil(entries.length / columns) - 1)) / Math.ceil(entries.length / columns));
  entries.forEach(({ label, value, tone }, index) => {
    const x = left + (index % columns) * (cardWidth + gap);
    const y = top + Math.floor(index / columns) * (cardHeight + gap);
    canvas.shape('Карточка показателя', x, y, cardWidth, cardHeight, color.white, color.line);
    canvas.shape('Акцент показателя', x, y, cardWidth, 3.5, rgb(tone));
    canvas.text('Показатель', label, x + 16, y + 13, cardWidth - 32, 40, { size: 17, min: 13, bold: true });
    canvas.text('Значение показателя', value, x + 16, y + 55, cardWidth - 32, cardHeight - 63,
      { size: 37, min: 22, bold: true, ink: rgb(tone), anchor: 'ctr' });
  });
}

function renderBars(canvas, { groups }, top, bottom) {
  groups = validList(groups ?? [], 8, 'групп');
  if (!groups.length) return;
  const keys = new Map();
  const rows = groups.map(group => {
    const values = new Map();
    for (const segment of validList(group.segments, 6, 'сегментов')) {
      if (!asText(segment.label).trim() || !Number.isFinite(segment.value) || segment.value < 0 || values.has(segment.label)) {
        throw new Error('Проверьте подписи и значения сегментов.');
      }
      values.set(segment.label, segment.value);
      if (keys.has(segment.label) && keys.get(segment.label) !== rgb(segment.tone)) {
        throw new Error('Одинаковым сегментам нужен один цвет.');
      }
      keys.set(segment.label, rgb(segment.tone));
    }
    const total = [...values.values()].reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total)) throw new Error('Проверьте сумму сегментов.');
    return { label: group.label, values, total };
  });
  const segments = validList([...keys], 6, 'типов сегментов');
  const maximum = Math.max(1, ...rows.map(row => row.total));
  const numbersWidth = segments.length * 68;
  const chartWidth = width - numbersWidth - 250;
  const chartStart = left + 188;
  const valuesStart = w - left - numbersWidth;
  const totalStart = valuesStart - 48;
  const headerHeight = 42;
  const rowHeight = Math.min(46, (bottom - top - headerHeight) / rows.length);
  canvas.text('Заголовок итогового столбца', 'Всего', totalStart, top + 9, 42, 23,
    { size: 11, ink: color.secondary, bold: true, align: 'r', anchor: 'ctr' });
  segments.forEach(([label, shade], index) => {
    const x = valuesStart + index * 68;
    canvas.shape('Цвет серии', x + 13, top + 3, 42, 3, shade);
    canvas.text('Подпись серии', label, x + 1, top + 9, 66, 27,
      { size: 11, min: 9, ink: color.secondary, align: 'ctr', anchor: 'ctr' });
  });
  rows.forEach(({ label, values, total }, index) => {
    const y = top + headerHeight + index * rowHeight;
    canvas.shape('Разделитель строк', left, y - 1, width, 0.65, color.line);
    canvas.text('Группа', label, left, y + 2, 174, rowHeight - 4, { size: 14, min: 11, bold: true, anchor: 'ctr' });
    let offset = chartStart;
    const barHeight = Math.min(17, rowHeight * 0.62);
    const barY = y + (rowHeight - barHeight) / 2;
    canvas.shape('Шкала', chartStart, barY, chartWidth, barHeight, tint.muted);
    segments.forEach(([segment, shade], column) => {
      const value = values.get(segment) ?? 0;
      const segmentWidth = value / maximum * chartWidth;
      canvas.shape('Сегмент: ' + segment, offset, barY, segmentWidth, barHeight, shade);
      offset += segmentWidth;
      canvas.text('Значение сегмента', n(value), valuesStart + column * 68, y + 1, 68, rowHeight - 2,
        { size: 12, min: 9, ink: value ? color.ink : color.secondary, align: 'ctr', anchor: 'ctr' });
    });
    canvas.text('Всего по группе', n(total), totalStart, y + 1, 42, rowHeight - 2,
      { size: 13, min: 9, bold: true, align: 'r', anchor: 'ctr' });
  });
}

function renderTable(canvas, { columns, rows }, top, bottom) {
  columns = validList(columns, 6, 'столбцов');
  rows = validList(rows, 8, 'строк');
  if (!columns.length || rows.some(row => !Array.isArray(row) || row.length !== columns.length)
    || columns.some(column => column.width !== undefined && (!Number.isFinite(column.width) || column.width <= 0))) {
    throw new Error('Проверьте структуру таблицы.');
  }
  const weights = columns.map(column => column.width ?? 1);
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(weightSum) || weights.some(value => value / weightSum * width < 29)) {
    throw new Error('Проверьте ширину столбцов таблицы.');
  }
  const widths = weights.map(value => value / weightSum * width);
  const header = 37;
  const sizes = rows.map(row => Math.max(39, ...row.map((value, index) => {
    const lineCount = asText(value).split('\n').reduce((count, line) =>
      count + Math.max(1, Math.ceil(estimatedWidth(line) * 13 / (widths[index] - 18))), 0);
    return 8 + lineCount * 15;
  })));
  const ratio = Math.min(1, (bottom - top - header) / (sizes.reduce((sum, size) => sum + size, 0) || 1));
  canvas.shape('Шапка таблицы', left, top, width, header, tint.neutral);
  const line = (values, y, rowSize, headerRow) => {
    let x = left;
    values.forEach((value, index) => {
      canvas.text(headerRow ? 'Столбец' : 'Ячейка', value, x + 9, y + 3, widths[index] - 18, rowSize - 6,
        { size: headerRow ? 13 : 14, min: 10, ink: color.ink, bold: headerRow || index === 0, anchor: 'ctr' });
      x += widths[index];
    });
  };
  line(columns.map(column => column.label), top, header, true);
  let y = top + header;
  rows.forEach((row, index) => {
    const rowHeight = sizes[index] * ratio;
    canvas.shape('Строка таблицы', left, y, width, rowHeight, index % 2 ? color.paper : color.white);
    canvas.shape('Разделитель строк', left, y + rowHeight - 0.6, width, 0.6, color.line);
    line(row, y, rowHeight, false);
    y += rowHeight;
  });
}

function renderColumns(canvas, { blocks }, top, bottom) {
  blocks = validList(blocks ?? [], 4, 'блоков');
  if (!blocks.length) return;
  const columns = Math.min(blocks.length, 2);
  const gap = 14;
  const boxWidth = (width - (columns - 1) * gap) / columns;
  const boxCount = Math.ceil(blocks.length / columns);
  const boxHeight = (bottom - top - (boxCount - 1) * gap) / boxCount;
  blocks.forEach(({ title, items, tone }, index) => {
    const x = left + (index % columns) * (boxWidth + gap);
    const y = top + Math.floor(index / columns) * (boxHeight + gap);
    canvas.shape('Блок отчёта', x, y, boxWidth, boxHeight, color.white, color.line);
    canvas.shape('Шапка блока', x, y, boxWidth, 36, pale(tone));
    canvas.text('Название блока', title, x + 14, y + 2, boxWidth - 28, 31, { size: 16, min: 11, bold: true, anchor: 'ctr' });
    items = validList(items ?? [], 8, 'пунктов');
    const rowHeight = Math.min(46, (boxHeight - 47) / Math.max(1, items.length));
    items.forEach((item, itemIndex) => {
      const itemY = y + 42 + itemIndex * rowHeight;
      canvas.shape('Маркер пункта', x + 15, itemY + 6, 4, 4, rgb(tone));
      canvas.text('Пункт отчёта', item, x + 26, itemY, boxWidth - 41, rowHeight - 1, { size: 14, min: 10 });
    });
  });
}

function relationships(entries) {
  return declaration + `<Relationships xmlns="${pkg}/relationships">` +
    entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`).join('') +
    '</Relationships>';
}

const mapColors = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const masterMap = '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>';
const emptyTree = `<p:spTree>${groupRoot}</p:spTree>`;

function theme() {
  const themeColors = {
    dk1: color.ink, lt1: color.white, dk2: color.secondary, lt2: color.paper, accent1: color.neutral,
    accent2: color.positive, accent3: color.risk, accent4: color.negative, accent5: color.muted,
    accent6: color.line, hlink: color.neutral, folHlink: color.negative,
  };
  const scheme = Object.entries(themeColors).map(([key, hex]) => `<a:${key}><a:srgbClr val="${hex}"/></a:${key}>`).join('');
  const fontGroup = `<a:latin typeface="${font}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  const ph = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const lines = [9525, 19050, 28575].map(lineWidth => `<a:ln w="${lineWidth}">${ph}<a:prstDash val="solid"/></a:ln>`).join('');
  return declaration + `<a:theme xmlns:a="${a}" name="ДИТ OPS"><a:themeElements>
    <a:clrScheme name="ДИТ OPS">${scheme}</a:clrScheme>
    <a:fontScheme name="Aptos"><a:majorFont>${fontGroup}</a:majorFont><a:minorFont>${fontGroup}</a:minorFont></a:fontScheme>
    <a:fmtScheme name="ДИТ OPS"><a:fillStyleLst>${ph.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${lines}</a:lnStyleLst>
    <a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${ph.repeat(3)}</a:bgFillStyleLst></a:fmtScheme>
    </a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

function packageFiles(report, slides) {
  const slideFiles = slides.map((_, i) => `slides/slide${i + 1}.xml`);
  const contentTypes = [
    ['presentation.xml', 'presentationml.presentation.main'],
    ['slideMasters/slideMaster1.xml', 'presentationml.slideMaster'],
    ['slideLayouts/slideLayout1.xml', 'presentationml.slideLayout'],
    ...slideFiles.map(name => [name, 'presentationml.slide']),
  ];
  const ct = declaration + `<Types xmlns="${pkg}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    contentTypes.map(([name, type]) => `<Override PartName="/ppt/${name}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join('') +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>';
  const pres = declaration + `<p:presentation ${namespaces}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>` +
    slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${2 + i}"/>`).join('') +
    `</p:sldIdLst><p:sldSz cx="${emu(w)}" cy="${emu(h)}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const master = declaration + `<p:sldMaster ${namespaces}><p:cSld>${emptyTree}</p:cSld>${mapColors}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
  const layout = declaration + `<p:sldLayout ${namespaces} type="blank" preserve="1"><p:cSld name="Пустой слайд">${emptyTree}</p:cSld>${masterMap}</p:sldLayout>`;
  const files = [
    ['[Content_Types].xml', ct],
    ['_rels/.rels', relationships([['rId1', 'officeDocument', 'ppt/presentation.xml']])],
    ['ppt/presentation.xml', pres],
    ['ppt/_rels/presentation.xml.rels', relationships([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ...slideFiles.map((name, i) => [`rId${i + 2}`, 'slide', name])])],
    ['ppt/slideMasters/slideMaster1.xml', master],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']])],
    ['ppt/slideLayouts/slideLayout1.xml', layout],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationships([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])],
    ['ppt/theme/theme1.xml', theme()],
  ];
  slides.forEach((slide, i) => {
    const canvas = new Canvas();
    canvas.draw(i, slide, report);
    const bg = `<p:bg><p:bgPr>${fill(color.paper)}<a:effectLst/></p:bgPr></p:bg>`;
    files.push([`ppt/${slideFiles[i]}`, declaration + `<p:sld ${namespaces}><p:cSld>${bg}<p:spTree>${groupRoot}${canvas.parts.join('')}</p:spTree></p:cSld>${masterMap}</p:sld>`]);
    files.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, relationships([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])]);
  });
  return files;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ -1) >>> 0;
}

function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  let directoryLength = 0;
  for (const [path, content] of files) {
    const name = Buffer.from(path);
    const bytes = Buffer.from(content);
    const compressed = deflateRawSync(bytes);
    const record = Buffer.alloc(30);
    record.writeUInt32LE(0x04034b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(8, 8);
    record.writeUInt16LE(33, 12);
    record.writeUInt32LE(crc32(bytes), 14);
    record.writeUInt32LE(compressed.length, 18);
    record.writeUInt32LE(bytes.length, 22);
    record.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    record.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42);
    local.push(record, name, compressed);
    central.push(entry, name);
    offset += record.length + name.length + compressed.length;
    directoryLength += entry.length + name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

export function renderMeetingPptx(report) {
  if (!asText(report?.title).trim()) throw new Error('Укажите название отчёта.');
  const slides = validList(report.slides, 500, 'слайдов');
  if (!slides.length) throw new Error('Добавьте хотя бы один слайд в отчёт.');
  return zip(packageFiles(report, slides));
}
