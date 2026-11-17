import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const objectId = /^[a-f0-9]{40,64}$/u;

export async function readBuildRevision(root) {
  try {
    const git = join(root, '.git');
    const head = (await readFile(join(git, 'HEAD'), 'utf8')).trim();
    if (objectId.test(head)) return head.slice(0, 12);
    const ref = /^ref: (refs\/(?:[\w-]+\/)*[\w.-]+)$/u.exec(head)?.[1];
    if (!ref || ref.split('/').some(part => part === '.' || part === '..')) return null;
    let revision;
    try {
      revision = (await readFile(join(git, ref), 'utf8')).trim();
    } catch {
      const packed = await readFile(join(git, 'packed-refs'), 'utf8');
      revision = packed.split(/\r?\n/u).find(line => line.endsWith(' ' + ref))?.split(' ')[0];
    }
    return objectId.test(revision ?? '') ? revision.slice(0, 12) : null;
  } catch {
    return null;
  }
}

function browserChecks(browser) {
  if (!browser.connectors.length) return [{ id: 'browser', label: 'Браузерные отчёты', status: 'neutral',
    detail: 'Подключения ещё не настроены.', route: 'connectors' }];
  return [['read', 'Чтение отчётов', 'browser-reports'], ['collect', 'Сбор выгрузок', 'connectors']].map(([kind, label, route]) => {
    const jobs = browser.jobs.filter(job => job.kind === kind);
    const latest = jobs.at(-1);
    const latestDone = new Map(jobs.filter(job => job.state !== 'running').map(job => [job.connectorId, job]));
    const failed = [...latestDone.values()].filter(job => job.state === 'error');
    const lastSuccess = jobs.findLast(job => job.state === 'success' && job.finishedAt);
    const lastReport = kind === 'read' ? browser.reports.map(report => report.collectedAt).sort().at(-1) : null;
    const at = latest?.finishedAt ?? latest?.startedAt;
    const detail = failed.length ? `Подключений с ошибкой: ${failed.length}. ${failed.at(-1).message}`
      : latest?.message ?? 'Операция ещё не запускалась.';
    return { id: kind, label, status: failed.length ? 'error' : latest?.state === 'success' ? 'ok' : 'neutral',
      detail, at, lastSuccessAt: lastReport || lastSuccess?.finishedAt, route: failed.length ? 'connectors' : route };
  });
}

export async function createWorkspaceHealth({ state, readRegister, readBrowser, checkGit, revision }) {
  const [register, browser, git] = await Promise.allSettled([readRegister(), readBrowser(), checkGit()]);
  const book = register.status === 'fulfilled' ? register.value : null;
  const bookStatus = register.status === 'rejected' ? 'error' : !book ? 'neutral' : book.asOf ? 'ok' : 'warning';
  const bookDetail = register.status === 'rejected' ? 'Не удалось прочитать выбранную книгу. Проверьте её в разделе «Источники».'
    : !book ? 'Книга со статусами не найдена.' : `${book.source.name} · ${book.periods.join(', ')} · ${book.asOf ? 'дата среза ' + book.asOf : 'дата среза не подтверждена'}`;
  const { profile, shared } = state;
  const remoteReady = profile.remote && !state.restoreConnectionPending;
  const syncStatus = shared.error && remoteReady ? 'error' : remoteReady && shared.checkedAt ? 'ok' : 'neutral';
  const syncDetail = !profile.remote ? 'Общий репозиторий не настроен.'
    : state.restoreConnectionPending ? 'Подтвердите подключение после восстановления.'
      : shared.error || (shared.checkedAt ? `Общая версия ${shared.version ?? '—'}.` : 'Обновления ещё не проверялись.');
  return { checkedAt: new Date().toISOString(), checks: [
    { id: 'build', label: 'Приложение', status: 'ok', detail: `Версия ${state.appVersion}${revision ? ' · ' + revision : ''}` },
    { id: 'map', label: 'Карта целей', status: state.goals.length ? 'ok' : 'neutral',
      detail: `Целей в карте: ${state.goals.length}.`, route: 'map' },
    { id: 'register', label: 'Книга со статусами', status: bookStatus, detail: bookDetail, route: book ? 'reconcile' : 'sources' },
    { id: 'git-executable', label: 'Git на компьютере', status: git.status === 'fulfilled' ? 'ok' : 'warning',
      detail: git.status === 'fulfilled' ? git.value : 'Git не запускается. Проверьте установку или путь в настройках.', route: 'settings' },
    { id: 'git-sync', label: 'Общие данные Git', status: syncStatus, detail: syncDetail,
      at: remoteReady ? shared.checkedAt : null, ...(remoteReady ? { action: 'activity-git-refresh' } : { route: 'settings' }) },
    ...(browser.status === 'fulfilled' ? browserChecks(browser.value)
      : [{ id: 'browser', label: 'Браузерные отчёты', status: 'error', detail: 'Не удалось прочитать состояние подключений.', route: 'connectors' }])
  ] };
}
