import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMeetingToolbar, renderMeetingView } from '../public/meeting-view.js';

const escape = value => String(value ?? '').replace(/[&<>"]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
const helpers = { escape, option: (value, label, selected) =>
  `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>` };
const config = { period: 'Q4 2026', leaderId: 'a', title: 'Срез <A>', note: 'A & B',
  sections: [{ id: 'summary', enabled: true }, { id: 'risk', enabled: false }] };
const base = { config, periods: ['Q4 2026', 'Y26'], leaders: [{ id: 'a', name: 'Кластер А' }],
  sectionLabels: { summary: 'Итоги', risk: 'Риски' } };

test('presents separate weekly modes and keeps constructor values and section order intact', () => {
  const toolbar = renderMeetingToolbar('meeting');
  assert.match(toolbar, /data-mode="operational" aria-pressed="false"/u);
  assert.match(toolbar, /data-mode="meeting" aria-pressed="true"/u);
  const view = renderMeetingView(base, helpers);
  assert.match(view, /id="meeting-form"/u);
  assert.match(view, /name="period"[\s\S]*value="Q4 2026" selected/u);
  assert.match(view, /name="leaderId"[\s\S]*value="a" selected/u);
  assert.match(view, /name="title"[^>]+value="Срез &lt;A&gt;"/u);
  assert.match(view, /<textarea name="note"[^>]*>A &amp; B<\/textarea>/u);
  assert.match(view, /name="section" value="summary" data-section="summary" checked/u);
  assert.match(view, /name="section" value="risk" data-section="risk">/u);
  assert.match(view, /data-section="summary" data-direction="up"[^>]+disabled/u);
  assert.match(view, /data-action="meeting-download" disabled/u);
});

test('renders one selected server slide and controlled pagination without injecting markup', () => {
  const report = { title: 'Отчёт', subtitle: 'Период', slides: [
    { kind: 'summary', title: 'Сводка', kpis: [{ label: 'Цели', value: 9 }] },
    { kind: 'table', title: 'Риски <b>', columns: [{ label: 'Риск' }], rows: [['<script>alert(1)</script>']], footer: 'Часть 1' },
  ] };
  const view = renderMeetingView({ ...base, report, slideIndex: 1 }, helpers);
  assert.match(view, /Риски &lt;b&gt;/u);
  assert.match(view, /<th scope="col">Риск<\/th>/u);
  assert.match(view, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(view, /<script>|Сводка/u);
  assert.match(view, /2 из 2/u);
  assert.match(view, /data-action="meeting-page" data-index="0"/u);
  assert.match(view, /data-action="meeting-page" data-index="2"[^>]+disabled/u);
  assert.doesNotMatch(view, /data-action="meeting-download" disabled/u);
  assert.match(renderMeetingView({ ...base, report, pending: true }, helpers), /data-action="meeting-download" disabled/u);
});

test('shows textual values alongside numeric bars and renders column blocks', () => {
  const report = { title: 'Срез', slides: [
    { kind: 'bars', title: 'Кластеры', groups: [{ label: 'Кластер А', segments: [{ label: 'Под риском', value: 3, tone: 'risk' }] }] },
    { kind: 'columns', title: 'Заметки', blocks: [{ title: 'Следующее', items: ['Проверить & сверить'] }], note: 'Вопрос' },
  ] };
  const bars = renderMeetingView({ ...base, report }, helpers);
  assert.match(bars, /<svg[^>]+aria-hidden="true"/u);
  assert.match(bars, /Под риском <strong>3<\/strong>/u);
  const columns = renderMeetingView({ ...base, report, slideIndex: 1 }, helpers);
  assert.match(columns, /<li>Проверить &amp; сверить<\/li>/u);
  assert.match(columns, /Вопрос/u);
});
