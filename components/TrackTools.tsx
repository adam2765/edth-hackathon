"use client";

/**
 * The command post's controls for tracks: the palette to place one or change what it is, the card
 * that confirms where it goes, and the card of the track picked on the map or in the list. A person
 * chooses everything here: whose a track is starts at unknown and is never assumed. The position
 * is a click on the map or a place picked by name, never a model's output.
 */
import { useEffect, useState, type ReactNode } from "react";
import { AREAS, type AreaId } from "@/lib/geo/areas";
import { shortGrid, typedGrid, type GridRead } from "@/lib/geo/grid";
import { AFFILIATION_LABEL, AFFILIATIONS, describeTrack, TRACK_KIND_NAME, TRACK_KINDS, trackSymbolCode } from "@/lib/geo/trackKinds";
import type { Affiliation, TrackKind } from "@/lib/geo/types";
import type { TrackState, FeedItem } from "@/lib/reports/fold";
import { PLOT_RADII } from "@/lib/reports/plot";
import type { PlacesReply, StartPoint, UnitPosition } from "@/lib/reports/types";
import styles from "./CommandPost.module.css";

export type MilSymbol = typeof import("milsymbol").default;

/** What a track is, as chosen in the palette. A count of 1 is sent as no count. */
export interface TrackWhat {
  affiliation: Affiliation;
  kind: TrackKind;
  count: number;
}

/** The palette opens on unknown: nothing is hostile until someone says so. */
export const DEFAULT_WHAT: TrackWhat = { affiliation: "unknown", kind: "vehicle", count: 1 };

/** Keys for whose a track is: the first letter of the word on the button. */
export const AFFILIATION_KEY: Record<Affiliation, string> = { hostile: "H", suspect: "S", unknown: "U", neutral: "C", friendly: "F" };

/**
 * A track's standard symbol (APP-6) as SVG, for the lists and the palette. The frame says whose it
 * is and the icon what it is; a neutral track keeps the standard's green, not its purple for
 * civilians, so one colour means one thing on this page. Each symbol is made once.
 */
const svgs = new Map<string, string>();
export function trackSvg(lib: MilSymbol, t: { affiliation: Affiliation; kind: TrackKind }, size: number): string {
  const code = trackSymbolCode(t.affiliation, t.kind);
  const key = `${code}:${size}`;
  let svg = svgs.get(key);
  if (svg === undefined) {
    svg = new lib.Symbol(code, { size, civilianColor: false }).asSVG();
    svgs.set(key, svg);
  }
  return svg;
}

function Sym({ lib, what, size }: { lib: MilSymbol | null; what: { affiliation: Affiliation; kind: TrackKind }; size: number }) {
  return <span className={styles.trackSym} aria-hidden="true" dangerouslySetInnerHTML={lib ? { __html: trackSvg(lib, what, size) } : undefined} />;
}

/** "hostile armour ×2" from the palette's choice. */
export function describeWhat(w: TrackWhat): string {
  return describeTrack({ affiliation: w.affiliation, kind: w.kind, count: w.count > 1 ? w.count : null });
}

/**
 * The six-figure grid of a position, as it is said on the radio [245], after the words that say
 * where it is. Nothing for a position placed by a grid: its name is the grid already [228].
 */
export function GridTag({ at }: { at: Pick<UnitPosition, "lat" | "lon" | "label" | "estimated"> | null | undefined }) {
  if (!at || at.label.startsWith("grid ")) return null;
  return (
    <>
      {" · "}
      <span className={styles.gridTag}>
        {at.estimated ? "≈ " : ""}
        {shortGrid(at)}
      </span>
    </>
  );
}

/** "100 m cell" for a six-figure grid, "10 m cell" for eight. */
function cellOf(g: GridRead): string {
  const figures = g.text.replace(/^\d{1,2}[A-Z] /, "").replace(/\D/g, "").length;
  return `${10 ** (5 - figures / 2)} m cell`;
}

/**
 * Finds places by name in the mission's area, for placing or moving a track at one. A grid typed
 * here, "586 101", is offered as a place too: its cell, read in code [245].
 */
function PlaceSearch({ area, onPick, onGrid }: { area: AreaId; onPick: (p: StartPoint) => void; onGrid?: (g: GridRead) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ key: string; places: StartPoint[] }>({ key: "", places: [] });
  const key = `${area}|${q.trim()}`;
  const grid = onGrid ? typedGrid(q, AREAS[area].centre) : null;
  const isGrid = grid != null;
  useEffect(() => {
    const term = q.trim();
    // A grid is no place's name: nothing to look up.
    if (!term || isGrid) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places?area=${area}&q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        if (res.ok) setFound({ key: `${area}|${term}`, places: ((await res.json()) as PlacesReply).places.slice(0, 5) });
      } catch {
        // Typing on; the next search tries again.
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [area, q, isGrid]);
  const places = q.trim() && !isGrid && found.key === key ? found.places : [];
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor="track-place">
        {onGrid ? "Or find a place, or type a grid" : "Or find a place"}
      </label>
      <input id="track-place" className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={onGrid ? "Château, Bérault, 586 101…" : "Château, Bérault, mairie…"} autoComplete="off" spellCheck={false} />
      {grid || places.length ? (
        <ul className={styles.places}>
          {grid ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  onGrid?.(grid);
                  setQ("");
                }}
              >
                Grid <span className={styles.gridTag}>{grid.text}</span> <span className={styles.muted}>· {cellOf(grid)}</span>
              </button>
            </li>
          ) : null}
          {places.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(p);
                  setQ("");
                }}
              >
                {p.name} <span className={styles.muted}>· {p.category.replace("_", " ")}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The palette: whose, what, how many, and for a new track how sure the place is. Keys work while
 * it is open and no field has the cursor: H S U C F for whose, 1 to 9 for what, Esc to stop.
 */
export function TrackPalette(props: {
  title: string;
  what: TrackWhat;
  onWhat: (w: TrackWhat) => void;
  symbols: MilSymbol | null;
  /** Placing or moving: the circle to give the track, and a search by place name. */
  radius?: number;
  onRadius?: (r: number) => void;
  area?: AreaId;
  onPlace?: (p: StartPoint) => void;
  /** Places it in the cell of a grid typed into the place search [245]. */
  onGrid?: (g: GridRead) => void;
  /** Changing a track: only where it is is fixed, so whose, what and how many show. */
  showWhat?: boolean;
  hint?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const { what, onWhat, symbols } = props;
  const showWhat = props.showWhat ?? true;
  return (
    <div className={styles.tool} role="dialog" aria-label={props.title}>
      <div className={styles.toolHead}>
        <h2 className={styles.toolTitle}>{props.title}</h2>
        <button type="button" className={styles.linkBtn} onClick={props.onClose}>
          Close
        </button>
      </div>
      {showWhat ? (
        <>
          <div className={styles.field}>
            <span className={styles.label}>Whose</span>
            <div className={styles.affs} role="group" aria-label="Whose it is">
              {AFFILIATIONS.map((a) => (
                <button key={a} type="button" data-aff={a} aria-pressed={what.affiliation === a} onClick={() => onWhat({ ...what, affiliation: a })} title={`${AFFILIATION_LABEL[a]} (${AFFILIATION_KEY[a]})`}>
                  {AFFILIATION_LABEL[a]}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>What</span>
            <div className={styles.kinds} role="group" aria-label="What it is">
              {TRACK_KINDS.map((k, i) => (
                <button key={k} type="button" aria-pressed={what.kind === k} onClick={() => onWhat({ ...what, kind: k })} title={`${TRACK_KIND_NAME[k]} (${i + 1})`}>
                  <Sym lib={symbols} what={{ affiliation: what.affiliation, kind: k }} size={18} />
                  <span>{TRACK_KIND_NAME[k]}</span>
                  <span className={styles.kindKey} aria-hidden="true">
                    {i + 1}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.toolRow}>
            <div className={styles.field}>
              <span className={styles.label} id="count-l">
                How many
              </span>
              <div className={styles.stepper} role="group" aria-labelledby="count-l">
                <button type="button" aria-label="One fewer" onClick={() => onWhat({ ...what, count: Math.max(1, what.count - 1) })}>
                  −
                </button>
                <span aria-live="polite">{what.count}</span>
                <button type="button" aria-label="One more" onClick={() => onWhat({ ...what, count: Math.min(999, what.count + 1) })}>
                  +
                </button>
              </div>
            </div>
            {props.onRadius ? <RadiusPicker radius={props.radius ?? 50} onRadius={props.onRadius} /> : null}
          </div>
        </>
      ) : props.onRadius ? (
        <RadiusPicker radius={props.radius ?? 50} onRadius={props.onRadius} />
      ) : null}
      {props.area && props.onPlace ? <PlaceSearch area={props.area} onPick={props.onPlace} onGrid={props.onGrid} /> : null}
      {props.hint ? <p className={styles.hint}>{props.hint}</p> : null}
      {props.footer}
    </div>
  );
}

function RadiusPicker({ radius, onRadius }: { radius: number; onRadius: (r: number) => void }) {
  return (
    <div className={styles.field}>
      <span className={styles.label} id="radius-l">
        How sure, ± m
      </span>
      <div className={styles.segmentedSmall} role="group" aria-labelledby="radius-l">
        {PLOT_RADII.map((r) => (
          <button key={r} type="button" aria-pressed={radius === r} onClick={() => onRadius(r)}>
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The card that says where a track will go, before it is saved: one more look before it is in the log. */
export function DraftCard(props: {
  symbols: MilSymbol | null;
  /** A track's symbol; or, for a unit placed by hand [243], `dot`: the unit's colour. */
  what?: { affiliation: Affiliation; kind: TrackKind };
  dot?: string;
  title: string;
  detail: string;
  /** The grid of where it will go, after the detail [245]. */
  grid?: string;
  note: string;
  onNote: (s: string) => void;
  notePlaceholder?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className={styles.draft} role="dialog" aria-label={props.title}>
      <div className={styles.draftHead}>
        {props.dot ? <span className={styles.unitDot} style={{ background: props.dot }} aria-hidden="true" /> : props.what ? <Sym lib={props.symbols} what={props.what} size={22} /> : null}
        <div className={styles.draftText}>
          <strong>{props.title}</strong>
          <span>
            {props.detail}
            {props.grid ? (
              <>
                {" · "}
                <span className={styles.gridTag}>{props.grid}</span>
              </>
            ) : null}
          </span>
        </div>
      </div>
      <input
        className={styles.input}
        value={props.note}
        onChange={(e) => props.onNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") props.onConfirm();
        }}
        placeholder={props.notePlaceholder ?? "Source, if any: drone feed, BRAVO 2 by phone"}
        aria-label="Where this came from"
        maxLength={120}
      />
      {props.error ? (
        <p className={styles.error} role="alert">
          {props.error}
        </p>
      ) : null}
      <div className={styles.draftButtons}>
        <button type="button" className={styles.linkBtn} onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.primaryBtn} onClick={props.onConfirm} disabled={props.busy}>
          {props.busy ? "Saving…" : props.confirmLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * The track picked on the map or in the list: what it is, who saw it or placed it, and what the
 * command post can do to it. Taking it off the map asks first.
 */
export function TrackCard(props: {
  track: TrackState;
  symbols: MilSymbol | null;
  canEdit: boolean;
  busy: boolean;
  error: string | null;
  onChange: () => void;
  onMove: () => void;
  onGone: () => void;
  onRestore: () => void;
  onClose: () => void;
  /** What the card says about recon, and its buttons [234]. */
  children?: ReactNode;
  /** The reports and command-post acts about this track, oldest first: its provenance [271]. */
  history?: FeedItem[];
  /** Opens the larger provenance panel. */
  onProvenance?: () => void;
}) {
  const t = props.track;
  const [confirmGone, setConfirmGone] = useState(false);
  const p = t.position;
  const who = t.plotted ? `placed by ${t.seenBy}` : `seen by ${t.seenBy}`;
  return (
    <div className={styles.tool} role="dialog" aria-label={`Track ${t.n}`}>
      <div className={styles.toolHead}>
        <Sym lib={props.symbols} what={t} size={22} />
        <h2 className={styles.toolTitle}>Track {t.n}</h2>
        <span className={styles.pill} data-status={t.affiliation}>
          {AFFILIATION_LABEL[t.affiliation]}
        </span>
        {t.gone != null ? (
          <span className={styles.pill} data-status="silent">
            Gone
          </span>
        ) : null}
        <span className={styles.toolActions}>
          {props.onProvenance ? (
            <button
              type="button"
              className={`${styles.linkBtn} ${styles.provenanceHead}`}
              onClick={props.onProvenance}
              title="Who opened it, who saw it last, and the reports behind it"
            >
              History <span className={styles.provenanceCount}>{props.history?.length ?? 0}</span>
            </button>
          ) : null}
          <button type="button" className={styles.linkBtn} onClick={props.onClose}>
            Close
          </button>
        </span>
      </div>
      <p className={styles.cardLine}>{describeTrack(t)}</p>
      <p className={styles.hint}>
        {p ? `${p.estimated ? "≈ " : ""}${p.label} · ±${p.radius_m} m` : "Not placed yet."}
        <GridTag at={p} /> · {who}
        {t.changed ? ` · changed by ${t.changed.by}` : ""}
        {t.note ? ` · source: ${t.note}` : ""}
      </p>
      {props.children}
      {props.error ? (
        <p className={styles.error} role="alert">
          {props.error}
        </p>
      ) : null}
      {!props.canEdit ? null : t.gone != null ? (
        <div className={styles.draftButtons}>
          <button type="button" className={styles.ghostBtn} onClick={props.onRestore} disabled={props.busy}>
            Put back on the map
          </button>
        </div>
      ) : confirmGone ? (
        <div className={styles.confirm} role="group" aria-label={`Take Track ${t.n} off the map?`}>
          <span className={styles.confirmText}>Take Track {t.n} off the map? It stays in the list and the log.</span>
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={() => {
              setConfirmGone(false);
              props.onGone();
            }}
            disabled={props.busy}
          >
            Mark gone
          </button>
          <button type="button" className={styles.linkBtn} onClick={() => setConfirmGone(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className={styles.draftButtons}>
          <button type="button" className={styles.ghostBtn} onClick={props.onChange} disabled={props.busy}>
            Change
          </button>
          <button type="button" className={styles.ghostBtn} onClick={props.onMove} disabled={props.busy || !!t.pendingReport}>
            Move
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => setConfirmGone(true)} disabled={props.busy}>
            Gone
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The larger provenance panel [271]: the same facts as the card's button, with room for the
 * earlier positions and the reports behind the track.
 */
export function TrackProvenance(props: {
  track: TrackState;
  symbols: MilSymbol | null;
  history: FeedItem[];
  format: (ts: number) => string;
  onClose: () => void;
  /** Replays the mission just after one of the history's reports. */
  onJump?: (ts: number) => void;
}) {
  const t = props.track;
  const p = t.position;
  const history = props.history.slice(-10).reverse();
  const when = props.format;
  return (
    <div className={styles.provenancePanel} role="dialog" aria-label={`Track ${t.n} provenance`}>
      <div className={styles.timelinePanelHead}>
        <Sym lib={props.symbols} what={t} size={22} />
        <div className={styles.drawerTitle}>
          <h2>Track {t.n}</h2>
          <span>Provenance and history</span>
        </div>
        <span className={styles.pill} data-status={t.affiliation}>
          {AFFILIATION_LABEL[t.affiliation]}
        </span>
        <button type="button" className={`${styles.linkBtn} ${styles.drawerClose}`} onClick={props.onClose}>
          Close
        </button>
      </div>
      <div className={styles.provenanceBody}>
        <p className={styles.cardLine}>{describeTrack(t)}</p>
        <p className={styles.hint}>
          {p ? `${p.estimated ? "≈ " : ""}${p.label} · ±${p.radius_m} m` : "Not placed yet."}
          <GridTag at={p} />
        </p>
        <dl className={styles.provMeta}>
          <div>
            <dt>Opened</dt>
            <dd>{t.openedBy} · {when(t.openedTs)}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>{t.seenBy} · {when(t.seenTs)}</dd>
          </div>
          <div>
            <dt>Accuracy</dt>
            <dd>{p ? `±${p.radius_m} m${p.estimated ? " (estimated)" : ""}` : "Not placed"}</dd>
          </div>
          <div>
            <dt>Positions</dt>
            <dd>{t.trail.length} earlier</dd>
          </div>
        </dl>
        {t.trail.length ? (
          <div className={styles.provTrail}>
            <span className={styles.provMetaLabel}>Earlier positions</span>
            <ol>
              {t.trail
                .slice(-8)
                .reverse()
                .map((x) => (
                  <li key={`${x.ts}-${x.lat}-${x.lon}`}>
                    <span className={styles.provTime}>{when(x.ts)}</span>
                    <span className={styles.gridTag}>{shortGrid({ lat: x.lat, lon: x.lon })}</span>
                  </li>
                ))}
            </ol>
          </div>
        ) : null}
        <span className={styles.provMetaLabel}>
          Reports and acts {props.onJump ? "· choose one to replay it" : ""}
        </span>
        {history.length ? (
          <ol className={styles.provList}>
            {history.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className={styles.provRow}
                  onClick={() => props.onJump?.(f.ts)}
                  disabled={!props.onJump}
                  title={props.onJump ? `Replay the mission just after ${when(f.ts)}` : undefined}
                >
                  <span className={styles.provTime}>{when(f.ts)}</span>
                  <span className={styles.provWho}>{f.callsign}</span>
                  <span className={styles.provWhat}>{f.transcript || f.outcome}</span>
                  {f.position ? <span className={styles.provPlace}>{shortGrid(f.position)}</span> : null}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.provLine}>No report about this track in the log yet.</p>
        )}
      </div>
    </div>
  );
}
