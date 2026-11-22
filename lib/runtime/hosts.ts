import { Bonjour, type Browser } from "bonjour-service";
import { createHash } from "node:crypto";
import { hostname, networkInterfaces } from "node:os";

export interface HostListing { id: string; name: string; urls: string[] }
interface Identity { id: string; port: number }
interface Directory { bonjour: Bonjour; browser: Browser; addresses: string; stop: () => void }
const runtime = globalThis as typeof globalThis & { voiceDirectory?: Directory; voiceIdentity?: Identity };

/** How often the coordinator checks whether the computer's addresses changed, to advertise again. */
const WATCH_MS = 10_000;

function computerName() {
  return hostname().replace(/\.local$/, "");
}

/**
 * This coordinator: an id that stays the same while the process runs, the computer's name now, and
 * the port. macOS can rename the computer while the coordinator runs (Alexs-MacBook-Pro-3 became -7
 * on 22 Nov), so the id is worked out once; a new id would make the coordinator list its own advert
 * as a second host.
 */
export function hostIdentity() {
  if (!runtime.voiceIdentity) {
    const port = Number(process.env.VOICE_COORDINATOR_PORT || process.env.PORT || 3117);
    const id = createHash("sha256").update(`${computerName()}:${process.cwd()}:${port}`).digest("hex").slice(0, 16);
    runtime.voiceIdentity = { id, port };
  }
  const { id, port } = runtime.voiceIdentity;
  return { id, name: computerName(), port };
}

/**
 * The host name the advert points at. bonjour-service would otherwise use the computer's own name
 * (`os.hostname()`) and announce it with its own list of addresses; macOS takes that as another
 * device using its name and renames itself, which strands a phone that knows the old name.
 */
export function advertHost(id: string) {
  return `voicetomap-${id}.local`;
}

/** The IPv4 addresses other devices can reach this computer at, now. */
export function lanAddresses(interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const addresses = Object.values(interfaces).flatMap((items) => (items || []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address));
  return [...new Set(addresses)].sort();
}

/** The addresses this coordinator answers at: the one the asker used first, then each LAN address. */
export function ownUrls(origin: string, port: number, addresses: string[]): string[] {
  return [...new Set([origin, ...addresses.map((address) => `http://${address}:${port}`)])];
}

function advertise(): Omit<Directory, "stop"> {
  const { id, name, port } = hostIdentity();
  const bonjour = new Bonjour({}, (error: Error) => console.warn("[hosts] LAN discovery unavailable:", error.message));
  const browser = bonjour.find({ type: "voicetomap" });
  const service = bonjour.publish({ name: `${name} ${id}`, type: "voicetomap", port, host: advertHost(id), txt: { id, name } });
  service.on("error", (error: Error) => console.warn("[hosts] Advertisement unavailable:", error.message));
  return { bonjour, browser, addresses: lanAddresses().join(",") };
}

/**
 * Advertises this coordinator on the local network as `_voicetomap._tcp`, and finds the others. The
 * advert carries the addresses of the moment and its sockets join the networks of the moment, so
 * when the computer moves (venue Wi-Fi to a phone's hotspot) it is made again.
 */
export function startHostDirectory() {
  if (runtime.voiceDirectory) return;
  const { port } = hostIdentity();
  if (port < 1 || port > 65535) return;
  try {
    let current = advertise();
    const watch = setInterval(() => {
      if (lanAddresses().join(",") === current.addresses) return;
      try {
        current.bonjour.destroy();
        current = advertise();
        Object.assign(runtime.voiceDirectory ?? {}, current);
      } catch (error) { console.warn("[hosts] Advertising again failed:", error); }
    }, WATCH_MS);
    watch.unref?.();
    runtime.voiceDirectory = {
      ...current,
      stop: () => {
        clearInterval(watch);
        current.bonjour.destroy();
      },
    };
  } catch (error) { console.warn("[hosts] Discovery unavailable:", error); }
}

export function listHosts(origin: string): HostListing[] {
  startHostDirectory();
  const { id, name, port } = hostIdentity();
  const hosts: HostListing[] = [{ id, name, urls: ownUrls(origin, port, lanAddresses()) }];
  for (const service of runtime.voiceDirectory?.browser.services || []) {
    if (service.txt?.id === id || typeof service.txt?.id !== "string") continue;
    const addresses = (service.addresses || []).filter((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address) && !address.startsWith("127."));
    hosts.push({ id: service.txt.id, name: service.txt.name || service.name, urls: addresses.map((address) => `http://${address}:${service.port}`) });
  }
  return hosts;
}
