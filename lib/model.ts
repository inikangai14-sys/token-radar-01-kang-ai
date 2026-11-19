// Radar Jujur's value model, fitted from the sealed snapshot and nothing else.
//
// The curve is an ordinary least-squares fit of log10(mcap_usd) on log10(tvl_usd)
// over the protocols whose tokens already trade (mcap_usd > 0). A category's
// premium is the median log gap of its traded protocols, shrunk toward 1 by
// n/(n+SHRINK_K) so a thin category cannot make a wild claim. Launch odds are
// the observed share of protocols in each age cohort that have a token, with
// the same shrinkage toward the all-snapshot rate. The 7-day TVL change is a
// bounded multiplier. Uncertainty is the empirical P25-P75 of the traded
// residuals, widened by the fitted parameter standard error and the cohort's
// binomial uncertainty; the range stays tied to the data, never to a guess.
//
// Ages come from snapshot.as_of; no wall clock, no network, no protocol names.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export interface SizeCurve {
  intercept: number;
  slope: number;
  n: number;
  residual_p25: number;
  residual_p50: number;
  residual_p75: number;
  parameter_se: number;
}

export interface CategoryPremium {
  category: string;
  premium: number;
  n: number;
  raw_premium: number;
}

export interface AgeCohort {
  label: string;
  odds: number;
  sample: number;
  launched: number;
  prior: number;
}

export interface ValueModel {
  as_of: string;
  model_version: string;
  curve: SizeCurve;
  categories: Map<string, CategoryPremium>;
  cohorts: AgeCohort[];
  global_odds: number;
  shrink_k: number;
  momentum_weight: number;
  known_ages: number;
  unknown_ages: number;
}

export interface Valuation {
  implied_value_usd: number;
  value_if_launches_usd: number;
  launch_odds: number;
  curve_value_usd: number;
  category_premium: number;
  momentum_multiplier: number;
  age_days: number | null;
  cohort: string;
  p25_usd: number;
  p75_usd: number;
}

export const MODEL_VERSION = 'radar-jujur-1';
const SHRINK_K = 10;
const MOMENTUM_WEIGHT = 0.35;
const DAY_MS = 86_400_000;
const COHORT_DAYS = [365, 730, 1095, 1460, 1825];
const COHORT_LABELS = ['<1y', '1-2y', '2-3y', '3-4y', '4-5y', '5y+', 'unknown'];
const Z25 = -0.6744897501960817;
const Z75 = 0.6744897501960817;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function round(value: number): number {
  return Math.round(value);
}

/** Whole days from a protocol's first tracking day to the snapshot's as_of; never Date.now. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const to = Date.parse(`${asOf}T00:00:00Z`);
  const from = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(to) || !Number.isFinite(from)) return null;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

function cohortIndex(age: number | null): number {
  if (age === null) return COHORT_DAYS.length;
  for (let index = 0; index < COHORT_DAYS.length; index += 1) {
    if (age < COHORT_DAYS[index]!) return index;
  }
  return COHORT_DAYS.length;
}

function shrink(estimate: number, sample: number, prior: number): number {
  const weight = sample / (sample + SHRINK_K);
  return prior * (1 - weight) + estimate * weight;
}

/** Validate the frozen file's shape; unknown extra fields are ignored. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not an object');
  const source = raw as Record<string, unknown>;
  if (typeof source.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(source.as_of) || !Number.isFinite(Date.parse(`${source.as_of}T00:00:00Z`))) {
    throw new SnapshotError('snapshot.json has no valid as_of date');
  }
  if (typeof source.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (finite(source.floor_usd) === null || source.floor_usd! <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(source.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(source.watchlist) || source.watchlist.some((value) => typeof value !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = source.protocols.map((value, index): SnapshotProtocol => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnapshotError(`protocol ${index} is not an object`);
    const record = value as Record<string, unknown>;
    if (typeof record.slug !== 'string' || typeof record.name !== 'string' || finite(record.tvl_usd) === null || record.tvl_usd! < 0) {
      throw new SnapshotError(`protocol ${index} lacks a slug, a name or a TVL`);
    }
    return {
      slug: record.slug,
      name: record.name,
      category: typeof record.category === 'string' ? record.category : null,
      chains: Array.isArray(record.chains) ? record.chains.filter((chain): chain is string => typeof chain === 'string') : [],
      tvl_usd: record.tvl_usd as number,
      change_7d: finite(record.change_7d),
      mcap_usd: finite(record.mcap_usd),
      listed_at: typeof record.listed_at === 'string' ? record.listed_at : null,
      gecko_id: typeof record.gecko_id === 'string' ? record.gecko_id : null,
      symbol: typeof record.symbol === 'string' ? record.symbol : null,
    };
  });
  return {
    as_of: source.as_of,
    source: source.source,
    floor_usd: source.floor_usd as number,
    protocols,
    watchlist: source.watchlist as string[],
  };
}

/** OLS log10 curve over traded protocols, plus residual quartiles and fit uncertainty. */
function fitCurve(traded: SnapshotProtocol[]): SizeCurve {
  if (traded.length < 2) throw new SnapshotError('not enough traded protocols to fit a size curve');
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const protocol of traded) {
    const x = Math.log10(protocol.tvl_usd);
    const y = Math.log10(protocol.mcap_usd!);
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const n = traded.length;
  const meanX = sumX / n;
  const meanY = sumY / n;
  const centeredXX = sumXX - n * meanX * meanX;
  const slope = (sumXY - n * meanX * meanY) / centeredXX;
  const intercept = meanY - slope * meanX;
  const residuals = traded
    .map((protocol) => Math.log10(protocol.mcap_usd!) - (intercept + slope * Math.log10(protocol.tvl_usd)))
    .sort((left, right) => left - right);
  const sumSquared = residuals.reduce((total, value) => total + value * value, 0);
  const sigma = Math.sqrt(sumSquared / Math.max(1, n - 2));
  const parameterSe = sigma * Math.sqrt(1 / n + (meanX * meanX) / centeredXX);
  return {
    intercept,
    slope,
    n,
    residual_p25: quantile(residuals, 0.25),
    residual_p50: quantile(residuals, 0.5),
    residual_p75: quantile(residuals, 0.75),
    parameter_se: parameterSe,
  };
}

/** Category medians of the log gap, shrunk toward 1 by the traded sample size. */
function fitCategories(traded: SnapshotProtocol[], curve: SizeCurve): Map<string, CategoryPremium> {
  const buckets = new Map<string, number[]>();
  for (const protocol of traded) {
    const category = protocol.category ?? '(none)';
    const expected = curve.intercept + curve.slope * Math.log10(protocol.tvl_usd);
    const gap = Math.log10(protocol.mcap_usd!) - expected;
    const values = buckets.get(category);
    if (values === undefined) buckets.set(category, [gap]);
    else values.push(gap);
  }
  const fitted = new Map<string, CategoryPremium>();
  for (const [category, gaps] of buckets) {
    gaps.sort((left, right) => left - right);
    const median = quantile(gaps, 0.5);
    const premium = Math.pow(10, shrink(median, gaps.length, 0));
    fitted.set(category, {
      category,
      premium,
      n: gaps.length,
      raw_premium: Math.pow(10, median),
    });
  }
  return fitted;
}

/** Observed launch rate by age cohort, shrunk toward the whole-snapshot rate. */
function fitCohorts(protocols: SnapshotProtocol[], asOf: string): { cohorts: AgeCohort[]; globalOdds: number; knownAges: number; unknownAges: number } {
  const sample = new Array<number>(COHORT_LABELS.length).fill(0);
  const launched = new Array<number>(COHORT_LABELS.length).fill(0);
  let knownAges = 0;
  let unknownAges = 0;
  for (const protocol of protocols) {
    const hasToken = protocol.mcap_usd !== null || protocol.gecko_id !== null || protocol.symbol !== null;
    const age = ageDays(asOf, protocol.listed_at);
    if (age === null) {
      unknownAges += 1;
      sample[COHORT_LABELS.length - 1]! += 1;
      if (hasToken) launched[COHORT_LABELS.length - 1]! += 1;
      continue;
    }
    knownAges += 1;
    const slot = cohortIndex(age);
    sample[slot]! += 1;
    if (hasToken) launched[slot]! += 1;
  }
  const globalLaunched = launched.slice(0, -1).reduce((total, value) => total + value, 0);
  const globalSample = sample.slice(0, -1).reduce((total, value) => total + value, 0);
  const globalOdds = globalSample > 0 ? globalLaunched / globalSample : 0;
  const cohorts = COHORT_LABELS.map((label, index) => ({
    label,
    odds: shrink(sample[index]! > 0 ? launched[index]! / sample[index]! : globalOdds, sample[index]!, globalOdds),
    sample: sample[index]!,
    launched: launched[index]!,
    prior: globalOdds,
  }));
  return { cohorts, globalOdds, knownAges, unknownAges };
}

/** Fit every component from the snapshot. No hard-coded protocol or category values. */
export function fitModel(snapshot: Snapshot): ValueModel {
  const traded = snapshot.protocols.filter((protocol) => protocol.mcap_usd !== null && protocol.mcap_usd > 0);
  const curve = fitCurve(traded);
  const cohorts = fitCohorts(snapshot.protocols, snapshot.as_of);
  return {
    as_of: snapshot.as_of,
    model_version: MODEL_VERSION,
    curve,
    categories: fitCategories(traded, curve),
    cohorts: cohorts.cohorts,
    global_odds: cohorts.globalOdds,
    shrink_k: SHRINK_K,
    momentum_weight: MOMENTUM_WEIGHT,
    known_ages: cohorts.knownAges,
    unknown_ages: cohorts.unknownAges,
  };
}

/** Wilson score interval at P25-P75 for a binomial rate. */
function oddsInterval(odds: number, sample: number): { low: number; high: number } {
  if (sample <= 0) return { low: odds, high: odds };
  const z = Z75;
  const denominator = 1 + (z * z) / sample;
  const center = (odds + (z * z) / (2 * sample)) / denominator;
  const half = (z / denominator) * Math.sqrt((odds * (1 - odds)) / sample + (z * z) / (4 * sample * sample));
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** Value if a token launches, its launch odds, and the P25-P75 range for one protocol. */
export function impliedValue(protocol: SnapshotProtocol, model: ValueModel, asOf: string = model.as_of): Valuation {
  if (protocol.tvl_usd <= 0) throw new SnapshotError(`${protocol.slug} has no positive TVL`);
  const category = protocol.category ?? '(none)';
  const categoryFit = model.categories.get(category);
  const premium = categoryFit?.premium ?? 1;
  const momentumPct = Math.max(-60, Math.min(120, protocol.change_7d ?? 0));
  const momentum = Math.max(0.1, 1 + (momentumPct / 100) * model.momentum_weight);
  const curveValue = Math.pow(10, model.curve.intercept + model.curve.slope * Math.log10(protocol.tvl_usd));
  const valueIfLaunches = curveValue * premium * momentum;
  const age = ageDays(asOf, protocol.listed_at);
  const slot = cohortIndex(age);
  const cohort = model.cohorts[slot]!;
  const odds = cohort.odds;
  const implied = Math.max(1, round(valueIfLaunches * odds));
  const interval = oddsInterval(odds, cohort.sample);
  const spread = Math.max(model.curve.residual_p75 - model.curve.residual_p25, model.curve.parameter_se * 2);
  const lowResidual = model.curve.residual_p50 - spread;
  const highResidual = model.curve.residual_p50 + spread;
  const p25 = Math.max(1, round(valueIfLaunches * Math.pow(10, lowResidual) * interval.low));
  const p75 = Math.max(p25, round(valueIfLaunches * Math.pow(10, highResidual) * interval.high));
  return {
    implied_value_usd: implied,
    value_if_launches_usd: round(valueIfLaunches),
    launch_odds: odds,
    curve_value_usd: round(curveValue),
    category_premium: premium,
    momentum_multiplier: momentum,
    age_days: age,
    cohort: cohort.label,
    p25_usd: p25,
    p75_usd: p75,
  };
}

export function isPreToken(protocol: SnapshotProtocol): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isRankable(protocol: SnapshotProtocol): boolean {
  return isPreToken(protocol) && protocol.category !== 'CEX' && !VERSIONED.test(protocol.name);
}

export interface ScoredProtocol {
  protocol: SnapshotProtocol;
  valuation: Valuation;
}

/** Score every rankable pre-token protocol; the caller decides coverage and row shape. */
export function scoreProtocols(snapshot: Snapshot, model: ValueModel = fitModel(snapshot)): ScoredProtocol[] {
  return snapshot.protocols
    .filter(isRankable)
    .map((protocol) => ({ protocol, valuation: impliedValue(protocol, model) }))
    .sort((left, right) =>
      right.valuation.implied_value_usd - left.valuation.implied_value_usd ||
      (left.protocol.slug < right.protocol.slug ? -1 : left.protocol.slug > right.protocol.slug ? 1 : 0),
    );
}
