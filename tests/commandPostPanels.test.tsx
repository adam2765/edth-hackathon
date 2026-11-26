// @vitest-environment jsdom

/**
 * The command post's extracted pieces on their own: a track that is gone, a track that is not
 * placed, a silent unit, and the replay bar's buttons. These are the states the page has to show
 * without a browser [276].
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { TrackState, UnitState } from "@/lib/reports/fold";
import type { Stretch } from "@/lib/reports/timeline";
import { TrackCard } from "@/components/TrackTools";
import { UnitPanel } from "@/components/UnitTools";
import { CommandPostReplayBar, CommandPostReplayBarProvider, type CommandPostReplayBarModel } from "@/components/CommandPostReplayBar";

afterEach(cleanup);

const format = (ts: number) => `t${ts}`;

function track(over: Partial<TrackState> = {}): TrackState {
  return {
    n: 3,
    affiliation: "unknown",
    kind: "vehicle",
    count: null,
    text: "a vehicle",
    heading: null,
    area: "vincennes",
    position: { lat: 48.84, lon: 2.43, radius_m: 60, label: "Cimetière ancien" },
    positionTs: 1000,
    trail: [],
    seenBy: "ALPHA 1",
    seenTs: 1000,
    from: null,
    openedBy: "ALPHA 1",
    openedTs: 900,
    pendingReport: null,
    plotted: false,
    changed: null,
    note: null,
    gone: null,
    task: null,
    recon: [],
    ...over,
  };
}

function unit(over: Partial<UnitState> = {}): UnitState {
  return {
    callsign: "ALPHA 1",
    colour: "#ff6b2c",
    area: "vincennes",
    position: { lat: 48.84, lon: 2.43, radius_m: 30, label: "Mairie de Vincennes" },
    positionTs: 1000,
    trail: [],
    lastHeard: 1000,
    pending: null,
    joined: 900,
    device: null,
    atStart: false,
    street: null,
    kind: null,
    task: null,
    prompt: null,
    placedBy: null,
    ...over,
  };
}

const card = (t: TrackState, over: Partial<Parameters<typeof TrackCard>[0]> = {}) => (
  <TrackCard
    track={t}
    symbols={null}
    canEdit
    busy={false}
    error={null}
    onChange={() => {}}
    onMove={() => {}}
    onGone={() => {}}
    onRestore={() => {}}
    onClose={() => {}}
    history={[]}
    format={format}
    {...over}
  />
);

describe("the track panel", () => {
  it("shows a track that is gone, and offers to put it back", () => {
    const onRestore = vi.fn();
    render(card(track({ gone: 1100 }), { onRestore }));
    expect(screen.getByText("Gone")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Put back on the map" }));
    expect(onRestore).toHaveBeenCalledOnce();
  });

  it("shows a track that is not placed", () => {
    render(card(track({ position: null, positionTs: null, gone: null })));
    expect(screen.getByText(/Not placed yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gone" })).toBeInTheDocument();
  });
});

describe("the unit panel", () => {
  it("shows a silent unit with its last known place", () => {
    render(
      <UnitPanel
        unit={unit()}
        status={{ tag: "Silent", text: "Last known at Mairie de Vincennes", tone: "silent" }}
        history={[]}
        format={format}
        canEdit
        busy={false}
        onClose={() => {}}
        onPlace={() => {}}
        onKind={() => {}}
        onTask={() => {}}
      />,
    );
    expect(screen.getByText("Silent")).toBeInTheDocument();
    expect(screen.getByText(/Last known at Mairie/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /by hand/ })).toBeInTheDocument();
  });
});

function stretch(over: Partial<Stretch> = {}): Stretch {
  return { code: "demo", name: "Vincennes · demo", start: 1000, end: 9000, open: true, ...over };
}

function barModel(over: Partial<CommandPostReplayBarModel> = {}): CommandPostReplayBarModel {
  const one = stretch();
  return {
    barShut: false,
    mapShort: false,
    hasEntries: true,
    replayOpen: true,
    playing: false,
    session: "demo",
    mode: "live",
    ended: null,
    lost: false,
    now: 5000,
    replayT: 4000,
    rangeEnd: 9000,
    barLo: 1000,
    barHi: 9000,
    sliderValue: 9000,
    barSpan: 8000,
    barStretches: [one],
    stretches: [one],
    shownStretch: one,
    sliderMission: one,
    barZoom: false,
    speed: 10,
    fmtTime: format,
    fmtSpan: (ms) => `${ms / 1000} s`,
    onShowBar: vi.fn(),
    onHideBar: vi.fn(),
    onToggleReplay: vi.fn(),
    onLive: vi.fn(),
    onTogglePlay: vi.fn(),
    onScrub: vi.fn(),
    onZoom: vi.fn(),
    onSpeed: vi.fn(),
    onCopy: vi.fn(),
    ...over,
  };
}

const bar = (over: Partial<CommandPostReplayBarModel> = {}) => {
  const model = barModel(over);
  render(
    <CommandPostReplayBarProvider value={model}>
      <CommandPostReplayBar />
    </CommandPostReplayBarProvider>,
  );
  return model;
};

describe("the replay bar", () => {
  it("shows the compact button, disabled when there is nothing to replay", () => {
    bar({ barShut: true, hasEntries: false, mapShort: true });
    const button = screen.getByRole("button", { name: "Show the replay bar" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Enlarge the map to show the replay bar");
  });

  it("runs play, speed, zoom and the replay toggle", () => {
    const model = bar();
    fireEvent.click(screen.getByRole("button", { name: "Play replay" }));
    expect(model.onTogglePlay).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole("button", { name: "10×" })[0]);
    expect(model.onSpeed).toHaveBeenCalledWith(10);
    fireEvent.click(screen.getAllByRole("button", { name: "Mission" })[0]);
    expect(model.onZoom).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Close replay" }));
    expect(model.onToggleReplay).toHaveBeenCalledOnce();
  });

  it("shows Link only in a replay, and calls live", () => {
    const model = bar({ mode: "replay", replayT: 4000 });
    fireEvent.click(screen.getAllByRole("button", { name: "Link" })[0]);
    expect(model.onCopy).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(model.onLive).toHaveBeenCalledOnce();
  });
});
