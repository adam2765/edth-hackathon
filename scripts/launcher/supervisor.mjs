import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings } from './settings.mjs';
import { groups, fingerprint, readJson, saveJson } from './files.mjs';
import { delay, run, waitFor, processIdentity, ownsProcess, killTree, openBrowser, stopExternalServers, setCancellation } from './processes.mjs';
import { toolEnvironment, listDevices, selectDevice, deploy, phoneServer, connect, forward, disconnect, stopPhone } from './devices.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const directory = path.join(root, '.run');
const configFile = path.join(directory, 'config.json');
const stateFile = path.join(directory, 'state.json');
const buildFile = path.join(directory, 'build.json');
const env = toolEnvironment();
const light = process.argv[2] === 'light';
const config = await loadSettings(root, env);
const state = { services: {}, ...await readJson(stateFile, {}), root, status: 'Stopped', error: null, busy: false };
const children = new Map();
let stopping = false;
let connection;
let reconnectTimer;
let operation;
let stopRequested = false;
const save = () => saveJson(stateFile, state);
async function phase(message) { state.message = message; console.log(message); await save(); }
const runtimeEnv = (extra = {}) => ({ ...env, PROVIDER_MODE: config.mode, WHISPER_URL: config.whisperUrl, WHISPER_PROFILE: light ? 'light' : 'regular', REPORT_STORE: 'file', REPORT_STORE_DIR: path.join(root, '.data/sessions'), ...extra });

async function launch(kind, cwd, args, extra = {}) {
  const id = randomUUID();
  const child = fork(path.join(here, 'service.mjs'), [kind, id, cwd, ...args], {
    cwd, env: runtimeEnv(extra), detached: process.platform !== 'win32', stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  children.set(kind, child);
  // A healthy old listener is not proof this coordinator successfully bound its port.
  const listening = kind === 'coordinator' ? new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Coordinator did not confirm listening.')), 15000);
    child.on('message', (message) => {
      if (message?.ready && message.id === id) { clearTimeout(timer); resolve(); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Coordinator exited before listening on port ${config.port}. Check .run/launcher.log.`)); });
  }) : null;
  listening?.catch(() => {}); // Attach immediately while process identity is inspected.
  state.services[kind] = { pid: child.pid, id, identity: await processIdentity(child.pid) };
  child.on('error', (error) => { state.error = error.message; state.status = 'Failed'; void save(); });
  child.once('exit', () => {
    children.delete(kind); delete state.services[kind];
    if (!stopping && state.status === 'Ready') { state.status = 'Failed'; state.error = `${kind} stopped. Run npm start to restart the servers.`; }
    void save();
  });
  await save();
  if (listening) await listening;
}
async function stopOwned() {
  // Cancellation stops work, never the cleanup that must reap its processes.
  setCancellation(undefined);
  stopping = true;
  clearInterval(reconnectTimer);
  for (const kind of ['metro', 'coordinator', 'whisper', 'ollama']) {
    const child = children.get(kind);
    const record = state.services[kind];
    if (child && child.exitCode == null && child.signalCode == null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      if (child.connected) child.send('stop');
      await Promise.race([exited, delay(18_000)]);
      if (child.exitCode == null && child.signalCode == null) {
        if (process.platform === 'win32') await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { env });
        else process.kill(-child.pid, 'SIGKILL');
        await exited;
      }
    } else if (record && await ownsProcess(record)) {
      await killTree(record); await delay(1000);
      if (await ownsProcess(record)) await killTree(record, true);
    }
    children.delete(kind); delete state.services[kind];
  }
  await disconnect(config, connection, env); connection = null;
  stopping = false; await save();
}
async function stopAll(stopApp = true) {
  await stopOwned();
  await stopExternalServers(root, { coordinator: config.port, metro: config.metroPort, ollama: Number(new URL(env.OLLAMA_URL || 'http://127.0.0.1:11434').port || 11434), whisper: config.whisperPort }, env);
  if (stopApp) {
    const device = selectDevice(await listDevices(env), config);
    if (device) await stopPhone(root, device, env);
  }
  state.status = 'Stopped'; await phase('Stopped. Mission data is kept.');
}
async function dependencies(phone = false) {
  const cwd = phone ? path.join(root, 'transmitter') : root;
  const hash = await fingerprint(cwd, ['package.json', 'package-lock.json'], { node: process.version });
  const file = path.join(directory, phone ? 'phone-dependencies.json' : 'web-dependencies.json');
  const previous = await readJson(file);
  if (!existsSync(path.join(cwd, 'node_modules')) || (previous && previous.hash !== hash)) await run('npm', ['ci'], { cwd, env });
  await saveJson(file, { hash });
}
async function metro(device) {
  if (config.phone === 'none' || !existsSync(path.join(root, 'transmitter/node_modules/expo/bin/cli'))) return;
  const phone = device || { platform: config.phone === 'ios' ? 'ios' : 'android' };
  const target = path.join(root, 'transmitter');
  await launch('metro', target, [process.execPath, path.join(target, 'node_modules/expo/bin/cli'), 'start', '--dev-client', ...(phone.platform === 'android' ? ['--localhost'] : ['--lan']), '--port', String(config.metroPort), '--max-workers', '2'], { CI: '1', EXPO_PUBLIC_SERVER_URL: phoneServer(config, phone) });
  await waitFor(() => fetch(`http://127.0.0.1:${config.metroPort}/status`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false), 'phone code server');
  if (device) { await forward(config, device, env); connection = device; }
}
async function build() {
  state.status = 'Building';
  await dependencies();
  if (config.mode === 'local') {
    await phase('Preparing coordinator speech-to-text…');
    await run(process.execPath, [path.join(root, 'scripts/stt-server.mjs'), '--prepare'], { cwd: root, env: runtimeEnv() });
  }
  const previous = await readJson(buildFile, {});
  const webHash = await fingerprint(root, groups.web, { node: process.version, platform: process.platform, arch: process.arch });
  const webChanged = previous.web !== webHash || !existsSync(path.join(root, '.next/BUILD_ID'));
  const device = selectDevice(await listDevices(env), config);
  const native = device ? await fingerprint(root, groups.native, { platform: device.platform, team: env.APPLE_TEAM_ID, bundle: env.TRANSMITTER_BUNDLE_ID }) : null;
  const phoneHash = device ? await fingerprint(root, [...groups.phone, ...groups.native], { native, server: phoneServer(config, device), device: device.id }) : null;
  const phoneChanged = device && previous.phone !== phoneHash;
  if (webChanged || phoneChanged) { await stopAll(false); setCancellation(operation?.signal); }
  if (webChanged) {
    await phase('Building coordinator…');
    await run('npm', ['run', 'build:web'], { cwd: root, env: runtimeEnv() });
    if (webHash !== await fingerprint(root, groups.web, { node: process.version, platform: process.platform, arch: process.arch })) throw new Error('Source changed during compilation. Run npm run build again.');
    previous.web = webHash; await saveJson(buildFile, previous);
  }
  if (device) {
    await dependencies(true);
    await phase(phoneChanged ? 'Building/loading changed phone app…' : 'Checking installed phone app…');
    const phoneEnv = runtimeEnv({ EXPO_PUBLIC_SERVER_URL: phoneServer(config, device) });
    const receipt = await deploy(root, device, phoneEnv, false, previous.phoneBuild, native);
    const installed = previous.phoneBuild?.key !== receipt.key || previous.phoneBuild?.native !== receipt.native || receipt.installed;
    // Installation already succeeded. Keep its receipt even if a later reload or
    // device connection fails, so retrying does not repeat a native compilation.
    previous.phoneBuild = receipt;
    await saveJson(buildFile, previous);
    if (phoneChanged || installed) {
      if (children.has('metro')) { await stopOwned(); setCancellation(operation?.signal); }
      await metro(device);
      await connect(config, device, env, receipt.identity);
    }
    previous.phone = phoneHash;
    await saveJson(buildFile, previous);
    config.phone = device.platform; config.device = device.id; await saveJson(configFile, config);
  }
  state.status = 'Built';
  await phase(device ? 'Build complete. Phone app is up to date. Run npm start for the servers.' : 'Coordinator built. No phone connected; connect it and run npm run build to build/load its app.');
}
async function start() {
  // Restart always, without building or opening/reloading the phone app.
  await stopAll(false);
  setCancellation(operation?.signal);
  if (!existsSync(path.join(root, '.next/BUILD_ID'))) throw new Error('Run npm run build first.');
  state.status = 'Starting'; await phase(`Starting servers (${light ? 'light' : 'regular'})…`);
  if (config.mode === 'local') {
    const whisper = new URL(config.whisperUrl);
    if (!['127.0.0.1', 'localhost'].includes(whisper.hostname)) throw new Error('Local speech-to-text must run on this computer.');
    await launch('whisper', root, [process.execPath, path.join(root, 'scripts/stt-server.mjs')]);
    await waitFor(async () => {
      if (!children.has('whisper')) throw new Error('Speech-to-text stopped. Run npm run build to prepare it; details in .run/launcher.log.');
      return fetch(config.whisperUrl + '/health', { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
    }, 'Whisper model readiness', 240_000);
    const url = (env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local mode needs Ollama on this server.');
    await launch('ollama', root, ['ollama', 'serve'], { OLLAMA_HOST: new URL(url).host, OLLAMA_NO_CLOUD: '1', OLLAMA_KEEP_ALIVE: light ? '30s' : '-1', OLLAMA_CONTEXT_LENGTH: '4096' });
    await waitFor(() => fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok).catch(() => false), 'Ollama');
  }
  await launch('coordinator', root, [String(config.port)]);
  await waitFor(() => fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false), 'coordinator readiness', 240_000);
  const device = selectDevice(await listDevices(env), config);
  await metro(device);
  for (const kind of ['coordinator', ...(config.mode === 'local' ? ['whisper', 'ollama'] : [])]) {
    if (!children.has(kind)) throw new Error(`${kind} stopped during startup.`);
  }
  state.status = 'Ready';
  await phase(`Servers ready.\nReceiver: http://localhost:${config.port}/receiver\nOpen Transmitter on the phone and tap Connect.`);
  reconnectTimer = setInterval(async () => {
    if (state.busy || state.status !== 'Ready') return;
    try { const phone = selectDevice(await listDevices(env), config); if (phone) { await forward(config, phone, env); connection = phone; } } catch (error) { console.warn(error.message); }
  }, 5000);
  if (config.open) await openBrowser(`http://localhost:${config.port}/receiver`).catch(() => {});
}
async function action(name) {
  state.busy = true; state.error = null;
  operation = new AbortController(); setCancellation(operation.signal);
  try {
    if (name === 'build') await build();
    else if (name === 'start') await start();
    else await stopAll();
  } catch (error) {
    setCancellation(undefined);
    if (stopRequested) await stopAll();
    else { await stopOwned(); state.status = 'Failed'; state.error = error.message; await phase(error.message); }
  } finally { state.busy = false; setCancellation(undefined); operation = null; await save(); }
  if (name === 'stop' || stopRequested) server.close(() => process.exit(state.error ? 1 : 0));
}
const server = createServer(async (req, res) => {
  const allowed = [`127.0.0.1:${config.controlPort}`, `localhost:${config.controlPort}`];
  if (!allowed.includes(req.headers.host)) { res.writeHead(403); res.end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/status') {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ app: 'voice-to-map-launcher', ...state })); return;
  }
  if (req.method !== 'POST' || !['/build', '/start', '/stop'].includes(req.url)) { res.writeHead(404); res.end(); return; }
  if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type'] !== 'application/json') { res.writeHead(403); res.end(); return; }
  if (state.busy) {
    if (req.url === '/stop') { stopRequested = true; operation?.abort(); res.writeHead(202); res.end(); }
    else { res.writeHead(409); res.end('Another command is still running.'); }
    return;
  }
  res.writeHead(202); res.end(); void action(req.url.slice(1));
});
server.on('error', (error) => { console.error(error.message); process.exit(1); });
server.listen(config.controlPort, '127.0.0.1', () => phase('Ready for build, start or stop.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (state.busy) operation?.abort(); else void action('stop'); });
