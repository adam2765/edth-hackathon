#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { loadSettings } from './launcher/settings.mjs';
import { readJson, saveJson } from './launcher/files.mjs';
import { stopProjectProcesses } from './launcher/shutdown.mjs';
import { toolEnvironment, listDevices, selectDevice, stopPhone } from './launcher/devices.mjs';
import { delay } from './launcher/processes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];
if (!['build', 'start', 'stop'].includes(command) || process.argv.length > 3) {
  console.error('Use npm run build, npm start or npm stop.'); process.exit(1);
}
const config = await loadSettings(root);
const base = `http://127.0.0.1:${config.controlPort}`;
async function status() {
  const response = await fetch(`${base}/status`, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`Server control: HTTP ${response.status}`);
  const state = await response.json();
  if (state.app !== 'voice-to-map-launcher' || state.root !== root) throw new Error('Another project is using the server control port.');
  return state;
}
try {
  // Run shutdown from the current code, never by trusting a resident controller's
  // Stopped flag. Retire old controllers as well, regardless of their ports.
  const env = toolEnvironment();
  await stopProjectProcesses(root, { env, ollamaPorts: [Number(new URL(env.OLLAMA_URL || 'http://127.0.0.1:11434').port || 11434)], whisperPorts: [config.whisperPort] });
  if (command === 'stop') {
    const device = selectDevice(await listDevices(env), { phone: 'auto', ...config });
    if (device) await stopPhone(root, device, env);
  }
  const file = path.join(root, '.run/state.json');
  await saveJson(file, { ...await readJson(file, {}), root, services: {}, status: 'Stopped', busy: false, error: null, message: 'Stopped. All project server processes verified gone.' });
  if (command === 'stop') { console.log('Stopped. All project server processes verified gone.'); process.exit(0); }
  await mkdir(path.join(root, '.run'), { recursive: true });
  const log = await open(path.join(root, '.run/launcher.log'), 'a');
  const child = spawn(process.execPath, [path.join(root, 'scripts/launcher/supervisor.mjs')], {
    cwd: root, detached: true, windowsHide: true, env: process.env, stdio: ['ignore', log.fd, log.fd],
  });
  child.unref(); await log.close();
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await delay(250);
    try { await status(); ready = true; break; } catch (error) { if (!error.cause && error.name !== 'TimeoutError') throw error; }
  }
  if (!ready) throw new Error('Could not start server control. See .run/launcher.log.');
  const response = await fetch(`${base}/${command}`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
  if (!response.ok) throw new Error(await response.text());
  await delay(200);
  let last = '';
  for (;;) {
    let state;
    try { state = await status(); } catch (error) {
      if (command !== 'stop' || (!error.cause && error.name !== 'TimeoutError')) throw error;
      state = await readJson(path.join(root, '.run/state.json'), {});
      if (state.error) throw new Error(state.error);
      console.log('Stopped.'); break;
    }
    if (state.message !== last) { console.log(state.message); last = state.message; }
    if (!state.busy) { if (state.error) throw new Error(state.error); break; }
    await delay(500);
  }
} catch (error) {
  console.error(error.message);
  await saveJson(path.join(root, '.run/state.json'), { ...await readJson(path.join(root, '.run/state.json'), {}), root, status: 'Failed', error: error.message, busy: false }).catch(() => {});
  process.exitCode = 1;
}
