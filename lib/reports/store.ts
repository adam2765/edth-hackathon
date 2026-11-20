/**
 * Where the shared record is kept, behind one interface so a hosted database can be added beside
 * the file without touching the endpoints. Server only.
 *
 * - `file`: one JSON-lines file per session on this computer (default outside Vercel). The demo's
 *   coordinator runs on the Mac, so this is the store the demo uses, online or not.
 * - `none`: keeps nothing (default on Vercel, where files are neither kept nor shared between
 *   instances). Reports still get their answer; the receiver says the site keeps no record.
 */
import { appendFile, mkdir, open, stat } from "node:fs/promises";
import path from "node:path";
import type { LogEntry } from "./types";

export interface ReportStore {
  readonly kind: "file" | "none";
  append(entry: LogEntry): Promise<void>;
  /** Entries after the first `after`, and how many there are in all. */
  list(session: string, after?: number): Promise<{ total: number; entries: LogEntry[] }>;
}

class NoStore implements ReportStore {
  readonly kind = "none" as const;
  async append(): Promise<void> {}
  async list(): Promise<{ total: number; entries: LogEntry[] }> {
    return { total: 0, entries: [] };
  }
}

/**
 * The file is the record; each instance keeps what it has parsed and reads only the bytes added
 * since, so a receiver polling every second costs one `stat` when nothing changed.
 */
export class FileStore implements ReportStore {
  readonly kind = "file" as const;
  private cache = new Map<string, { bytes: number; entries: LogEntry[] }>();
  private ready: Promise<unknown> | null = null;

  constructor(private readonly dir: string) {}

  private file(session: string): string {
    // Session codes are checked by sessionCode() before they get here; this is a second guard.
    if (!/^[a-z0-9_-]+$/.test(session)) throw new Error(`bad session code: ${session}`);
    return path.join(this.dir, `${session}.jsonl`);
  }

  async append(entry: LogEntry): Promise<void> {
    this.ready ??= mkdir(this.dir, { recursive: true });
    await this.ready;
    // One write per line, opened for appending, so two reports at once cannot interleave.
    await appendFile(this.file(entry.session), `${JSON.stringify(entry)}\n`, "utf8");
  }

  async list(session: string, after = 0): Promise<{ total: number; entries: LogEntry[] }> {
    const all = await this.readAll(session);
    return { total: all.length, entries: all.slice(Math.max(0, after)) };
  }

  private async readAll(session: string): Promise<LogEntry[]> {
    const file = this.file(session);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      return [];
    }
    let c = this.cache.get(session);
    if (!c || size < c.bytes) c = { bytes: 0, entries: [] }; // new, or the file was cleared
    if (size > c.bytes) {
      const fh = await open(file, "r");
      try {
        const buf = Buffer.alloc(size - c.bytes);
        await fh.read(buf, 0, buf.length, c.bytes);
        // Only whole lines: a write may be half done.
        const end = buf.lastIndexOf(0x0a);
        if (end >= 0) {
          const entries = [...c.entries];
          for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
            if (!line.trim()) continue;
            try {
              entries.push(JSON.parse(line) as LogEntry);
            } catch {
              // A damaged line is skipped, not fatal: the rest of the record still replays.
            }
          }
          c = { bytes: c.bytes + end + 1, entries };
        }
      } finally {
        await fh.close();
      }
    }
    this.cache.set(session, c);
    return c.entries;
  }
}

let store: ReportStore | null = null;

/** `REPORT_STORE=file|none` picks the store; `REPORT_STORE_DIR` moves the files (default `.data/sessions`). */
export function getStore(): ReportStore {
  if (store) return store;
  const kind = process.env.REPORT_STORE ?? (process.env.VERCEL ? "none" : "file");
  store = kind === "file" ? new FileStore(path.resolve(process.env.REPORT_STORE_DIR ?? ".data/sessions")) : new NoStore();
  return store;
}

/** A short id that sorts by time: base-36 milliseconds plus a random tail. */
export function newEntryId(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
