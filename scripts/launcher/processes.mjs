import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';

const exec = promisify(execFile);
let cancellation;
export function setCancellation(signal) { cancellation = signal; }
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function run(file, args = [], options = {}) {
  // Invoke npm through its JS entry point; .cmd files cannot be execFile'd on Windows.
  if (file === 'npm') {
    if (!process.env.npm_execpath) throw new Error('Run this command with npm, or set npm_execpath to npm-cli.js.');
    args = [process.env.npm_execpath, ...args]; file = process.execPath;
  }
  return new Promise((resolve, reject) => {
    cancellation?.throwIfAborted();
    const signal = cancellation;
    const child = spawn(file, args, { stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32', ...options });
    const abort = () => {
      if (process.platform === 'win32') {
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Command already exited. */ } }
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('exit', (code, exitSignal) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new Error('Operation stopped.'));
      else if (code === 0) resolve();
      else reject(new Error(`${file} exited ${code ?? exitSignal}`));
    });
  });
}
export async function output(file, args, options = {}) {
  cancellation?.throwIfAborted();
  return (await exec(file, args, { windowsHide: true, timeout: 30_000, signal: cancellation, maxBuffer: 4 * 1024 * 1024, ...options })).stdout.trim();
}
export function portBusy(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(800);
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}
export async function waitFor(check, description, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    cancellation?.throwIfAborted();
    if (await check()) return;
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${description}. See .run/launcher.log.`);
}
export async function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return null;
  try {
    if (process.platform === 'win32') {
      return await output('powershell.exe', ['-NoProfile', '-Command', `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { "$($p.CreationDate.ToUniversalTime().Ticks)|$($p.CommandLine)" }`]);
    }
    return await output('ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command=']);
  } catch { return null; }
}
export async function ownsProcess(record, inspect = processIdentity) {
  const identity = await inspect(record.pid);
  return !!identity && identity === record.identity && identity.includes(record.id);
}
export async function killTree(record, force = false) {
  if (!await ownsProcess(record)) return false;
  try {
    if (process.platform === 'win32') {
      await output('taskkill.exe', ['/PID', String(record.pid), '/T', ...(force ? ['/F'] : [])]);
    } else process.kill(-record.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
  return true;
}
export async function openBrowser(url) {
  const [file, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  await run(file, args);
}

// Scan the process table, independent of configured or listening port numbers.
export async function stopExternalServers(root, ports, env) {
  const { stopProjectProcesses } = await import('./shutdown.mjs');
  return stopProjectProcesses(root, { env, ollamaPorts: ports.ollama ? [ports.ollama] : [], whisperPorts: ports.whisper ? [ports.whisper] : [] });
}
