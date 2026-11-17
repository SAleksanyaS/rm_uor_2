import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readStatusRegister } from './status-register.mjs';

async function exists(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function seedWorkspace(seed, dataDir) {
  const initialState = join(seed, 'workspace.json');
  const currentState = join(dataDir, 'workspace.json');
  if (!(await exists(initialState)) || await exists(currentState)) return;
  const sources = join(dataDir, 'sources');
  await mkdir(sources, { recursive: true });
  for (const file of await readdir(join(seed, 'sources'))) {
    if (!/^[a-f0-9]{64}$/u.test(file)) throw new Error('Не удалось прочитать исходные данные комплекта.');
    await copyFile(join(seed, 'sources', file), join(sources, file), constants.COPYFILE_EXCL).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  const staging = await mkdtemp(join(dataDir, '.seed-'));
  try {
    const stateFile = join(staging, 'workspace.json');
    await copyFile(initialState, stateFile);
    await link(stateFile, currentState).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
  } finally {
    await rm(join(staging, 'workspace.json'), { force: true });
    await rmdir(staging);
  }
}

export async function readBundledStatus(seed) {
  const manifest = join(seed, 'status-register.json');
  if (!(await exists(manifest))) return null;
  const { id, name } = JSON.parse(await readFile(manifest, 'utf8'));
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/u.test(id) || typeof name !== 'string' || !/\.xlsx$/iu.test(name)) {
    throw new Error('Некорректное описание книги статусов в комплекте.');
  }
  const bytes = await readFile(join(seed, 'sources', id));
  if (createHash('sha256').update(bytes).digest('hex') !== id) {
    throw new Error('Книга статусов в комплекте не совпадает с контрольной суммой.');
  }
  readStatusRegister(bytes);
  return { id, name, bytes };
}
