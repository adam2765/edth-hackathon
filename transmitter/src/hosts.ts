import type { MissionListReply } from "./types";
export interface FoundHost { id: string; name: string; url: string; ready: boolean; missions: MissionListReply }
export function serverOrigin(value: string | undefined | null): string | null {
  try { const url = new URL(value || ""); return ["http:", "https:"].includes(url.protocol) ? url.origin : null; } catch { return null; }
}
async function json(url: string) {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(2500) });
  return await res.json();
}
// Metro gives the phone a bootstrap host; that host browses LAN advertisements.
// USB loopback and remembered hosts also work, without a native discovery module.
export async function discoverHosts(candidates: Array<string | null | undefined>): Promise<FoundHost[]> {
  const seeds = [...new Set(candidates.map(serverOrigin).filter((url): url is string => !!url))];
  const names = new Map<string, string>();
  const urls = new Set(seeds);
  await Promise.all(seeds.map(async (seed) => {
    try {
      const data = await json(seed + "/api/hosts");
      for (const host of data.hosts || []) for (const value of host.urls || []) {
        const url = serverOrigin(value);
        if (url) { urls.add(url); names.set(url, host.name); }
      }
    } catch { /* Older hosts still work through the direct probe. */ }
  }));
  const results = await Promise.all([...urls].slice(0, 32).map(async (url): Promise<FoundHost | null> => {
    try {
      const [health, missions] = await Promise.all([json(url + "/api/health"), json(url + "/api/sessions")]);
      if (typeof health.ready !== "boolean" || missions.stored !== true || !Array.isArray(missions.missions)) return null;
      return { id: health.id || url, name: health.name || names.get(url) || new URL(url).host, url, ready: health.ready, missions };
    } catch { return null; }
  }));
  const unique = new Map<string, FoundHost>();
  for (const host of results) if (host && !unique.has(host.id)) unique.set(host.id, host);
  return [...unique.values()];
}
