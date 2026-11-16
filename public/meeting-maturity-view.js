const automatic = '@auto';
const disabled = value => value ? ' disabled' : '';

function renderClusterLinks(clusters, links, leaders, loading, { escape, option }) {
  if (!clusters.length) return '';
  const overrides = new Map(links.map(row => [row.clusterId, row.leaderId]));
  const leaderNames = new Map(leaders.map(leader => [leader.id, leader.name]));
  const selected = cluster => overrides.get(cluster.id) ?? automatic;
  const mapped = clusters.filter(cluster => leaderNames.has(overrides.has(cluster.id)
    ? overrides.get(cluster.id) : cluster.proposedLeaderId)).length;

  return `<details id="meeting-maturity-mapping" class="context-details">
    <summary>Соответствие кластеров · ${mapped} из ${clusters.length} с лидером</summary>
    <div class="context-body stack">
      <p class="muted small">Проверьте автоматические совпадения. В разрез лидера попадут только кластеры, которые с ним связаны.</p>
      ${clusters.map(cluster => {
        const value = selected(cluster);
        const proposal = leaderNames.get(cluster.proposedLeaderId);
        const path = [cluster.block, cluster.tribe].filter(Boolean).join(' · ');
        const unavailable = value && value !== automatic && !leaderNames.has(value);
        return `<label class="field"><span><strong>${escape(cluster.name)}</strong>${path ? ` · ${escape(path)}` : ''}</span>
          <select data-maturity-cluster="${escape(cluster.id)}"${disabled(loading)}>
            ${option(automatic, proposal ? `Авто · ${proposal}` : 'Без совпадения', value)}
            ${option('', 'Без ИТ-лидера', value)}
            ${unavailable ? option(value, 'ИТ-лидер недоступен', value) : ''}
            ${leaders.map(leader => option(leader.id, leader.name, value)).join('')}
          </select>
        </label>`;
      }).join('')}
    </div>
  </details>`;
}

export function renderMeetingMaturity({ sources = [], config = {}, maturity, leaders = [], loading, error }, helpers) {
  const { escape, option } = helpers;
  const { sourceId = '', asOf = '', links = [] } = config;
  const books = sources.filter(source => source.type === 'xlsx');
  const selected = books.some(source => source.id === sourceId);
  const current = sourceId && maturity?.sourceId === sourceId ? maturity : null;
  return `<section class="stack meeting-maturity" aria-labelledby="meeting-maturity-heading" aria-busy="${Boolean(loading)}">
    <div><h3 id="meeting-maturity-heading">Модель зрелости</h3>
      <p class="muted small">Выберите отдельную книгу по модели зрелости и укажите дату её среза.</p></div>
    <label class="field"><span>Книга модели зрелости</span><select name="maturitySourceId"${disabled(loading)}>
      ${option('', books.length ? 'Выбрать Excel' : 'Нет загруженных книг Excel', sourceId)}
      ${sourceId && !selected ? option(sourceId, 'Книга недоступна', sourceId) : ''}
      ${books.map(book => option(book.id, book.name, sourceId)).join('')}
    </select></label>
    <label class="field"><span>Загрузить книгу XLSX</span>
      <input id="meeting-maturity-upload" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"${disabled(loading)}></label>
    <label class="field"><span>Дата среза модели зрелости</span><input name="maturityAsOf" type="date" value="${escape(asOf)}"${disabled(loading)}></label>
    ${loading ? '<p class="muted small" role="status">Читаем книгу модели зрелости…</p>' : ''}
    ${error ? `<p class="inline-error" role="alert">${escape(error)}</p>` : ''}
    ${current?.sheet ? `<p class="muted small">Лист «${escape(current.sheet)}»</p>` : ''}
    ${renderClusterLinks(current?.clusters ?? [], links, leaders, loading, helpers)}
  </section>`;
}
