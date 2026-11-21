import { Bonjour, type Browser } from "bonjour-service";
import { createHash } from "node:crypto";
import { hostname, networkInterfaces } from "node:os";

export interface HostListing { id: string; name: string; urls: string[] }
interface Directory { bonjour: Bonjour; browser: Browser; self: HostListing }
const runtime = globalThis as typeof globalThis & { voiceDirectory?: Directory };
export function hostIdentity() {
  const port = Number(process.env.VOICE_COORDINATOR_PORT || process.env.PORT || 3117);
  const name = hostname().replace(/\.local$/, "");
  return { id: createHash("sha256").update(`${name}:${process.cwd()}:${port}`).digest("hex").slice(0, 16), name, port };
}
export function startHostDirectory() {
  if (runtime.voiceDirectory) return;
  const { id, name, port } = hostIdentity();
  if (port < 1 || port > 65535) return;
  try {
    const bonjour = new Bonjour({}, (error: Error) => console.warn("[hosts] LAN discovery unavailable:", error.message));
    const urls = Object.values(networkInterfaces()).flatMap((items) => (items || []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => `http://${i.address}:${port}`));
    const browser = bonjour.find({ type: "voicetomap" });
    runtime.voiceDirectory = { bonjour, browser, self: { id, name, urls } };
    const service = bonjour.publish({ name: `${name} ${id}`, type: "voicetomap", port, txt: { id, name } });
    service.on("error", (error: Error) => console.warn("[hosts] Advertisement unavailable:", error.message));
  } catch (error) { console.warn("[hosts] Discovery unavailable:", error); }
}
export function listHosts(origin: string): HostListing[] {
  startHostDirectory();
  const { id, name } = hostIdentity();
  const self = runtime.voiceDirectory?.self;
  const hosts: HostListing[] = [{ id, name, urls: [origin, ...(self?.urls || [])] }];
  for (const service of runtime.voiceDirectory?.browser.services || []) {
    if (service.txt?.id === id || typeof service.txt?.id !== "string") continue;
    const addresses = (service.addresses || []).filter((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address) && !address.startsWith("127."));
    hosts.push({ id: service.txt.id, name: service.txt.name || service.name, urls: addresses.map((address) => `http://${address}:${service.port}`) });
  }
  return hosts;
}
