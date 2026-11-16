const normalized = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU')
  .replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim();

export function resolveMaturityLinks(clusters, goals, directory, links) {
  const leaders = new Set(directory.filter(item => item.type === 'leader').map(item => item.id));
  const byId = new Map(directory.map(item => [item.id, item]));
  const names = new Map();
  const maturity = goals.find(goal => goal.id === 'SW26.1');
  for (const assignment of maturity?.assignments ?? []) {
    if (!leaders.has(assignment.leaderId) || assignment.active === false) continue;
    const refs = new Set([...(assignment.teamIds ?? []), ...(assignment.scopeIds ?? [])]);
    const entities = [...refs].map(id => byId.get(id)).filter(item => item?.type === 'team' || item?.type === 'product');
    const labels = [...(assignment.teams ?? []), ...entities.flatMap(item => [item.name, ...(item.aliases ?? [])])];
    for (const label of labels.map(normalized).filter(Boolean)) {
      if (!names.has(label)) names.set(label, new Set());
      names.get(label).add(assignment.leaderId);
    }
  }
  const overrides = new Map(links.map(item => [item.clusterId, item.leaderId]));
  const sourceCounts = new Map();
  for (const cluster of clusters) {
    const label = normalized(cluster.name);
    sourceCounts.set(label, (sourceCounts.get(label) ?? 0) + 1);
  }
  return clusters.map(({ id, name, tribe }) => {
    const label = normalized(name);
    const candidates = names.get(label);
    const proposedLeaderId = candidates?.size === 1 && sourceCounts.get(label) === 1 ? candidates.values().next().value : '';
    const override = overrides.get(id);
    const validOverride = override === '' || leaders.has(override);
    const leaderId = override === undefined ? proposedLeaderId : validOverride ? override : '';
    return { id, name, tribe, leaderId, proposedLeaderId, method: leaderId ? (override === undefined ? 'auto' : 'manual') : 'unmapped' };
  });
}
