import { describe, expect, it } from "vitest";
import { AREAS } from "../lib/geo/areas";
import { bearingDeg, distanceM, type LatLon } from "../lib/geo/geo";
import {
  associate,
  bearingSigmaDeg,
  correlationClusters,
  detCov,
  fromLocal,
  fuseObservations,
  invertCov,
  observationGaussian,
  toLocal,
  type BearingSource,
  type Covariance,
  type FusionObservation,
  type TrackPrediction,
} from "../lib/geo/fusion";
import { runScenario, SCENARIOS } from "../scripts/sim-fusion";

const center = AREAS.vincennes.centre;
const at = (e: number, n: number, c: LatLon = center) => fromLocal({ e, n }, c);

function sighting(
  id: string,
  observerId: string,
  from: LatLon,
  to: LatLon,
  o: { range?: number | null; source?: BearingSource; ts?: number; offsetDeg?: number; scale?: number; sigma?: number } = {},
): FusionObservation {
  const bearing = (bearingDeg(from, to) + (o.offsetDeg ?? 0) + 360) % 360;
  const range = o.range === undefined ? null : o.range === null ? null : o.range * (o.scale ?? 1);
  return {
    id,
    observerId,
    observer: { ...from, sigma_m: o.sigma ?? 10 },
    bearing_deg: bearing,
    bearing_source: o.source ?? "degrees",
    range_m: range,
    ts: o.ts ?? 0,
  };
}

function sigmaAxis(cov: Covariance): [number, number, number] {
  const tr = cov[0][0] + cov[1][1];
  const det = detCov(cov);
  const root = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  return [tr / 2 + root, Math.max(0, tr / 2 - root), det];
}

function track(id: string, e: number, n: number, cov: Covariance = [[100, 0], [0, 100]], semantics?: TrackPrediction["semantics"]): TrackPrediction {
  return { id, mean: { e, n }, cov, ts: 0, semantics };
}

describe("local plane", () => {
  it("puts geographic north on the n axis in each area", () => {
    for (const area of Object.values(AREAS)) {
      const north = fromLocal({ e: 0, n: 1000 }, area.centre);
      expect(bearingDeg(area.centre, north)).toBeCloseTo(0, 6);
      const back = toLocal(north, area.centre);
      expect(Math.abs(back.e)).toBeLessThan(0.01);
      expect(back.n).toBeCloseTo(1000, 0);
    }
  });

  it("fuses the same perpendicular geometry the same way in Vincennes, Kyiv and Izium", () => {
    for (const area of Object.values(AREAS)) {
      const target = at(0, 500, area.centre);
      const obs = [
        sighting("a", "A", at(-500, 0, area.centre), target),
        sighting("b", "B", at(500, 0, area.centre), target),
      ];
      const r = fuseObservations(obs, { center: area.centre, gridHalfSizeM: 1500, humanBearingSigmaDeg: 5 });
      expect(r.status).toBe("resolved");
      expect(Math.hypot(r.mean!.e, r.mean!.n - 500)).toBeLessThan(5);
    }
  });
});

describe("bearing-only fusion", () => {
  it("puts two perpendicular bearings at their intersection", () => {
    const target = at(0, 500);
    const r = fuseObservations(
      [sighting("a", "A", at(-500, 0), target), sighting("b", "B", at(500, 0), target)],
      { center, gridHalfSizeM: 1500, humanBearingSigmaDeg: 5 },
    );
    expect(r.status).toBe("resolved");
    expect(r.groups).toBe(2);
    expect(Math.hypot(r.mean!.e, r.mean!.n - 500)).toBeLessThan(5);
    expect(r.truncated).toBe(false);
    expect(r.radius50_m).toBeGreaterThan(0);
    expect(r.radius90_m!).toBeGreaterThan(r.radius50_m!);
  });

  it("leaves a long ellipse for two nearly parallel bearings, with no false precision", () => {
    const target = at(0, 1500);
    const r = fuseObservations(
      [sighting("a", "A", at(-100, 0), target), sighting("b", "B", at(100, 0), target)],
      { center, gridHalfSizeM: 2000, humanBearingSigmaDeg: 5 },
    );
    expect(r.status).toBe("unresolved");
    const [major, minor] = sigmaAxis(r.cov!);
    expect(Math.sqrt(major)).toBeGreaterThan(150);
    expect(Math.sqrt(minor)).toBeGreaterThan(20);
    expect(major / minor).toBeGreaterThan(4);
    expect(r.radius90_m!).toBeGreaterThan(200);
    expect(r.truncated).toBe(true);
  });

  it("marks a posterior cut by the range prior as unresolved", () => {
    const target = at(0, 1500);
    const r = fuseObservations(
      [sighting("a", "A", at(-100, 0), target), sighting("b", "B", at(100, 0), target)],
      { center, maxRangeM: 1600, humanBearingSigmaDeg: 5 },
    );
    expect(r.status).toBe("unresolved");
    expect(r.truncated).toBe(true);
  });

  it("keeps a gross outlier out of the estimate", () => {
    const target = at(0, 0);
    const observers = [at(-500, -500), at(500, -500), at(500, 500), at(-500, 500)];
    const good = observers.map((o, i) => sighting(`g${i}`, `O${i}`, o, target, { range: distanceM(o, target) }));
    const bad = sighting("bad", "O3", observers[3], target, { range: distanceM(observers[3], target), offsetDeg: 120, scale: 2.5 });
    const without = fuseObservations(good, { center, gridHalfSizeM: 1200 });
    const fixed = fuseObservations([...good.slice(0, 3), bad], { center, gridHalfSizeM: 1200, outlierEpsilon: 0.05 });
    const fragile = fuseObservations([...good.slice(0, 3), bad], { center, gridHalfSizeM: 1200, outlierEpsilon: 0 });
    expect(Math.hypot(fixed.mean!.e, fixed.mean!.n)).toBeLessThan(5);
    expect(Math.hypot(fixed.mean!.e - without.mean!.e, fixed.mean!.n - without.mean!.n)).toBeLessThan(5);
    expect(Math.hypot(fragile.mean!.e, fragile.mean!.n)).toBeGreaterThan(20);
  });
});

describe("correlated reports", () => {
  it("does not shrink five reports from one observer like five independent observers", () => {
    const target = at(0, 0);
    const from = at(-400, 0);
    const same = [0, 1, 2, 3, 4].map((i) =>
      sighting(`s${i}`, "A", from, target, { range: 400, ts: i * 30_000 }),
    );
    const independent = same.map((o) => ({ ...o, observerId: `A${o.id}` }));
    const rSame = fuseObservations(same, { center, gridHalfSizeM: 1000 });
    const rIndependent = fuseObservations(independent, { center, gridHalfSizeM: 1000 });
    expect(rSame.groups).toBe(1);
    expect(rIndependent.groups).toBe(5);
    const sameTrace = rSame.cov![0][0] + rSame.cov![1][1];
    const independentTrace = rIndependent.cov![0][0] + rIndependent.cov![1][1];
    expect(sameTrace).toBeGreaterThan(independentTrace * 3);
    expect(Math.hypot(rSame.mean!.e, rSame.mean!.n)).toBeLessThan(5);
  });

  it("never gives one observer a smaller area than the same reports treated as independent", () => {
    const from = at(-400, 0);
    const target = at(0, 0);
    const offsets = [
      [0, 0, 0, 0, 0],
      [3, -2, 1, -1, 2],
      [-4, 4, -3, 3, -2],
      [8, -8, 6, -6, 2],
      [12, -12, 9, -9, 3],
    ];
    for (const set of offsets) {
      const same = set.map((off, i) =>
        sighting(`r${i}`, "A", from, target, { range: 400 + off * 10, ts: i * 30_000 }),
      );
      const independent = same.map((o) => ({ ...o, observerId: `A${o.id}` }));
      const a = fuseObservations(same, { center, gridHalfSizeM: 1000 });
      const b = fuseObservations(independent, { center, gridHalfSizeM: 1000 });
      expect(a.status).toBe("resolved");
      expect(b.status).toBe("resolved");
      expect(a.groups).toBe(1);
      expect(b.groups).toBe(5);
      expect(detCov(a.cov!)).toBeGreaterThanOrEqual(detCov(b.cov!) * 0.999);
    }
  });

  it("clusters one observer's reports only inside the time window", () => {
    const from = at(-400, 0);
    const target = at(0, 0);
    const inside = [0, 60_000, 120_000].map((ts, i) => sighting(`i${i}`, "A", from, target, { range: 400, ts }));
    const outside = [0, 200_000].map((ts, i) => sighting(`o${i}`, "A", from, target, { range: 400, ts }));
    expect(correlationClusters(inside, 120_000)).toHaveLength(1);
    expect(correlationClusters(outside, 120_000)).toHaveLength(2);
  });
});

describe("measurement model", () => {
  it("uses the polar covariance and the named bearing assumptions", () => {
    expect(bearingSigmaDeg("degrees", 5)).toBeCloseTo(5, 6);
    expect(bearingSigmaDeg("compass8", 5)).toBeGreaterThan(bearingSigmaDeg("clock", 5));
    expect(bearingSigmaDeg("clock", 5)).toBeGreaterThan(bearingSigmaDeg("degrees", 5));
    expect(bearingSigmaDeg("degrees", 2)).toBeLessThan(bearingSigmaDeg("degrees", 10));
    const obs = sighting("a", "A", at(0, 0), at(0, 1000), { range: 1000 });
    const g = observationGaussian(obs, center)!;
    expect(g.mean.e).toBeCloseTo(0, 3);
    expect(g.mean.n).toBeCloseTo(1000, 3);
    expect(invertCov(g.cov)).not.toBeNull();
    expect(g.cov[0][0]).toBeGreaterThan(0);
    expect(g.cov[1][1]).toBeGreaterThan(250 * 250);
  });
});

describe("association", () => {
  const target = at(0, 0);
  const from = at(-200, 0);
  const obs = sighting("a", "A", from, target, { range: 200, ts: 0 });

  it("assigns a report to the track inside the gate", () => {
    const r = associate([obs], [track("near", 0, 0), track("far", 1000, 0)], { center });
    expect(r.status).toBe("assigned");
    expect(r.assignments).toEqual([{ observation: "a", track: "near", cost: expect.any(Number) }]);
    expect(r.unassigned).toEqual([]);
  });

  it("checks the words before the geometry", () => {
    const r = associate([{ ...obs, semantics: { kind: "vehicle" } }], [track("people", 0, 0, undefined, { kind: "people" })], { center });
    expect(r.status).toBe("empty");
  });

  it("returns ambiguous when two tracks are equally likely, and does not choose", () => {
    const wide: Covariance = [[250_000, 0], [0, 250_000]];
    const middle = sighting("m", "A", at(-200, 0), at(0, 0), { range: 700 });
    const r = associate([middle], [track("left", 0, 0, wide), track("right", 0, 0, wide)], { center, ambiguityMargin: 1 });
    expect(r.status).toBe("ambiguous");
    expect(r.ambiguous[0].tracks).toHaveLength(2);
  });
});

describe("reproducibility", () => {
  it("gives the same tables for the same seed", () => {
    const a = runScenario(SCENARIOS[0], 5, 4242, 3);
    const b = runScenario(SCENARIOS[0], 5, 4242, 3);
    expect(b).toEqual(a);
    const c = runScenario(SCENARIOS[0], 5, 4243, 3);
    expect(c.fused.cep50).not.toBe(a.fused.cep50);
  }, 30_000);
});
