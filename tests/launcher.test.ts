import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { fingerprint } from "../scripts/launcher/files.mjs";
import { ownsProcess, waitFor } from "../scripts/launcher/processes.mjs";
import { parseAndroidDevices, selectDevice } from "../scripts/launcher/devices.mjs";

const temporary: string[] = [];
const processes: ChildProcess[] = [];
afterEach(async () => {
  for (const child of processes.splice(0)) {
    if (child.connected) child.disconnect();
    if (child.exitCode == null && child.signalCode == null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill(); await exited;
    }
  }
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() { const dir = await mkdtemp(path.join(os.tmpdir(), "voice-launcher-")); temporary.push(dir); return dir; }
async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe("rebuild decisions", () => {
  it("detects edits, added and removed files, while ignoring runtime data", async () => {
    const root = await fixture();
    await mkdir(path.join(root, "src/.run"), { recursive: true });
    await writeFile(path.join(root, "src/a.ts"), "first");
    const first = await fingerprint(root, ["src"]);
    await writeFile(path.join(root, "src/.run/log"), "not source");
    expect(await fingerprint(root, ["src"])).toBe(first);
    await writeFile(path.join(root, "src/a.ts"), "other");
    expect(await fingerprint(root, ["src"])).not.toBe(first);
    await writeFile(path.join(root, "src/a.ts"), "first");
    await writeFile(path.join(root, "src/b.ts"), "added");
    expect(await fingerprint(root, ["src"])).not.toBe(first);
    await rm(path.join(root, "src/b.ts"));
    expect(await fingerprint(root, ["src"])).toBe(first);
    await rm(path.join(root, "src/a.ts"));
    expect(await fingerprint(root, ["src"])).not.toBe(first);
  });
  it("invalidates build configuration independently of source contents", async () => {
    const root = await fixture();
    expect(await fingerprint(root, [], { platform: "ios" })).not.toBe(await fingerprint(root, [], { platform: "android" }));
  });
});
describe("phone selection", () => {
  it("ignores unauthorized devices and refuses an ambiguous automatic selection", () => {
    const devices = parseAndroidDevices("List of devices attached\none\tdevice\ntwo\tunauthorized\nthree\tdevice\n");
    expect(devices.map((d: { id: string }) => d.id)).toEqual(["one", "three"]);
    expect(() => selectDevice(devices, { phone: "auto" })).toThrow("More than one");
    expect(selectDevice(devices, { phone: "android", device: "three" })?.id).toBe("three");
    expect(selectDevice(devices, { phone: "none" })).toBeNull();
  });
});
describe("owned processes", () => {
  it("refuses unrelated or recycled process records", async () => {
    const id = randomUUID();
    const record = { pid: 1234, identity: `start-time service ${id}`, id };
    expect(await ownsProcess(record, async () => record.identity)).toBe(true);
    expect(await ownsProcess(record, async () => `new-start service ${id}`)).toBe(false);
    expect(await ownsProcess(record, async () => null)).toBe(false);
    expect(await ownsProcess({ ...record, id: randomUUID() }, async () => record.identity)).toBe(false);
  });
  it("stops a service when its supervisor disconnects", async () => {
    const root = await fixture();
    const script = path.join(root, "idle.cjs");
    await writeFile(script, "setInterval(() => {}, 1000)");
    const child = fork(new URL("../scripts/launcher/service.mjs", import.meta.url), ["fixture", randomUUID(), root, process.execPath, script], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore", "ipc"] });
    processes.push(child);
    await new Promise((resolve) => child.once("message", resolve));
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.disconnect();
    await exited;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  }, 20_000);
});
describe("basic start/stop", () => {
  it("restarts servers without building or opening the phone, then stops everything", async () => {
    const root = await fixture();
    await cp(new URL("../scripts/launcher/", import.meta.url), path.join(root, "scripts/launcher"), { recursive: true });
    // OS process discovery is covered by the separate orphan shutdown regression.
    await writeFile(path.join(root, "scripts/launcher/shutdown.mjs"), "export const stopProjectProcesses = async () => 0;");
    await mkdir(path.join(root, ".run"));
    await mkdir(path.join(root, ".next"));
    await writeFile(path.join(root, ".next/BUILD_ID"), "already-built");
    const controlPort = await unusedPort();
    const port = await unusedPort();
    const metroPort = await unusedPort();
    const ollamaPort = await unusedPort();
    await writeFile(path.join(root, ".run/config.json"), JSON.stringify({ controlPort, port, metroPort, phone: "android", mode: "hosted", open: false }));
    await writeFile(path.join(root, "scripts/launcher/devices.mjs"), `
      export const toolEnvironment = () => process.env;
      export const listDevices = async () => [{platform:'android',id:'test-phone'}];
      export const selectDevice = devices => devices[0];
      export const forward = async () => {};
      export const disconnect = async () => {};
      export const stopPhone = async () => {};
      export const phoneServer = () => '';
      export const deploy = async () => {throw Error('Start must not build a phone')};
      export const connect = async () => {throw Error('Start must not open a phone')};
    `);
    await writeFile(path.join(root, "scripts/launcher/service.mjs"), `
      import {createServer} from 'node:http';
      const server=createServer((req,res)=>{res.writeHead(200);res.end('ready')});
      server.listen(Number(process.argv[5]),'127.0.0.1');
      process.on('message',()=>{server.close(()=>process.exit(0));server.closeIdleConnections()});
      process.on('disconnect',()=>process.exit(0));
    `);
    const child = fork(path.join(root, "scripts/launcher/supervisor.mjs"), [], { stdio: "ignore", env: {...process.env, OLLAMA_URL:`http://127.0.0.1:${ollamaPort}`} });
    processes.push(child);
    const base = `http://127.0.0.1:${controlPort}`;
    await waitFor(() => fetch(`${base}/status`).then((r) => r.ok).catch(() => false), "server control", 5000);
    const act = (command: string) => fetch(`${base}/${command}`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: "{}" });
    expect((await act("start")).status).toBe(202);
    await waitFor(() => fetch(`${base}/status`).then((r) => r.json()).then((s) => { if (s.error) throw new Error(s.error); return s.status === "Ready"; }), "startup", 5000);
    const first = await fetch(`${base}/status`).then((r) => r.json());
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).ok).toBe(true);
    expect((await act("start")).status).toBe(202);
    await waitFor(() => fetch(`${base}/status`).then((r) => r.json()).then((s) => s.status === "Ready" && s.services.coordinator.pid !== first.services.coordinator.pid), "restart", 5000);
    const exited = new Promise((resolve) => child.once("exit", resolve));
    expect((await act("stop")).status).toBe(202);
    await exited;
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
    await expect(fetch(`${base}/status`)).rejects.toThrow();
  }, 15_000);
});
