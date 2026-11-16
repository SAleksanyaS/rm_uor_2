import test from 'node:test';
import assert from 'node:assert/strict';
import { appendDitEvent } from '../src/dit-timeline.mjs';
import { compareDitDates } from '../public/dit-history-view.js';

const period = 'Y26';
const row = (revision, status, measurement) => ({ goalId: 'G', period, revision, status, measurement });

test('records the observation date separately from the measurement date and keeps prior values', () => {
  const measurement = { id: 'm', asOf: '2026-11-03', plan: 80, fact: 0, unit: '%' };
  const first = row('a', 'В плане', measurement);
  const next = row('b', 'Под риском', measurement);
  const firstEvent = appendDitEvent([], first, { recordedAt: '2026-11-05T12:00:00.000Z' });
  const events = appendDitEvent(firstEvent, next, { previous: first, recordedAt: '2026-11-06T12:00:00.000Z' });
  assert.deepEqual(events.map(event => [event.date, event.measurement?.asOf, event.status]), [
    ['2026-11-03', '2026-11-03', 'В плане'], ['2026-11-06', '2026-11-03', 'Под риском']
  ]);
  assert.strictEqual(appendDitEvent(events, next, { previous: first, recordedAt: '2026-11-07T12:00:00.000Z' }), events);
});

test('compares exact dates in one period, including zero, missing observations and changed units', () => {
  const sample = (goalId, date, fact, unit, status, reportingPeriod = period) => ({
    goalId, date, period: reportingPeriod, status, measurement: { fact, unit, plan: 80 },
    recordedAt: date + 'T10:00:00.000Z'
  });
  const earlier = '2026-11-03';
  const later = '2026-11-06';
  const onlyLater = sample('new', later, 10, '%', 'В плане');
  const events = [
    sample('same', earlier, 0, '%', 'В плане'), sample('same', later, 97, '%', 'Выполнено'),
    sample('unit', earlier, 1, 'ч', 'В плане'), sample('unit', later, 20, 'мин', 'В плане'),
    onlyLater, sample('other', later, 10, '%', '', 'Q4 2026')
  ];
  const result = new Map(compareDitDates(events, period, earlier, later).map(item => [item.goalId, item]));
  assert.equal(result.get('same').delta, 97);
  assert.equal(result.get('unit').delta, null);
  assert.equal(result.get('new').before, null);
  assert.equal(result.get('new').after, onlyLater);
  assert.equal(result.has('other'), false);
});
