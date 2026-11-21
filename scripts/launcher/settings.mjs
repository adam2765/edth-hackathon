import path from 'node:path';
import { readJson, saveJson } from './files.mjs';

// Whisper keeps the upstream default. The private controller migrates away from it.
export async function loadSettings(root, env = process.env) {
  const file = path.join(root, '.run/config.json');
  const saved = await readJson(file, {});
  const whisperUrl = env.WHISPER_URL || 'http://127.0.0.1:3118';
  const whisperPort = Number(new URL(whisperUrl).port || 80);
  const config = { mode: 'local', phone: 'auto', device: '', port: 3117, metroPort: 8082, controlPort: 3116, open: true, ...saved, ...(env.PROVIDER_MODE ? { mode: env.PROVIDER_MODE } : {}), whisperUrl, whisperPort };
  if (new Set([config.port, config.metroPort, whisperPort]).has(config.controlPort)) {
    config.controlPort = 3116;
    while (new Set([config.port, config.metroPort, whisperPort]).has(config.controlPort)) config.controlPort++;
    await saveJson(file, config);
  }
  return config;
}
