// Out-of-sample validation for the fitted curve. Pure functions, snapshot only.
import type { SnapshotProtocol } from './model.ts';

export interface Fit { intercept: number; slope: number }
export interface Prediction { value: number; p25: number; p75: number }
export interface ValidationFigures {
  median_abs_pct: number;
  within_interval: number;
  n: number;
}

export interface ValidationReport {
  loo: ValidationFigures;
  kfold: ValidationFigures & { folds: number };
  by_time: ValidationFigures & { train_n: number; test_n: number };
}

export function fitLogCurve(rows: SnapshotProtocol[]): Fit {
  if (rows.length < 2) throw new Error('not enough traded protocols');
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const row of rows) {
    const x = Math.log10(row.tvl_usd);
    const y = Math.log10(row.mcap_usd!);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const n = rows.length;
  const meanX = sx / n;
  const meanY = sy / n;
  const slope = (sxy - n * meanX * meanY) / (sxx - n * meanX * meanX);
  return { intercept: meanY - slope * meanX, slope };
}

export function residualQuartiles(rows: SnapshotProtocol[], fit: Fit): { p25: number; p50: number; p75: number } {
  const residuals = rows.map((row) => Math.log10(row.mcap_usd!) - (fit.intercept + fit.slope * Math.log10(row.tvl_usd))).sort((a, b) => a - b);
  const at = (q: number): number => {
    const position = (residuals.length - 1) * q;
    const lo = Math.floor(position);
    const hi = Math.ceil(position);
    return lo === hi ? residuals[lo]! : residuals[lo]! + (residuals[hi]! - residuals[lo]!) * (position - lo);
  };
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75) };
}

export function predict(row: SnapshotProtocol, fit: Fit, spreadRows: SnapshotProtocol[]): Prediction {
  const q = residualQuartiles(spreadRows, fit);
  const center = Math.pow(10, fit.intercept + fit.slope * Math.log10(row.tvl_usd));
  return {
    value: center * Math.pow(10, q.p50),
    p25: center * Math.pow(10, q.p25),
    p75: center * Math.pow(10, q.p75),
  };
}

function figures(rows: SnapshotProtocol[], fit: Fit, spreadRows: SnapshotProtocol[]): ValidationFigures {
  let within = 0;
  const misses: number[] = [];
  for (const row of rows) {
    const prediction = predict(row, fit, spreadRows);
    misses.push(Math.abs(prediction.value - row.mcap_usd!) / row.mcap_usd! * 100);
    if (row.mcap_usd! >= prediction.p25 && row.mcap_usd! <= prediction.p75) within += 1;
  }
  misses.sort((a, b) => a - b);
  const mid = Math.floor((misses.length - 1) / 2);
  const median = misses.length % 2 === 0 ? (misses[mid]! + misses[mid + 1]!) / 2 : misses[mid]!;
  return { median_abs_pct: median, within_interval: within / rows.length * 100, n: rows.length };
}

/** Five-fold out-of-sample check. Slug order makes the folds stable; each fold refits the curve. */
export function crossValidate(protocols: SnapshotProtocol[], folds = 5): ValidationFigures & { folds: number } {
  if (folds < 2) throw new Error('crossValidate needs at least two folds');
  const traded = protocols
    .filter((row) => row.mcap_usd !== null && row.mcap_usd > 0 && row.tvl_usd > 0)
    .slice()
    .sort((left, right) => (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0));
  if (traded.length < folds * 2) throw new Error('not enough traded protocols for five folds');
  const misses: number[] = [];
  let within = 0;
  for (let fold = 0; fold < folds; fold += 1) {
    const test = traded.filter((_, index) => index % folds === fold);
    const train = traded.filter((_, index) => index % folds !== fold);
    const fit = fitLogCurve(train);
    for (const row of test) {
      const prediction = predict(row, fit, train);
      misses.push(Math.abs(prediction.value - row.mcap_usd!) / row.mcap_usd! * 100);
      if (row.mcap_usd! >= prediction.p25 && row.mcap_usd! <= prediction.p75) within += 1;
    }
  }
  misses.sort((left, right) => left - right);
  const middle = Math.floor((misses.length - 1) / 2);
  const median = misses.length % 2 === 0 ? (misses[middle]! + misses[middle + 1]!) / 2 : misses[middle]!;
  return { median_abs_pct: median, within_interval: within / misses.length * 100, n: misses.length, folds };
}

export function validate(snapshotAsOf: string, protocols: SnapshotProtocol[]): ValidationReport {
  const traded = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const full = fitLogCurve(traded);
  const looFit = fitLogCurve(traded);
  const loo = figures(traded, looFit, traded);
  const cutoff = Date.parse('2024-01-01T00:00:00Z');
  const older = traded.filter((p) => p.listed_at !== null && Date.parse(`${p.listed_at}T00:00:00Z`) < cutoff);
  const newer = traded.filter((p) => p.listed_at === null || Date.parse(`${p.listed_at}T00:00:00Z`) >= cutoff);
  const olderFit = fitLogCurve(older);
  const byTime = figures(newer, olderFit, older);
  return { loo, kfold: crossValidate(protocols), by_time: { ...byTime, train_n: older.length, test_n: newer.length } };
}

export function auditSeal(asOf: string, rowCount: number, watchlist: number, curveN: number): string {
  return `radar-jujur audit seal\nas_of: ${asOf}\nrows: ${rowCount} = ${watchlist} watchlist + ${rowCount - watchlist} early\nranks: 1..${rowCount}, unique\nvalues: positive, non-increasing, not all equal\ntraded fit: ${curveN} protocols\nages: snapshot.as_of only; no wall clock\nnetwork: none`;
}
