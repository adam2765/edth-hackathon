import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";

// The computer's name as macOS reports it; a test renames it, as macOS did on 22 Nov.
let computer = "Alexs-MacBook-Pro-3.local";
vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  return { ...os, hostname: () => computer };
});

const { advertHost, hostIdentity, lanAddresses, ownUrls } = await import("../lib/runtime/hosts");

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({ address, netmask: "255.255.255.0", family: "IPv4", mac: "02:00:00:00:00:01", internal, cidr: null });
const v6 = (address: string): NetworkInterfaceInfo => ({ address, netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", mac: "02:00:00:00:00:01", internal: false, cidr: null, scopeid: 4 });

describe("the coordinator on the local network", () => {
  beforeEach(() => {
    computer = "Alexs-MacBook-Pro-3.local";
    delete (globalThis as { voiceIdentity?: unknown }).voiceIdentity;
  });

  it("keeps its id when macOS renames the computer, and reports the new name", () => {
    const before = hostIdentity();
    computer = "Alexs-MacBook-Pro-7.local";
    const after = hostIdentity();
    expect(after.id).toBe(before.id);
    expect(before.name).toBe("Alexs-MacBook-Pro-3");
    expect(after.name).toBe("Alexs-MacBook-Pro-7");
  });

  it("advertises under a name of its own, never the computer's", () => {
    const { id, name } = hostIdentity();
    expect(advertHost(id)).toBe(`voicetomap-${id}.local`);
    expect(advertHost(id)).not.toBe(`${name}.local`);
  });

  it("lists the IPv4 addresses other devices can reach, once each", () => {
    const addresses = lanAddresses({
      lo0: [v4("127.0.0.1", true)],
      en0: [v4("172.20.10.2"), v6("fe80::1")],
      en8: [v4("169.254.169.145")],
      bridge0: [v4("172.20.10.2")],
    });
    expect(addresses).toEqual(["169.254.169.145", "172.20.10.2"]);
  });

  it("answers first at the address it was asked on, then at each address it has now", () => {
    expect(ownUrls("http://localhost:3117", 3117, ["172.20.10.2", "169.254.169.145"])).toEqual([
      "http://localhost:3117",
      "http://172.20.10.2:3117",
      "http://169.254.169.145:3117",
    ]);
    expect(ownUrls("http://172.20.10.2:3117", 3117, ["172.20.10.2"])).toEqual(["http://172.20.10.2:3117"]);
  });
});

describe("the phone following its coordinator", async () => {
  const { movedTo } = await import("../transmitter/src/hosts");
  const missions = { stored: true as const, missions: [] };
  const host = (id: string, url: string, ready = true) => ({ id, name: id, url, ready, missions });
  const renamed = "http://Alexs-MacBook-Pro-7.local:3117";

  it("stays put while the coordinator still answers at its address", () => {
    expect(movedTo([host("a", renamed)], renamed, "a")).toBeUndefined();
  });

  it("follows the same coordinator, by its id, to a new address", () => {
    const found = [host("b", "http://172.20.10.2:3141"), host("a", "http://voicetomap-a.local:3117")];
    expect(movedTo(found, renamed, "a")?.url).toBe("http://voicetomap-a.local:3117");
  });

  it("does not follow to another coordinator, a host still starting, or before Connect", () => {
    expect(movedTo([host("b", "http://172.20.10.2:3141")], renamed, "a")).toBeUndefined();
    expect(movedTo([host("a", "http://172.20.10.2:3117", false)], renamed, "a")).toBeUndefined();
    expect(movedTo([host("a", "http://172.20.10.2:3117")], renamed, null)).toBeUndefined();
  });
});
