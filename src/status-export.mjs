import { openWorkbook, openZip } from './imports.mjs';
import { writeZip } from './ooxml-zip.mjs';

const excludedGoals = new Set(['monitor', 'removed', 'outOfScope']);
const sheetName = 'Статусы РМ УОР';
const basePath = '/xl/worksheets/rm-uor-status-export.xml';
const type = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const key = (goalId, scopeId, period) => JSON.stringify([goalId, scopeId, period]);

const legend = new Map([
  ['выполнено', 'выполнено'], ['в плане', 'в плане'], ['есть риски', 'есть риски'], ['риск принят', 'риск принят'],
  ['нет методики для оценки статуса исполнения', 'нет методики для оценки статуса исполнения'],
  ['данные не предоставлены', 'данные не предоставлены'], ['год', 'год'],
  ['не выполнено', 'не выполнено'], ['вне скоупа', 'вне скоупа'],
  ['под риском', 'есть риски'], ['есть риск', 'есть риски'], ['риски приняты', 'риск принят'],
  ['нет методики', 'нет методики для оценки статуса исполнения'], ['нет данных', 'данные не предоставлены'],
  ['в работе', 'в плане'], ['неприменимо', 'вне скоупа']
]);

function addResults(records, rows, goal, origin, scopeId) {
  for (const row of rows ?? []) {
    const scope = scopeId ?? row.scopeId;
    const id = key(goal.id, scope, row.period);
    if (row.status || row.measurement || row.value != null || row.plan || row.comment || row.risk) {
      records.set(id, { ...row, scopeId: scope, goalId: goal.id, title: goal.title, origin });
    } else {
      records.delete(id);
    }
  }
}

export function planStatusExport(state, register, includeDrafts) {
  const directory = new Map(state.directory.map(entry => [entry.id, entry]));
  const goals = new Map(state.goals.filter(goal => !excludedGoals.has(goal.status)).map(goal => [goal.id, goal]));
  const assignments = new Set([...goals.values()].flatMap(goal => (goal.assignments ?? [])
    .filter(row => row.active !== false && directory.get(row.leaderId)?.type === 'leader')
    .map(row => JSON.stringify([goal.id, row.leaderId]))));
  const excluded = new Set((state.ditExcluded ?? []).map(row => key(row.goalId, 'dit', row.period)));
  const records = new Map();
  for (const goal of goals.values()) {
    const allowed = row => row.scopeId === 'dit' ? !excluded.has(key(goal.id, 'dit', row.period))
      : assignments.has(JSON.stringify([goal.id, row.scopeId]));
    addResults(records, goal.published?.filter(allowed), goal, 'Опубликовано');
    if (includeDrafts) addResults(records, goal.local?.filter(allowed), goal, 'Черновик');
  }
  for (const [rows, origin] of [[state.ditPublished, 'Опубликовано'], [includeDrafts ? state.ditDrafts : [], 'Черновик']]) {
    for (const row of rows ?? []) {
      const goal = goals.get(row.goalId);
      if (goal && !excluded.has(key(goal.id, 'dit', row.period))) addResults(records, [row], goal, origin, 'dit');
    }
  }
  const candidates = new Map();
  for (const entry of register.entries) {
    if (!entry.goalId || !entry.scopeId || !['confirmed', 'suggested'].includes(entry.linkState)) continue;
    const id = key(entry.goalId, entry.scopeId, entry.period);
    if (!candidates.has(id)) candidates.set(id, []);
    candidates.get(id).push(entry);
  }
  const updates = new Map();
  const details = [];
  for (const [id, row] of records) {
    const matches = candidates.get(id) ?? [];
    const confirmed = matches.filter(entry => entry.linkState === 'confirmed');
    const selected = confirmed.length ? confirmed : matches;
    const entry = selected.length === 1 ? selected[0] : null;
    const status = legend.get(String(row.status ?? '').normalize('NFKC').toLowerCase().replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim());
    let result = !selected.length ? 'Нет связанной строки КР' : 'Несколько строк КР';
    if (entry && status) {
      updates.set((entry.period === register.periods[0] ? 'T' : 'V') + entry.sourceRow, status);
      result = `Строка ${entry.sourceRow}`;
    } else if (entry) {
      result = row.status ? 'Статуса нет в легенде Excel' : 'Статус не задан';
    }
    details.push({ ...row, scope: directory.get(row.scopeId)?.name ?? (row.scopeId === 'dit' ? 'ДИТ OPS' : row.scopeId),
      result, rowNumber: entry && status ? entry.sourceRow : null });
  }
  return { details, updates };
}

function xml(value) {
  return String(value ?? '').toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, '')
    .replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}

function cell(ref, value, attr = '', prefix = '') {
  if (typeof value === 'number') return `<${prefix}c${attr}><${prefix}v>${value}</${prefix}v></${prefix}c>`;
  return `<${prefix}c${attr || ` r="${ref}"`} t="inlineStr"><${prefix}is><${prefix}t xml:space="preserve">${xml(value)}</${prefix}t></${prefix}is></${prefix}c>`;
}

function annex(details) {
  const rows = [['Цель', 'Название', 'Уровень', 'Период', 'Статус', 'Факт', 'План числом', 'Ед. изм.',
    'Дата факта', 'План действий', 'Комментарий', 'Риск', 'Результат в реестре', 'Запись в РМ УОР']];
  for (const row of details) rows.push([row.goalId, row.title, row.scope, row.period, row.status,
    row.measurement?.fact ?? row.value, row.measurement?.plan, row.measurement?.unit ?? (row.value == null ? '' : '%'),
    row.measurement?.asOf ?? row.asOf, row.plan, row.comment, row.risk, row.result, row.origin]);
  const data = rows.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => {
    const ref = String.fromCharCode(65 + j) + (i + 1);
    return value == null ? '' : cell(ref, value, ` r="${ref}"`);
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="3" width="42" customWidth="1"/><col min="4" max="9" width="21" customWidth="1"/><col min="10" max="14" width="34" customWidth="1"/></cols><sheetData>${data}</sheetData><autoFilter ref="A1:N${rows.length}"/></worksheet>`;
}

function insertBefore(text, close, addition) {
  if (!text.includes(close)) throw new Error('Структура шаблона XLSX не поддерживается.');
  return text.replace(close, addition + close);
}

export function writeStatusWorkbook(bytes, sheet, model) {
  const book = openWorkbook(bytes);
  const target = book.sheetPath(sheet);
  const read = openZip(bytes);
  if (!target || read.names.includes(basePath.slice(1)) || book.sheets.some(tab => tab.name === sheetName)) {
    throw new Error('Выберите исходную книгу реестра без выгрузки РМ УОР.');
  }
  const text = path => read(path).toString('utf8');
  const workbookPath = 'xl/workbook.xml';
  const relsPath = 'xl/_rels/workbook.xml.rels';
  const contentPath = '[Content_Types].xml';
  const workbook = text(workbookPath);
  const sheetId = 1 + Math.max(0, ...[...workbook.matchAll(/\bsheetId="(\d+)"/gu)].map(match => Number(match[1])));
  const relationship = 'rIdRmUorStatusExport';
  const sheetRef = `<sheet name="${sheetName}" sheetId="${sheetId}" xmlns:r="${type}" r:id="${relationship}"/>`;
  const patched = new Set();
  const mainSheet = text(target).replace(/<((?:[\w.-]+:)?)(?:c)(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/\1c\s*>)/gu, (raw, prefix, attr, value) => {
    const ref = /\br="([TV]\d+)"/u.exec(attr)?.[1];
    const status = model.updates.get(ref);
    if (status === undefined) return raw;
    if (/<(?:[\w.-]+:)?f(?=[\s/>])/u.test(value ?? '')) throw new Error('В ячейке статуса есть формула.');
    patched.add(ref);
    return cell(ref, status, attr.replace(/\s+t="[^"]*"/u, ''), prefix);
  });
  if (patched.size !== model.updates.size) throw new Error('В шаблоне отсутствует ячейка статуса. Проверьте книгу Excel.');
  const replacements = new Map([
    [target, mainSheet],
    [workbookPath, insertBefore(workbook, '</sheets>', sheetRef)],
    [relsPath, insertBefore(text(relsPath), '</Relationships>',
      `<Relationship Id="${relationship}" Type="${type}/worksheet" Target="worksheets/rm-uor-status-export.xml"/>`)],
    [contentPath, insertBefore(text(contentPath), '</Types>',
      `<Override PartName="${basePath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)]
  ]);
  for (const path of read.names.filter(name => /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/u.test(name))) {
    replacements.set(path, text(path).replace(/<pivotCacheDefinition\b([^>]+)>/u,
      (_, attrs) => `<pivotCacheDefinition${attrs.replace(/\s+refreshOnLoad="[^"]*"/u, '')} refreshOnLoad="1">`));
  }
  return writeZip([...read.names.map(path => [path, replacements.get(path) ?? read(path)]), [basePath.slice(1), annex(model.details)]]);
}
