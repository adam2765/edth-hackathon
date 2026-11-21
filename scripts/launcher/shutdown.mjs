import { realpath } from 'node:fs/promises';
import { output, delay } from './processes.mjs';

const runtime = /\b(?:node(?:\.exe)?|next-server|ollama(?:\.exe)?|whisper-server(?:\.exe)?|expo|metro)\b/i;
const controller = /[\\/]scripts[\\/]launcher[\\/]supervisor\.mjs(?:\s|$)/;
const role = /(?:whisper-server|next-server|[\\/]next[\\/]|[\\/]expo[\\/]|[\\/]metro[\\/]|[\\/]jest-worker[\\/]|[\\/]scripts[\\/]launcher[\\/](?:supervisor|service)\.mjs|\bollama(?:\.exe)?\s+(?:serve|runner))/i;
const normalize = (value = '') => {
  const name = value.replace(/\\/g, '/').replace(/\/$/, '');
  return process.platform === 'win32' ? name.toLowerCase() : name;
};
const compact = (value) => value.trim().replace(/\s+/g, ' ');

// Port numbers are deliberately irrelevant to ownership. A checkout path or cwd,
// a server role/listener, and the same user identify roots; their workers follow.
export function selectProjectProcesses(root, processes, { selfPid = process.pid, parentPid = process.ppid, includeControllers = true, ollamaPorts = [11434], whisperPorts = [3118] } = {}) {
  const base = normalize(root);
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const excluded = new Set([selfPid]);
  let ancestor = byPid.get(selfPid)?.ppid ?? parentPid;
  while (ancestor && !excluded.has(ancestor)) { excluded.add(ancestor); ancestor = byPid.get(ancestor)?.ppid; }
  const inside = (value) => { const name = normalize(value); return name === base || name.startsWith(base + '/'); };
  const references = (command) => {
    const value = normalize(command);
    let from = 0;
    for (;;) {
      const at = value.indexOf(base, from);
      if (at < 0) return false;
      const before = value[at - 1]; const after = value[at + base.length];
      if ((!before || /[\s"'=]/.test(before)) && (!after || /[\s"'/]/.test(after))) return true;
      from = at + base.length;
    }
  };
  const chosen = new Set();
  for (const item of processes) {
    if (excluded.has(item.pid) || item.owned === false || !runtime.test(item.command)) continue;
    if (!includeControllers && controller.test(item.command)) continue;
    const project = inside(item.cwd) || references(item.command) || (/\bollama(?:\.exe)?\s+serve\b/i.test(item.command) && item.ports?.some((p) => ollamaPorts.includes(p))) || (/\bwhisper-server(?:\.exe)?\b/i.test(item.command) && item.ports?.some((p) => whisperPorts.includes(p)));
    if (project && (role.test(item.command) || item.ports?.length)) chosen.add(item.pid);
  }
  let added = true;
  while (added) {
    added = false;
    for (const item of processes) {
      if (item.owned !== false && !excluded.has(item.pid) && !chosen.has(item.pid) && chosen.has(item.ppid)) {
        chosen.add(item.pid); added = true;
      }
    }
  }
  return processes.filter((p) => chosen.has(p.pid));
}

async function lsof(args, env) {
  try { return await output('lsof', args, { env }); }
  catch (error) {
    if (error.code === 1 && !error.stderr?.trim()) return '';
    throw error;
  }
}
export async function processSnapshot(env = process.env) {
  if (process.platform === 'win32') {
    const script = `$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $items=@(Get-CimInstance Win32_Process); $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue); @($items | ForEach-Object { $p=$_; $mine=$false; if ($p.CommandLine -match 'node|next|expo|metro|ollama|whisper') { $mine=(Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction SilentlyContinue).Sid -eq $sid }; [pscustomobject]@{pid=[int]$p.ProcessId;ppid=[int]$p.ParentProcessId;started=$p.CreationDate.ToUniversalTime().ToString('o');command=[string]$p.CommandLine;owned=$mine;ports=@($listeners | Where-Object OwningProcess -eq $p.ProcessId | ForEach-Object LocalPort)} }) | ConvertTo-Json -Depth 4 -Compress`;
    const parsed = JSON.parse(await output('powershell.exe', ['-NoProfile', '-Command', script], { env }));
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  const table = await output('ps', ['-axww', '-o', 'pid=,ppid=,uid=,lstart=,command='], { env: { ...env, LC_ALL: 'C' } });
  const uid = process.getuid();
  const items = table.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), owned: Number(match[3]) === uid, started: compact(match[4]), command: match[5], ports: [] }] : [];
  });
  if (!items.some((p) => p.pid === process.pid)) throw new Error('Process inspection failed; shutdown cannot be verified.');
  const candidates = items.filter((p) => p.owned && runtime.test(p.command));
  const byPid = new Map(candidates.map((p) => [p.pid, p]));
  if (candidates.length) {
    let current;
    for (const line of (await lsof(['-a', '-p', candidates.map((p) => p.pid).join(','), '-d', 'cwd', '-Fpn'], env)).split('\n')) {
      if (line.startsWith('p')) current = byPid.get(Number(line.slice(1)));
      else if (line.startsWith('n') && current) current.cwd = line.slice(1);
    }
    for (const line of (await lsof(['-nP', '-a', '-u', String(uid), '-iTCP', '-sTCP:LISTEN', '-Fpn'], env)).split('\n')) {
      if (line.startsWith('p')) current = byPid.get(Number(line.slice(1)));
      else if (line.startsWith('n') && current) {
        const port = Number(line.slice(line.lastIndexOf(':') + 1));
        if (port) current.ports.push(port);
      }
    }
  }
  return items;
}
async function signalProcess(record, signal, env) {
  try {
    // Verify birth time again immediately before signalling, protecting recycled PIDs.
    if (process.platform === 'win32') {
      const birth = await output('powershell.exe', ['-NoProfile', '-Command', `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${record.pid}"; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o') }`], { env });
      if (birth !== record.started) return;
      try { await output('taskkill.exe', ['/PID', String(record.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], { env }); }
      catch (error) { if (signal === 'SIGKILL') throw error; /* Escalate after the graceful deadline. */ }
    } else {
      const birth = await output('ps', ['-p', String(record.pid), '-o', 'lstart='], { env: { ...env, LC_ALL: 'C' } });
      if (compact(birth) !== record.started) return;
      process.kill(record.pid, signal);
    }
  } catch (error) {
    if (error.code === 'ESRCH' || (error.code === 1 && !error.stderr?.trim())) return;
    throw error;
  }
}
async function askControllerToStop(record, root) {
  if (!controller.test(record.command)) return;
  for (const port of record.ports || []) {
    const base = `http://127.0.0.1:${port}`;
    try {
      const state = await fetch(base + '/status', { signal: AbortSignal.timeout(500) }).then((r) => r.json());
      if (state.app !== 'voice-to-map-launcher' || normalize(state.root) !== normalize(root)) continue;
      const options = { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(500) };
      await fetch(base + '/stop', options);
      // Older controllers stop components but only exit on /quit. Never trust their status flag.
      await fetch(base + '/quit', { ...options, signal: AbortSignal.timeout(500) }).catch(() => {});
    } catch { /* The verified process is still checked and terminated below. */ }
  }
}
export async function stopProjectProcesses(root, { env = process.env, includeControllers = true, ollamaPorts = [11434], whisperPorts = [3118], snapshot = () => processSnapshot(env), signal = (p, s) => signalProcess(p, s, env), graceMs = 16_000, forceMs = 2000, selfPid = process.pid, parentPid = process.ppid } = {}) {
  root = await realpath(root);
  const pending = new Map();
  const signalled = new Set();
  const key = (p) => `${p.pid}:${p.started}`;
  const refresh = async () => {
    const all = await snapshot();
    const alive = new Set(all.filter((p) => !/defunct|^\(node\)$/.test(p.command || '')).map(key));
    for (const id of pending.keys()) if (!alive.has(id)) pending.delete(id);
    for (const p of selectProjectProcesses(root, all, { selfPid, parentPid, includeControllers, ollamaPorts, whisperPorts })) if (alive.has(key(p))) pending.set(key(p), p);
  };
  try { await refresh(); } catch (error) { throw new Error(`Cannot inspect project processes; shutdown is not verified: ${error.message}`); }
  const seen = new Set();
  const deadline = Date.now() + graceMs;
  do {
    for (const [id, record] of pending) {
      seen.add(id);
      if (!signalled.has(id)) {
        signalled.add(id);
        await askControllerToStop(record, root);
        await signal(record, 'SIGTERM');
      }
    }
    await delay(100); await refresh();
  } while (pending.size && Date.now() < deadline);
  const forceDeadline = Date.now() + forceMs;
  while (pending.size && Date.now() < forceDeadline) {
    for (const [id, record] of pending) { seen.add(id); await signal(record, 'SIGKILL'); }
    await delay(100); await refresh();
  }
  // A final rescan includes servers that respawned or moved to another port.
  await refresh();
  if (pending.size) throw new Error(`Shutdown incomplete: ${pending.size} project processes are still running.`);
  return seen.size;
}
