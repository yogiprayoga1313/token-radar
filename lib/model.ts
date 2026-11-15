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
  peer_shrinkage: 5,
  peer_min: 3,
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
export const MODEL_VERSION = 'radar-2-peer';

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

/** Where a quote's peers came from: its own category, its category family, or the whole snapshot. */
export type QuoteBasis = 'category' | 'family' | 'global';

/** The peer set one category was priced against. */
export interface PeerQuote {
  /** Which peer set priced it. */
  basis: QuoteBasis;
  /** The category or family the quote came from, or null for the global median. */
  category: string | null;
  /** Live-token protocols in that peer set. */
  peers: number;
  /** That peer set's own median mcap/TVL, before shrinkage; null when it had too few peers. */
  raw_multiple: number | null;
  /** The multiple actually applied, after shrinkage and bounds. */
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
  raw_multiple: number;
  multiple: number;
  pre_token_rows: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  /** Live-token protocols the multiples were actually read from (not the Live tab's shown rows). */
  peer_protocols: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  categories: CategoryQuote[];
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
  readonly globalMultiple: number;
  // Declared as plain fields: Node's strip-only TypeScript takes no parameter properties.
  private readonly byCategory = new Map<string, { peers: number; raw: number }>();
  private readonly byFamily = new Map<string, { peers: number; raw: number }>();
  private readonly model: ModelConstants;

  constructor(snapshot: Snapshot, model: ModelConstants = MODEL) {
    this.model = model;
    const peers = snapshot.protocols.filter(isQuotablePeer);
    // The global median is the fallback quote and the anchor every thin peer set is shrunk toward.
    this.globalMultiple = clamp(median(peers.map((p) => p.mcap_usd! / p.tvl_usd)) ?? 0.2, model.multiple_floor, model.multiple_cap);

    const collect = (key: (p: SnapshotProtocol) => string | null, into: Map<string, { peers: number; raw: number }>): void => {
      const groups = new Map<string, number[]>();
      for (const p of peers) {
        const k = key(p);
        if (k === null) continue;
        const list = groups.get(k);
        if (list === undefined) groups.set(k, [p.mcap_usd! / p.tvl_usd]);
        else list.push(p.mcap_usd! / p.tvl_usd);
      }
      for (const [k, ratios] of groups) {
        if (ratios.length < model.peer_min) continue;
        into.set(k, { peers: ratios.length, raw: median(ratios)! });
      }
    };
    collect((p) => p.category, this.byCategory);
    collect((p) => (p.category === null ? null : (CATEGORY_FAMILY[p.category] ?? null)), this.byFamily);
  }

  /** multiple = (n x raw + k x global) / (n + k): a thin peer set is pulled toward the global median. */
  private shrink(peers: number, raw: number): number {
    const k = this.model.peer_shrinkage;
    return round4(clamp((peers * raw + k * this.globalMultiple) / (peers + k), this.model.multiple_floor, this.model.multiple_cap));
  }

  /**
   * What one dollar of this protocol's TVL is worth as token market cap. The quote cascades: the
   * protocol's own category where the snapshot gives it enough live-token peers, else its category
   * family, else the global median. Each level is shrunk toward the global median by its peer count,
   * so a three-peer set cannot swing the board on one outlier.
   */
  quote(category: string | null): PeerQuote {
    const own = category === null ? undefined : this.byCategory.get(category);
    if (own !== undefined) {
      return { basis: 'category', category, peers: own.peers, raw_multiple: round4(own.raw), multiple: this.shrink(own.peers, own.raw) };
    }
    const familyName = category === null ? undefined : CATEGORY_FAMILY[category];
    const family = familyName === undefined ? undefined : this.byFamily.get(familyName);
    if (family !== undefined && familyName !== undefined) {
      return { basis: 'family', category: familyName, peers: family.peers, raw_multiple: round4(family.raw), multiple: this.shrink(family.peers, family.raw) };
    }
    return { basis: 'global', category: null, peers: 0, raw_multiple: null, multiple: round4(this.globalMultiple) };
  }

  /** Every peer set the model quotes, strongest multiple first. */
  quotes(): { category: string; basis: QuoteBasis; peers: number; raw: number; multiple: number }[] {
    const out: { category: string; basis: QuoteBasis; peers: number; raw: number; multiple: number }[] = [];
    for (const [category, v] of this.byCategory) out.push({ category, basis: 'category', peers: v.peers, raw: round4(v.raw), multiple: this.shrink(v.peers, v.raw) });
    for (const [family, v] of this.byFamily) out.push({ category: family, basis: 'family', peers: v.peers, raw: round4(v.raw), multiple: this.shrink(v.peers, v.raw) });
    return out.sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
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
  const quote = valuation.quote(p.category);
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
    share: round4(share),
    timing: round4(timing),
    momentumMult: round4(momentumMult),
    growthPct,
    age,
    quote,
    conviction: convictionOf(quote, age, p.change_7d),
  };
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
    raw_multiple: q.raw,
    multiple: q.multiple,
    pre_token_rows: rowsPerCategory.get(q.category) ?? 0,
  }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(valuation.globalMultiple),
    peer_protocols: snapshot.protocols.filter(isQuotablePeer).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    categories,
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
