import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, realpath, writeFile, rm } from "node:fs/promises";
import { fork, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { selectProjectProcesses, stopProjectProcesses } from "../scripts/launcher/shutdown.mjs";

const directories: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode == null && child.signalCode == null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL"); await exited;
    }
  }
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function directory() {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "voice-stop-")));
  directories.push(dir); return dir;
}

describe("orphan shutdown", () => {
  it("finds project servers and workers across ports without selecting other projects or ancestors", () => {
    const root = "/project/app";
    const item = (pid: number, command: string, extra = {}) => ({ pid, ppid: 1, owned: true, started: "birth", command, cwd: root, ports: [], ...extra });
    const processes = [
      item(100, "node caller", { ppid: 90 }), item(90, "next-server", { ports: [7777] }),
      item(10, `node ${root}/scripts/launcher/supervisor.mjs`, { status: "Stopped", ports: [46321] }),
      item(11, "next-server (v16)", { ports: [55555] }),
      item(12, `node ${root}/transmitter/node_modules/expo/bin/cli start`, { ports: [8087] }),
      item(13, "worker", { ppid: 11, cwd: "/elsewhere" }),
      item(20, "next-server", { cwd: "/project/application", ports: [3117] }),
      item(21, "next-server", { owned: false, ports: [3117] }),
      item(22, `node ${root}2/node_modules/next/dist/bin/next start`, { cwd: "/elsewhere", ports: [6000] }),
      item(23, "node custom-server.js", { ports: [49152] }),
      item(24, "whisper-server -m models/turbo.bin --port 49153", { ports: [49153] }),
      item(25, "whisper-server --port 3118", { cwd: "/elsewhere", ports: [3118] }),
      item(26, "whisper-server --port 47777", { cwd: "/elsewhere", ports: [47777] }),
      item(27, "Safari Web Content", { ports: [], cwd: "/elsewhere" }),
    ];
    expect(selectProjectProcesses(root, processes, { selfPid: 100, parentPid: 90 }).map((p: { pid: number }) => p.pid)).toEqual([10, 11, 12, 13, 23, 24, 25]);
  });

  it("closes a stale Stopped controller and an orphan on random ports, keeping an unrelated server alive", async () => {
    const root = await directory();
    const other = await directory();
    const script = path.join(root, "fixture.mjs");
    await writeFile(script, `
      import {createServer} from 'node:http';
      const root=process.argv[2], kind=process.argv[3];
      const server=createServer((req,res)=>{
        if(req.url==='/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'voice-to-map-launcher',root,status:'Stopped'}));return;}
        if(req.url==='/api/health' && kind==='pathless') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'voice-to-map',ready:true}));return;}
        res.end('up');
        if(req.url==='/quit') {server.close(()=>process.exit(0));server.closeIdleConnections();}
      });
      if(kind==='stubborn') process.on('SIGTERM',()=>{});
      server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
    `);
    const records: Array<{ child: ChildProcess; port: number; cwd: string; command: string; started: string }> = [];
    for (const kind of ["controller", "stubborn", "unrelated", "pathless"]) {
      const child = fork(script, [root, kind], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
      children.push(child);
      const { port } = await new Promise<{ port: number }>((resolve) => child.once("message", resolve));
      records.push({ child, port, cwd: kind === "pathless" ? "" : kind === "unrelated" ? other : root, command: kind === "controller" ? `node ${root}/scripts/launcher/supervisor.mjs` : "next-server", started: `birth-${child.pid}` });
    }
    const signals: string[] = [];
    // Use controlled process metadata: this exercises real socket closure/signals
    // even in sandboxes that deny the operating system's ps/lsof enumeration.
    const count = await stopProjectProcesses(root, {
      snapshot: async () => records.filter(({ child }) => child.exitCode == null && child.signalCode == null).map((r) => ({ pid: r.child.pid, ppid: 1, owned: true, started: r.started, cwd: r.cwd, command: r.command, ports: [r.port] })),
      signal: async (record, signal) => {
        const child = records.find((r) => r.child.pid === record.pid)?.child;
        if (child && child.exitCode == null && child.signalCode == null) { signals.push(signal); child.kill(signal); }
      },
      graceMs: 150, forceMs: 1500,
    });
    expect(count).toBe(3);
    expect(signals).toContain("SIGKILL");
    for (const { port } of records.slice(0, 2)) await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
    expect((await fetch(`http://127.0.0.1:${records[2].port}`)).ok).toBe(true);
    await expect(fetch(`http://127.0.0.1:${records[3].port}`)).rejects.toThrow();
  }, 7000);

  it("fails instead of claiming Stopped when inspection is blocked or a process survives", async () => {
    const root = await directory();
    await expect(stopProjectProcesses(root, { snapshot: async () => { throw Error("inspection denied"); } })).rejects.toThrow("shutdown is not verified");
    const process = { pid: 12345, ppid: 1, owned: true, started: "birth", command: "next-server", cwd: root, ports: [56000] };
    await expect(stopProjectProcesses(root, { snapshot: async () => [process], signal: async () => {}, graceMs: 1, forceMs: 1 })).rejects.toThrow("Shutdown incomplete");
  });
});
