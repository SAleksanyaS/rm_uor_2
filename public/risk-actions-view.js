const statusLabels = {
  open: 'Открыта',
  'in-progress': 'В работе',
  done: 'Выполнена',
};

export function renderRiskActionCreateButton(anchor, { escape }) {
  return `<button type="button" class="button compact" data-action="risk-action-create"
    data-goal="${escape(anchor.goalId)}" data-scope="${escape(anchor.scopeId)}" data-period="${escape(anchor.period)}"
    data-snapshot="${escape(anchor.snapshotId ?? '')}" data-week="${escape(anchor.week ?? '')}">Создать задачу</button>`;
}

export function renderRiskActionDialog({ action, anchor }, { escape }) {
  const target = action ?? anchor;
  const label = [anchor?.goalTitle || target.goalId, anchor?.scopeLabel || target.scopeId, target.period]
    .filter(Boolean).map(escape).join(' · ');
  const inputs = {
    id: action?.id,
    expectedRevision: action?.revision,
    goalId: target.goalId,
    scopeId: target.scopeId,
    period: target.period,
    snapshotId: target.snapshotId,
    week: target.week,
  };
  const hidden = Object.entries(inputs).map(([name, value]) =>
    `<input type="hidden" name="${name}" value="${escape(value ?? '')}">`).join('');
  return `<h2 id="dialog-title">${action ? 'Изменить задачу' : 'Создать задачу по риску'}</h2>
    <p class="muted">${label}</p>
    ${anchor?.risk ? `<p>${escape(anchor.risk)}</p>` : ''}
    <form id="risk-action-form" class="stack">
      ${hidden}
      <label class="field"><span>Название задачи</span><input name="title" value="${escape(action?.title ?? '')}" maxlength="250" required autofocus></label>
      <div class="form-grid">
        <label class="field"><span>Ответственный</span><input name="owner" value="${escape(action?.owner ?? '')}" maxlength="160" required></label>
        <label class="field"><span>Срок</span><input name="dueOn" type="date" value="${escape(action?.dueOn ?? '')}" required></label>
      </div>
      <label class="field"><span>Следующее действие</span><textarea name="nextAction" rows="3" maxlength="3000" required>${escape(action?.nextAction ?? '')}</textarea></label>
      <label class="field"><span>Состояние</span><select name="status">${Object.entries(statusLabels).map(([value, title]) =>
        `<option value="${value}"${value === (action?.status ?? 'open') ? ' selected' : ''}>${title}</option>`).join('')}</select></label>
      <div class="actions"><button type="button" class="button" data-action="dialog-close">Отмена</button>
        <button type="submit" class="button primary">Сохранить задачу</button></div>
    </form>`;
}

export function renderRiskActions(actions, { escape, dateText = value => value }, {
  editable = false,
  today,
  goalName = id => id,
  scopeName = id => id,
} = {}) {
  if (!actions?.length) return '<p class="muted">Связанных задач пока нет.</p>';
  return `<ul class="stack">${actions.map(action => {
    const context = [goalName(action.goalId), scopeName(action.scopeId), action.period].filter(Boolean).map(escape).join(' · ');
    const tone = action.status === 'done' ? ' success' : action.status === 'in-progress' ? ' accent' : '';
    const late = Boolean(today && action.status !== 'done' && action.dueOn < today);
    return `<li class="stack">
      <div class="headline"><strong>${escape(action.title)}</strong><span class="badge${tone}">${escape(statusLabels[action.status] || action.status)}</span></div>
      <p class="muted small">${context}</p>
      <p class="small">${escape(action.owner)} · Срок ${escape(dateText(action.dueOn))} ${late ? '<span class="badge warning">Просрочено</span>' : ''}</p>
      <p>${escape(action.nextAction)}</p>
      ${editable ? `<div class="actions"><button type="button" class="button compact" data-action="risk-action-edit" data-id="${escape(action.id)}">Изменить</button></div>` : ''}
    </li>`;
  }).join('')}</ul>`;
}
