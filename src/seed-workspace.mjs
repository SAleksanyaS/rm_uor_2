import { constants } from 'node:fs';
import { copyFile, link, mkdir, mkdtemp, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

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
