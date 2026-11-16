const toneClasses = new Map([
  ['done', 'positive'], ['positive', 'positive'], ['success', 'positive'],
  ['risk', 'risk'], ['warning', 'risk'], ['danger', 'risk'],
  ['progress', 'active'], ['planned', 'active'], ['active', 'active'], ['accent', 'active'],
]);

const disabled = value => value ? ' disabled' : '';
const toneClass = tone => toneClasses.get(tone) ?? 'neutral';

export function renderMeetingToolbar(mode = 'operational') {
  return `<div class="meeting-toolbar" role="group" aria-label="Режим еженедельного отчёта">
    <button type="button" class="button compact" data-action="meeting-tab" data-mode="operational" aria-pressed="${mode === 'operational'}">Оперативный отчёт</button>
    <button type="button" class="button compact" data-action="meeting-tab" data-mode="meeting" aria-pressed="${mode === 'meeting'}">К встрече</button>
  </div>`;
}

function sectionRows(sections, sectionLabels, busy, { escape }) {
  return sections.map((section, index) => {
    const label = sectionLabels?.[section.id] ?? section.label ?? section.id;
    const key = escape(section.id);
    return `<li class="meeting-section">
      <label><input type="checkbox" name="section" value="${key}" data-section="${key}"${section.enabled ? ' checked' : ''}${disabled(busy)}><span>${escape(label)}</span></label>
      <div class="meeting-order" role="group" aria-label="Порядок раздела «${escape(label)}»">
        <button type="button" class="button compact meeting-icon" data-action="meeting-move" data-section="${key}" data-direction="up" title="Выше" aria-label="Переместить выше: ${escape(label)}"${disabled(busy || index === 0)}>↑</button>
        <button type="button" class="button compact meeting-icon" data-action="meeting-move" data-section="${key}" data-direction="down" title="Ниже" aria-label="Переместить ниже: ${escape(label)}"${disabled(busy || index === sections.length - 1)}>↓</button>
      </div>
    </li>`;
  }).join('');
}

function renderMeetingForm(model, helpers) {
  const { escape, option } = helpers;
  const { config = {}, periods = [], leaders = [], sectionLabels, loading, maturityControls = '' } = model;
  const { period = '', leaderId = '', title = '', note = '', sections = [] } = config;
  const choices = [...new Set([...periods, period].filter(Boolean))];
  return `<form id="meeting-form" class="panel panel-inner stack meeting-form" aria-labelledby="meeting-config-heading">
    <h2 id="meeting-config-heading">Настройка презентации</h2>
    <div class="meeting-fields">
      <label class="field"><span>Период</span><select name="period"${disabled(!choices.length || loading)}>${choices.length
        ? choices.map(value => option(value, value, period)).join('') : option('', 'Нет доступных периодов', '')}</select></label>
      <label class="field"><span>Охват</span><select name="leaderId"${disabled(loading)}>${option('', 'ДИТ и все кластеры', leaderId)}${leaders.map(leader => option(leader.id, leader.name, leaderId)).join('')}</select></label>
    </div>
    <label class="field"><span>Название презентации</span><input name="title" type="text" maxlength="120" value="${escape(title)}"${disabled(loading)}></label>
    <label class="field"><span>Заметка к встрече</span><textarea name="note" rows="3" maxlength="1200"${disabled(loading)}>${escape(note)}</textarea></label>
    <fieldset class="meeting-sections">
      <legend>Разделы и их порядок</legend>
      <ol class="meeting-section-list">${sectionRows(sections, sectionLabels, loading, helpers)}</ol>
    </fieldset>
    ${maturityControls}
    <div class="actions meeting-layout-actions">
      <button type="button" class="button" data-action="meeting-save"${disabled(loading)}>Сохранить настройки</button>
      <button type="button" class="button ghost" data-action="meeting-reset"${disabled(loading)}>Восстановить стандартные</button>
    </div>
  </form>`;
}

function renderKpis(kpis, { escape }) {
  if (!kpis.length) return '';
  return `<dl class="meeting-kpis">${kpis.map(kpi => `<div class="meeting-kpi tone-${toneClass(kpi.tone)}">
    <dt>${escape(kpi.label)}</dt><dd>${escape(kpi.value)}</dd>
  </div>`).join('')}</dl>`;
}

function renderBars(groups, { escape }) {
  if (!groups.length) return '';
  const count = item => Number.isFinite(item.value) && item.value > 0 ? item.value : 0;
  const total = group => (group.segments ?? []).reduce((sum, item) => sum + count(item), 0);
  const max = Math.max(1, ...groups.map(total));
  return `<ul class="meeting-bars">${groups.map(group => {
    const segments = group.segments ?? [];
    let start = 0;
    const bars = segments.map(item => {
      const width = count(item) / max * 100;
      const bar = width > 0 ? `<rect class="tone-${toneClass(item.tone)}" x="${start.toFixed(6)}" y="0" width="${width.toFixed(6)}" height="10"></rect>` : '';
      start += width;
      return bar;
    }).join('');
    return `<li class="meeting-bar"><p><strong>${escape(group.label)}</strong></p>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">${bars}</svg>
      <ul class="meeting-bar-values">${segments.map(item => `<li class="tone-${toneClass(item.tone)}"><i aria-hidden="true"></i>${escape(item.label)} <strong>${escape(item.value)}</strong></li>`).join('')}</ul>
    </li>`;
  }).join('')}</ul>`;
}

function renderTable(slide, { escape }) {
  const { columns = [], rows = [] } = slide;
  if (!columns.length) return '';
  return `<div class="table-wrap meeting-slide-table" tabindex="0" role="region" aria-label="${escape(slide.title)}"><table>
    <thead><tr>${columns.map(column => `<th scope="col">${escape(column.label ?? column)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr>${columns.map((_, index) => `<td>${escape(row[index])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function renderBlocks(blocks, { escape }) {
  if (!blocks.length) return '';
  return `<div class="meeting-blocks">${blocks.map(block => `<section class="meeting-block">
    <h4>${escape(block.title)}</h4>${block.items?.length
      ? `<ul>${block.items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : '<p class="small muted">Записей нет.</p>'}
  </section>`).join('')}</div>`;
}

function slideBody(slide, helpers) {
  switch (slide.kind) {
    case 'bars': return renderBars(slide.groups ?? [], helpers);
    case 'table': return renderTable(slide, helpers);
    case 'columns': return renderBlocks(slide.blocks ?? [], helpers);
    case 'summary': return renderKpis(slide.kpis ?? [], helpers) + renderBlocks(slide.blocks ?? [], helpers);
    default: return '';
  }
}

function renderSlide(slide, subtitle, helpers) {
  const { escape } = helpers;
  const body = slideBody(slide, helpers);
  return `<article class="meeting-slide" aria-labelledby="meeting-slide-heading">
    <header><h3 id="meeting-slide-heading" tabindex="-1">${escape(slide.title)}</h3>${subtitle ? `<p>${escape(subtitle)}</p>` : ''}</header>
    <div class="meeting-slide-body">${body || (slide.note ? '' : '<p class="muted small">Данных для этого слайда нет.</p>')}
      ${slide.note ? `<p class="meeting-slide-note">${escape(slide.note)}</p>` : ''}</div>
    ${slide.footer ? `<footer>${escape(slide.footer)}</footer>` : ''}
  </article>`;
}

function renderPreview(model, helpers) {
  const { escape } = helpers;
  const { report, loading, pending, error, config = {} } = model;
  const slides = report?.slides ?? [];
  const index = Number.isInteger(model.slideIndex) ? Math.max(0, Math.min(model.slideIndex, slides.length - 1)) : 0;
  const slide = slides[index];
  return `<section class="panel panel-inner stack meeting-preview" aria-labelledby="meeting-preview-heading" aria-busy="${Boolean(loading)}">
    <div class="meeting-preview-header"><h2 id="meeting-preview-heading">Предпросмотр</h2>
      <div class="actions meeting-preview-actions">
        <button type="button" class="button" data-action="meeting-preview"${disabled(!config.period || loading)}>${slide ? 'Обновить' : 'Собрать'} предпросмотр</button>
        <button type="button" class="button primary" data-action="meeting-download"${disabled(!slide || pending || loading)}>Скачать PPTX</button>
      </div>
    </div>
    ${loading ? '<p class="muted loading" role="status">Готовим презентацию…</p>' : ''}
    ${error ? `<p class="inline-error" role="alert">${escape(error)}</p>` : ''}
    ${slide ? `<p class="muted small" id="meeting-stale" role="status"${pending && !loading ? '' : ' hidden'}>Обновите предпросмотр перед скачиванием.</p>
      ${report.omitted?.includes('comparison') ? '<p class="muted small">Сравнение появится после выбора второго датированного среза в недельном отчёте.</p>' : ''}
      ${report.title && report.title !== slide.title ? `<p class="meeting-report-title">${escape(report.title)}</p>` : ''}
      ${renderSlide(slide, slide.subtitle || (index === 0 ? report.subtitle : ''), helpers)}
      <nav class="meeting-pagination" aria-label="Слайды презентации">
        <button type="button" class="button compact" data-action="meeting-page" data-index="${index - 1}" aria-label="Предыдущий слайд"${disabled(index === 0 || loading)}>← <span>Назад</span></button>
        <span class="muted small" aria-live="polite" aria-atomic="true">${index + 1} из ${slides.length}</span>
        <button type="button" class="button compact" data-action="meeting-page" data-index="${index + 1}" aria-label="Следующий слайд"${disabled(index === slides.length - 1 || loading)}><span>Далее</span> →</button>
      </nav>` : `<div class="meeting-preview-empty"><p>${loading ? 'Предпросмотр появится после сборки.' : 'Выберите период и разделы, затем соберите предпросмотр.'}</p></div>`}
  </section>`;
}

export function renderMeetingView(model, helpers) {
  return `<div class="meeting-layout">${renderMeetingForm(model, helpers)}${renderPreview(model, helpers)}</div>`;
}
