// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds pre-token
// protocols below the floor: the early rows the radar exists to find. A protocol is pre-token when its
// entry records no token at all (no market cap, no CoinGecko id, no symbol); protocols whose token already
// trades are kept apart and shown at the market's own valuation, never mixed into the ranked board.
//
// WHAT THE VALUE MODEL DOES DIFFERENTLY
//
// A board whose value is `TVL x a constant` is a TVL table with extra columns: TVL spans four orders of
// magnitude here, so any constant multiple reproduces the TVL order exactly. This model prices each
// protocol against its OWN CATEGORY's live-token peers, read out of the same snapshot:
//
//   peerMultiple(category) = median(mcap_usd / tvl_usd) over the snapshot's live-token protocols in that
//                            category, shrunk toward the global median by peer count.
//
// In this snapshot those medians run from 0.04x (Liquid Staking) to 1.22x (Cross Chain Bridge), a 30-fold
// spread around a 0.214x global median, so a Bridge and a Liquid Staking protocol of equal TVL are priced
// thirty times apart. Nothing is hardcoded per protocol: the multiples are computed from the file.
//
//   impliedValue = tvl_usd                        the capital the protocol actually holds
//                x peerMultiple(category)         what the market pays per dollar of TVL, in its category
//                x farmerShare(tvl_usd)           the slice an early-user distribution hands to farmers
//                x launchTiming(ageDays)          how close it is to the window where tokens actually ship
//                x momentum(change_7d)            whether the capital is arriving or leaving
//
// The last three are stated, bounded and the same function for every row. launchTiming is deliberately NOT
// monotonic in age: a 60-day-old protocol is too young to ship, the 9-to-30-month band is where launches
// cluster, and a protocol four years old with no token has told you something. The starter's model ramps
// value up with age forever, which prices a 2021 protocol that never launched as its safest bet.
//
// Every constant below is declared in the dashboard beside the number it moves.

// The farm plan lives in dashboard/farm.js, one classic script the page loads over file:// and this
// module imports, so the plan board.json carries and the plan the dashboard draws are the same bytes
// rather than two implementations that drift. tools/verify-farm.mjs checks that every row agrees.
import farm from '../dashboard/farm.js';

/** What dashboard/farm.js needs to write a plan: a snapshot protocol plus what the model made of it. */
export interface FarmInput {
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  age_days: number | null;
  per_farmer_usd: number;
}

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** Live peers a category needs before its own median outweighs the global one (shrinkage strength). */
  peer_shrinkage: number;
  /** Live peers a category needs before it is quoted at all. */
  peer_min: number;
  /** Hard bounds on any peer multiple, so one thin category cannot run away with the board. */
  multiple_floor: number;
  multiple_cap: number;
  /** The farmer slice at the small end and the large end of the size range. */
  share_small: number;
  share_large: number;
  /** The TVL range, in dollars, over which the farmer slice falls from share_small to share_large. */
  share_tvl_small: number;
  share_tvl_large: number;
  /** launchTiming: the ramp, the plateau and the decay, in days since listing. */
  timing_cold: number;
  timing_open: number;
  timing_close: number;
  timing_stale: number;
  timing_min: number;
  timing_tail: number;
  /** momentum: the 7-day change is clamped here, then softened through tanh at this scale and weight. */
  growth_floor: number;
  growth_cap: number;
  growth_scale: number;
  growth_weight: number;
  /** The age assumed for a protocol whose listing date the snapshot does not carry. */
  unknown_age_days: number;
  /** One farmer's assumed position, used only to turn a pool into a per-farmer expectation. */
  farmer_position_usd: number;
  /** The fewest farmers any distribution is split between. */
  farmers_floor: number;
}

export const MODEL: ModelConstants = {
  // Both chosen on the blind test (tools/backtest.mjs sweeps them), not by taste. The sweep is noisy
  // at 128 points, so these are moderate values rather than whichever pair scored highest: the knobs
  // sit where the curve is already doing the work, not tuned to the last decimal of a small sample.
  peer_shrinkage: 3,
  peer_min: 4,
  multiple_floor: 0.02,
  multiple_cap: 3,
  share_small: 0.1,
  share_large: 0.035,
  share_tvl_small: 1_000_000,
  share_tvl_large: 10_000_000_000,
  timing_cold: 120,
  timing_open: 270,
  timing_close: 900,
  timing_stale: 1800,
  timing_min: 0.3,
  timing_tail: 0.4,
  growth_floor: -80,
  growth_cap: 200,
  growth_scale: 40,
  growth_weight: 0.35,
  unknown_age_days: 365,
  farmer_position_usd: 8_000,
  farmers_floor: 500,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3-curve';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** How much of the model's input this row actually had. */
export type Conviction = 'high' | 'medium' | 'low';

/** Where a quote's offset came from: its own category, its category family, or nowhere. */
export type QuoteBasis = 'category' | 'family' | 'global';

/**
 * The size curve, fitted to the snapshot's live-token protocols: log10(mcap) = a + b x log10(tvl).
 *
 * `b` is the whole point. Fitted on this snapshot it comes out near 0.5, so a token's market cap grows
 * roughly as the square root of the TVL beneath it: a protocol ten times the size carries about three
 * times the market cap, not ten. The implied multiple therefore falls steeply with size, from about
 * 0.67x at $5M of TVL to 0.025x at $5B. A flat multiple, whether one constant or one per category,
 * cannot express that, and the blind test below says so plainly.
 */
export interface Curve {
  a: number;
  b: number;
  /** Live-token protocols the fit was made on. */
  points: number;
}

/** What one protocol is priced at, and where each part of that price came from. */
export interface PeerQuote {
  /** Which peer set supplied the category offset. */
  basis: QuoteBasis;
  /** The category or family the offset came from, or null when none did. */
  category: string | null;
  /** Live-token protocols in that peer set. */
  peers: number;
  /** The category's shift off the curve, in log10: +0.3 is a category worth twice the curve's call. */
  offset: number;
  /** What the curve and the offset imply for one dollar of this protocol's TVL, at this size. */
  multiple: number;
}

/**
 * The category families, so a category the snapshot gives no live peers for borrows from its relatives
 * before it falls back to the global median. Risk Curators and Onchain Capital Allocator have no live
 * token between them in this snapshot, but Yield Aggregator and Indexes do, and all four are the same
 * business: someone else's capital, managed for a fee.
 *
 * This is a taxonomy of DeFi categories, not a list of protocols: no protocol is named anywhere in it,
 * and a category the table does not carry simply falls through to the global median.
 */
export const CATEGORY_FAMILY: Record<string, string> = {
  // Someone else's capital, managed for a fee.
  'Risk Curators': 'Asset management',
  'Onchain Capital Allocator': 'Asset management',
  'Liquidity Manager': 'Asset management',
  'Yield Aggregator': 'Asset management',
  Yield: 'Asset management',
  Farm: 'Asset management',
  'Leveraged Farming': 'Asset management',
  Indexes: 'Asset management',
  // A deposit that earns the chain's own yield.
  'Liquid Staking': 'Staking',
  'Staking Pool': 'Staking',
  Restaking: 'Staking',
  'Liquid Restaking': 'Staking',
  'Restaked BTC': 'Staking',
  'Anchor BTC': 'Staking',
  'Decentralized BTC': 'Staking',
  // Credit against collateral.
  Lending: 'Credit',
  CDP: 'Credit',
  'Collateral Markets': 'Credit',
  'Uncollateralized Lending': 'Credit',
  'NFT Lending': 'Credit',
  // Someone takes the other side.
  Dexs: 'Trading',
  Derivatives: 'Trading',
  Perpetuals: 'Trading',
  'Basis Trading': 'Trading',
  'Prediction Market': 'Trading',
  Options: 'Trading',
  // Value moved between chains.
  Bridge: 'Bridging',
  'Canonical Bridge': 'Bridging',
  'Cross Chain Bridge': 'Bridging',
  // A claim on something off-chain, or a peg.
  RWA: 'Stable and real-world',
  'Stablecoin Wrapper': 'Stable and real-world',
  'Dual-Token Stablecoin': 'Stable and real-world',
  'Algo-Stables': 'Stable and real-world',
  CeDeFi: 'Stable and real-world',
};

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
  /** The implied pool split between the farmers the model assumes, in whole dollars. */
  per_farmer_usd: number;
  conviction: Conviction;
  model: {
    peer_multiple: number;
    peer_basis: QuoteBasis;
    peer_category: string | null;
    peer_count: number;
    peer_offset: number;
    curve_value_usd: number;
    expected_fdv_usd: number;
    farmer_share: number;
    timing_multiplier: number;
    momentum_multiplier: number;
    growth_pct: number;
    age_days: number | null;
    estimated_farmers: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
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
  per_farmer_usd: number;
  conviction: Conviction;
  peer_multiple: number;
  peer_basis: QuoteBasis;
  peer_category: string | null;
  peer_count: number;
  peer_offset: number;
  curve_value_usd: number;
  expected_fdv_usd: number;
  farmer_share: number;
  timing_multiplier: number;
  momentum_multiplier: number;
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
  /** Its own mcap/TVL: the observation every pre-token row in this category is priced from. */
  multiple: number | null;
}

/** One category's quote, for the dashboard's model panel. */
export interface CategoryQuote {
  category: string;
  basis: QuoteBasis;
  peers: number;
  /** Its shift off the curve in log10, and that shift as a plain factor (1.4 = worth 40% more). */
  offset: number;
  factor: number;
  pre_token_rows: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  /** The size curve every price starts from, and how it did on the blind test. */
  curve: Curve;
  holdout: Holdout;
  global_multiple: number;
  /** Live-token protocols the multiples were actually read from (not the Live tab's shown rows). */
  peer_protocols: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  categories: CategoryQuote[];
  /** Every live-token protocol as one point, so the page can draw the fit it was made from. */
  peer_points: { tvl: number; mcap: number }[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Least squares through the live-token protocols in log-log: log10(mcap) = a + b x log10(tvl).
 *
 * Logs, not raw dollars, because both run over four orders of magnitude here and a handful of large
 * protocols would otherwise decide the line on their own.
 */
export function fitCurve(peers: SnapshotProtocol[]): Curve {
  const pts = peers
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd!) }));
  if (pts.length < 3) return { a: Math.log10(0.2), b: 1, points: pts.length };
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) * (p.x - mx);
  }
  if (sxx === 0) return { a: Math.log10(0.2), b: 1, points: n };
  const b = sxy / sxx;
  return { a: round4(my - b * mx), b: round4(b), points: n };
}

/** The median of a non-empty list; null when it is empty. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol's token trades and carries a market the model can read a multiple from. */
function isQuotablePeer(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The valuation context: what the snapshot's own live-token protocols say a dollar of TVL is worth, in
 * each category and overall. Built once per run and shared by every row.
 */
export class Valuation {
  readonly curve: Curve;
  /** The median mcap/TVL of every live-token protocol: the flat multiple the curve replaced. */
  readonly globalMultiple: number;
  // Declared as plain fields: Node's strip-only TypeScript takes no parameter properties.
  private readonly byCategory = new Map<string, { peers: number; offset: number }>();
  private readonly byFamily = new Map<string, { peers: number; offset: number }>();
  private readonly model: ModelConstants;

  /**
   * `excludeSlug` holds one protocol out of the peer set, so the model can be asked what it would have
   * said about a protocol it had never seen. That is the whole of the blind test below: nothing else
   * about the quote changes.
   */
  constructor(snapshot: Snapshot, model: ModelConstants = MODEL, excludeSlug: string | null = null) {
    this.model = model;
    const peers = snapshot.protocols.filter((p) => isQuotablePeer(p) && p.slug !== excludeSlug);
    this.globalMultiple = round4(clamp(median(peers.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0.2, model.multiple_floor, model.multiple_cap));

    // Fit the size curve first: everything else is measured as a shift off it.
    this.curve = fitCurve(peers);

    // A category's offset is the median of its peers' residuals, how far above or below the curve
    // they sit, shrunk toward zero by peer count so a thin set cannot swing the board on one outlier.
    const residual = (p: SnapshotProtocol): number => Math.log10(p.mcap_usd!) - (this.curve.a + this.curve.b * Math.log10(p.tvl_usd));
    const collect = (key: (p: SnapshotProtocol) => string | null, into: Map<string, { peers: number; offset: number }>): void => {
      const groups = new Map<string, number[]>();
      for (const p of peers) {
        const k = key(p);
        if (k === null) continue;
        const list = groups.get(k);
        if (list === undefined) groups.set(k, [residual(p)]);
        else list.push(residual(p));
      }
      for (const [k, rs] of groups) {
        if (rs.length < model.peer_min) continue;
        into.set(k, { peers: rs.length, offset: (rs.length * median(rs)!) / (rs.length + model.peer_shrinkage) });
      }
    };
    collect((p) => p.category, this.byCategory);
    collect((p) => (p.category === null ? null : (CATEGORY_FAMILY[p.category] ?? null)), this.byFamily);
  }

  /** What the curve alone says a protocol of this size is worth, before any category offset. */
  curveValue(tvl: number): number {
    return Math.pow(10, this.curve.a + this.curve.b * Math.log10(Math.max(tvl, 1)));
  }

  /**
   * What this protocol's unlaunched token is worth: the size curve, shifted by what its category's
   * live-token peers are worth above or below that curve. The offset cascades from the protocol's own
   * category to its family to nothing, and is shrunk toward zero by how few peers stand behind it.
   */
  quote(category: string | null, tvl: number): PeerQuote {
    const own = category === null ? undefined : this.byCategory.get(category);
    const familyName = category === null ? undefined : CATEGORY_FAMILY[category];
    const family = familyName === undefined ? undefined : this.byFamily.get(familyName);

    let basis: QuoteBasis = 'global';
    let name: string | null = null;
    let peers = 0;
    let offset = 0;
    if (own !== undefined) { basis = 'category'; name = category; peers = own.peers; offset = own.offset; }
    else if (family !== undefined && familyName !== undefined) { basis = 'family'; name = familyName; peers = family.peers; offset = family.offset; }

    const value = this.curveValue(tvl) * Math.pow(10, offset);
    const multiple = clamp(tvl > 0 ? value / tvl : this.globalMultiple, this.model.multiple_floor, this.model.multiple_cap);
    return { basis, category: name, peers, offset: round4(offset), multiple: round4(multiple) };
  }

  /** Every peer set the model carries an offset for, dearest first. */
  quotes(): { category: string; basis: QuoteBasis; peers: number; offset: number; factor: number }[] {
    const out: { category: string; basis: QuoteBasis; peers: number; offset: number; factor: number }[] = [];
    const add = (category: string, basis: QuoteBasis, v: { peers: number; offset: number }): void => {
      out.push({ category, basis, peers: v.peers, offset: round4(v.offset), factor: round4(Math.pow(10, v.offset)) });
    };
    for (const [category, v] of this.byCategory) add(category, 'category', v);
    for (const [family, v] of this.byFamily) add(family, 'family', v);
    return out.sort((a, b) => b.factor - a.factor || (a.category < b.category ? -1 : 1));
  }
}

/**
 * The farmer's slice of a launch, by size. A $2M protocol distributing to early users hands a far larger
 * share of supply to them than a $5B one, whose distribution is spread over far more claimants and far
 * more of whose supply is already committed. Interpolated on a log scale between the two declared ends.
 */
export function farmerShare(tvl: number, model: ModelConstants = MODEL): number {
  const lo = Math.log10(Math.max(model.share_tvl_small, 1));
  const hi = Math.log10(Math.max(model.share_tvl_large, model.share_tvl_small * 10));
  const t = clamp((Math.log10(Math.max(tvl, 1)) - lo) / (hi - lo), 0, 1);
  return model.share_small + (model.share_large - model.share_small) * t;
}

/**
 * How close a protocol is to the window where tokens actually ship, from its days since listing.
 *
 * Not monotonic, and that is the point. Below `timing_cold` a protocol is too young to have a
 * distribution to farm; it ramps to full weight by `timing_open`, holds the plateau to `timing_close`,
 * then decays toward `timing_tail` by `timing_stale`: a protocol that has run four years without a token
 * is evidence against a launch, not for one.
 */
export function launchTiming(age: number | null, model: ModelConstants = MODEL): number {
  const d = age ?? model.unknown_age_days;
  if (d <= 0) return model.timing_min;
  if (d < model.timing_cold) {
    return model.timing_min + (1 - model.timing_min) * (d / model.timing_cold) * 0.6;
  }
  if (d < model.timing_open) {
    const t = (d - model.timing_cold) / (model.timing_open - model.timing_cold);
    const start = model.timing_min + (1 - model.timing_min) * 0.6;
    return start + (1 - start) * t;
  }
  if (d <= model.timing_close) return 1;
  if (d >= model.timing_stale) return model.timing_tail;
  const t = (d - model.timing_close) / (model.timing_stale - model.timing_close);
  return 1 - (1 - model.timing_tail) * t;
}

/**
 * Whether the capital is arriving or leaving, from the 7-day TVL change. Softened through tanh so a
 * single violent week cannot dominate the board: a +40% week and a +400% week differ, but not tenfold.
 */
export function momentum(change7d: number | null, model: ModelConstants = MODEL): { multiplier: number; growthPct: number } {
  const growthPct = clamp(finite(change7d, 0), model.growth_floor, model.growth_cap);
  return { multiplier: 1 + Math.tanh(growthPct / model.growth_scale) * model.growth_weight, growthPct };
}

/**
 * How much of the model's input this row actually had: a quote from the protocol's own category with a
 * deep peer set and both time series is a high-conviction row; one priced off the global median is not.
 */
function convictionOf(quote: PeerQuote, age: number | null, change7d: number | null): Conviction {
  if (quote.basis === 'global') return 'low';
  if (quote.basis === 'category' && quote.peers >= 8 && age !== null && change7d !== null) return 'high';
  if (age !== null && change7d !== null) return 'medium';
  return 'low';
}

/** Everything the model says about one protocol. */
export interface Scored {
  implied: number;
  perFarmer: number;
  farmers: number;
  fdv: number;
  /** What the size curve alone said, before the category offset moved it. */
  curveValue: number;
  share: number;
  timing: number;
  momentumMult: number;
  growthPct: number;
  age: number | null;
  quote: PeerQuote;
  conviction: Conviction;
}

/** The implied value of one protocol's unlaunched token, and every factor behind it. */
export function score(p: SnapshotProtocol, asOf: string, valuation: Valuation, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, p.listed_at);
  const quote = valuation.quote(p.category, p.tvl_usd);
  const fdv = p.tvl_usd * quote.multiple;
  const share = farmerShare(p.tvl_usd, model);
  const timing = launchTiming(age, model);
  const { multiplier: momentumMult, growthPct } = momentum(p.change_7d, model);
  const implied = Math.max(1, Math.round(fdv * share * timing * momentumMult));
  const farmers = Math.max(model.farmers_floor, Math.round(p.tvl_usd / model.farmer_position_usd));
  return {
    implied,
    perFarmer: Math.max(1, Math.round(implied / farmers)),
    farmers,
    fdv: Math.round(fdv),
    curveValue: Math.round(valuation.curveValue(p.tvl_usd)),
    share: round4(share),
    timing: round4(timing),
    momentumMult: round4(momentumMult),
    growthPct,
    age,
    quote,
    conviction: convictionOf(quote, age, p.change_7d),
  };
}

/** How one way of pricing did against the protocols whose market the snapshot already records. */
export interface HoldoutScore {
  /** The middle protocol's error, as a ratio: 1.8 means the typical miss was 1.8x out, either way. */
  median_ratio: number;
  /** How often the prediction landed inside a factor of two, and of three, in per cent. */
  within_2x: number;
  within_3x: number;
}

/** The blind test's whole result. */
export interface Holdout {
  /** Live-token protocols the test ran on. */
  tested: number;
  /** This model, each protocol priced by peers that never included it. */
  model: HoldoutScore;
  /** One constant times TVL, the global median: what a board with no category model would say. */
  baseline: HoldoutScore;
  /** How much of the baseline's typical error the category model removes, in per cent. */
  error_cut_pct: number;
}

/**
 * The blind test. Every protocol in the snapshot whose token already trades has a market cap the model
 * never sees, so each one is a question the model can be marked on: hide it from the peer set, ask what
 * its token would be worth from its TVL alone, and compare that with what the market actually says.
 *
 * Errors are measured as a ratio, not a difference, because these values span four orders of magnitude:
 * predicting $40M against a real $20M and predicting $20M against a real $40M are both a factor of two
 * out, and both should count the same. The baseline is one constant times TVL, which is what a board
 * with no category model can do, and the test is whether reading the category is worth anything at all.
 */
export function validate(snapshot: Snapshot, model: ModelConstants = MODEL): Holdout {
  const peers = snapshot.protocols.filter(isQuotablePeer);
  const modelErrors: number[] = [];
  const baselineErrors: number[] = [];

  for (const p of peers) {
    const blind = new Valuation(snapshot, model, p.slug);
    const actual = p.mcap_usd!;
    if (!(actual > 0) || !(p.tvl_usd > 0)) continue;
    modelErrors.push(Math.abs(Math.log10((p.tvl_usd * blind.quote(p.category, p.tvl_usd).multiple) / actual)));
    baselineErrors.push(Math.abs(Math.log10((p.tvl_usd * blind.globalMultiple) / actual)));
  }

  const score = (errors: number[]): HoldoutScore => {
    const mid = median(errors) ?? 0;
    const share = (limit: number): number => Math.round((errors.filter((e) => e <= Math.log10(limit)).length / errors.length) * 1000) / 10;
    return { median_ratio: Math.round(Math.pow(10, mid) * 100) / 100, within_2x: share(2), within_3x: share(3) };
  };

  const m = score(modelErrors);
  const b = score(baselineErrors);
  const mid = (errors: number[]): number => median(errors) ?? 0;
  const cut = mid(baselineErrors) === 0 ? 0 : (1 - mid(modelErrors) / mid(baselineErrors)) * 100;
  return { tested: modelErrors.length, model: m, baseline: b, error_cut_pct: Math.round(cut * 10) / 10 };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, valuation = new Valuation(snapshot, model)): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, so the gate's coverage row is never gambled on.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: score(p, snapshot.as_of, valuation, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    per_farmer_usd: s.perFarmer,
    conviction: s.conviction,
    model: {
      peer_multiple: s.quote.multiple,
      peer_basis: s.quote.basis,
      peer_category: s.quote.category,
      peer_count: s.quote.peers,
      peer_offset: s.quote.offset,
      curve_value_usd: s.curveValue,
      expected_fdv_usd: s.fdv,
      farmer_share: s.share,
      timing_multiplier: s.timing,
      momentum_multiplier: s.momentumMult,
      growth_pct: s.growthPct,
      age_days: s.age,
      estimated_farmers: s.farmers,
    },
    farm_steps: farmPlan({ name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, age_days: s.age, per_farmer_usd: s.perFarmer }),
  }));
}

/** One protocol's farm plan, from dashboard/farm.js: seven steps, each with its cost and its time. */
export function farmPlan(input: FarmInput): string[] {
  return (farm as { plan: (row: FarmInput) => string[] }).plan(input);
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
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
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
    per_farmer_usd: row.per_farmer_usd,
    conviction: row.conviction,
    peer_multiple: row.model.peer_multiple,
    peer_basis: row.model.peer_basis,
    peer_category: row.model.peer_category,
    peer_count: row.model.peer_count,
    peer_offset: row.model.peer_offset,
    curve_value_usd: row.model.curve_value_usd,
    expected_fdv_usd: row.model.expected_fdv_usd,
    farmer_share: row.model.farmer_share,
    timing_multiplier: row.model.timing_multiplier,
    momentum_multiplier: row.model.momentum_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const valuation = new Valuation(snapshot, model);
  const board = buildBoard(snapshot, model, valuation);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;

  const rowsPerCategory = new Map<string, number>();
  for (const r of board) {
    if (r.model.peer_category === null) continue;
    rowsPerCategory.set(r.model.peer_category, (rowsPerCategory.get(r.model.peer_category) ?? 0) + 1);
  }
  const categories: CategoryQuote[] = valuation.quotes().map((q) => ({
    category: q.category,
    basis: q.basis,
    peers: q.peers,
    offset: q.offset,
    factor: q.factor,
    pre_token_rows: rowsPerCategory.get(q.category) ?? 0,
  }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    curve: valuation.curve,
    holdout: validate(snapshot, model),
    global_multiple: round4(valuation.globalMultiple),
    peer_protocols: snapshot.protocols.filter(isQuotablePeer).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    categories,
    peer_points: snapshot.protocols
      .filter(isQuotablePeer)
      .map((p) => ({ tvl: p.tvl_usd, mcap: p.mcap_usd! }))
      .sort((a, b) => a.tvl - b.tvl),
    rows: board.map(radarRow),
    live,
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
