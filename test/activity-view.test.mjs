import test from 'node:test';
import assert from 'node:assert/strict';
import { renderActivityButtons, renderActivityDialog, renderHealthDialog } from '../public/activity-view.js';

const escape = value => String(value ?? '').replace(/[&<>"]/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
const helpers = { escape, dateText: () => '16.11.2026' };

test('top bar exposes unread count and distinct health state with accessible names', () => {
  const html = renderActivityButtons({ unread: 101, severity: 'warning' }, helpers);
  assert.match(html, /data-action="activity-open"[^>]+aria-label="Уведомления · 101 непрочитанных"/u);
  assert.match(html, /99\+/u);
  assert.match(html, /data-action="health-open"[^>]+aria-label="Состояние рабочего места · требует внимания"/u);
  assert.equal((html.match(/aria-haspopup="dialog"/gu) ?? []).length, 2);
  assert.match(renderActivityButtons({ unread: 0, severity: 'unknown' }, helpers), /Состояние рабочего места · нет данных/u);
});

test('notification items expose read state, safe text, navigation metadata, and mark-all affordance', () => {
  const html = renderActivityDialog({ items: [
    { id: 'one', title: '<Изменение>', detail: 'Источник & факт', route: '#weekly', targetId: 'target', at: '2026-11-16T09:00:00Z', read: false, severity: 'warning' },
    { id: 'two', title: 'Готово', route: 'javascript:alert(1)', read: true, severity: 'invalid' },
  ] }, helpers);
  assert.match(html, /id="dialog-title"/u);
  assert.match(html, /data-action="activity-item" data-id="one"[^>]+data-route="weekly"[^>]+data-target-id="target"/u);
  assert.match(html, /&lt;Изменение&gt;[\s\S]+Источник &amp; факт/u);
  assert.equal((html.match(/>Не прочитано</gu) ?? []).length, 1);
  assert.doesNotMatch(html, /javascript:/u);
  assert.match(html, /data-action="activity-read-all"/u);
  assert.doesNotMatch(renderActivityDialog({ items: [{ id: 'two', title: 'Готово', read: true }] }, helpers), /activity-read-all/u);
});

test('health summary differentiates unknown from success and only emits supported actions', () => {
  const html = renderHealthDialog({ health: { checkedAt: '2026-11-16T09:00:00Z', checks: [
    { id: 'git', label: 'Git', status: 'neutral', detail: 'Не настроен', action: 'activity-git-refresh' },
    { id: 'map', label: 'Карта', status: 'ok', detail: 'Есть цели', route: '#sources', at: '2026-11-16T09:00:00Z' },
    { id: 'unknown', label: 'Адрес', status: 'unknown', detail: '<данных нет>', route: 'https://external.invalid', action: 'unexpected' },
  ] } }, helpers);
  assert.match(html, /Последняя проверка · <time[^>]+>16\.11\.2026<\/time>/u);
  assert.match(html, /data-action="health-check"/u);
  assert.match(html, /data-action="activity-git-refresh"/u);
  assert.match(html, /href="#sources"/u);
  assert.match(html, /В порядке/u);
  assert.equal((html.match(/>Нет данных</gu) ?? []).length, 2);
  assert.doesNotMatch(html, /external\.invalid|data-action="unexpected"/u);
  assert.match(html, /&lt;данных нет&gt;/u);
  assert.match(renderHealthDialog({ loading: true, error: 'Сбой' }, helpers), /role="alert">Сбой/u);
});
