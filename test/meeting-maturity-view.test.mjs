import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMeetingMaturity } from '../public/meeting-maturity-view.js';

const escape = value => String(value ?? '').replace(/[&<>"]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
const helpers = { escape, option: (value, label, selected) =>
  `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>` };
const metadata = { sourceId: 'book', sheet: 'Срез <A>', clusters: [
  { id: 'auto', name: 'Платформа <A>', tribe: 'A & B', proposedLeaderId: 'l1' },
  { id: 'explicit', name: 'Платформа Б', tribe: 'Б', proposedLeaderId: 'l1' },
  { id: 'unmapped', name: 'Платформа В', tribe: 'Б' },
  { id: 'override', name: 'Платформа Г', tribe: 'Б' },
] };
const model = { sources: [{ id: 'book', type: 'xlsx', name: 'Срез.xlsx' }, { id: 'map', type: 'html', name: 'Карта.html' }],
  config: { sourceId: 'book', asOf: '2026-11-16', links: [{ clusterId: 'explicit', leaderId: '' }, { clusterId: 'override', leaderId: 'l2' }] },
  maturity: metadata, leaders: [{ id: 'l1', name: 'Лидер А' }, { id: 'l2', name: 'Лидер Б' }] };

test('renders upload, explicit as-of date, and distinguishable automatic and manual matches', () => {
  const view = renderMeetingMaturity(model, helpers);
  assert.match(view, /<input id="meeting-maturity-upload"[^>]+type="file"[^>]*>/u);
  assert.doesNotMatch(view, /id="meeting-maturity-upload"[^>]+name=/u);
  assert.match(view, /name="maturitySourceId"[\s\S]+value="book" selected/u);
  assert.match(view, /name="maturityAsOf"[^>]+value="2026-11-16"/u);
  assert.doesNotMatch(view, /Карта\.html/u);
  assert.match(view, /<summary>Соответствие кластеров · 2 из 4 с лидером<\/summary>/u);
  assert.match(view, /Платформа &lt;A&gt;[\s\S]*A &amp; B/u);
  const cluster = id => view.match(new RegExp('data-maturity-cluster="' + id + '"[^>]*>([\\s\\S]*?)<\\/select>', 'u'))[1];
  assert.match(cluster('auto'), /value="@auto" selected>Авто · Лидер А/u);
  assert.match(cluster('explicit'), /value="" selected>Без ИТ-лидера/u);
  assert.match(cluster('unmapped'), /value="@auto" selected>Без совпадения/u);
  assert.match(cluster('override'), /value="l2" selected>Лидер Б/u);
});

test('keeps old clusters hidden when selecting a new source and reports load errors safely', () => {
  const view = renderMeetingMaturity({ ...model, config: { sourceId: 'new' }, loading: true, error: '<ошибка>' }, helpers);
  assert.doesNotMatch(view, /data-maturity-cluster/u);
  assert.match(view, /id="meeting-maturity-upload"[^>]* disabled/u);
  assert.match(view, /role="alert">&lt;ошибка&gt;/u);
});
