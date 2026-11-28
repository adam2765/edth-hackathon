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
import { AREAS, type AreaId } from "../lib/geo/areas";
import { bearingDeg, distanceM, type LatLon } from "../lib/geo/geo";
import {
  bearingSigmaDeg,
  fromLocal,
  fuseObservations,
  invertCov,
  observationGaussian,
  type FusionObservation,
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

interface Scenario {
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

const SCENARIOS: Scenario[] = [
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
  sigmaHumanDeg: number,
  gross: boolean,
): FusionObservation {
  const center = AREAS[scenario.area].centre;
  const oe = observer.e + normal(rng) * observer.sigma_m;
  const on = observer.n + normal(rng) * observer.sigma_m;
  const from: LatLon = at(scenario.area, { e: oe, n: on });
  const to: LatLon = at(scenario.area, truth);
  let bearing = bearingDeg(from, to);
  let range = distanceM(from, to);
  bearing += normal(rng) * bearingSigmaDeg("degrees", sigmaHumanDeg);
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

function observationsFor(rng: () => number, scenario: Scenario, truth: LocalPoint, sigmaHumanDeg: number): FusionObservation[] {
  const out: FusionObservation[] = [];
  const reports = scenario.kind === "same-observer" ? 5 : 1;
  for (let index = 0; index < reports; index++) {
    for (const observer of scenario.observers) {
      const gross = !!scenario.outlier && observer.id === "D";
      out.push(sighting(rng, scenario, observer, truth, index, sigmaHumanDeg, gross));
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

function runScenario(scenario: Scenario, sigmaHumanDeg: number): { fused: Stats; current: Stats | null } {
  let idHash = 2166136261;
  for (let i = 0; i < scenario.id.length; i++) idHash = Math.imul(idHash ^ scenario.id.charCodeAt(i), 16777619);
  const rng = rngFrom((seed ^ idHash ^ Math.round(sigmaHumanDeg * 1000)) >>> 0);
  const errors: number[] = [];
  const nees: number[] = [];
  const hits50: boolean[] = [];
  const hits90: boolean[] = [];
  const truncated: boolean[] = [];
  let failed = 0;
  const currentErrors: number[] = [];
  const currentHits: boolean[] = [];
  for (let trial = 0; trial < trials; trial++) {
    const u = rng();
    const truth = {
      e: scenario.start.e + u * (scenario.end.e - scenario.start.e),
      n: scenario.start.n + u * (scenario.end.n - scenario.start.n),
    };
    const observations = observationsFor(rng, scenario, truth, sigmaHumanDeg);
    const result = fuseObservations(observations, {
      center: AREAS[scenario.area].centre,
      gridCellM: 10,
      gridHalfSizeM: scenario.gridHalf,
      humanBearingSigmaDeg: sigmaHumanDeg,
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

    const firstRanged = observations.find((x) => x.range_m != null);
    if (firstRanged) {
      const g = observationGaussian(firstRanged, AREAS[scenario.area].centre);
      if (g) {
        const currentError = Math.hypot(g.mean.e - truth.e, g.mean.n - truth.n);
        const circle = Math.max(50, 0.4 * firstRanged.range_m!);
        currentErrors.push(currentError);
        currentHits.push(currentError <= circle);
      }
    }
  }
  return {
    fused: stats(errors, nees, hits50, hits90, truncated, failed),
    current: currentErrors.length
      ? {
          n: currentErrors.length,
          failed: 0,
          cep50: quantile(currentErrors, 0.5),
          cep90: quantile(currentErrors, 0.9),
          nees: Number.NaN,
          hit50: Number.NaN,
          hit90: currentHits.filter(Boolean).length / currentHits.length,
          truncated: Number.NaN,
        }
      : null,
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
  console.log("Observer position sigma 10 m; range sigma 0.25 r; bearing sigma = the human value (the source is a stated bearing).");
  console.log("A bearing-only report places nothing today, so the current method asks how far.\n");
  for (const scenario of SCENARIOS) {
    console.log(`### ${scenario.title}`);
    console.log(`Area: ${scenario.area}. Grid: 10 m cells, half-size ${scenario.gridHalf} m.\n`);
    console.log("| sigma human | fused CEP50 | fused CEP90 | NEES | 50% circle | 90% circle | cut off | current CEP50 | current CEP90 | current circle |");
    console.log("|---|---|---|---|---|---|---|---|---|---|");
    for (const sigma of SIGMAS) {
      const { fused, current } = runScenario(scenario, sigma);
      const currentCols = current
        ? `${m(current.cep50)} m | ${m(current.cep90)} m | ${p(current.hit90)} inside the resolver circle`
        : "no placement | no placement | asks how far";
      console.log(`| ${sigma}° | ${m(fused.cep50)} m | ${m(fused.cep90)} m | ${m(fused.nees, 2)} | ${p(fused.hit50)} | ${p(fused.hit90)} | ${p(fused.truncated)} | ${currentCols} |`);
    }
    console.log("");
  }

  console.log("### The same perpendicular geometry at the three area centres (sigma human 5°)\n");
  console.log("| area | fused CEP50 | fused CEP90 | NEES | 50% circle | 90% circle |");
  console.log("|---|---|---|---|---|---|");
  for (const area of Object.keys(AREAS) as AreaId[]) {
    const scenario = { ...SCENARIOS[0], area, title: "perpendicular" };
    const { fused } = runScenario(scenario, 5);
    console.log(`| ${AREAS[area].label} | ${m(fused.cep50)} m | ${m(fused.cep90)} m | ${m(fused.nees, 2)} | ${p(fused.hit50)} | ${p(fused.hit90)} |`);
  }
}

main();
