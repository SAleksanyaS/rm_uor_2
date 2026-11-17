const healthLabels = new Map([
  ['ok', 'В порядке'], ['warning', 'Требует внимания'], ['error', 'Ошибка'], ['neutral', 'Нет данных'],
]);

const bell = '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>';
const pulse = '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M6 12h3l2-4 2 8 2-4h3"/>';

const severityValue = value => healthLabels.has(value) ? value : 'neutral';
const icon = content => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${content}</svg>`;

function fragment(route) {
  if (typeof route !== 'string') return '';
  const value = route.replace(/^#/u, '');
  return /^[a-z][a-z0-9-]{0,39}$/u.test(value) ? value : '';
}

export function renderActivityButtons({ unread, severity }, { escape }) {
  const count = Number.isSafeInteger(unread) && unread > 0 ? unread : 0;
  const label = count ? `Уведомления · ${count} непрочитанных` : 'Уведомления';
  const health = severityValue(severity);
  const healthLabel = `Состояние рабочего места · ${healthLabels.get(health).toLocaleLowerCase('ru-RU')}`;
  return `<div class="activity-buttons" role="group" aria-label="Рабочее место">
    <button type="button" class="button activity-trigger" data-action="activity-open" aria-haspopup="dialog" aria-label="${escape(label)}" title="${escape(label)}">
      ${icon(bell)}${count ? `<span class="activity-count" aria-hidden="true">${count > 99 ? '99+' : count}</span>` : ''}
    </button>
    <button type="button" class="button activity-trigger activity-health-trigger" data-action="health-open" data-severity="${health}"
      aria-haspopup="dialog" aria-label="${escape(healthLabel)}" title="${escape(healthLabel)}">
      ${icon(pulse)}<span class="activity-health-dot" aria-hidden="true"></span>
    </button>
  </div>`;
}

function timestamp(at, { escape, dateText }) {
  return at ? `<time datetime="${escape(at)}">${escape(dateText(at))}</time>` : '';
}

function renderActivityItem(item, helpers) {
  const { escape } = helpers;
  const route = fragment(item.route);
  const severity = severityValue(item.severity);
  const unread = item.read !== true;
  return `<li><button type="button" class="activity-entry${unread ? ' is-unread' : ''}" data-action="activity-item" data-id="${escape(item.id)}"
      ${route ? `data-route="${escape(route)}"` : ''}${item.targetId ? ` data-target-id="${escape(item.targetId)}"` : ''}>
    <span class="activity-entry-head">
      <strong>${escape(item.title)}</strong>${timestamp(item.at, helpers)}
    </span>
    ${item.detail ? `<span class="activity-detail">${escape(item.detail)}</span>` : ''}
    ${unread || severity === 'warning' || severity === 'error' ? `<span class="activity-entry-status">
      ${unread ? '<span class="activity-unread"><i aria-hidden="true"></i>Не прочитано</span>' : ''}
      ${severity === 'warning' || severity === 'error' ? `<span class="activity-badge" data-severity="${severity}">${healthLabels.get(severity)}</span>` : ''}
    </span>` : ''}
  </button></li>`;
}

export function renderActivityDialog({ items = [] }, helpers) {
  const hasUnread = items.some(item => item.read !== true);
  return `<div class="activity-dialog-head">
    <h2 id="dialog-title" tabindex="-1">Уведомления</h2>
    ${hasUnread ? '<button type="button" class="button compact" data-action="activity-read-all">Отметить все прочитанными</button>' : ''}
  </div>
  ${items.length ? `<ul class="activity-list">${items.map(item => renderActivityItem(item, helpers)).join('')}</ul>`
    : '<p class="status-empty">Уведомлений пока нет.</p>'}
  <div class="actions"><button type="button" class="button" data-action="dialog-close">Закрыть</button></div>`;
}

function renderHealthCheck(check, loading, helpers) {
  const { escape } = helpers;
  const severity = severityValue(check.status);
  const route = fragment(check.route);
  const controls = check.action === 'activity-git-refresh'
    ? `<button type="button" class="button compact" data-action="activity-git-refresh"${loading ? ' disabled' : ''}>Проверить обновления Git</button>`
    : route ? `<a class="button compact" href="#${escape(route)}" data-action="dialog-close" aria-label="Открыть раздел проверки «${escape(check.label)}»">Открыть раздел</a>` : '';
  return `<li class="activity-health-row" data-check-id="${escape(check.id)}">
    <div class="activity-entry-head"><strong>${escape(check.label)}</strong><span class="activity-badge" data-severity="${severity}">${healthLabels.get(severity)}</span></div>
    ${check.detail ? `<p class="activity-detail">${escape(check.detail)}</p>` : ''}
    ${check.at ? `<p class="small muted">${timestamp(check.at, helpers)}</p>` : ''}
    ${check.lastSuccessAt ? `<p class="small muted">Последний успех · ${timestamp(check.lastSuccessAt, helpers)}</p>` : ''}
    ${controls ? `<div class="activity-health-actions">${controls}</div>` : ''}
  </li>`;
}

export function renderHealthDialog({ health, loading = false, error }, helpers) {
  const { escape } = helpers;
  const checkedAt = health?.checkedAt;
  const checks = health?.checks ?? [];
  return `<div class="activity-dialog-head">
    <h2 id="dialog-title" tabindex="-1">Состояние рабочего места</h2>
    <button type="button" class="button compact" data-action="health-check"${loading ? ' disabled' : ''}>Проверить работу</button>
  </div>
  <div class="stack activity-health-list" aria-busy="${Boolean(loading)}">
    ${checkedAt ? `<p class="small muted">Последняя проверка · ${timestamp(checkedAt, helpers)}</p>`
      : (!loading && !checks.length ? '<p class="status-empty">Проверка ещё не запускалась.</p>' : '')}
    ${loading ? '<p class="small muted" role="status">Проверяем рабочее место…</p>' : ''}
    ${error ? `<p class="inline-error" role="alert">${escape(error)}</p>` : ''}
    ${checks.length ? `<ul class="activity-list">${checks.map(check => renderHealthCheck(check, loading, helpers)).join('')}</ul>` : ''}
  </div>
  <div class="actions"><button type="button" class="button" data-action="dialog-close">Закрыть</button></div>`;
}
