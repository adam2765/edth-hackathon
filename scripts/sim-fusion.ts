/**
 * Fixed-seed simulation for the ghost fusion of track sightings.
 *
 *   npx tsx scripts/sim-fusion.ts                200 trials per scenario
 *   npx tsx scripts/sim-fusion.ts --trials 500
 *   npx tsx scripts/sim-fusion.ts --seed 20261128
 *
 * It prints the tables the report `evals/fusion-<date>.md` carries. Everything is synthetic:
 * straight true paths, observers with position noise, bearings and ranges with the assumed
 * noise. No real sighting, no network, no model. The current method is one report with the
 * resolver's own circle (`max(50, 0.4 * r)` for a stated distance and bearing); a bearing alone
 * places nothing today, so the current method asks how far.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS, type AreaId } from "../lib/geo/areas";
import { bearingDeg, distanceM, type LatLon } from "../lib/geo/geo";
import {
  fromLocal,
  fuseObservations,
  invertCov,
  toLocal,
  type FusionObservation,
  type RangePrior,
  type LocalPoint,
} from "../lib/geo/fusion";

const SEED_DEFAULT = 20261128;
const TRIALS_DEFAULT = 200;
const SIGMAS = [2, 5, 10];

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const seed = Number(opt("seed") ?? SEED_DEFAULT) >>> 0;
const trials = Math.max(10, Number(opt("trials") ?? TRIALS_DEFAULT) || TRIALS_DEFAULT);

function rngFrom(seedValue: number): () => number {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface Observer {
  id: string;
  /** Local metres. */
  e: number;
  n: number;
  sigma_m: number;
}

/** What the world does, as opposed to what the estimator assumes. */
export interface TruthModel {
  /** The true bearing noise. The estimator's value is passed separately. */
  bearingSigmaDeg: number;
  /** A constant offset added to every bearing. */
  biasDeg?: number;
  /** Reported range as a fraction of the true range. 0.8 is a 20 percent understatement. */
  rangeFactor?: number;
  /** One bearing in ten gets five times the stated sigma. */
  heavyTail?: boolean;
}

export interface Scenario {
  id: string;
  title: string;
  area: AreaId;
  observers: Observer[];
  /** True path, local metres: a straight line from start to end. */
  start: LocalPoint;
  end: LocalPoint;
  kind: "bearings" | "ranged" | "same-observer";
  outlier?: boolean;
  gridHalf: number;
}

const OBSERVER_SIGMA_M = 10;

export const SCENARIOS: Scenario[] = [
  {
    id: "bearings-perpendicular",
    title: "Two bearings, about perpendicular",
    area: "vincennes",
    observers: [
      { id: "A", e: -500, n: 0, sigma_m: OBSERVER_SIGMA_M },
      { id: "B", e: 500, n: 0, sigma_m: OBSERVER_SIGMA_M },
    ],
    start: { e: 0, n: 450 },
    end: { e: 0, n: 550 },
    kind: "bearings",
    gridHalf: 1500,
  },
  {
    id: "bearings-near-parallel",
    title: "Two bearings, nearly parallel",
    area: "vincennes",
    observers: [
      { id: "A", e: -100, n: 0, sigma_m: OBSERVER_SIGMA_M },
      { id: "B", e: 100, n: 0, sigma_m: OBSERVER_SIGMA_M },
    ],
    start: { e: 0, n: 1450 },
    end: { e: 0, n: 1550 },
    kind: "bearings",
    gridHalf: 2000,
  },
  {
    id: "bearings-outlier",
    title: "Three bearings and one gross outlier",
    area: "vincennes",
    observers: [
      { id: "A", e: -400, n: -200, sigma_m: OBSERVER_SIGMA_M },
      { id: "B", e: 400, n: -200, sigma_m: OBSERVER_SIGMA_M },
      { id: "C", e: 0, n: 400, sigma_m: OBSERVER_SIGMA_M },
      { id: "D", e: 0, n: -500, sigma_m: OBSERVER_SIGMA_M },
    ],
    start: { e: 0, n: 200 },
    end: { e: 0, n: 300 },
    kind: "bearings",
    outlier: true,
    gridHalf: 1200,
  },
  {
    id: "ranged-three",
    title: "Three observers, bearing and distance",
    area: "vincennes",
    observers: [
      { id: "A", e: -600, n: -300, sigma_m: OBSERVER_SIGMA_M },
      { id: "B", e: 600, n: -300, sigma_m: OBSERVER_SIGMA_M },
      { id: "C", e: 0, n: 600, sigma_m: OBSERVER_SIGMA_M },
    ],
    start: { e: -200, n: 0 },
    end: { e: 200, n: 0 },
    kind: "ranged",
    gridHalf: 1200,
  },
  {
    id: "ranged-same-observer",
    title: "One observer, five reports in two minutes",
    area: "vincennes",
    observers: [{ id: "A", e: -400, n: 0, sigma_m: OBSERVER_SIGMA_M }],
    start: { e: 0, n: -100 },
    end: { e: 0, n: 100 },
    kind: "same-observer",
    gridHalf: 1000,
  },
];

function at(area: AreaId, p: LocalPoint): LatLon {
  return fromLocal(p, AREAS[area].centre);
}

/** The measured sighting from one observer at one time. */
function sighting(
  rng: () => number,
  scenario: Scenario,
  observer: Observer,
  truth: LocalPoint,
  index: number,
  model: TruthModel,
  gross: boolean,
): FusionObservation {
  const oe = observer.e + normal(rng) * observer.sigma_m;
  const on = observer.n + normal(rng) * observer.sigma_m;
  const from: LatLon = at(scenario.area, { e: oe, n: on });
  const to: LatLon = at(scenario.area, truth);
  let bearing = bearingDeg(from, to);
  let range = distanceM(from, to);
  const tail = model.heavyTail && rng() < 0.1 ? 5 : 1;
  bearing += normal(rng) * model.bearingSigmaDeg * tail + (model.biasDeg ?? 0);
  range *= model.rangeFactor ?? 1;
  range *= 1 + normal(rng) * 0.25;
  if (gross) {
    bearing += 100;
    range *= 2.5;
  }
  const ranged = scenario.kind !== "bearings";
  return {
    id: `${scenario.id}-${observer.id}-${index}`,
    observerId: observer.id,
    observer: { lat: from.lat, lon: from.lon, sigma_m: observer.sigma_m },
    bearing_deg: ((bearing % 360) + 360) % 360,
    bearing_source: "degrees",
    range_m: ranged ? Math.max(20, range) : null,
    ts: index * 30_000,
  };
}

function observationsFor(rng: () => number, scenario: Scenario, truth: LocalPoint, model: TruthModel): FusionObservation[] {
  const out: FusionObservation[] = [];
  const reports = scenario.kind === "same-observer" ? 5 : 1;
  for (let index = 0; index < reports; index++) {
    for (const observer of scenario.observers) {
      const gross = !!scenario.outlier && observer.id === "D";
      out.push(sighting(rng, scenario, observer, truth, index, model, gross));
    }
  }
  return out;
}

interface Stats {
  n: number;
  failed: number;
  cep50: number;
  cep90: number;
  nees: number;
  hit50: number;
  hit90: number;
  truncated: number;
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return s[lo] + (s[hi] - s[lo]) * (at - lo);
}

function stats(errors: number[], nees: number[], hits50: boolean[], hits90: boolean[], truncated: boolean[], failed: number): Stats {
  return {
    n: errors.length,
    failed,
    cep50: quantile(errors, 0.5),
    cep90: quantile(errors, 0.9),
    nees: nees.length ? nees.reduce((a, b) => a + b, 0) / nees.length : Number.NaN,
    hit50: hits50.length ? hits50.filter(Boolean).length / hits50.length : Number.NaN,
    hit90: hits90.length ? hits90.filter(Boolean).length / hits90.length : Number.NaN,
    truncated: truncated.length ? truncated.filter(Boolean).length / truncated.length : Number.NaN,
  };
}

function nearest8(deg: number): number {
  return ((Math.round(deg / 45) * 45) % 360 + 360) % 360;
}

export function runScenario(
  scenario: Scenario,
  estimatorSigmaDeg: number,
  seedValue = seed,
  trialCount = trials,
  truthModel: TruthModel = { bearingSigmaDeg: estimatorSigmaDeg },
  rangePrior: RangePrior = "uniform-area",
): { fused: Stats; current: Stats | null; exact: Stats | null } {
  const seed = seedValue;
  const trials = trialCount;
  let idHash = 2166136261;
  const key = [scenario.id, estimatorSigmaDeg, truthModel.bearingSigmaDeg, truthModel.biasDeg ?? 0, truthModel.rangeFactor ?? 1, truthModel.heavyTail ? 1 : 0].join("|");
  for (let i = 0; i < key.length; i++) idHash = Math.imul(idHash ^ key.charCodeAt(i), 16777619);
  const rng = rngFrom((seed ^ idHash) >>> 0);
  const errors: number[] = [];
  const nees: number[] = [];
  const hits50: boolean[] = [];
  const hits90: boolean[] = [];
  const truncated: boolean[] = [];
  let failed = 0;
  const currentErrors: number[] = [];
  const currentHits: boolean[] = [];
  const exactErrors: number[] = [];
  const exactHits: boolean[] = [];
  for (let trial = 0; trial < trials; trial++) {
    const u = rng();
    const truth = {
      e: scenario.start.e + u * (scenario.end.e - scenario.start.e),
      n: scenario.start.n + u * (scenario.end.n - scenario.start.n),
    };
    const observations = observationsFor(rng, scenario, truth, truthModel);
    const result = fuseObservations(observations, {
      center: AREAS[scenario.area].centre,
      gridCellM: 10,
      gridHalfSizeM: scenario.gridHalf,
      humanBearingSigmaDeg: estimatorSigmaDeg,
      rangePrior,
    });
    if (result.status !== "resolved" || !result.mean || !result.cov) {
      failed++;
      continue;
    }
    const error = Math.hypot(result.mean.e - truth.e, result.mean.n - truth.n);
    errors.push(error);
    const inv = invertCov(result.cov);
    if (inv) {
      const de = result.mean.e - truth.e;
      const dn = result.mean.n - truth.n;
      nees.push(inv[0][0] * de * de + 2 * inv[0][1] * de * dn + inv[1][1] * dn * dn);
    }
    hits50.push(error <= (result.radius50_m ?? 0));
    hits90.push(error <= (result.radius90_m ?? 0));
    truncated.push(result.truncated);

    const firstRanged = observations.find((x) => x.range_m != null && x.bearing_deg != null);
    if (firstRanged) {
      const o = toLocal(firstRanged.observer, AREAS[scenario.area].centre);
      const r = firstRanged.range_m!;
      const point = (deg: number) => {
        const rad = (deg * Math.PI) / 180;
        return { e: o.e + r * Math.sin(rad), n: o.n + r * Math.cos(rad) };
      };
      const circle = Math.max(50, 0.4 * r);
      const exact = point(firstRanged.bearing_deg!);
      const exactError = Math.hypot(exact.e - truth.e, exact.n - truth.n);
      exactErrors.push(exactError);
      exactHits.push(exactError <= circle);
      const eight = point(nearest8(firstRanged.bearing_deg!));
      const currentError = Math.hypot(eight.e - truth.e, eight.n - truth.n);
      currentErrors.push(currentError);
      currentHits.push(currentError <= circle);
    }
  }
  const single = (errors: number[], hits: boolean[]): Stats | null =>
    errors.length
      ? {
          n: errors.length,
          failed: 0,
          cep50: quantile(errors, 0.5),
          cep90: quantile(errors, 0.9),
          nees: Number.NaN,
          hit50: Number.NaN,
          hit90: hits.filter(Boolean).length / hits.length,
          truncated: Number.NaN,
        }
      : null;
  return {
    fused: stats(errors, nees, hits50, hits90, truncated, failed),
    current: single(currentErrors, currentHits),
    exact: single(exactErrors, exactHits),
  };
}

function m(x: number, digits = 1): string {
  return Number.isFinite(x) ? x.toFixed(digits) : "-";
}
function p(x: number): string {
  return Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : "-";
}

function main() {
  console.log(`Fixed seed ${seed}, ${trials} trials per row. Synthetic paths, observers and measurements only.`);
  console.log("Observer position sigma 10 m; range sigma 0.25 r. In the 2/5/10 rows the estimator is set to the truth's sigma (matched), not fixed at 5.");
  console.log("A bearing-only report places nothing today, so the current method asks how far.\n");
  for (const scenario of SCENARIOS) {
    console.log(`### ${scenario.title}`);
    console.log(`Area: ${scenario.area}. Grid: 10 m cells, half-size ${scenario.gridHalf} m.\n`);
    console.log("| sigma (matched) | fused CEP50 | fused CEP90 | NEES | 50% circle | 90% circle | cut off | current 8-point CEP50 | current 8-point CEP90 | current circle | exact single CEP50 | exact single CEP90 | exact circle |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const sigma of SIGMAS) {
      const { fused, current, exact } = runScenario(scenario, sigma);
      const currentCols = current
        ? `${m(current.cep50)} m | ${m(current.cep90)} m | ${p(current.hit90)} inside`
        : "no placement | no placement | asks how far";
      const exactCols = exact
        ? `${m(exact.cep50)} m | ${m(exact.cep90)} m | ${p(exact.hit90)} inside`
        : "no placement | no placement | asks how far";
      console.log(`| ${sigma}° | ${m(fused.cep50)} m | ${m(fused.cep90)} m | ${m(fused.nees, 2)} | ${p(fused.hit50)} | ${p(fused.hit90)} | ${p(fused.truncated)} | ${currentCols} | ${exactCols} |`);
    }
    console.log("");
  }

  console.log("### Estimator mismatch: perpendicular bearings, estimator fixed at 5°\n");
  console.log("| truth | fused CEP50 | fused CEP90 | NEES | 50% circle | 90% circle | cut off |");
  console.log("|---|---|---|---|---|---|---|");
  const mismatch: { label: string; model: TruthModel }[] = [
    { label: "5° (matched)", model: { bearingSigmaDeg: 5 } },
    { label: "10° (estimator assumes 5°)", model: { bearingSigmaDeg: 10 } },
    { label: "5° + constant bias 3°", model: { bearingSigmaDeg: 5, biasDeg: 3 } },
    { label: "5° + heavy tails (10% at ×5)", model: { bearingSigmaDeg: 5, heavyTail: true } },
  ];
  for (const row of mismatch) {
    const { fused } = runScenario(SCENARIOS[0], 5, seed, trials, row.model);
    console.log(`| ${row.label} | ${m(fused.cep50)} m | ${m(fused.cep90)} m | ${m(fused.nees, 2)} | ${p(fused.hit50)} | ${p(fused.hit90)} | ${p(fused.truncated)} |`);
  }

  console.log("\n### Estimator mismatch: three observers with range, estimator fixed at 5°\n");
  console.log("| truth | fused CEP50 | fused CEP90 | NEES | 50% circle | 90% circle | cut off |");
  console.log("|---|---|---|---|---|---|---|");
  const rangeMismatch: { label: string; model: TruthModel }[] = [
    { label: "5° (matched)", model: { bearingSigmaDeg: 5 } },
    { label: "5°, reported range 0.8 × true", model: { bearingSigmaDeg: 5, rangeFactor: 0.8 } },
  ];
  for (const row of rangeMismatch) {
    const { fused } = runScenario(SCENARIOS[3], 5, seed, trials, row.model);
    console.log(`| ${row.label} | ${m(fused.cep50)} m | ${m(fused.cep90)} m | ${m(fused.nees, 2)} | ${p(fused.hit50)} | ${p(fused.hit90)} | ${p(fused.truncated)} |`);
  }
  console.log("");

  console.log("### Range prior sensitivity, estimator = truth = 5°\n");
  console.log("| scenario | range prior | fused CEP50 | fused CEP90 | NEES | 50% circle | 90% circle | cut off |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const scenario of [SCENARIOS[0], SCENARIOS[1]]) {
    for (const prior of ["uniform-area", "uniform-r"] as RangePrior[]) {
      const { fused } = runScenario(scenario, 5, seed, trials, { bearingSigmaDeg: 5 }, prior);
      console.log(`| ${scenario.title} | ${prior} | ${m(fused.cep50)} m | ${m(fused.cep90)} m | ${m(fused.nees, 2)} | ${p(fused.hit50)} | ${p(fused.hit90)} | ${p(fused.truncated)} |`);
    }
  }
  console.log("");

  console.log("### The same perpendicular geometry at the three area centres (sigma human 5°)\n");
  console.log("| area | fused CEP50 | fused CEP90 | NEES | 50% circle | 90% circle |");
  console.log("|---|---|---|---|---|---|");
  for (const area of Object.keys(AREAS) as AreaId[]) {
    const scenario = { ...SCENARIOS[0], area, title: "perpendicular" };
    const { fused } = runScenario(scenario, 5);
    console.log(`| ${AREAS[area].label} | ${m(fused.cep50)} m | ${m(fused.cep90)} m | ${m(fused.nees, 2)} | ${p(fused.hit50)} | ${p(fused.hit90)} |`);
  }
}

const isMain = process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
