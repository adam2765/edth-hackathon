import { describeTrack } from "@/lib/geo/trackKinds";
import { FADE_AFTER_MS, knownAt, type SessionState } from "./fold";

/**
 * A plain-text handover of the mission, for a shift change or a radio message [273]. It is built
 * from the folded view only: no model, no new data, and every line names what it comes from.
 */
export interface HandoverOptions {
  session?: string | null;
  now: number;
  mode: "live" | "replay" | "ended";
  format?: (ts: number) => string;
}

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const defaultFormat = (ts: number) => clock.format(ts);

export function handover(view: SessionState, opts: HandoverOptions): string {
  const fmt = opts.format ?? defaultFormat;
  const mission = view.mission?.name ?? "No mission";
  const code = opts.session ? ` (${opts.session})` : "";
  const lines: string[] = [];
  lines.push(`Situation · ${mission}${code} · ${opts.mode} at ${fmt(opts.now)}`);
  lines.push("");

  lines.push(`Units (${view.units.length})`);
  if (!view.units.length) lines.push("- None.");
  for (const u of view.units) {
    const p = u.position;
    const silent = opts.now > 0 && opts.now - knownAt(u) > FADE_AFTER_MS;
    const where = p ? `${p.label} · ±${p.radius_m} m` : "not placed";
    const heard = u.lastHeard ? `last heard ${fmt(u.lastHeard)}` : "not heard yet";
    const question = u.pending?.question ?? u.prompt?.question ?? null;
    lines.push(
      `- ${u.callsign}: ${silent ? "silent" : "on the net"}, ${heard}, ${where}` +
        `${question ? `; question: ${question}` : ""}${u.task ? `; looking at T${u.task.n}` : ""}`,
    );
  }
  lines.push("");

  lines.push(`Tracks (${view.tracks.length})`);
  if (!view.tracks.length) lines.push("- None.");
  for (const t of view.tracks) {
    const p = t.position;
    const where = p ? `${p.label} · ±${p.radius_m} m` : "not placed";
    lines.push(`- T${t.n}: ${describeTrack(t)}, ${where}${t.gone != null ? ", gone" : ""}, seen by ${t.seenBy} at ${fmt(t.seenTs)}`);
  }
  lines.push("");

  const waiting = view.held.length + view.requests.length;
  lines.push(`Waiting (${waiting})`);
  if (!waiting) lines.push("- Nothing.");
  for (const h of view.held) {
    const who = h.candidates[0] ?? h.read ?? "unknown";
    lines.push(`- Held radio report (${who}): ${h.question || h.transcript || "(no words)"} · ${fmt(h.ts)}`);
  }
  for (const r of view.requests) {
    lines.push(`- Recon request from ${r.callsign} for ${r.n != null ? `T${r.n}` : "no track named"} · ${fmt(r.ts)}`);
  }
  lines.push("");

  lines.push("Recent (newest first)");
  if (!view.feed.length) lines.push("- Nothing heard yet.");
  for (const f of view.feed.slice(0, 5)) {
    lines.push(`- ${fmt(f.ts)} ${f.callsign}: ${f.transcript || f.outcome}`);
  }
  return lines.join("\n");
}
