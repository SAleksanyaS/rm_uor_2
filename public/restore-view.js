export function renderRestoreControl() {
  return `<label class="field"><span>Восстановить из резервной копии</span>
    <input id="workspace-restore-file" type="file" accept=".json,application/json"
      aria-describedby="workspace-restore-note"></label>
    <p id="workspace-restore-note" class="muted small">Выберите JSON, скачанный из РМ УОР. Сначала откроется предпросмотр.</p>`;
}

export function renderRestorePreview({ token, summary, connectionPending = false }, { escape, dateText }) {
  const categories = [
    ['Цели', summary.goals], ['Исходники HTML и XLSX', summary.sources],
    ['Общие результаты участников', summary.results], ['Локальные черновики участников', summary.drafts],
    ['Записи ДИТ по целям и периодам', summary.ditStatuses],
  ];
  return `<h2 id="dialog-title">Восстановление рабочего места</h2>
    <p class="muted">Копия от ${escape(dateText(summary.exportedAt))}</p>
    <dl class="definition">${categories.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
    <p>Подтверждение заменит текущие цели, исходники, настройки и черновики данными из копии. Браузерные подключения хранятся отдельно.</p>
    ${connectionPending ? '<p class="muted small">Чтобы подключить репозиторий из копии, проверьте и сохраните параметры в разделе «Профиль и Git».</p>' : ''}
    <form id="restore-confirm-form" class="actions" data-token="${escape(token)}">
      <button type="button" class="button" data-action="dialog-close">Отмена</button>
      <button type="submit" class="button primary">Заменить данные копией</button>
    </form>`;
}
