export function renderStatusExport(model, { heading, escape }) {
  const { data, drafts, loading, downloading, error } = model;
  const matched = data?.matched ?? 0;
  const count = data?.rows.length ?? 0;
  const rows = (data?.rows ?? []).slice(0, 30);
  return `${heading('Сводная по статусам', 'Выгрузка статусов ДИТ и ИТ-лидеров в исходный шаблон Excel.')}
    <section class="panel panel-inner stack" aria-busy="${loading}">
      <div><h2>Книга для выгрузки</h2>${data ? `<p><strong>${escape(data.source)}</strong> · ${data.periods.map(escape).join(' / ')}</p>` : ''}</div>
      <label class="small"><input id="status-export-drafts" type="checkbox"${drafts ? ' checked' : ''}> Включить локальные черновики</label>
      ${error ? `<p class="inline-error" role="alert">${escape(error)}</p>` : ''}
      ${loading ? '<p class="muted" role="status">Проверяем связи со строками Excel…</p>' : ''}
      ${data ? `<p><strong>${matched} из ${count}</strong> записей попадают в основной реестр. Все ${count} записей будут на листе «Статусы РМ УОР».</p>
        <p class="form-caption">Факт, план и комментарии из РМ УОР доступны на отдельном листе. Свод Excel обновляется при открытии книги.</p>` : ''}
      <div class="actions"><button type="button" class="button primary" data-action="status-export-download"${loading || downloading || !data ? ' disabled' : ''}>${downloading ? 'Готовим файл…' : 'Скачать Excel'}</button>
        <a class="button" href="#reconcile">Сверка КР</a></div>
    </section>
    ${count ? `<section class="panel panel-inner stack"><h2>Предпросмотр переноса</h2>
      <div class="table-wrap"><table class="table"><thead><tr><th>Цель</th><th>Уровень</th><th>Период</th><th>Статус РМ УОР</th><th>Перенос в реестр</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td><strong>${escape(row.goalId)}</strong> · ${escape(row.title)}</td><td>${escape(row.scope)}</td><td>${escape(row.period)}</td>
        <td>${escape(row.status || '—')}<p class="small muted">${escape(row.origin)}</p></td><td>${escape(row.result)}</td></tr>`).join('')}
      </tbody></table></div>${count > rows.length ? `<p class="small muted">В предпросмотре ${rows.length} записей. В Excel доступны все ${count}.</p>` : ''}</section>`
      : data ? '<p class="muted">Сохранённых статусов пока нет. Можно скачать книгу с текущими значениями шаблона.</p>' : ''}`;
}
