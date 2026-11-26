// @vitest-environment jsdom

/**
 * The command post's extracted pieces on their own: a track that is gone, a track that is not
 * placed, a silent unit, and the replay bar's buttons. These are the states the page has to show
 * without a browser [276].
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { FeedItem, MissionState, TrackState, UnitState } from "@/lib/reports/fold";
import type { Stretch } from "@/lib/reports/timeline";
import { TrackCard } from "@/components/TrackTools";
import { UnitPanel } from "@/components/UnitTools";
import { CommandPostReplayBar, CommandPostReplayBarProvider, type CommandPostReplayBarModel } from "@/components/CommandPostReplayBar";
import { CommandPostHeader, CommandPostHeaderProvider, type CommandPostHeaderModel } from "@/components/CommandPostHeader";
import { CommandPostTimeline, CommandPostTimelineProvider, type CommandPostTimelineModel } from "@/components/CommandPostTimeline";

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

function mission(over: Partial<MissionState> = {}): MissionState {
  return { name: "Vincennes · demo", area: "vincennes", start: null, opened: 1000, ended: null, ...over };
}

function headerModel(over: Partial<CommandPostHeaderModel> = {}): CommandPostHeaderModel {
  return {
    mission: mission(),
    session: "demo",
    ended: null,
    mode: "live",
    lost: false,
    connected: true,
    stored: true,
    demo: true,
    canEdit: false,
    placing: false,
    actionError: null,
    panelOpen: false,
    moreOpen: false,
    confirmEnd: false,
    now: 5000,
    defaultArea: "vincennes",
    onStartPlace: vi.fn(),
    onOpenMissions: vi.fn(),
    onToggleMissions: vi.fn(),
    onOpenTimeline: vi.fn(),
    onOpenFind: vi.fn(),
    onToggleMore: vi.fn(),
    onCloseMore: vi.fn(),
    onCopySituation: vi.fn(),
    onOpenHelp: vi.fn(),
    onStopMission: vi.fn(),
    onConfirmStop: vi.fn(),
    onCancelStop: vi.fn(),
    onCloseMissions: vi.fn(),
    onPickMission: vi.fn(),
    fmtWhen: (ts) => `t${ts}`,
    ...over,
  };
}

const header = (over: Partial<CommandPostHeaderModel> = {}) => {
  const model = headerModel(over);
  render(
    <CommandPostHeaderProvider value={model}>
      <CommandPostHeader />
    </CommandPostHeaderProvider>,
  );
  return model;
};

describe("the header", () => {
  it("shows the mission, hides Place track in the demo, and runs the More menu", () => {
    const model = header({ moreOpen: true });
    expect(screen.getByText("Vincennes · demo")).toBeInTheDocument();
    expect(screen.getByText("Demo · read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Place track" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy situation" }));
    expect(model.onCloseMore).toHaveBeenCalledOnce();
    expect(model.onCopySituation).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menuitem", { name: "Stop mission" })).not.toBeInTheDocument();
  });

  it("offers Place track and Stop mission on a live mission that can be edited", () => {
    const model = header({ demo: false, canEdit: true, moreOpen: true });
    expect(screen.getByRole("button", { name: "Place track" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop mission" }));
    expect(model.onConfirmStop).toHaveBeenCalledOnce();
  });
});

function report(id: string, ts: number, text: string): FeedItem {
  return {
    kind: "report",
    id,
    ts,
    callsign: "ALPHA 1",
    colour: "#ff6b2c",
    area: "vincennes",
    transcript: text,
    status: "resolved",
    outcome: "Placed at the town hall",
    position: null,
    candidates: [],
    answer: null,
    expired: false,
    track: null,
  };
}

function timelineModel(over: Partial<CommandPostTimelineModel> = {}): CommandPostTimelineModel {
  const events = [report("b", 2000, "newer"), report("a", 1000, "hello")];
  return {
    events,
    feedLength: events.length,
    newSince: null,
    newCount: 0,
    filter: "all",
    query: "",
    window: 0,
    fmtTime: (ts) => `t${ts}`,
    onClose: vi.fn(),
    onFilter: vi.fn(),
    onQuery: vi.fn(),
    onWindow: vi.fn(),
    onClear: vi.fn(),
    onJump: vi.fn(),
    onInspect: vi.fn(),
    onHover: vi.fn(),
    ...over,
  };
}

const timeline = (over: Partial<CommandPostTimelineModel> = {}) => {
  const model = timelineModel(over);
  render(
    <CommandPostTimelineProvider value={model}>
      <CommandPostTimeline />
    </CommandPostTimelineProvider>,
  );
  return model;
};

describe("the timeline", () => {
  it("renders the rows, filters, search and inspect", () => {
    const model = timeline();
    expect(screen.getByText(/2 events/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reports" }));
    expect(model.onFilter).toHaveBeenCalledWith("reports");
    fireEvent.click(screen.getByText("hello"));
    expect(model.onJump).toHaveBeenCalledWith(model.events[1]);
    fireEvent.click(screen.getByRole("button", { name: "Inspect the event at t1000 from ALPHA 1" }));
    expect(model.onInspect).toHaveBeenCalledWith(model.events[1]);
    fireEvent.change(screen.getByLabelText("Search the timeline"), { target: { value: "church" } });
    expect(model.onQuery).toHaveBeenCalledWith("church");
    fireEvent.change(screen.getByLabelText("Show events from"), { target: { value: "5" } });
    expect(model.onWindow).toHaveBeenCalledWith(5);
  });

  it("says when there are no events", () => {
    timeline({ events: [], feedLength: 0 });
    expect(screen.getByText("No events yet.")).toBeInTheDocument();
  });
});
