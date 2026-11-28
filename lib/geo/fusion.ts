/**
 * Ghost fusion of track sightings: several observers see the same thing from different places,
 * and their bearings and ranges are combined into one estimate with a measured uncertainty.
 *
 * Pure: no network, no UI, no storage. Nothing in the app imports this module, and the resolver
 * still places a track from a single report as before.
 *
 * The plane is local east/north, in metres, centred on the mission's centre. A point is converted
 * with `bearingDeg` and `distanceM` from `geo.ts`, so a bearing of 0 is geographic north; there is
 * no UTM grid convergence to correct. What is not distinguished: grid north, magnetic north and
 * true north all count as the same, and the plane is azimuthal equidistant, so curvature grows
 * with distance (a few centimetres at a kilometre, metres at tens of kilometres).
 */
import { bearingDeg, destination, distanceM, type LatLon } from "./geo";
import type { Affiliation, TrackKind } from "./types";

export interface LocalPoint {
  e: number;
  n: number;
}

/** [[ee, en], [en, nn]], metres squared. */
export type Covariance = [[number, number], [number, number]];

export interface Gaussian {
  mean: LocalPoint;
  cov: Covariance;
}

export type BearingSource = "degrees" | "mils" | "clock" | "compass8";

/** What the report said about the thing, for association only. Null or absent means not said. */
export interface ObservationSemantics {
  kind?: TrackKind | null;
  count?: number | null;
  affiliation?: Affiliation | null;
}

/**
 * One sighting, as the ghost adapter would build it from the mission's log. `observer.sigma_m` is
 * the observer's own circle: `last.radius_m ?? last.uncertainty_m ?? 0`. `bearing_deg` is the
 * continuous bearing when the adapter could read one; `range_m` is null when none was said.
 */
export interface FusionObservation {
  id: string;
  observerId: string;
  observer: { lat: number; lon: number; sigma_m: number };
  bearing_deg: number | null;
  bearing_source: BearingSource;
  range_m: number | null;
  ts: number;
  semantics?: ObservationSemantics;
}

/**
 * Named assumptions, not measured facts. The quantisation sigmas are the standard deviations of
 * a uniform bin: 45 degrees for a compass word, 30 for a clock hour, and nothing worth modelling
 * for a bearing said in degrees or mils. The human sigma is the eye's own error, which dominates
 * for a bearing said to the degree; it is added to the quantisation in quadrature.
 */
export const SIGMA_RANGE_FRACTION = 0.25;
export const SIGMA_HUMAN_BEARING_DEG = 5;
export const SIGMA_QUANT_COMPASS8_DEG = 22.5 / Math.sqrt(3);
export const SIGMA_QUANT_CLOCK_DEG = 15 / Math.sqrt(3);
export const SIGMA_QUANT_DEGREES_DEG = 0;
export const SIGMA_QUANT_MILS_DEG = 0;

export const DEFAULT_GRID_CELL_M = 10;
export const DEFAULT_GRID_HALF_M = 2000;
export const DEFAULT_MAX_RANGE_M = 3000;
export const DEFAULT_OUTLIER_EPSILON = 0.05;
export const DEFAULT_CORRELATION_WINDOW_MS = 120_000;
/** Chi-square, 2 degrees of freedom, 99 percent. */
export const CHI2_2DOF_99 = 9.21034;
export const DEFAULT_MAX_SPEED_MPS = 30;
export const DEFAULT_MAX_AGE_MS = 300_000;
export const DEFAULT_AMBIGUITY_MARGIN = 1;
/** Below this spread, bearing-only sightings leave the range effectively unobserved. */
export const MIN_BEARING_SPREAD_DEG = 15;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const TWO_PI = Math.PI * 2;

export type RangePrior = "uniform-area" | "uniform-r";

export interface FusionOptions {
  /** The mission's centre: the local plane's origin. */
  center: LatLon;
  sigmaRangeFraction?: number;
  humanBearingSigmaDeg?: number;
  outlierEpsilon?: number;
  gridCellM?: number;
  /** Overrides the automatic grid; rare. */
  gridHalfSizeM?: number;
  /** The maximum range a bearing-only sighting is allowed to reach, metres. */
  maxRangeM?: number;
  correlationWindowMs?: number;
  /**
   * What the bearing-only ridge assumes about distance: uniform per unit area (the 1/r factor)
   * or uniform per metre of range (no factor). It is a prior, not a Jacobian of the likelihood.
   */
  rangePrior?: RangePrior;
}

type Resolved = Required<Omit<FusionOptions, "center" | "gridHalfSizeM">> & { center: LatLon; gridHalfSizeM?: number };

function options(o: FusionOptions): Resolved {
  return {
    center: o.center,
    sigmaRangeFraction: o.sigmaRangeFraction ?? SIGMA_RANGE_FRACTION,
    humanBearingSigmaDeg: o.humanBearingSigmaDeg ?? SIGMA_HUMAN_BEARING_DEG,
    outlierEpsilon: Math.min(0.5, Math.max(0, o.outlierEpsilon ?? DEFAULT_OUTLIER_EPSILON)),
    gridCellM: Math.max(1, o.gridCellM ?? DEFAULT_GRID_CELL_M),
    gridHalfSizeM: o.gridHalfSizeM,
    maxRangeM: Math.max(100, o.maxRangeM ?? DEFAULT_MAX_RANGE_M),
    correlationWindowMs: Math.max(0, o.correlationWindowMs ?? DEFAULT_CORRELATION_WINDOW_MS),
    rangePrior: o.rangePrior ?? "uniform-area",
  };
}

/** Latitude and longitude to local east/north metres, relative to the mission's centre. */
export function toLocal(p: LatLon, center: LatLon): LocalPoint {
  const d = distanceM(center, p);
  if (d === 0) return { e: 0, n: 0 };
  const b = bearingDeg(center, p) * DEG;
  return { e: d * Math.sin(b), n: d * Math.cos(b) };
}

/** Local east/north metres back to a latitude and longitude. */
export function fromLocal(q: LocalPoint, center: LatLon): LatLon {
  const d = Math.hypot(q.e, q.n);
  if (d === 0) return { lat: center.lat, lon: center.lon };
  return destination(center, (Math.atan2(q.e, q.n) * RAD + 360) % 360, d);
}

/** The standard deviation of a bearing, in degrees, from what was said plus the eye's error. */
export function bearingSigmaDeg(source: BearingSource, humanSigmaDeg = SIGMA_HUMAN_BEARING_DEG): number {
  const quant =
    source === "compass8"
      ? SIGMA_QUANT_COMPASS8_DEG
      : source === "clock"
        ? SIGMA_QUANT_CLOCK_DEG
        : source === "degrees"
          ? SIGMA_QUANT_DEGREES_DEG
          : SIGMA_QUANT_MILS_DEG;
  return Math.hypot(quant, humanSigmaDeg);
}

/** [[a, b], [b, d]] inverse, or null when it is not positive definite. */
export function invertCov(c: Covariance): Covariance | null {
  const det = c[0][0] * c[1][1] - c[0][1] * c[1][0];
  if (!(det > 0) || !Number.isFinite(det)) return null;
  return [
    [c[1][1] / det, -c[0][1] / det],
    [-c[1][0] / det, c[0][0] / det],
  ];
}

export function detCov(c: Covariance): number {
  return c[0][0] * c[1][1] - c[0][1] * c[1][0];
}

/**
 * The Gaussian of one observation with a range: the observer's own circle, plus the polar model
 * `r, theta` pushed through its Jacobian. Null when no range was said, because a bearing alone
 * has no point.
 */
export function observationGaussian(obs: FusionObservation, center: LatLon, opts: FusionOptions = { center }): Gaussian | null {
  if (obs.range_m == null || obs.bearing_deg == null) return null;
  const o = toLocal(obs.observer, center);
  const theta = obs.bearing_deg * DEG;
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const r = Math.max(0, obs.range_m);
  const sr = Math.max(0, opts.sigmaRangeFraction ?? SIGMA_RANGE_FRACTION) * r;
  const st = bearingSigmaDeg(obs.bearing_source, opts.humanBearingSigmaDeg ?? SIGMA_HUMAN_BEARING_DEG) * DEG;
  const radial = sr * sr;
  const angular = (r * st) * (r * st);
  const observer = Math.max(0, obs.observer.sigma_m) ** 2;
  return {
    mean: { e: o.e + r * s, n: o.n + r * c },
    cov: [
      [observer + radial * s * s + angular * c * c, (radial - angular) * s * c],
      [(radial - angular) * s * c, observer + radial * c * c + angular * s * s],
    ],
  };
}

/** A flat posterior on the local plane, one probability per cell. */
export interface ProbabilityGrid {
  /** The centre of the south-west cell. */
  origin: LocalPoint;
  cellM: number;
  cols: number;
  rows: number;
  /** Normalised probability mass, `cols * rows` entries, row-major northwards. */
  p: Float64Array;
}

export interface FusionResult {
  status: "resolved" | "unresolved" | "insufficient";
  mean: LocalPoint | null;
  cov: Covariance | null;
  /** The smallest circle around `mean` that holds this share of the posterior. */
  radius50_m: number | null;
  radius90_m: number | null;
  grid: ProbabilityGrid | null;
  /** How many independent groups were multiplied: one per observer and time window. */
  groups: number;
  /** Posterior mass on the grid's outer edge: the window cut the answer. */
  truncated: boolean;
  reason?: string;
}

interface Cluster {
  observerId: string;
  observations: FusionObservation[];
}

/** Sort by observer and time, then split each observer's sightings at gaps over the window. */
export function correlationClusters(observations: FusionObservation[], windowMs = DEFAULT_CORRELATION_WINDOW_MS): Cluster[] {
  const byObserver = new Map<string, FusionObservation[]>();
  for (const o of observations) byObserver.set(o.observerId, [...(byObserver.get(o.observerId) ?? []), o]);
  const out: Cluster[] = [];
  for (const [observerId, list] of byObserver) {
    const sorted = [...list].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    let current: FusionObservation[] = [];
    for (const o of sorted) {
      const previous = current[current.length - 1];
      if (previous && o.ts - previous.ts > windowMs) {
        out.push({ observerId, observations: current });
        current = [];
      }
      current.push(o);
    }
    if (current.length) out.push({ observerId, observations: current });
  }
  return out;
}

function makeGridAround(center: LocalPoint, half: number, cell: number): { cols: number; rows: number; cellM: number; origin: LocalPoint } {
  const side = Math.max(1, Math.round((2 * half) / cell));
  const cols = side + 1;
  return { cols, rows: cols, cellM: cell, origin: { e: center.e - side * cell * 0.5, n: center.n - side * cell * 0.5 } };
}

function makeGrid(half: number, cell: number): { cols: number; rows: number; cellM: number; origin: LocalPoint } {
  return makeGridAround({ e: 0, n: 0 }, half, cell);
}

function cellPoint(grid: { origin: LocalPoint; cellM: number }, i: number, j: number): LocalPoint {
  return { e: grid.origin.e + i * grid.cellM, n: grid.origin.n + j * grid.cellM };
}

function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= TWO_PI;
  while (x < -Math.PI) x += TWO_PI;
  return x;
}

/** Log likelihood of one ranged observation at every cell, with the outlier mixture. */
function rangedLog(grid: { origin: LocalPoint; cellM: number; cols: number; rows: number }, mean: LocalPoint, cov: Covariance, eps: number): Float64Array {
  const inv = invertCov(cov);
  const det = detCov(cov);
  if (!inv || !(det > 0)) return new Float64Array(grid.cols * grid.rows).fill(Number.NEGATIVE_INFINITY);
  const norm = -Math.log(TWO_PI) - 0.5 * Math.log(det);
  const area = (grid.cols * grid.cellM) * (grid.rows * grid.cellM);
  const uniform = 1 / Math.max(1, area);
  const log = new Float64Array(grid.cols * grid.rows);
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const q = cellPoint(grid, i, j);
      const de = q.e - mean.e;
      const dn = q.n - mean.n;
      const m2 = inv[0][0] * de * de + 2 * inv[0][1] * de * dn + inv[1][1] * dn * dn;
      const g = Math.exp(norm - 0.5 * m2);
      log[j * grid.cols + i] = Math.log((1 - eps) * g + eps * uniform);
    }
  }
  return log;
}

/** Log likelihood of one bearing-only observation: a ridge along the line of sight. */
function bearingLog(grid: { origin: LocalPoint; cellM: number; cols: number; rows: number }, observer: LocalPoint, bearingDegrees: number, sigmaDeg: number, eps: number, rangePrior: RangePrior, maxRange: number): Float64Array {
  const sigma = Math.max(1e-6, sigmaDeg * DEG);
  const peak = 1 / (Math.sqrt(TWO_PI) * sigma);
  const area = (grid.cols * grid.cellM) * (grid.rows * grid.cellM);
  const uniform = 1 / Math.max(1, area);
  const theta = ((bearingDegrees % 360) + 360) % 360 * DEG;
  const log = new Float64Array(grid.cols * grid.rows);
  const near = Math.max(grid.cellM, 1);
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const q = cellPoint(grid, i, j);
      const de = q.e - observer.e;
      const dn = q.n - observer.n;
      const r = Math.max(near, Math.hypot(de, dn));
      if (r > maxRange) {
        log[j * grid.cols + i] = Number.NEGATIVE_INFINITY;
        continue;
      }
      // The ridge's height as a function of distance is the range prior, not a likelihood term.
      const delta = wrapPi(Math.atan2(de, dn) - theta);
      const along = rangePrior === "uniform-area" ? peak / r : peak;
      const g = along * Math.exp(-0.5 * (delta / sigma) ** 2);
      log[j * grid.cols + i] = Math.log((1 - eps) * g + eps * uniform);
    }
  }
  return log;
}

function logOfObservation(obs: FusionObservation, center: LatLon, grid: { origin: LocalPoint; cellM: number; cols: number; rows: number }, opts: Resolved): Float64Array {
  if (obs.bearing_deg == null) {
    // A range with no bearing says nothing about where: the flat component alone.
    return new Float64Array(grid.cols * grid.rows).fill(Math.log(1 / Math.max(1, (grid.cols * grid.cellM) * (grid.rows * grid.cellM))));
  }
  if (obs.range_m != null) {
    const g = observationGaussian(obs, center, opts);
    if (!g) return new Float64Array(grid.cols * grid.rows).fill(Number.NEGATIVE_INFINITY);
    return rangedLog(grid, g.mean, g.cov, opts.outlierEpsilon);
  }
  return bearingLog(grid, toLocal(obs.observer, center), obs.bearing_deg, bearingSigmaDeg(obs.bearing_source, opts.humanBearingSigmaDeg), opts.outlierEpsilon, opts.rangePrior, opts.maxRangeM);
}

/** A normalised grid from log weights; returns the grid and its mean and covariance. */
function gridFromLog(log: Float64Array, grid: { origin: LocalPoint; cellM: number; cols: number; rows: number }): { grid: ProbabilityGrid; mean: LocalPoint; cov: Covariance } {
  let max = Number.NEGATIVE_INFINITY;
  for (const v of log) if (v > max && Number.isFinite(v)) max = v;
  if (!Number.isFinite(max)) {
    return {
      grid: { ...grid, p: new Float64Array(log.length) },
      mean: { e: 0, n: 0 },
      cov: [[0, 0], [0, 0]],
    };
  }
  const p = new Float64Array(log.length);
  let sum = 0;
  for (let k = 0; k < log.length; k++) {
    const v = Number.isFinite(log[k]) ? Math.exp(log[k] - max) : 0;
    p[k] = v;
    sum += v;
  }
  if (!(sum > 0)) {
    return { grid: { ...grid, p }, mean: { e: 0, n: 0 }, cov: [[0, 0], [0, 0]] };
  }
  let meanE = 0;
  let meanN = 0;
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const k = j * grid.cols + i;
      const q = cellPoint(grid, i, j);
      meanE += q.e * p[k];
      meanN += q.n * p[k];
    }
  }
  meanE /= sum;
  meanN /= sum;
  let vEE = 0;
  let vEN = 0;
  let vNN = 0;
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const k = j * grid.cols + i;
      const q = cellPoint(grid, i, j);
      const de = q.e - meanE;
      const dn = q.n - meanN;
      vEE += de * de * p[k];
      vEN += de * dn * p[k];
      vNN += dn * dn * p[k];
    }
  }
  for (let k = 0; k < p.length; k++) p[k] /= sum;
  return {
    grid: { ...grid, p },
    mean: { e: meanE, n: meanN },
    cov: [[vEE / sum, vEN / sum], [vEN / sum, vNN / sum]],
  };
}

/** Covariance intersection of two log grids: p ∝ p1^w p2^(1-w), w chosen for the smallest spread. */
function intersectLogs(a: Float64Array, b: Float64Array, grid: { origin: LocalPoint; cellM: number; cols: number; rows: number }): Float64Array {
  let best: Float64Array | null = null;
  let bestDet = Number.POSITIVE_INFINITY;
  for (let step = 0; step <= 20; step++) {
    const w = step / 20;
    const mixed = new Float64Array(a.length);
    for (let k = 0; k < a.length; k++) mixed[k] = w * a[k] + (1 - w) * b[k];
    const { cov } = gridFromLog(mixed, grid);
    const det = detCov(cov);
    if (det < bestDet) {
      bestDet = det;
      best = mixed;
    }
  }
  return best ?? a;
}

/** Covariance intersection of two Gaussian estimates: the prudent overlap, not their product. */
function intersectGaussians(a: Gaussian, b: Gaussian): Gaussian {
  const ia = invertCov(a.cov);
  const ib = invertCov(b.cov);
  if (!ia || !ib) return a;
  let best = a;
  let bestDet = Number.POSITIVE_INFINITY;
  for (let step = 0; step <= 20; step++) {
    const w = step / 20;
    const info: Covariance = [
      [w * ia[0][0] + (1 - w) * ib[0][0], w * ia[0][1] + (1 - w) * ib[0][1]],
      [w * ia[1][0] + (1 - w) * ib[1][0], w * ia[1][1] + (1 - w) * ib[1][1]],
    ];
    const cov = invertCov(info);
    if (!cov) continue;
    const etaE = w * (ia[0][0] * a.mean.e + ia[0][1] * a.mean.n) + (1 - w) * (ib[0][0] * b.mean.e + ib[0][1] * b.mean.n);
    const etaN = w * (ia[1][0] * a.mean.e + ia[1][1] * a.mean.n) + (1 - w) * (ib[1][0] * b.mean.e + ib[1][1] * b.mean.n);
    const det = detCov(cov);
    if (det < bestDet) {
      bestDet = det;
      best = { cov, mean: { e: cov[0][0] * etaE + cov[0][1] * etaN, n: cov[1][0] * etaE + cov[1][1] * etaN } };
    }
  }
  return best;
}

/**
 * Covariance intersection of more than two estimates. Equal weights: the intersection is
 * contained in this weighted estimate, and no order or numerical tie can pull it to one report.
 */
function intersectGaussianList(list: Gaussian[]): Gaussian {
  if (!list.length) throw new Error("no estimate");
  if (list.length === 1) return list[0];
  if (list.length === 2) return intersectGaussians(list[0], list[1]);
  let info: Covariance = [[0, 0], [0, 0]];
  let etaE = 0;
  let etaN = 0;
  for (const g of list) {
    const inv = invertCov(g.cov);
    if (!inv) continue;
    info = [
      [info[0][0] + inv[0][0] / list.length, info[0][1] + inv[0][1] / list.length],
      [info[1][0] + inv[1][0] / list.length, info[1][1] + inv[1][1] / list.length],
    ];
    etaE += (inv[0][0] * g.mean.e + inv[0][1] * g.mean.n) / list.length;
    etaN += (inv[1][0] * g.mean.e + inv[1][1] * g.mean.n) / list.length;
  }
  const cov = invertCov(info);
  if (!cov) return list[0];
  return { cov, mean: { e: cov[0][0] * etaE + cov[0][1] * etaN, n: cov[1][0] * etaE + cov[1][1] * etaN } };
}

/** The smallest circles around the mean that hold each requested share, from one sort. */
function credibleRadii(grid: ProbabilityGrid, mean: LocalPoint, levels: number[] = [0.5, 0.9]): number[] {
  const cells: { d2: number; p: number }[] = [];
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const p = grid.p[j * grid.cols + i];
      if (!(p > 0)) continue;
      const q = { e: grid.origin.e + i * grid.cellM, n: grid.origin.n + j * grid.cellM };
      cells.push({ d2: (q.e - mean.e) ** 2 + (q.n - mean.n) ** 2, p });
    }
  }
  cells.sort((x, y) => x.d2 - y.d2);
  const out = levels.map(() => Number.NaN);
  let sum = 0;
  let k = 0;
  for (const c of cells) {
    sum += c.p;
    while (k < levels.length && sum >= levels[k]) {
      out[k] = Math.sqrt(c.d2);
      k++;
    }
    if (k >= levels.length) break;
  }
  return out;
}

/** Posterior mass within two cells of a bearing-only observation's maximum range. */
function priorEdgeMass(
  grid: ProbabilityGrid,
  observations: FusionObservation[],
  center: LatLon,
  maxRange: number,
): number {
  const sensors = observations
    .filter((x) => x.range_m == null && x.bearing_deg != null)
    .map((x) => toLocal(x.observer, center));
  if (!sensors.length) return 0;
  const near = maxRange - 2 * grid.cellM;
  let mass = 0;
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const p = grid.p[j * grid.cols + i];
      if (!(p > 0)) continue;
      const q = { e: grid.origin.e + i * grid.cellM, n: grid.origin.n + j * grid.cellM };
      if (sensors.some((sensor) => Math.hypot(q.e - sensor.e, q.n - sensor.n) >= near)) mass += p;
    }
  }
  return mass;
}

function edgeMass(grid: ProbabilityGrid): number {
  let mass = 0;
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      if (i === 0 || j === 0 || i === grid.cols - 1 || j === grid.rows - 1) mass += grid.p[j * grid.cols + i];
    }
  }
  return mass;
}

interface Posterior {
  grid: ProbabilityGrid;
  mean: LocalPoint;
  cov: Covariance;
  priorMass: number;
  edgeMass: number;
  groups: number;
}

/** The normalised posterior of all clusters on one grid. */
function posteriorOn(
  dims: { origin: LocalPoint; cellM: number; cols: number; rows: number },
  usable: FusionObservation[],
  o: Resolved,
): Posterior | null {
  const clusters = correlationClusters(usable, o.correlationWindowMs);
  const total = new Float64Array(dims.cols * dims.rows);
  let groups = 0;
  for (const cluster of clusters) {
    let group: Float64Array;
    const allRanged = cluster.observations.every((x) => x.range_m != null && x.bearing_deg != null);
    if (allRanged) {
      const gaussians = cluster.observations.map((x) => observationGaussian(x, o.center, o)!);
      const g = intersectGaussianList(gaussians);
      group = rangedLog(dims, g.mean, g.cov, o.outlierEpsilon);
    } else {
      const logs = cluster.observations.map((x) => logOfObservation(x, o.center, dims, o));
      if (logs.length === 1) group = logs[0];
      else if (logs.length === 2) group = intersectLogs(logs[0], logs[1], dims);
      else {
        group = new Float64Array(logs[0].length);
        for (const log of logs) for (let i = 0; i < group.length; i++) group[i] += log[i] / logs.length;
      }
    }
    for (let i = 0; i < total.length; i++) total[i] += group[i];
    groups++;
  }
  let max = Number.NEGATIVE_INFINITY;
  for (const v of total) if (v > max && Number.isFinite(v)) max = v;
  if (!Number.isFinite(max)) return null;
  const normalized = new Float64Array(total.length);
  for (let k = 0; k < total.length; k++) normalized[k] = Number.isFinite(total[k]) ? total[k] - max : Number.NEGATIVE_INFINITY;
  const { grid, mean, cov } = gridFromLog(normalized, dims);
  return {
    grid,
    mean,
    cov,
    priorMass: priorEdgeMass(grid, usable, o.center, o.maxRangeM),
    edgeMass: edgeMass(grid),
    groups,
  };
}

function resultOf(p: Posterior, truncated: boolean, radii: number[] = credibleRadii(p.grid, p.mean)): FusionResult {
  return {
    status: truncated ? "unresolved" : "resolved",
    mean: p.mean,
    cov: p.cov,
    radius50_m: radii[0],
    radius90_m: radii[1],
    grid: p.grid,
    groups: p.groups,
    truncated,
  };
}

/** The widest angle between any two bearing-only lines, 0 to 90 degrees. */
function bearingSpread(observations: FusionObservation[]): number {
  const bearings = observations.filter((x) => x.range_m == null && x.bearing_deg != null).map((x) => ((x.bearing_deg! % 180) + 180) % 180);
  let widest = 0;
  for (let i = 0; i < bearings.length; i++) {
    for (let j = i + 1; j < bearings.length; j++) {
      const d = Math.abs(bearings[i] - bearings[j]);
      widest = Math.max(widest, Math.min(d, 180 - d));
    }
  }
  return widest;
}

function maxSpread(c: Covariance): number {
  const tr = c[0][0] + c[1][1];
  const det = detCov(c);
  const root = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  return Math.sqrt(Math.max(0, tr / 2 + root));
}

/**
 * Fuse observations of one thing. Each observer's sightings inside the same time window are
 * treated as correlated and intersected; different observers' groups are multiplied. A bearing
 * with no range contributes a ridge, never an invented distance.
 *
 * A bearing-only posterior is found on a coarse 50 m grid over the whole prior, then on a 10 m
 * grid around its own mean. The coarse pass locates the ridge and detects a result that the prior
 * cuts; the fine pass gives the metres. A posterior that reaches either edge is `unresolved`.
 */
export function fuseObservations(observations: FusionObservation[], opts: FusionOptions): FusionResult {
  const o = options(opts);
  const usable = observations.filter((x) => x.bearing_deg != null || x.range_m != null);
  if (!usable.length) {
    return { status: "insufficient", mean: null, cov: null, radius50_m: null, radius90_m: null, grid: null, groups: 0, truncated: false, reason: "no bearing and no range" };
  }
  let autoHalf = o.gridHalfSizeM;
  if (autoHalf == null) {
    autoHalf = o.maxRangeM + o.gridCellM;
    for (const obs of usable) {
      const at = toLocal(obs.observer, o.center);
      autoHalf = Math.max(autoHalf, Math.hypot(at.e, at.n) + o.gridCellM);
      if (obs.range_m != null) {
        const g = observationGaussian(obs, o.center, o);
        if (g) autoHalf = Math.max(autoHalf, Math.hypot(g.mean.e, g.mean.n) + 4 * maxSpread(g.cov));
      }
    }
  }
  const bearingOnly = usable.some((x) => x.range_m == null && x.bearing_deg != null);
  if (!bearingOnly) {
    let ce = 0;
    let cn = 0;
    let half = 5 * o.gridCellM;
    for (const obs of usable) {
      const g = observationGaussian(obs, o.center, o);
      if (!g) continue;
      ce += g.mean.e / usable.length;
      cn += g.mean.n / usable.length;
      half = Math.max(half, Math.hypot(g.mean.e - ce, g.mean.n - cn) + 6 * maxSpread(g.cov));
    }
    const dims = makeGridAround({ e: ce, n: cn }, Math.min(autoHalf, half), o.gridCellM);
    const p = posteriorOn(dims, usable, o);
    if (!p) return { status: "insufficient", mean: null, cov: null, radius50_m: null, radius90_m: null, grid: null, groups: 0, truncated: false, reason: "no usable likelihood" };
    const radii = credibleRadii(p.grid, p.mean);
    return resultOf(p, p.edgeMass > 0.002 || p.priorMass > 0.01, radii);
  }

  const coarse = posteriorOn(makeGrid(autoHalf, Math.max(50, o.gridCellM * 5)), usable, o);
  if (!coarse) return { status: "insufficient", mean: null, cov: null, radius50_m: null, radius90_m: null, grid: null, groups: 0, truncated: false, reason: "no usable likelihood" };
  const coarseRadii = credibleRadii(coarse.grid, coarse.mean);
  if (bearingSpread(usable) < MIN_BEARING_SPREAD_DEG) return resultOf(coarse, true, coarseRadii);
  const coarseWide = coarseRadii[1] > 0.25 * o.maxRangeM;
  if (coarse.edgeMass > 0.002 || coarse.priorMass > 0.01 || coarseWide) return resultOf(coarse, true, coarseRadii);
  const half = Math.min(autoHalf, Math.max(6 * maxSpread(coarse.cov), 5 * o.gridCellM));
  const fine = posteriorOn(makeGridAround(coarse.mean, half, o.gridCellM), usable, o);
  if (!fine) return resultOf(coarse, true, coarseRadii);
  const fineRadii = credibleRadii(fine.grid, fine.mean);
  const wide = fineRadii[1] > 0.25 * o.maxRangeM;
  return resultOf(fine, fine.edgeMass > 0.002 || fine.priorMass > 0.01 || wide, fineRadii);
}

// ---- association ----

export interface TrackPrediction {
  id: string;
  mean: LocalPoint;
  cov: Covariance;
  ts: number;
  semantics?: ObservationSemantics;
}

export interface AssociationOptions extends FusionOptions {
  gateChi2?: number;
  ambiguityMargin?: number;
  maxSpeedMps?: number;
  maxAgeMs?: number;
}

export interface Assignment {
  observation: string;
  track: string;
  cost: number;
}

export interface AssociationResult {
  status: "assigned" | "ambiguous" | "empty";
  assignments: Assignment[];
  ambiguous: { observation: string; tracks: string[]; costs: number[] }[];
  unassigned: string[];
}

function compatible(a?: ObservationSemantics, b?: ObservationSemantics): boolean {
  if (!a || !b) return true;
  if (a.kind != null && b.kind != null && a.kind !== b.kind) return false;
  if (a.count != null && b.count != null && a.count !== b.count) return false;
  if (a.affiliation != null && b.affiliation != null && a.affiliation !== b.affiliation) return false;
  return true;
}

/** Mahalanobis squared of an observation against a track, or Infinity when it cannot be one. */
function associationCost(obs: FusionObservation, track: TrackPrediction, center: LatLon, opts: AssociationOptions): number {
  if (!compatible(obs.semantics, track.semantics)) return Number.POSITIVE_INFINITY;
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!(Math.abs(obs.ts - track.ts) <= maxAge)) return Number.POSITIVE_INFINITY;
  const sigmaTheta = bearingSigmaDeg(obs.bearing_source, opts.humanBearingSigmaDeg ?? SIGMA_HUMAN_BEARING_DEG) * DEG;
  if (obs.bearing_deg == null) return Number.POSITIVE_INFINITY;
  if (obs.range_m != null) {
    const g = observationGaussian(obs, center, opts);
    if (!g) return Number.POSITIVE_INFINITY;
    const de = g.mean.e - track.mean.e;
    const dn = g.mean.n - track.mean.n;
    const s: Covariance = [
      [g.cov[0][0] + track.cov[0][0], g.cov[0][1] + track.cov[0][1]],
      [g.cov[1][0] + track.cov[1][0], g.cov[1][1] + track.cov[1][1]],
    ];
    const inv = invertCov(s);
    if (!inv) return Number.POSITIVE_INFINITY;
    const d2 = inv[0][0] * de * de + 2 * inv[0][1] * de * dn + inv[1][1] * dn * dn;
    const dt = Math.abs(obs.ts - track.ts) / 1000;
    if (dt >= 1 && Math.hypot(de, dn) / dt > (opts.maxSpeedMps ?? DEFAULT_MAX_SPEED_MPS)) {
      return Number.POSITIVE_INFINITY;
    }
    return d2;
  }
  const observer = toLocal(obs.observer, center);
  const de = track.mean.e - observer.e;
  const dn = track.mean.n - observer.n;
  const r = Math.hypot(de, dn);
  if (!(r > 1)) return Number.POSITIVE_INFINITY;
  const line = obs.bearing_deg * DEG;
  if (de * Math.sin(line) + dn * Math.cos(line) <= 0) return Number.POSITIVE_INFINITY;
  const delta = wrapPi(Math.atan2(de, dn) - line);
  const lateral = Math.cos(line) * (track.cov[0][0] * Math.cos(line) + track.cov[0][1] * Math.sin(line)) +
    Math.sin(line) * (track.cov[1][0] * Math.cos(line) + track.cov[1][1] * Math.sin(line));
  const variance = sigmaTheta * sigmaTheta + Math.max(0, lateral) / (r * r);
  return variance > 0 ? (delta * delta) / variance : Number.POSITIVE_INFINITY;
}

const BIG = 1e12;

/** Hungarian assignment for a square cost matrix; -1 where a row has no column. */
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const answer = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] > 0) answer[p[j] - 1] = j - 1;
  return answer;
}

/** Pair each observation with at most one track, if the gate and the words allow it. */
export function associate(observations: FusionObservation[], tracks: TrackPrediction[], opts: AssociationOptions): AssociationResult {
  const gate = opts.gateChi2 ?? CHI2_2DOF_99;
  const margin = opts.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN;
  const n = observations.length;
  const m = tracks.length;
  if (!n || !m) return { status: "empty", assignments: [], ambiguous: [], unassigned: [] };
  const size = n + m;
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const c = associationCost(observations[i], tracks[j], opts.center, opts);
      matrix[i][j] = Number.isFinite(c) && c <= gate ? c : BIG;
    }
    matrix[i][m + i] = gate;
  }
  for (let j = 0; j < m; j++) matrix[n + j][j] = 0;
  const best = hungarian(matrix);
  const assignments: Assignment[] = [];
  let total = 0;
  for (let k = 0; k < size; k++) total += matrix[k][best[k]];
  for (let i = 0; i < n; i++) {
    const j = best[i];
    if (j >= 0 && j < m && matrix[i][j] < BIG / 2) {
      assignments.push({ observation: observations[i].id, track: tracks[j].id, cost: matrix[i][j] });
    }
  }
  const ambiguous: AssociationResult["ambiguous"] = [];
  for (let i = 0; i < n; i++) {
    const near = tracks
      .map((t, j) => ({ id: t.id, cost: matrix[i][j] }))
      .filter((x) => x.cost < BIG / 2)
      .sort((a, b) => a.cost - b.cost);
    if (near.length > 1 && near[1].cost - near[0].cost < margin) {
      ambiguous.push({
        observation: observations[i].id,
        tracks: near.filter((x) => x.cost - near[0].cost < margin).map((x) => x.id),
        costs: near.filter((x) => x.cost - near[0].cost < margin).map((x) => x.cost),
      });
    }
  }
  for (const a of assignments) {
    const i = observations.findIndex((x) => x.id === a.observation);
    const j = tracks.findIndex((x) => x.id === a.track);
    if (i < 0 || j < 0) continue;
    const copy = matrix.map((row) => [...row]);
    copy[i][j] = BIG;
    const alt = hungarian(copy);
    let altTotal = 0;
    for (let k = 0; k < size; k++) altTotal += copy[k][alt[k]];
    if (altTotal - total < margin) {
      ambiguous.push({ observation: a.observation, tracks: [a.track], costs: [a.cost] });
    }
  }
  const assigned = new Set(assignments.map((a) => a.observation));
  return {
    status: ambiguous.length ? "ambiguous" : assignments.length ? "assigned" : "empty",
    assignments,
    ambiguous,
    unassigned: observations.filter((x) => !assigned.has(x.id)).map((x) => x.id),
  };
}
