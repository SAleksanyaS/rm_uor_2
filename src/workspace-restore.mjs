import { createHash, createHmac, randomBytes } from 'node:crypto';
import { extname, posix, win32 } from 'node:path';
import { openWorkbook, parseGoalMap } from './imports.mjs';
import { normalizeDitMeasurement } from './dit-measurement.mjs';
import { validateCards } from './visualization-config.mjs';
import { validateRiskActions } from './risk-actions.mjs';
import { normalizeMeetingConfig } from '../public/meeting-config.js';

export const maxWorkspaceBackupBytes = 128 * 1024 * 1024;
const maxOriginalBytes = 20 * 1024 * 1024;
const sha = /^[a-f0-9]{64}$/u;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const quarterOrYear = /^(?:Q[1-4] 20\d{2}|Y\d{2})$/u;
const themes = new Set(['system', 'light', 'indigo', 'slate', 'sand', 'forest', 'dark']);
const ditStatuses = new Set(['', 'Выполнено', 'Под риском', 'В плане', 'Не выполнено', 'Нет методики']);
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const workspaceFields = new Set(['schemaVersion', 'profile', 'catalogSourceId', 'catalog', 'goalEdits',
  'directory', 'drafts', 'sources', 'statusDates', 'statusLinks', 'ditStatuses', 'ditDrafts', 'automations',
  'runs', 'visualization', 'shared', 'riskActions', 'ditTimeline', 'ditExcluded', 'qualityReports', 'restoreConnectionPending', 'meetingTemplate']);
const profileFields = new Set(['name', 'remote', 'branch', 'refreshMinutes', 'theme', 'gitExecutable', 'gitAuth']);
const sourceFields = new Set(['id', 'name', 'size', 'type', 'uploadedAt', 'sheets']);
const originalFields = new Set(['id', 'base64']);
const tokenKey = randomBytes(32);

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeText = (value, max = 200, required = false) => typeof value === 'string' && value.length <= max && (!required || Boolean(value.trim()));
const id = value => safeText(value, 200, true) && !reserved.has(value) && !/[\u0000-\u001f\u007f]/u.test(value);
const known = (value, keys) => record(value) && Object.keys(value).every(key => keys.has(key));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const absolute = value => posix.isAbsolute(value) || win32.isAbsolute(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function invalid(section, status = 400) {
  return Object.assign(new Error(`Резервная копия: ${section}.`), { code: 'INVALID_BACKUP', status });
}

function check(condition, section) {
  if (!condition) throw invalid(section);
}

function realDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
    && realDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function validateTree(value, depth = 0, budget = { nodes: 0 }) {
  check(depth <= 40 && ++budget.nodes <= 2_000_000, 'превышена сложность рабочего состояния');
  if (Array.isArray(value)) {
    for (const child of value) validateTree(child, depth + 1, budget);
  } else if (record(value)) {
    for (const [key, child] of Object.entries(value)) {
      check(!reserved.has(key), 'недопустимый ключ рабочего состояния');
      validateTree(child, depth + 1, budget);
    }
  } else if (typeof value === 'number') check(Number.isFinite(value), 'встречено недопустимое число');
}

function validateList(rows, valid, key, section) {
  check(Array.isArray(rows) && rows.every(valid), section);
  if (key) check(new Set(rows.map(key)).size === rows.length, section);
}

function validateIndex(value, valid, section) {
  check(record(value) && Object.entries(value).every(([key, item]) => id(key) && valid(item, key)), section);
}

function optionalFields(value, fields, predicate) {
  return fields.every(field => value[field] === undefined || predicate(value[field]));
}

const strings = values => Array.isArray(values) && values.every(value => typeof value === 'string');
const ids = values => Array.isArray(values) && values.every(id);
const definedText = value => typeof value === 'string';

function https(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
}

function gitLocation(remote) {
  if (!safeText(remote, 500) || /[\u0000-\u001f\u007f]/u.test(remote)) return false;
  if (!remote || (absolute(remote) && !remote.startsWith('\\\\') && !remote.startsWith('//'))) return true;
  if (!remote.startsWith('https://') || /[\\\s]/u.test(remote) || !https(remote)) return false;
  const url = new URL(remote);
  return !url.search && !url.hash;
}

function gitBranch(branch) {
  return safeText(branch, 100, true) && /^[A-Za-z0-9_./-]+$/u.test(branch) && !branch.startsWith('-') && !branch.includes('..')
    && !branch.endsWith('.') && branch.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

function gitTarget(target) {
  return target == null || (record(target) && target.remote && gitLocation(target.remote) && gitBranch(target.branch));
}

function validateProfile(profile) {
  const executable = profile?.gitExecutable;
  check(known(profile, profileFields) && safeText(profile.name, 120) && gitLocation(profile.remote)
    && (profile.remote ? gitBranch(profile.branch) : safeText(profile.branch, 100, true))
    && integer(profile.refreshMinutes, 1, 1440) && (profile.theme === undefined || themes.has(profile.theme))
    && (profile.gitAuth === undefined || ['system', 'prompt'].includes(profile.gitAuth))
    && (!executable || (safeText(executable, 1000) && absolute(executable) && !/[\u0000-\u001f]/u.test(executable)
      && (!profile.remote || /(?:^|[\\/])git(?:\.exe)?$/iu.test(executable))))
    && (executable === undefined || typeof executable === 'string'),
  'некорректный профиль');
}

function validateSources(sourceRows, originalRows) {
  const section = 'некорректный перечень исходников';
  const extension = source => extname(source.name).toLowerCase().replace(/^\.htm$/u, '.html');
  validateList(sourceRows, source => known(source, sourceFields) && typeof source.id === 'string' && sha.test(source.id)
    && safeText(source.name, 200, true) && !/[\\/\u0000-\u001f]/u.test(source.name)
    && ['html', 'xlsx'].includes(source.type) && extension(source) === '.' + source.type && integer(source.size, 1, maxOriginalBytes)
    && timestamp(source.uploadedAt) && Array.isArray(source.sheets), source => source.id, section);
  validateList(originalRows, item => known(item, originalFields) && typeof item.id === 'string' && sha.test(item.id)
    && typeof item.base64 === 'string', item => item.id, section);
  check(sourceRows.length === originalRows.length, 'указаны не все исходные файлы');
  const originalById = new Map(originalRows.map(item => [item.id, item.base64]));
  const sources = new Map();
  const originals = sourceRows.map(source => {
    const encoded = originalById.get(source.id);
    check(typeof encoded === 'string' && encoded.length === Math.ceil(source.size / 3) * 4, 'не совпадает размер исходного файла');
    const bytes = Buffer.from(encoded, 'base64');
    check(bytes.length === source.size && bytes.toString('base64') === encoded && sha256(bytes) === source.id,
      'не совпадает контрольная сумма исходного файла');
    let catalog;
    let sheets = [];
    try {
      if (source.type === 'html') catalog = parseGoalMap(bytes).goals;
      else sheets = openWorkbook(bytes).sheets;
    } catch {
      throw invalid('исходник не читается приложением');
    }
    const sheetFields = ['name', 'rows', 'columns', 'hidden', 'filterRange'];
    check(source.sheets.length === sheets.length && source.sheets.every((sheet, index) => record(sheet)
      && sheetFields.every(field => sheet[field] === sheets[index][field] || (field === 'hidden' && sheet[field] === undefined && !sheets[index][field]))),
    'перечень листов не совпадает с исходной книгой');
    sources.set(source.id, { ...source, catalog });
    return { id: source.id, bytes };
  });
  return { sources, originals };
}

function assignment(row, goalId, directory) {
  return record(row) && row.goalId === goalId && id(row.leaderId) && directory.has(row.leaderId)
    && optionalFields(row, ['teams', 'agents', 'actions'], strings)
    && optionalFields(row, ['teamIds', 'agentIds', 'scopeIds'], values => ids(values) && values.every(value => directory.has(value)))
    && optionalFields(row, ['active', 'allProducts'], value => typeof value === 'boolean')
    && optionalFields(row, ['title', 'target', 'summary', 'metric', 'participantType'], definedText);
}

function goalRow(goal, directory) {
  return record(goal) && id(goal.id) && safeText(goal.title, Infinity, true)
    && optionalFields(goal, ['description', 'scope', 'method', 'target', 'category', 'metric', 'status', 'scopeType', 'summary', 'outOfScopeReason'], definedText)
    && optionalFields(goal, ['curators', 'actions'], strings)
    && (goal.links === undefined || (Array.isArray(goal.links) && goal.links.every(link => record(link) && https(link.url)
      && optionalFields(link, ['label', 'kind'], definedText))))
    && (goal.assignments === undefined || (Array.isArray(goal.assignments) && goal.assignments.every(row => assignment(row, goal.id, directory))));
}

function validateCatalog(state, sources) {
  validateList(state.directory, row => record(row) && id(row.id) && safeText(row.name, Infinity, true)
    && safeText(row.type, Infinity, true) && optionalFields(row, ['leaderId'], id) && optionalFields(row, ['aliases'], strings)
    && optionalFields(row, ['edited'], value => typeof value === 'boolean'), row => row.id, 'некорректный справочник');
  const directory = new Set(state.directory.map(row => row.id));
  check(directory.has('dit'), 'в справочнике отсутствует уровень ДИТ');
  validateList(state.catalog, row => goalRow(row, directory), row => row.id, 'некорректный каталог');
  if (state.catalogSourceId !== undefined) {
    const map = sources.get(state.catalogSourceId)?.catalog;
    const sourceGoals = new Set(map?.map(goal => goal.id));
    check(state.catalogSourceId === null ? !state.catalog.length : map && sourceGoals.size === state.catalog.length
      && state.catalog.every(goal => sourceGoals.has(goal.id)), 'каталог не соответствует активной карте');
  }
  validateIndex(state.goalEdits ?? {}, row => record(row) && safeText(row.title, 400, true)
    && optionalFields(row, ['target', 'description', 'method'], definedText)
    && optionalFields(row, ['curators'], strings), 'некорректные правки карточек целей');
}

function result(row) {
  return record(row) && id(row.scopeId) && safeText(row.period, 60, true) && realDate(row.asOf)
    && (row.value == null || (typeof row.value === 'number' && row.value >= 0 && row.value <= 1_000_000))
    && optionalFields(row, ['status', 'plan', 'comment', 'risk', 'author', 'savedAt'], definedText)
    && (row.mode === undefined || ['manual', 'automatic'].includes(row.mode));
}

const resultKey = row => JSON.stringify([row.scopeId, row.period]);
const ditKey = row => JSON.stringify([row.goalId, row.period]);

function ditRow(row) {
  if (!record(row) || !id(row.goalId) || typeof row.period !== 'string' || !quarterOrYear.test(row.period)
    || !ditStatuses.has(row.status) || typeof row.revision !== 'string' || !uuid.test(row.revision)) return false;
  if (row.measurement !== undefined) {
    try { normalizeDitMeasurement(row.goalId, row.period, row.measurement); }
    catch { return false; }
  }
  return true;
}

function validateResults(state) {
  const draftSection = 'некорректные черновики целей';
  validateIndex(state.drafts, rows => {
    validateList(rows, row => result(row) && (row.base == null || result(row.base)) && gitTarget(row.target), resultKey, draftSection);
    return true;
  }, draftSection);
  const ditSection = 'некорректные черновики ДИТ';
  validateList(state.ditDrafts ?? [], row => ditRow(row) && gitTarget(row.target)
    && (row.base == null || (ditRow(row.base) && ditKey(row.base) === ditKey(row))), ditKey, ditSection);
  if (state.ditStatuses !== undefined) validateList(state.ditStatuses, ditRow, ditKey, ditSection);

  const sharedSection = 'некорректная общая версия';
  const { shared } = state;
  check(record(shared) && (shared.revision === null || id(shared.revision)) && integer(shared.version, 0, Number.MAX_SAFE_INTEGER)
    && (shared.checkedAt == null || timestamp(shared.checkedAt)) && (shared.error == null || typeof shared.error === 'string'), sharedSection);
  validateList(shared.goals, goal => {
    if (!record(goal) || !id(goal.id) || !safeText(goal.title, 400, true)) return false;
    validateList(goal.results, result, resultKey, sharedSection);
    return true;
  }, goal => goal.id, sharedSection);
  validateList(shared.ditStatuses ?? [], ditRow, ditKey, sharedSection);
  validateList(shared.history, item => record(item) && integer(item.version, 1, Number.MAX_SAFE_INTEGER)
    && safeText(item.author, 120, true) && timestamp(item.at ?? item.publishedAt)
    && (item.goalIds === undefined || ids(item.goalIds)), item => item.version, sharedSection);
}

function column(value) {
  return typeof value === 'string' && /^[A-Z]{1,3}$/u.test(value)
    && [...value].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) <= 16384;
}

function validateConfiguration(state, sources) {
  const xlsx = sourceId => sources.get(sourceId)?.type === 'xlsx';
  const recipe = row => record(row) && xlsx(row.sourceId) && sources.get(row.sourceId).sheets.some(sheet => sheet.name === row.sheet)
    && column(row.scopeColumn) && column(row.valueColumn) && row.scopeColumn !== row.valueColumn
    && integer(row.headerRow, 1, 1_000_000) && (row.endRow == null || integer(row.endRow, row.headerRow + 1, 1_048_576))
    && safeText(row.period, 60, true) && realDate(row.asOf) && ['percent', 'fraction'].includes(row.scale);
  validateIndex(state.automations ?? {}, recipe, 'некорректные правила расчёта');
  validateIndex(state.runs ?? {}, row => {
    if (!record(row) || !recipe(row.recipe)) return false;
    validateList(row.rows, result, resultKey, 'некорректные строки расчёта');
    return true;
  }, 'некорректные результаты расчёта');
  validateIndex(state.statusDates ?? {}, (row, key) => xlsx(key) && record(row) && realDate(row.asOf)
    && Array.isArray(row.periods) && row.periods.length && row.periods.every(period => typeof period === 'string' && quarterOrYear.test(period))
    && typeof row.revision === 'string' && uuid.test(row.revision), 'некорректные даты срезов');
  validateIndex(state.statusLinks ?? {}, row => record(row) && xlsx(row.sourceId)
    && integer(row.sourceRow, 1, 1_048_576) && (row.goalId === null || id(row.goalId)) && (row.scopeId == null || id(row.scopeId))
    && typeof row.revision === 'string' && uuid.test(row.revision), 'некорректные связи срезов');
  if (state.visualization !== undefined) {
    check(record(state.visualization) && (state.visualization.revision == null || uuid.test(state.visualization.revision)), 'некорректная версия визуализации');
    if (state.visualization.cards !== null) {
      try { validateCards(state.visualization.cards); }
      catch { throw invalid('некорректные карточки визуализации'); }
    }
  }
  for (const field of ['riskActions', 'ditTimeline', 'qualityReports']) {
    if (state[field] !== undefined) validateList(state[field], record, null, 'некорректные данные отчётов');
  }
  if (state.riskActions !== undefined) {
    try { validateRiskActions(state.riskActions); }
    catch { throw invalid('некорректные поручения'); }
  }
  if (state.ditExcluded !== undefined) validateList(state.ditExcluded,
    row => record(row) && id(row.goalId) && typeof row.period === 'string' && quarterOrYear.test(row.period),
    ditKey, 'некорректная применимость ДИТ');
  if (state.meetingTemplate !== undefined) {
    check(record(state.meetingTemplate) && typeof state.meetingTemplate.revision === 'string'
      && uuid.test(state.meetingTemplate.revision) && record(state.meetingTemplate.config), 'некорректный шаблон встречи');
    try { normalizeMeetingConfig(state.meetingTemplate.config); }
    catch { throw invalid('некорректные параметры шаблона встречи'); }
  }
  check(state.restoreConnectionPending === undefined || typeof state.restoreConnectionPending === 'boolean', 'некорректное состояние подключения');
}

export function parseWorkspaceBackup(bytes) {
  check(bytes instanceof Uint8Array && bytes.byteLength > 0, 'выберите файл копии JSON');
  if (bytes.byteLength > maxWorkspaceBackupBytes) throw invalid('файл превышает 128 МиБ', 413);
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw invalid('не удалось прочитать JSON в UTF-8'); }
  check(known(payload, new Set(['format', 'exportedAt', 'workspace', 'originals'])) && payload.format === 'rm-uor-workspace-v1'
    && timestamp(payload.exportedAt) && known(payload.workspace, workspaceFields) && payload.workspace.schemaVersion === 1,
  'формат или версия файла не поддерживаются');
  const { workspace, exportedAt } = payload;
  validateTree(workspace);
  validateProfile(workspace.profile);
  const { sources, originals } = validateSources(workspace.sources, payload.originals);
  validateCatalog(workspace, sources);
  validateResults(workspace);
  validateConfiguration(workspace, sources);
  const count = rows => Object.values(rows).reduce((sum, group) => sum + group.length, 0);
  return { workspace, originals, digest: sha256(bytes), summary: { exportedAt, goals: workspace.catalog.length, sources: sources.size,
    results: workspace.shared.goals.reduce((sum, goal) => sum + goal.results.length, 0), drafts: count(workspace.drafts),
    ditStatuses: new Set([...(workspace.shared.ditStatuses ?? []), ...(workspace.ditDrafts ?? workspace.ditStatuses ?? [])].map(ditKey)).size } };
}

export function workspaceRestoreToken(backupDigest, currentWorkspace) {
  return createHmac('sha256', tokenKey).update(backupDigest).update('\0').update(JSON.stringify(currentWorkspace)).digest('hex');
}
