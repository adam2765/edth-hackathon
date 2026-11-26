// @vitest-environment jsdom

/**
 * A render smoke test for the command post, on the recorded demo mission [275]. It does not
 * replace a browser check: the map library is stubbed, and the test only says that the page
 * mounts, reads the demo log, and draws its units and tracks without throwing.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { demoLog } from "@/lib/reports/demo";

vi.mock("maplibre-gl", () => {
  class FakeMap {
    on() { return this; }
    once() { return this; }
    off() { return this; }
    addControl() { return this; }
    removeControl() { return this; }
    getContainer() { return document.createElement("div"); }
    getCanvas() { return { style: {} } as unknown as HTMLCanvasElement; }
    getSource() { return { setData() {} }; }
    addSource() {}
    addLayer() {}
    removeLayer() {}
    getLayer() { return null; }
    queryRenderedFeatures() { return []; }
    fitBounds() { return this; }
    flyTo() { return this; }
    easeTo() { return this; }
    setLayoutProperty() {}
    setPaintProperty() {}
    hasImage() { return false; }
    addImage() {}
    getZoom() { return 14; }
    setCenter() {}
    setZoom() {}
    resize() {}
    remove() {}
  }
  class FakeMarker {
    setLngLat() { return this; }
    addTo() { return this; }
    remove() {}
    getElement() { return document.createElement("div"); }
    on() { return this; }
    setDragPan() { return this; }
  }
  class FakeBounds {
    extend() { return this; }
    isEmpty() { return true; }
  }
  return {
    Map: FakeMap,
    Marker: FakeMarker,
    LngLatBounds: FakeBounds,
    NavigationControl: class {},
    AttributionControl: class {},
    setWorkerUrl() {},
  };
});

vi.mock("@/lib/map/baseMap", () => ({
  loadBaseMap: async () => ({
    style: { version: 8, sources: {}, layers: [] },
    attribution: [],
  }),
}));

vi.mock("milsymbol", () => ({
  default: {
    Symbol: class {
      asSVG() { return "<svg></svg>"; }
    },
  },
}));

// Import after the mocks so the component gets the fake map and symbol library.
import CommandPost from "@/components/CommandPost";

const now = Date.now();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(() => {
  window.history.replaceState({}, "", "/cp?session=demo");
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() { return false; },
    }),
  });
  window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
  window.cancelAnimationFrame = (id: number) => clearTimeout(id);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the command post", () => {
  it("renders the recorded demo mission and its units and tracks", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/cp/login") return json({ required: false, signedIn: true });
      if (url === "/api/sessions") return json({ stored: true, missions: [] });
      if (url.startsWith("/api/sessions/demo?")) {
        const after = Number(new URL(`http://local${url}`).searchParams.get("after") ?? 0);
        return json(demoLog(after, now));
      }
      if (url === "/api/basemap") return json({ prefer: "hosted" });
      return json({}, 404);
    }));

    render(<CommandPost />);

    await waitFor(() => {
      expect(screen.getByText("Vincennes · demo")).toBeInTheDocument();
    });
    expect(screen.getByText("Demo · read-only")).toBeInTheDocument();
    expect(screen.getAllByText("ALPHA 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CHARLIE 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Track 1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reports").length).toBeGreaterThan(0);
  });

  it("shows a coordinator failure and retries without a reload", async () => {
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/cp/login") return json({ required: false, signedIn: true });
      if (url === "/api/sessions") return json({ stored: true, missions: [] });
      if (url.startsWith("/api/sessions/demo?")) {
        if (fail) return json({ error: "down" }, 503);
        const after = Number(new URL(`http://local${url}`).searchParams.get("after") ?? 0);
        return json(demoLog(after, now));
      }
      return json({}, 404);
    }));

    render(<CommandPost />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The coordinator did not answer the mission's log.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByText("Vincennes · demo")).toBeInTheDocument();
    });
  });
});
