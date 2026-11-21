/**
 * Where the shared record is kept, behind one interface so a hosted database can be added beside
 * the file without touching the endpoints. Server only.
 *
 * - `file`: one JSON-lines file per session on this computer (default outside Vercel). The demo's
 *   coordinator runs on the Mac, so this is the store the demo uses, online or not. A deleted
 *   mission's file moves to `deleted/` beside them.
 * - `none`: keeps nothing (default on Vercel, where files are neither kept nor shared between
 *   instances). Reports still get their answer; the command post says the site keeps no record.
 */
import { appendFile, mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LogEntry, MissionEntry } from "./types";

export interface ReportStore {
  readonly kind: "file" | "none";
  append(entry: LogEntry): Promise<void>;
  /** Entries after the first `after`, and how many there are in all. */
  list(session: string, after?: number): Promise<{ total: number; entries: LogEntry[] }>;
  /** Starts a new log with its mission line. False if the code is taken. */
  create(entry: MissionEntry): Promise<boolean>;
  /** Every session code kept, and every code ever used (deleted ones too), so none is reused. */
  sessions(): Promise<{ kept: string[]; used: string[] }>;
  /** Moves a session's log out of the list, into `deleted/`. False if there was none. */
  remove(session: string): Promise<boolean>;
  /** Keeps the recording of a held radio report, for the operator to listen to [203]. False if not kept. */
  saveAudio(session: string, file: string, data: Buffer): Promise<boolean>;
  /** The recording, or null when there is none. */
  readAudio(session: string, file: string): Promise<Buffer | null>;
}

/** A recording's file name as kept: an entry id and an audio extension. */
export const AUDIO_FILE = /^[a-z0-9]+-[a-z0-9]+\.(wav|m4a|mp4|aac|caf|webm|ogg|mp3|bin)$/;

class NoStore implements ReportStore {
  readonly kind = "none" as const;
  async append(): Promise<void> {}
  async list(): Promise<{ total: number; entries: LogEntry[] }> {
    return { total: 0, entries: [] };
  }
  async create(): Promise<boolean> {
    return false;
  }
  async sessions(): Promise<{ kept: string[]; used: string[] }> {
    return { kept: [], used: [] };
  }
  async remove(): Promise<boolean> {
    return false;
  }
  async saveAudio(): Promise<boolean> {
    return false;
  }
  async readAudio(): Promise<Buffer | null> {
    return null;
  }
}

const SESSION_FILE = /^([a-z0-9][a-z0-9_-]*)\.jsonl$/;

/**
 * The file is the record; each instance keeps what it has parsed and reads only the bytes added
 * since, so a command post polling every second costs one `stat` when nothing changed.
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

  async create(entry: MissionEntry): Promise<boolean> {
    this.ready ??= mkdir(this.dir, { recursive: true });
    await this.ready;
    try {
      // "wx" fails if the file exists, so two missions opened at once cannot take the same code.
      await writeFile(this.file(entry.session), `${JSON.stringify(entry)}\n`, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  }

  async sessions(): Promise<{ kept: string[]; used: string[] }> {
    const codes = async (dir: string) => {
      try {
        return (await readdir(dir)).map((f) => SESSION_FILE.exec(f)?.[1]).filter((c): c is string => !!c);
      } catch {
        return [];
      }
    };
    const kept = await codes(this.dir);
    // Deleted logs are named <code>.jsonl or <code>~<time>.jsonl; the code is the part before ~.
    const gone = (await readdir(path.join(this.dir, "deleted")).catch(() => [] as string[])).map((f) => f.split(/[~.]/)[0]);
    return { kept, used: [...new Set([...kept, ...gone])] };
  }

  async remove(session: string): Promise<boolean> {
    const from = this.file(session);
    const bin = path.join(this.dir, "deleted");
    await mkdir(bin, { recursive: true });
    const stamp = Date.now();
    try {
      await rename(from, path.join(bin, `${session}~${stamp}.jsonl`));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
    this.cache.delete(session);
    // Its held reports' recordings go with it [203].
    await rename(path.join(this.dir, "audio", session), path.join(bin, `${session}~${stamp}.audio`)).catch(() => {});
    return true;
  }

  /** Recordings of held radio reports sit in `audio/<session>/` beside the logs [203]. */
  private audioFile(session: string, file: string): string {
    if (!/^[a-z0-9_-]+$/.test(session) || !AUDIO_FILE.test(file)) throw new Error(`bad audio file: ${session}/${file}`);
    return path.join(this.dir, "audio", session, file);
  }

  async saveAudio(session: string, file: string, data: Buffer): Promise<boolean> {
    const to = this.audioFile(session, file);
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, data);
    return true;
  }

  async readAudio(session: string, file: string): Promise<Buffer | null> {
    try {
      return await readFile(this.audioFile(session, file));
    } catch {
      return null;
    }
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

const queues = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` after any earlier call for the same session has finished, so a check and the write it
 * leads to (is the call sign free? was this report saved already?) cannot interleave with another.
 * One coordinator process; enough for the demo's Mac.
 */
export function withSessionLock<T>(session: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(session) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(session, tail);
  void tail.then(() => {
    if (queues.get(session) === tail) queues.delete(session);
  });
  return run;
}

/** A short id that sorts by time: base-36 milliseconds plus a random tail. */
export function newEntryId(now = Date.now()): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
