// The token radar's model, version radar-2: one snapshot of the protocol universe in, one ranked
// board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other pre-token protocol the snapshot carries that can be ranked: the early rows the radar exists
// to find. A protocol is pre-token when its index entry records no token (no market cap, no
// CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart and shown as the
// market's own values, never mixed into the ranked board. A protocol records no token, never that
// it has none: DefiLlama's record is not proof.
//
// Implied value follows only from the snapshot's own figures, through one function that scores
// every protocol the same way, with no protocol name ever special-cased:
//
//   category multiple = the FDV/TVL multiple the snapshot's own live protocols in the same
//     category trade at: the median mcap_usd / tvl_usd of the live protocols in that category,
//     shrunk toward the global median of all live protocols (four phantom observations) so a
//     category with one or two live peers does not set the price alone, then clamped to
//     [0.08, 1.20]. A category with no live peer uses the global median. The multiple is
//     recomputed from whatever snapshot the program reads, so a future snapshot re-prices
//     every row: nothing about a category is hard-coded.
//   growth     = clamp(change_7d, -50, 100) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   readiness  = how long the protocol has run with no token: 0.65 at listing, rising to 1.00
//     at two years (a protocol that has shipped, grown and still records no token is the
//     likeliest to launch next), then easing to 0.85 by five years (a protocol that has run
//     that long with no token may never launch one). Age unknown: 0.85.
//   chainMult  = 1 + 0.02 x (chains - 1), capped at 1.10: a protocol live on more chains
//     reaches more users and more snapshot sources.
//   implied    = max(1, round(tvl_usd x categoryMultiple x growthMult x readiness x chainMult))
//
// The constants are the model's, stated in the dashboard and changeable in the model sandbox.
// The dashboard recomputes every row from the same figures, so the page and board.json agree.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  shrink_k: number;
  multiple_floor: number;
  multiple_cap: number;
  readiness_base: number;
  readiness_peak_days: number;
  readiness_decay_days: number;
  readiness_decay_to: number;
  unknown_readiness: number;
  chain_step: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  shrink_k: 4,
  multiple_floor: 0.08,
  multiple_cap: 1.2,
  readiness_base: 0.65,
  readiness_peak_days: 730,
  readiness_decay_days: 1095,
  readiness_decay_to: 0.85,
  unknown_readiness: 0.85,
  chain_step: 0.02,
  chain_cap: 1.1,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    peer_median: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    readiness_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  peer_median: number;
  peer_count: number;
  growth_multiplier: number;
  readiness_multiplier: number;
  chain_multiplier: number;
  on_watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  fdv_tvl: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
  comps: Record<string, LiveRow[]>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The live market's own pricing, from this snapshot alone: for every category, the median
 * mcap_usd / tvl_usd of its live protocols, plus the global median across all live protocols.
 * A category with few live peers is shrunk toward the global median so one outlier cannot set
 * the price; the result is clamped so no category's multiple runs away.
 */
export function categoryMultiples(
  snapshot: Snapshot,
  model: ModelConstants,
): { byCategory: Map<string, { multiple: number; peerMedian: number; peerCount: number }>; global: number } {
  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  // Each live protocol's FDV/TVL ratio, winsorized at 3 so one thin-TVL outlier (a large
  // market cap on a tiny TVL) cannot set a whole category's price on its own.
  const ratios = live.map((p) => Math.min(p.mcap_usd! / p.tvl_usd, 3));
  const global = ratios.length > 0 ? median(ratios) : 0.25;
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCat.get(key) ?? [];
    list.push(Math.min(p.mcap_usd! / p.tvl_usd, 3));
    byCat.set(key, list);
  }
  const byCategory = new Map<string, { multiple: number; peerMedian: number; peerCount: number }>();
  for (const [key, list] of byCat) {
    const peerMedian = median(list);
    const shrunk = (list.length * peerMedian + model.shrink_k * global) / (list.length + model.shrink_k);
    const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk));
    byCategory.set(key, { multiple, peerMedian, peerCount: list.length });
  }
  return { byCategory, global };
}

/** How ready a protocol is to launch, from how long it has run with no token. */
export function readiness(age: number | null, model: ModelConstants): number {
  if (age === null) return model.unknown_readiness;
  if (age <= model.readiness_peak_days) {
    return model.readiness_base + (1 - model.readiness_base) * (age / model.readiness_peak_days);
  }
  const over = Math.min(age - model.readiness_peak_days, model.readiness_decay_days);
  return 1 - (1 - model.readiness_decay_to) * (over / model.readiness_decay_days);
}

/** The chain-breadth multiplier: more chains, more reach, capped. */
export function chainMultiplier(chainCount: number, model: ModelConstants): number {
  return Math.min(model.chain_cap, 1 + model.chain_step * Math.max(0, chainCount - 1));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { byCategory: Map<string, { multiple: number; peerMedian: number; peerCount: number }>; global: number },
): {
  implied: number;
  categoryMultiple: number;
  peerMedian: number;
  peerCount: number;
  growthPct: number;
  growthMult: number;
  readinessMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  // Each factor is rounded to four decimals before it is multiplied in, so the number
  // board.json carries is exactly the number the dashboard recomputes from the row's
  // own stored factors.
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const readinessMult = round4(readiness(age, model));
  const chainMult = round4(chainMultiplier(protocol.chains.length, model));
  const peer = multiples.byCategory.get(protocol.category ?? 'Other');
  const categoryMultiple = round4(peer !== undefined ? peer.multiple : Math.min(model.multiple_cap, Math.max(model.multiple_floor, multiples.global)));
  const peerMedian = peer !== undefined ? peer.peerMedian : multiples.global;
  const peerCount = peer !== undefined ? peer.peerCount : 0;
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * categoryMultiple * growthMult * readinessMult * chainMult),
  );
  return { implied, categoryMultiple, peerMedian, peerCount, growthPct, growthMult, readinessMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The watchlist's own exclusion, applied to every row the board ranks: a wrapped, staked or
 * bridged product of a token that already trades is not a token that does not exist yet, so
 * the board never ranks one as a launch to come. The watchlist itself passes this rule by
 * construction, so coverage is never at risk from it.
 */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged product of a token that already trades, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not just the biggest by TVL. The
  // board is the whole pre-token universe the snapshot carries, so a future snapshot's new
  // protocols enter it by the same rule, with no hand-kept list.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const s = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, ...s };
  });
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.categoryMultiple),
      peer_median: round4(s.peerMedian),
      peer_count: s.peerCount,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      readiness_multiplier: round4(s.readinessMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category family, in lowercase, for the action maps. */
function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'dex';
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) return 'yield';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'perps';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('stable')) return 'stable';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('insurance')) return 'insurance';
  return 'generic';
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (familyOf(p)) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
    case 'dex':
      return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
    case 'yield':
      return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
    case 'bridge':
      return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
    case 'staking':
      return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
    case 'prediction':
      return `Fund $${capital} and place one market position on ${name}.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
    case 'rwa':
      return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** A second, different qualifying action, so the farm is more than one deposit. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (familyOf(p)) {
    case 'lending':
      return `Borrow $25 of USDC against the supply on ${name}, then repay it the same week.`;
    case 'dex':
      return `Swap $25 through ${name} on ${chain} and add the output back to the pool.`;
    case 'yield':
      return `Move $25 between two ${name} vaults on ${chain} and keep both receipts.`;
    case 'bridge':
      return `Bridge $25 back through ${name} and use the returned funds in a second app on ${chain}.`;
    case 'staking':
      return `Claim the staking rewards on ${name} and restake them instead of selling.`;
    case 'perps':
      return `Close the hedge on ${name} and open a fresh one half its size.`;
    case 'prediction':
      return `Settle one market on ${name} and place a second, smaller position.`;
    case 'stable':
      return `Swap $25 of the stable asset through ${name} and hold the result.`;
    case 'rwa':
      return `Reinvest $25 of the yield the ${name} asset pays into the same asset.`;
    case 'insurance':
      return `Renew or top up the ${name} cover by $25 and keep the new policy.`;
    default:
      return `Use the position once more in ${name} on ${chain}: a swap, a vote or a second deposit of $25.`;
  }
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Two qualifying actions, a weekly cadence, a hold that spans snapshots, a points check, a
 * safety check and an exit plan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: 'about $25 of capital and $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never leave the wallet untouched for a whole month.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open the protocol's own points or rewards page once a week and check that the activity shows up; if it does not, repeat the qualifying action.`,
      cost: 'no fee to check',
      time: '10 minutes a week',
    },
    {
      text: `Before you withdraw or claim, check the link on the protocol's own page and never pay anyone to claim for you; a real claim costs only gas.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, then unwind in the reverse order: claim, withdraw the second action, then the main position.`,
      cost: 'nothing but the log',
      time: '5 minutes to log, 15 minutes to unwind',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      fdv_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 100) / 100 : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    peer_median: row.model.peer_median,
    peer_count: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    readiness_multiplier: row.model.readiness_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    on_watchlist: watchlist.has(row.slug),
  };
}

/** The live comparables for one category: its live protocols, by market cap, at most three. */
export function liveComps(snapshot: Snapshot): Record<string, LiveRow[]> {
  const byCat = new Map<string, LiveRow[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === 'CEX') continue;
    const key = p.category ?? 'Other';
    const list = byCat.get(key) ?? [];
    list.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      fdv_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 100) / 100 : null,
    });
    byCat.set(key, list);
  }
  const out: Record<string, LiveRow[]> = {};
  for (const [key, list] of byCat) {
    list.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
    out[key] = list.slice(0, 3);
  }
  return out;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const multiples = categoryMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(multiples.global),
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
    comps: liveComps(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
