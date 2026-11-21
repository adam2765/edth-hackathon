// Every owned service has a unique command-line identity and an IPC shutdown path.
// Losing the supervisor also stops its services. The supervisor separately records process groups.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const [, , kind, id, root, ...args] = process.argv;
let stop = false;
let close = async () => {};
async function shutdown() {
  if (stop) return;
  stop = true;
  const timer = setTimeout(() => process.exit(1), 15_000);
  try { await close(); } finally {
    clearTimeout(timer);
    // The graceful work is done. Reap any remaining workers in this owned process group.
    if (process.platform !== 'win32') process.kill(-process.pid, 'SIGKILL');
    process.exit(0);
  }
}
process.on('message', (message) => { if (message === 'stop') void shutdown(); });
process.on('disconnect', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

if (kind === 'coordinator') {
  process.env.VOICE_COORDINATOR_PORT = args[0];
  const next = createRequire(`${root}/package.json`)('next');
  const app = next({ dev: false, dir: root });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => {
    if (stop) { res.writeHead(503); res.end('Stopping'); return; }
    void handle(req, res);
  });
  close = async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); });
    globalThis.voiceDirectory?.bonjour.destroy();
    await app.close();
  };
  server.listen(Number(args[0]), '0.0.0.0', () => process.send?.({ ready: true, id, port: server.address().port }));
} else {
  const [file, ...commandArgs] = args;
  const child = spawn(file, commandArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
  child.once('spawn', () => process.send?.({ spawned: true, id, pid: child.pid }));
  close = async () => {
    if (child.exitCode != null) return;
    if (process.platform === 'win32') {
      await new Promise((resolve) => { const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T'], { windowsHide: true }); killer.on('exit', resolve); killer.on('error', resolve); });
    } else child.kill('SIGTERM');
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 10_000).unref(); });
    if (process.platform === 'win32' && child.exitCode == null) {
      await new Promise((resolve) => { const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); killer.on('exit', resolve); killer.on('error', resolve); });
    }
  };
  child.on('error', (error) => { console.error(error.message); process.exit(1); });
  child.on('exit', (code) => { if (!stop) process.exit(code || 1); });
}
