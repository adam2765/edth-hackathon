import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, stat, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const groups = {
  web: ['app', 'components', 'lib', 'data', 'public', 'scripts/copy-maplibre-worker.mjs', 'scripts/prepare-tts.mjs', 'scripts/stt-server.mjs', 'instrumentation.ts', 'next.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'],
  phone: ['transmitter/App.tsx', 'transmitter/index.ts', 'transmitter/src', 'transmitter/assets', 'transmitter/scenarios', 'transmitter/metro.config.js', 'transmitter/tsconfig.json', 'transmitter/babel.config.js', 'lib/geo/types.ts', 'lib/reports/types.ts'],
  native: ['transmitter/scripts/prepare-app.mjs', 'transmitter/modules', 'transmitter/plugins', 'transmitter/app.json', 'transmitter/app.config.ts', 'transmitter/package.json', 'transmitter/package-lock.json'],
};
const skipped = new Set(['node_modules', '.git', '.next', '.run', '.expo', 'build', '.gradle', '.cxx', 'models', 'ort', 'tts']);
export async function fingerprint(root, inputs, settings = {}) {
  const hash = createHash('sha256').update(JSON.stringify(settings));
  async function visit(relative) {
    const full = path.join(root, relative);
    let info;
    try { info = await stat(full); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update(`missing:${relative}\0`); return;
    }
    if (info.isDirectory()) {
      for (const entry of (await readdir(full)).sort()) {
        if (!skipped.has(entry) && !entry.startsWith('.env') && entry !== 'maplibre-gl-worker.mjs') await visit(path.join(relative, entry));
      }
    } else if (info.isFile()) {
      hash.update(relative).update('\0').update(await readFile(full)).update('\0');
    }
  }
  for (const input of [...inputs].sort()) await visit(input);
  return hash.digest('hex');
}
export async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}
export async function saveJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
}
