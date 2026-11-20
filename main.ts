// Radar Jujur entry point: snapshot in, ranked board out. Node 22, stdlib only.
//
// The board is the model's own: every watchlist protocol, plus the 158 largest
// rankable pre-token protocols below the floor. Ranks come from implied value,
// never from a hand-written list. Farm plans are concrete steps with a cost and
// a time on every line. No wall clock, no network.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { auditSeal, validate } from './lib/validate.ts';
import {
  fitModel,
  impliedValue,
  isRankable,
  MODEL_VERSION,
  parseSnapshot,
  type SnapshotProtocol,
  type ValueModel,
  type Valuation,
} from './lib/model.ts';

export const EARLY_ROWS = 158;
const FARM_STEP_MIN = 20;
const FARM_STEP_MAX = 600;
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_MAX_BYTES = 524_288;
const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((value) => value.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function firstChain(protocol: SnapshotProtocol): string {
  return protocol.chains.length > 0 ? protocol.chains[0]! : 'its main chain';
}

function capitalFor(protocol: SnapshotProtocol): number {
  if (protocol.tvl_usd >= 5_000_000_000) return 500;
  if (protocol.tvl_usd >= 1_000_000_000) return 250;
  if (protocol.tvl_usd >= 100_000_000) return 150;
  if (protocol.tvl_usd >= 10_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 14;
}

function actionFor(protocol: SnapshotProtocol, capital: number, chain: string): string {
  const category = (protocol.category ?? '').toLowerCase();
  const name = protocol.name;
  if (category.includes('lend') || category.includes('cdp') || category.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open until the snapshot window ends.`;
  }
  if (category.includes('dex') || category.includes('liquidity') || category.includes('yield')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the LP receipt.`;
  }
  if (category.includes('bridge')) {
    return `Bridge $${capital} of USDC through ${name} into ${chain} and leave the funds there for the test period.`;
  }
  if (category.includes('staking') || category.includes('restak')) {
    return `Stake $${capital} of the supported staking asset through ${name} and hold the receipt until review.`;
  }
  if (category.includes('perpetual') || category.includes('derivative') || category.includes('option')) {
    return `Deposit $${capital} of USDC as margin at ${name} and open one small position you can monitor daily.`;
  }
  if (category.includes('prediction')) {
    return `Fund $${capital} at ${name} and place one market position that stays open through the test window.`;
  }
  if (category.includes('curator') || category.includes('allocator') || category.includes('vault')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares in your wallet.`;
  }
  if (category.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the position.`;
  }
  if (category.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it through the review period.`;
  }
  if (category.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} and keep the policy active through the review.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open through the review.`;
}

function costFor(protocol: SnapshotProtocol, capital: number): string {
  if (protocol.tvl_usd >= 1_000_000_000) {
    return `$${capital} of capital plus about $${Math.max(3, Math.round(capital * 0.004))} in gas and protocol fees`;
  }
  return `$${capital} of capital plus about $${Math.max(2, Math.round(capital * 0.01))} in gas and protocol fees`;
}

function timeFor(protocol: SnapshotProtocol, age: number | null): string {
  const days = holdDaysFor(age);
  if (protocol.change_7d !== null && protocol.change_7d < -15) return `${days} days, reviewed every 3 days because TVL is falling`;
  return `${days} days, with a wallet check every 7 days`;
}

function farmSteps(protocol: SnapshotProtocol, age: number | null): string[] {
  const chain = firstChain(protocol);
  const capital = capitalFor(protocol);
  const action = actionFor(protocol, capital, chain);
  const cost = costFor(protocol, capital);
  const time = timeFor(protocol, age);
  const verdict = protocol.tvl_usd >= 100_000_000 && (protocol.change_7d ?? 0) >= -10 ? 'FARM' : protocol.tvl_usd >= 10_000_000 ? 'MARGINAL' : 'SKIP';
  const steps = [
    `Open a fresh wallet with no other positions and keep its seed phrase offline; budget $${capital} of USDC for ${protocol.name}.`,
    action,
    `Track the position for ${time}; expected cost is ${cost}.`,
    `Record ${protocol.name}'s TVL on day 0, day ${Math.floor(holdDaysFor(age) / 2)} and day ${holdDaysFor(age)} and compare the change.`,
    `Exit if TVL falls more than 25% or the protocol pauses deposits; verdict at this size is ${verdict}.`,
  ];
  return steps.map((step) => {
    let text = step.trim();
    if (text.length < FARM_STEP_MIN) text = `${text} Check the protocol page before acting.`;
    if (text.length > FARM_STEP_MAX) text = `${text.slice(0, FARM_STEP_MAX - 3)}...`;
    return text;
  });
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  p25_usd: number;
  p75_usd: number;
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  cohort: string;
  launch_odds: number;
  cohort_odds: number;
  peer_launched: number;
  peer_sample: number;
  odds_basis: string;
  range_sensitivity: string;
  value_if_launches_usd: number;
  curve_value_usd: number;
  category_premium: number;
  momentum_multiplier: number;
  model_version: string;
  farm_steps: string[];
}

export function chooseProtocols(snapshot: ReturnType<typeof parseSnapshot>): SnapshotProtocol[] {
  const bySlug = new Map(snapshot.protocols.map((protocol) => [protocol.slug, protocol]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const protocol = bySlug.get(slug);
    if (protocol !== undefined && isRankable(protocol)) chosen.set(slug, protocol);
  }
  const early = snapshot.protocols
    .filter((protocol) => !chosen.has(protocol.slug) && isRankable(protocol) && protocol.tvl_usd < snapshot.floor_usd)
    .sort((left, right) => right.tvl_usd - left.tvl_usd || (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const protocol of early) chosen.set(protocol.slug, protocol);
  return [...chosen.values()];
}

export function buildBoard(snapshot: ReturnType<typeof parseSnapshot>, model: ValueModel = fitModel(snapshot)): BoardRow[] {
  const scored = chooseProtocols(snapshot).map((protocol) => {
    const valuation: Valuation = impliedValue(protocol, model, snapshot.as_of);
    return { protocol, valuation };
  });
  scored.sort((left, right) =>
    right.valuation.implied_value_usd - left.valuation.implied_value_usd ||
    (left.protocol.slug < right.protocol.slug ? -1 : left.protocol.slug > right.protocol.slug ? 1 : 0),
  );
  return scored.map(({ protocol, valuation }, index) => {
    const age = valuation.age_days;
    return {
      slug: protocol.slug,
      name: protocol.name,
      rank: index + 1,
      implied_value_usd: valuation.implied_value_usd,
      p25_usd: valuation.p25_usd,
      p75_usd: valuation.p75_usd,
      category: protocol.category,
      tvl_usd: protocol.tvl_usd,
      change_7d: protocol.change_7d,
      age_days: age,
      cohort: valuation.cohort,
      launch_odds: valuation.launch_odds,
      cohort_odds: valuation.cohort_odds,
      peer_launched: valuation.peer_launched,
      peer_sample: valuation.peer_sample,
      odds_basis: valuation.odds_basis,
      range_sensitivity: valuation.range_sensitivity,
      value_if_launches_usd: valuation.value_if_launches_usd,
      curve_value_usd: valuation.curve_value_usd,
      category_premium: valuation.category_premium,
      momentum_multiplier: valuation.momentum_multiplier,
      model_version: MODEL_VERSION,
      farm_steps: farmSteps(protocol, age),
    };
  });
}

/** Dashboard data: board rows, fitted model, validation figures and the audit seal. */
export function radarData(snapshot: ReturnType<typeof parseSnapshot>, model: ValueModel, board: BoardRow[]) {
  const traded = snapshot.protocols.filter((protocol) => protocol.mcap_usd !== null && protocol.mcap_usd > 0 && protocol.tvl_usd > 0);
  const comparables = traded
    .map((protocol) => ({ slug: protocol.slug, name: protocol.name, mcap_usd: protocol.mcap_usd!, tvl_usd: protocol.tvl_usd }))
    .sort((left, right) => right.tvl_usd - left.tvl_usd)
    .slice(0, 24);
  return {
    as_of: snapshot.as_of,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    rows: board,
    comparables,
    model: {
      curve: model.curve,
      global_odds: model.global_odds,
      global_odds_label: model.global_odds_label,
      global_odds_launched: model.global_odds_launched,
      global_odds_sample: model.global_odds_sample,
      categories: [...model.categories.values()].map((value) => ({ category: value.category, premium: value.premium, n: value.n })),
      cohorts: model.cohorts,
    },
    validation: validate(snapshot.as_of, snapshot.protocols),
    audit: { seal: auditSeal(snapshot.as_of, board.length, snapshot.watchlist.length, model.curve.n) },
  };
}

function copyDirectory(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names;
}

export function boardIssue(board: BoardRow[], snapshot: ReturnType<typeof parseSnapshot>): string | null {
  if (board.length !== snapshot.watchlist.length + EARLY_ROWS) {
    return `board has ${board.length} rows, expected ${snapshot.watchlist.length + EARLY_ROWS}`;
  }
  const slugs = new Set(board.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slug(s)`;
  if (slugs.size !== board.length) return 'board has duplicate slugs';
  const ranks = board.map((row) => row.rank);
  for (let index = 0; index < ranks.length; index += 1) if (ranks[index] !== index + 1) return `rank ${index + 1} is ${ranks[index]}`;
  for (let index = 1; index < board.length; index += 1) {
    if (board[index]!.implied_value_usd > board[index - 1]!.implied_value_usd) return `row ${index + 1} outranks row ${index} on implied value`;
  }
  if (new Set(board.map((row) => row.implied_value_usd)).size < 2) return 'every row has the same implied value';
  for (const row of board) {
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has an invalid implied value`;
    if (row.p25_usd > row.implied_value_usd || row.implied_value_usd > row.p75_usd) return `${row.slug} has an invalid P25-P75 range`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.trim().length < FARM_STEP_MIN || step.trim().length > FARM_STEP_MAX) return `${row.slug} has a farm step of ${step.trim().length} characters`;
    }
  }
  return null;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`radar jujur: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const outputArg = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const model = fitModel(snapshot);
const board = buildBoard(snapshot, model);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`radar jujur: board failed its own check: ${issue}\n`);
  process.exit(1);
}
mkdirSync(outputArg, { recursive: true });
writeFileSync(join(outputArg, 'board.json'), `${JSON.stringify({ as_of: snapshot.as_of, model_version: MODEL_VERSION, rows: board }, null, 2)}\n`);
writeFileSync(join(outputArg, 'data.js'), `window.RADAR=${JSON.stringify(radarData(snapshot, model, board))};\n`);
const dashboardFiles = copyDirectory(join(here, 'dashboard'), join(outputArg, 'dashboard'));
const shotFiles = copyDirectory(join(here, 'screenshots'), join(outputArg, 'screenshots'));
if (shotFiles.length !== 3) {
  process.stderr.write(`radar jujur: screenshots/ holds ${shotFiles.length} images, expected 3\n`);
  process.exit(1);
}
for (const name of shotFiles) {
  if (statSync(join(outputArg, 'screenshots', name)).size > SCREENSHOT_MAX_BYTES) {
    process.stderr.write(`radar jujur: screenshot ${name} is over the byte cap\n`);
    process.exit(1);
  }
}
writeFileSync(join(outputArg, 'dossier.json'), buildDossier(outputArg, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: 3, max_bytes: SCREENSHOT_MAX_BYTES },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
}));
process.stdout.write(`radar jujur: wrote ${board.length} rows, ${dashboardFiles.length} dashboard files, ${shotFiles.length} screenshots and dossier.json to ${outputArg}\n`);
