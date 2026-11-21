"use client";

/**
 * The receiver's missions menu: open a new mission (area, name, optional start point), switch to an
 * open one, replay or delete an ended one. The start point is picked by name from the gazetteer,
 * so nobody types coordinates and no model makes them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AREAS, type AreaId } from "@/lib/geo/areas";
import type { MissionListReply, MissionSummary, PlacesReply, StartPoint } from "@/lib/reports/types";
import styles from "./Receiver.module.css";

const LIST_POLL_MS = 5000;

interface Props {
  current: string | null;
  defaultArea: AreaId;
  /** Show this mission (null: none). */
  onPick: (code: string | null) => void;
  onClose: () => void;
}

// Day and 24-hour time, whatever the browser's language is set to. Local time.
const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function fmtWhen(ts: number): string {
  return WHEN.format(ts);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

async function errorOf(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? `The coordinator answered ${res.status}.`;
}

export default function MissionPanel({ current, defaultArea, onPick, onClose }: Props) {
  const [list, setList] = useState<MissionListReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The list could not be read. Kept apart from `error`, so the next good read clears it. */
  const [unreachable, setUnreachable] = useState(false);
  const [area, setArea] = useState<AreaId>(defaultArea);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ key: string; places: StartPoint[] }>({ key: "", places: [] });
  const [start, setStart] = useState<StartPoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      if (!res.ok) throw new Error(await errorOf(res));
      setList((await res.json()) as MissionListReply);
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, LIST_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Place search, a moment after typing stops.
  const q = query.trim();
  const key = `${area}|${q}`;
  useEffect(() => {
    if (!q) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places?area=${area}&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        if (res.ok) setFound({ key: `${area}|${q}`, places: ((await res.json()) as PlacesReply).places });
      } catch {
        // Aborted by the next keystroke, or offline: the list stays as it was.
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, area]);
  const places = q && found.key === key ? found.places : [];

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, name, start: start?.id ?? null }),
      });
      if (!res.ok) throw new Error(await errorOf(res));
      const { mission } = (await res.json()) as { mission: MissionSummary };
      onPick(mission.code);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opening the mission failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (code: string) => {
    setConfirmDelete(null);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(code)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await errorOf(res));
      if (code === current) onPick(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deleting the mission failed.");
    }
  };

  const open = list?.missions.filter((m) => m.ended == null) ?? [];
  const past = list?.missions.filter((m) => m.ended != null) ?? [];

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className={styles.panel} role="dialog" aria-label="Missions" tabIndex={-1}>
        {list && !list.stored ? (
          <p className={styles.empty}>This coordinator keeps no record, so it has no missions. Run the coordinator on the Mac and open this page there.</p>
        ) : (
          <>
            <section className={styles.panelSection} aria-labelledby="new-h">
              <h2 id="new-h" className={styles.h2}>
                Start mission
              </h2>
              <div className={styles.field}>
                <span className={styles.label} id="area-l">
                  Area
                </span>
                <div className={styles.segmented} role="group" aria-labelledby="area-l">
                  {(Object.keys(AREAS) as AreaId[]).map((id) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={area === id}
                      onClick={() => {
                        setArea(id);
                        setStart(null);
                        setQuery("");
                      }}
                    >
                      {AREAS[id].label}
                    </button>
                  ))}
                </div>
              </div>
              <label className={styles.field}>
                <span className={styles.label}>Name</span>
                <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Optional, e.g. Vincennes walk" />
              </label>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="start-q">
                  Start point
                </label>
                {start ? (
                  <div className={styles.startChosen}>
                    <span>
                      <strong>{start.name}</strong> <span className={styles.muted}>· {start.category.replace("_", " ")} · within {start.radius_m} m</span>
                    </span>
                    <button type="button" className={styles.linkBtn} onClick={() => setStart(null)}>
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      id="start-q"
                      className={styles.input}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={area === "kyiv" ? "Search a place, e.g. Майдан" : area === "izium" ? "Search a place, e.g. собор" : "Search a place, e.g. château"}
                      autoComplete="off"
                    />
                    {places.length ? (
                      <ul className={styles.places}>
                        {places.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setStart(p);
                                setQuery("");
                              }}
                            >
                              <strong>{p.name}</strong> <span className={styles.muted}>· {p.category.replace("_", " ")}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : q && found.key === key ? (
                      <p className={styles.hint}>No place by that name in {AREAS[area].label}.</p>
                    ) : null}
                  </>
                )}
                <p className={styles.hint}>Optional. Units that join start here, shown with ≈, until they say where they are.</p>
              </div>
              <button type="button" className={styles.primaryBtn} onClick={create} disabled={busy}>
                {busy ? "Starting…" : "Start mission"}
              </button>
            </section>

            <section className={styles.panelSection} aria-labelledby="open-h">
              <h2 id="open-h" className={styles.h2}>
                Open <span className={styles.count}>{open.length}</span>
              </h2>
              {open.length ? (
                <ul className={styles.missions}>
                  {open.map((m) => (
                    <li key={m.code}>
                      <button
                        type="button"
                        className={styles.missionRow}
                        aria-current={m.code === current || undefined}
                        onClick={() => {
                          onPick(m.code);
                          onClose();
                        }}
                      >
                        <span className={styles.missionName}>
                          {m.name}
                          {m.code === current ? <span className={styles.shownTag}>On screen</span> : null}
                        </span>
                        <span className={styles.muted}>
                          {m.code} · {plural(m.units, "unit", "units")} · {plural(m.reports, "report", "reports")} · opened {fmtWhen(m.opened)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>{list ? "No mission is open." : "Loading…"}</p>
              )}
            </section>

            {past.length ? (
              <section className={styles.panelSection} aria-labelledby="past-h">
                <h2 id="past-h" className={styles.h2}>
                  Ended <span className={styles.count}>{past.length}</span>
                </h2>
                <ul className={styles.missions}>
                  {past.map((m) => (
                    <li key={m.code} className={styles.pastRow}>
                      <button
                        type="button"
                        className={styles.missionRow}
                        aria-current={m.code === current || undefined}
                        onClick={() => {
                          onPick(m.code);
                          onClose();
                        }}
                      >
                        <span className={styles.missionName}>
                          {m.name}
                          {m.code === current ? <span className={styles.shownTag}>On screen</span> : null}
                        </span>
                        <span className={styles.muted}>
                          {m.code} · {plural(m.units, "unit", "units")} · {plural(m.reports, "report", "reports")} · ended {fmtWhen(m.ended!)}
                        </span>
                      </button>
                      {confirmDelete === m.code ? (
                        <span className={styles.confirm} role="group" aria-label={`Delete ${m.name}?`}>
                          <button type="button" className={styles.dangerBtn} onClick={() => remove(m.code)} aria-label={`Yes, delete ${m.name}`}>
                            Delete
                          </button>
                          <button type="button" className={styles.linkBtn} onClick={() => setConfirmDelete(null)} aria-label={`Keep ${m.name}`}>
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button type="button" className={styles.linkBtn} onClick={() => setConfirmDelete(m.code)} aria-label={`Delete ${m.name}`}>
                          Delete
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
        {error || unreachable ? (
          <p className={styles.error} role="alert">
            {error ?? "No answer from the coordinator. The list may be out of date."}
          </p>
        ) : null}
      </div>
    </>
  );
}
