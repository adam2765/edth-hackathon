import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { fingerprint } from "../scripts/launcher/files.mjs";
import { ownsProcess, waitFor } from "../scripts/launcher/processes.mjs";
import { parseAndroidDevices, parseAppleDevices, selectDevice } from "../scripts/launcher/devices.mjs";

const temporary: string[] = [];
const processes: ChildProcess[] = [];
const blockers: Server[] = [];
afterEach(async () => {
  for (const server of blockers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
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

  // What `xcrun xctrace list devices` prints, with made-up names and ids. `phones` go under
  // "== Devices ==" (Xcode reaches them now), `remembered` under "== Devices Offline ==".
  const xctrace = (phones: string[], remembered: string[]) => [
    "== Devices ==",
    "Someone’s MacBook Pro (3) (11111111-2222-3333-4444-555555555555)",
    ...phones,
    "",
    "== Devices Offline ==",
    ...remembered,
    "",
    "== Simulators ==",
    "iPad (A16) Simulator (18.5) (99999999-8888-7777-6666-555555555555)",
    "iPhone 16 Simulator (18.5) (AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE)",
    "",
  ].join("\n");
  const phoneA = "Phone A (27.0.1) (00000000-000A000A000A000A)";
  const phoneB = "Someone’s iPhone (2) (26.6.1) (00000000-000B000B000B000B)";

  it("does not count an iPhone that Xcode only remembers", () => {
    const devices = parseAppleDevices(xctrace([], [phoneA, phoneB]));
    expect(devices).toEqual([]);
    // Two remembered iPhones and none connected used to stop every command here.
    expect(selectDevice(devices, { phone: "auto" })).toBeNull();
  });
  it("counts an iPhone listed under Devices, and never the Mac or a simulator", () => {
    const devices = parseAppleDevices(xctrace([phoneA], [phoneB]));
    expect(devices).toEqual([{ platform: "ios", id: "00000000-000A000A000A000A", name: "Phone A" }]);
    expect(selectDevice(devices, { phone: "auto" })?.id).toBe("00000000-000A000A000A000A");
    expect(parseAppleDevices(xctrace([], []))).toEqual([]);
  });
  it("still refuses two iPhones that are both connected", () => {
    const devices = parseAppleDevices(xctrace([phoneA, phoneB], []));
    expect(devices.map((d: { name: string }) => d.name)).toEqual(["Phone A", "Someone’s iPhone (2)"]);
    expect(() => selectDevice(devices, { phone: "auto" })).toThrow("More than one");
    expect(selectDevice(devices, { phone: "auto", device: "00000000-000B000B000B000B" })?.name).toBe("Someone’s iPhone (2)");
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
// The supervisor's signal and child-process handling is the Mac path; Windows cannot run it.
describe.skipIf(process.platform === "win32")("basic start/stop", () => {
  it.each([["hosted", false, false], ["local", false, false], ["local", true, false], ["local", false, true]] as const)("restarts %s servers (light=%s, occupied=%s) without building or opening the phone, then stops everything", async (mode, light, occupied) => {
    const root = await fixture();
    await cp(new URL("../scripts/launcher/", import.meta.url), path.join(root, "scripts/launcher"), { recursive: true });
    // OS process discovery is covered by the separate orphan shutdown regression.
    await writeFile(path.join(root, "scripts/launcher/shutdown.mjs"), "export const stopProjectProcesses = async () => 0;");
    await mkdir(path.join(root, ".run"));
    await mkdir(path.join(root, ".next"));
    await writeFile(path.join(root, ".next/BUILD_ID"), "already-built");
    const controlPort = await unusedPort();
    const port = await unusedPort();
    if (occupied) {
      const blocker = createHttpServer((req, res) => { res.writeHead(200); res.end('old server still healthy'); });
      blockers.push(blocker);
      await new Promise<void>(resolve => blocker.listen(port, '127.0.0.1', resolve));
    }
    const metroPort = await unusedPort();
    const ollamaPort = await unusedPort();
    const whisperPort = await unusedPort();
    await writeFile(path.join(root, ".run/config.json"), JSON.stringify({ controlPort, port, metroPort, phone: "android", mode, open: false }));
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
      const server=createServer((req,res)=>{res.writeHead(200);res.end(JSON.stringify({profile:process.env.WHISPER_PROFILE,keepAlive:process.env.OLLAMA_KEEP_ALIVE}))});
      const kind=process.argv[2];
      const port=kind==='ollama'?new URL(process.env.OLLAMA_URL).port:kind==='whisper'?new URL(process.env.WHISPER_URL).port:process.argv[5];
      server.listen(Number(port),'127.0.0.1',()=>process.send?.({ready:true,id:process.argv[3]}));
      process.on('message',()=>{server.close(()=>process.exit(0));server.closeIdleConnections()});
      process.on('disconnect',()=>process.exit(0));
    `);
    const child = fork(path.join(root, "scripts/launcher/supervisor.mjs"), light ? ["light"] : [], { stdio: "ignore", env: {...process.env, OLLAMA_URL:`http://127.0.0.1:${ollamaPort}`, WHISPER_URL:`http://127.0.0.1:${whisperPort}`, PROVIDER_MODE:mode} });
    processes.push(child);
    const base = `http://127.0.0.1:${controlPort}`;
    await waitFor(() => fetch(`${base}/status`).then((r) => r.ok).catch(() => false), "server control", 5000);
    const act = (command: string) => fetch(`${base}/${command}`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: "{}" });
    expect((await act("start")).status).toBe(202);
    if (occupied) {
      await waitFor(() => fetch(`${base}/status`).then(r => r.json()).then(s => s.status === "Failed" && /before listening/.test(s.error)), "bind failure", 5000);
      expect((await fetch(`http://127.0.0.1:${port}/api/health`)).ok).toBe(true);
      const exited = new Promise(resolve => child.once("exit", resolve));
      expect((await act("stop")).status).toBe(202);
      await exited;
      return;
    }
    await waitFor(() => fetch(`${base}/status`).then((r) => r.json()).then((s) => { if (s.error) throw new Error(s.error); return s.status === "Ready"; }), "startup", 5000);
    const first = await fetch(`${base}/status`).then((r) => r.json());
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).ok).toBe(true);
    expect(!!first.services.whisper).toBe(mode === "local");
    if (mode === "local") {
      const speech = await fetch(`http://127.0.0.1:${whisperPort}/health`).then(r => r.json());
      const ollama = await fetch(`http://127.0.0.1:${ollamaPort}/api/version`).then(r => r.json());
      expect(speech.profile).toBe(light ? "light" : "regular");
      expect(ollama.keepAlive).toBe(light ? "30s" : "-1");
    }
    expect((await act("start")).status).toBe(202);
    await waitFor(() => fetch(`${base}/status`).then((r) => r.json()).then((s) => s.status === "Ready" && s.services.coordinator.pid !== first.services.coordinator.pid), "restart", 5000);
    const exited = new Promise((resolve) => child.once("exit", resolve));
    expect((await act("stop")).status).toBe(202);
    await exited;
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
    await expect(fetch(`${base}/status`)).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${whisperPort}/health`)).rejects.toThrow();
  }, 15_000);
});
