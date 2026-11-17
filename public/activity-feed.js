const storageKey = 'rm-uor.activity.v1';
const routes = new Set(['history', 'connectors', 'risk-actions', 'edit', 'dit-settings']);
const limit = 80;

function eventDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : new Date(value).toISOString();
}

function safeItem(item) {
  if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || !routes.has(item.route)) return null;
  return {
    id: item.id.slice(0, 600), title: item.title.slice(0, 220), detail: String(item.detail ?? '').slice(0, 500),
    at: eventDate(item.at),
    route: item.route, targetId: typeof item.targetId === 'string' ? item.targetId.slice(0, 160) : null,
    severity: ['ok', 'warning', 'error'].includes(item.severity) ? item.severity : 'neutral', read: item.read === true
  };
}

export function readActivity(storage) {
  try {
    const items = JSON.parse(storage.getItem(storageKey));
    return Array.isArray(items) ? items.slice(0, limit).map(safeItem).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function writeActivity(storage, items) {
  try { storage.setItem(storageKey, JSON.stringify(items)); }
  catch { /* The in-memory feed remains usable if browser storage is unavailable. */ }
}

export function addActivity(items, raw) {
  const item = safeItem(raw);
  if (!item || items.some(previous => previous.id === item.id)) return items;
  return [item, ...items].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, limit);
}

export function markActivityRead(items, id) {
  return items.map(item => !id || item.id === id ? { ...item, read: true } : item);
}

export function reconcileActivity(items, { state, browser, today }) {
  const shared = state?.shared;
  for (const release of (shared?.history ?? []).slice(-5)) {
    items = addActivity(items, { id: `git:${release.version}:${release.at}`,
      title: `Общие данные обновлены · версия ${release.version}`, detail: release.author, at: release.at,
      severity: 'ok', route: 'history', targetId: String(release.version) });
  }
  if (shared?.error) {
    items = addActivity(items, { id: `git-error:${shared.revision}:${shared.error}`,
      title: 'Не удалось проверить обновления Git', detail: shared.error, at: shared.checkedAt, severity: 'error', route: 'history' });
  }
  const recentJobs = new Map();
  for (const job of browser?.jobs ?? []) {
    if (['read', 'collect'].includes(job.kind) && job.state !== 'running') recentJobs.set(`${job.connectorId}:${job.kind}`, job);
  }
  for (const job of recentJobs.values()) {
    if (job.state !== 'error') continue;
    const name = browser.connectors?.find(item => item.id === job.connectorId)?.name;
    items = addActivity(items, { id: `browser:${job.id}`, title: job.kind === 'collect' ? 'Не удалось собрать выгрузку' : 'Не удалось прочитать отчёт',
      detail: [name, job.message].filter(Boolean).join(' · '), at: job.finishedAt ?? job.startedAt,
      severity: 'error', route: 'connectors', targetId: job.connectorId });
  }
  for (const task of state?.riskActions ?? []) {
    if (!task.dueOn || task.status === 'done' || task.dueOn >= today) continue;
    items = addActivity(items, { id: `overdue:${task.id}:${task.dueOn}`, title: 'Просрочено поручение',
      detail: task.title, at: task.dueOn, severity: 'warning', route: 'risk-actions', targetId: task.id });
  }
  return items;
}
