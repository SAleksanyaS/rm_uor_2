export const meetingSections = Object.freeze({
  overview: 'Сводка',
  leaders: 'Все ИТ-лидеры',
  risks: 'Цели под риском',
  'leader-details': 'Карточки лидеров',
  comparison: 'Изменения между срезами',
  curators: 'Сводка кураторов',
  actions: 'Открытые поручения',
  maturity: 'Модель зрелости SW26.1',
  appendix: 'Все цели в охвате',
});

export function defaultMeetingConfig(overrides = {}) {
  return {
    period: '', leaderId: '', title: '', note: '',
    maturity: { sourceId: '', asOf: '', links: [] },
    sections: Object.keys(meetingSections).map(id => ({ id, enabled: id !== 'curators' && id !== 'maturity' })),
    ...overrides,
  };
}

export function isMeetingPeriod(value) {
  return typeof value === 'string' && /^(?:Q[1-4] 20\d{2}|Y\d{2})$/u.test(value);
}

function field(value, limit, label, multiline = false) {
  const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (typeof value !== 'string' || value.length > limit || controls.test(value)) throw new Error('Проверьте поле «' + label + '».');
  return value.trim();
}

export function normalizeMeetingConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Проверьте настройки презентации.');
  const { period = '', leaderId = '', title = '', note = '', sections = defaultMeetingConfig().sections } = input;
  if (period !== '' && !isMeetingPeriod(period)) throw new Error('Выберите период презентации — квартал или год.');
  const known = Object.keys(meetingSections);
  const used = new Set();
  if (!Array.isArray(sections) || sections.length > known.length) throw new Error('Проверьте разделы презентации.');
  const ordered = sections.map(section => {
    if (!section || typeof section.id !== 'string' || !Object.hasOwn(meetingSections, section.id)
      || used.has(section.id) || typeof section.enabled !== 'boolean') throw new Error('Проверьте разделы презентации.');
    used.add(section.id);
    return { id: section.id, enabled: section.enabled };
  });
  for (const item of defaultMeetingConfig().sections) if (!used.has(item.id)) ordered.push(item);
  if (!ordered.some(item => item.enabled)) throw new Error('Включите хотя бы один раздел презентации.');
  return { period, leaderId: field(leaderId, 200, 'ИТ-лидер'), title: field(title, 120, 'Название'),
    note: field(note, 1200, 'Заметка к встрече', true), maturity: normalizeMeetingMaturity(input.maturity), sections: ordered };
}

export function normalizeMeetingMaturity(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Проверьте настройки модели зрелости.');
  const { sourceId = '', asOf = '', links = [] } = input;
  if (typeof sourceId !== 'string' || (sourceId && !/^[a-f0-9]{64}$/u.test(sourceId))) throw new Error('Выберите книгу модели зрелости.');
  if (asOf !== '') {
    const date = new Date(asOf);
    if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(asOf) || !Number.isFinite(+date)
      || date.toISOString().slice(0, 10) !== asOf) throw new Error('Проверьте дату среза модели зрелости.');
  }
  if (!Array.isArray(links) || links.length > 250) throw new Error('Проверьте привязки кластеров.');
  const confirmed = new Set();
  const assigned = links.map(item => {
    const clusterId = field(item?.clusterId, 350, 'Кластер');
    const leaderId = field(item?.leaderId, 200, 'Лидер кластера');
    if (!clusterId || confirmed.has(clusterId)) throw new Error('Проверьте уникальность привязок кластеров.');
    confirmed.add(clusterId);
    return { clusterId, leaderId };
  });
  return { sourceId, asOf, links: assigned };
}
