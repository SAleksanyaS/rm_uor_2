import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { openWorkbook, openZip } from '../src/imports.mjs';
import { readStatusRegister } from '../src/status-register.mjs';
import { planStatusExport, writeStatusWorkbook } from '../src/status-export.mjs';

test('writes an edited copy of the actual template and keeps unmatched DIT results', async () => {
  const seed = new URL('../seed/', import.meta.url);
  const { id } = JSON.parse(await readFile(new URL('status-register.json', seed), 'utf8'));
  const original = await readFile(new URL('sources/' + id, seed));
  const register = readStatusRegister(original);
  const matched = register.entries.find(entry => entry.status === 'в плане');
  const ambiguous = register.entries.filter(entry => entry.id !== matched.id && entry.period === matched.period).slice(0, 2);
  Object.assign(matched, { scopeId: 'lead', goalId: 'A', linkState: 'suggested' });
  for (const entry of ambiguous) Object.assign(entry, { scopeId: 'lead', goalId: 'B', linkState: 'confirmed' });
  const state = {
    directory: [{ id: 'lead', type: 'leader', name: 'ИТ-лидер' }],
    goals: ['A', 'B'].map(id => ({ id, title: id, status: 'active', assignments: [{ leaderId: 'lead' }],
      local: [{ scopeId: 'lead', period: matched.period, status: 'Выполнено', value: 0, comment: '=1+1' }],
      published: [{ scopeId: 'lead', period: matched.period, status: 'Риск принят' }] })),
    ditDrafts: [{ goalId: 'A', period: matched.period, status: 'Под риском',
      measurement: { fact: 97, plan: 80, unit: '%', asOf: '2026-11-09' } }]
  };
  assert.equal(planStatusExport(state, register, false).updates.get('T' + matched.sourceRow), 'риск принят');
  const model = planStatusExport(state, register, true);
  assert.equal(model.updates.size, 1);
  const exported = writeStatusWorkbook(original, register.sheet, model);
  const next = readStatusRegister(exported);
  assert.equal(next.entries.find(entry => entry.id === matched.id).status, 'выполнено');
  assert.equal(next.entries.find(entry => entry.id === matched.id).fact, matched.fact);
  assert.deepEqual(openZip(exported)('xl/styles.xml'), openZip(original)('xl/styles.xml'));
  const read = openZip(exported);
  assert.match(read('xl/pivotCache/pivotCacheDefinition1.xml').toString(), /refreshOnLoad="1"/u);
  const annex = openWorkbook(exported).getRows('Статусы РМ УОР');
  assert.ok(annex.some(row => row.includes('=1+1') && row.includes(0)));
  assert.ok(annex.some(row => row.includes(97) && row.includes('ДИТ OPS')));
  assert.ok(annex.some(row => row.includes('Несколько строк КР')));
  assert.equal(readStatusRegister(original).entries.find(entry => entry.id === matched.id).status, 'в плане');
});
