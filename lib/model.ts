// Launch Radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// Where the house model multiplies every TVL by one flat constant, this model calibrates itself on
// the snapshot it is scoring. Protocols whose token already trades reveal what the market pays for
// a dollar of TVL in each category; a pre-token protocol is valued as if its token changed hands at
// the same market-cap-to-TVL multiple as its live peers in the same category, shrunk toward the
// market-wide median when the peer set is thin. Three further factors, all from the row's own
// record, adjust that peer value:
//
//   implied = tvl_usd x peer_multiple x momentum x maturity x breadth
//
//   peer_multiple  median mcap/TVL of the live protocols in the same category, blended with the
//                  market-wide median in log space by w = n / (n + 4), clamped to [0.02, 1.25]
//   momentum       1 + 0.25 x damped(change_7d) / 100, clamped to [0.55, 1.60]; the weekly change
//                  is damped on a log scale so one explosive week (the snapshot holds a +4,448%
//                  print) cannot carry a ranking, and an unreported change counts as neutral
//   maturity       0.65 + 0.35 x min(age_days, 1095) / 1095: a protocol that has run longer with
//                  no token has more record behind it; an unknown age counts as 365 days
//   breadth        1 + 0.02 x min(chains - 1, 10): every extra chain is another surface a launch
//                  would reach, worth a little, never a lot
//
// No protocol name is ever special-cased: the peer table is computed from the snapshot at run time,
// and the same function scores every row. The board ranks every pre-token protocol that is not a
// wrapped, staked or bridged product of a token that already trades, at every size: the watchlist
// rule's product screen without its TVL floor, because the floor is a line the house drew and the
// screen is a finding about what a protocol is. The live-token protocols are set aside with the
// market's own values, never mixed into the ranking.

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
  peer_shrink: number;
  peer_min: number;
  peer_max: number;
  momentum_weight: number;
  momentum_min: number;
  momentum_max: number;
  damp_divisor: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  peer_shrink: 4,
  peer_min: 0.02,
  peer_max: 1.25,
  momentum_weight: 0.25,
  momentum_min: 0.55,
  momentum_max: 1.6,
  damp_divisor: 25,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_extra: 10,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 40;

/** One category's live peer set: how many live protocols, and the multiple they imply. */
export interface PeerGroup {
  category: string;
  n: number;
  median: number;
  used: number;
}

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
  tier: 'watchlist' | 'early';
  age_days: number | null;
  implied_value_usd: number;
  signal: string;
  flags: string[];
  model: {
    peer_multiple: number;
    peer_sample: number;
    peer_category_median: number | null;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
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
  listed_at: string | null;
  age_days: number | null;
  tier: 'watchlist' | 'early';
  implied_value_usd: number;
  peer_multiple: number;
  peer_sample: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  signal: string;
  flags: string[];
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the peer table and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_peer_n: number;
  global_peer_median: number;
  peers: PeerGroup[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
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

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are products of another protocol's token, in the watchlist rule's own list. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
const PRODUCT_WORD = /\b(?:wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol is a wrapped, staked or bridged product of a token that already trades, by
 * the watchlist rule's own screen, read off the snapshot's fields: WBTC is Bitcoin on Ethereum and
 * Binance staked ETH is ETH in a staking product, so neither is a launch still to come, however
 * large its TVL. The board applies this screen at every size; only the watchlist's TVL floor,
 * which the rules call a floor and never a finding, is dropped.
 */
export function isProductOfLiveToken(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (PRODUCT_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Whether a protocol is one the board may rank: pre-token, and not a product of a live token. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isProductOfLiveToken(p);
}

/**
 * The peer table: for each category, the live protocols' market-cap-to-TVL ratios and the multiple
 * the model uses after shrinking the category median toward the market-wide one. Computed from the
 * snapshot itself, so the sealed set calibrates its own board.
 */
export function peerTable(snapshot: Snapshot, model: ModelConstants = MODEL): { peers: PeerGroup[]; globalN: number; globalMedian: number; byCategory: Map<string, PeerGroup> } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const globalMedian = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, PeerGroup>();
  const peers: PeerGroup[] = [];
  for (const [category, ratios] of ratiosByCategory) {
    const med = median(ratios);
    const w = ratios.length / (ratios.length + model.peer_shrink);
    // Ratios blend in log space: a multiple is a multiplicative quantity, and log blending keeps
    // one richly priced live peer (a category of one at 3.8x TVL) from carrying a whole category.
    const blended = Math.exp(w * Math.log(med) + (1 - w) * Math.log(globalMedian));
    const used = Math.min(model.peer_max, Math.max(model.peer_min, blended));
    const group: PeerGroup = { category, n: ratios.length, median: round4(med), used: round4(used) };
    byCategory.set(category, group);
    peers.push(group);
  }
  peers.sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  return { peers, globalN: all.length, globalMedian, byCategory };
}

/** The weekly change after log damping: +100% stays +100, +4,448% counts as about +322. */
export function dampedGrowth(change7d: number | null, model: ModelConstants = MODEL): number | null {
  if (change7d === null || !Number.isFinite(change7d)) return null;
  const sign = change7d < 0 ? -1 : 1;
  return sign * 100 * (Math.log(1 + Math.abs(change7d) / model.damp_divisor) / Math.log(1 + 100 / model.damp_divisor));
}

/** The four factors and the implied value one protocol gets under `model` and the peer table. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: { byCategory: Map<string, PeerGroup>; globalMedian: number },
  model: ModelConstants = MODEL,
): { implied: number; peerMult: number; peerN: number; peerMedian: number | null; momentumMult: number; maturityMult: number; breadthMult: number; age: number | null; damped: number | null } {
  const group = peers.byCategory.get(protocol.category ?? 'Uncategorised');
  const peerMult = group !== undefined ? group.used : Math.min(model.peer_max, Math.max(model.peer_min, peers.globalMedian));
  const damped = dampedGrowth(protocol.change_7d, model);
  const momentumMult = damped === null
    ? 1
    : Math.min(model.momentum_max, Math.max(model.momentum_min, 1 + (damped / 100) * model.momentum_weight));
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_extra);
  // The implied value is computed from the rounded factors, exactly as the dashboard recomputes it:
  // the number in board.json and the number the page derives from the printed factors are the same.
  const implied = Math.max(1, Math.round(protocol.tvl_usd * round4(peerMult) * round4(momentumMult) * round4(maturityMult) * round4(breadthMult)));
  return {
    implied,
    peerMult,
    peerN: group !== undefined ? group.n : 0,
    peerMedian: group !== undefined ? group.median : null,
    momentumMult,
    maturityMult,
    breadthMult,
    age,
    damped,
  };
}

/** The row's risk and data flags, each one read straight off its record. */
export function flagsFor(p: SnapshotProtocol, age: number | null, peerN: number): string[] {
  const flags: string[] = [];
  if (p.change_7d === null) flags.push('7d change unreported');
  if (p.change_7d !== null && p.change_7d <= -25) flags.push('TVL falling fast');
  if (p.change_7d !== null && p.change_7d >= 200) flags.push('one-week TVL spike');
  if (age === null) flags.push('listing date unknown');
  if (age !== null && age < 90) flags.push('under 90 days old');
  if (p.chains.length <= 1) flags.push('single chain');
  if (peerN < 4) flags.push('thin peer set');
  return flags;
}

/** A plain-language conviction grade from momentum, record length and size; shown, never ranked on. */
export function signalFor(p: SnapshotProtocol, age: number | null, damped: number | null, floorUsd: number): string {
  let score = 0;
  if (damped !== null && damped >= 15) score += 2;
  else if (damped !== null && damped >= 3) score += 1;
  else if (damped !== null && damped <= -30) score -= 2;
  else if (damped !== null && damped <= -10) score -= 1;
  if (age !== null && age >= 365) score += 1;
  else if (age !== null && age < 90) score -= 1;
  if (p.tvl_usd >= floorUsd) score += 1;
  else if (p.tvl_usd >= 10_000_000) score += 0.5;
  if (score >= 3) return 'Prime';
  if (score >= 1.5) return 'Strong';
  if (score >= 0) return 'Watch';
  return 'Fading';
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerTable(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, peers, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    token_status: 'pre-token' as const,
    tier: watch.has(s.p.slug) ? ('watchlist' as const) : ('early' as const),
    age_days: s.age,
    implied_value_usd: s.implied,
    signal: signalFor(s.p, s.age, s.damped, snapshot.floor_usd),
    flags: flagsFor(s.p, s.age, s.peerN),
    model: {
      peer_multiple: round4(s.peerMult),
      peer_sample: s.peerN,
      peer_category_median: s.peerMedian,
      momentum_multiplier: round4(s.momentumMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, snapshot.floor_usd).map(stepText),
  }));
}

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

/** A rough per-transaction gas figure for a chain, stated in the plan as an estimate. */
function gasFor(chain: string): { label: string; usd: number } {
  if (chain === 'Ethereum') return { label: 'Ethereum mainnet gas', usd: 12 };
  if (chain === 'Solana') return { label: 'Solana fees', usd: 1 };
  if (chain === 'Bitcoin') return { label: 'Bitcoin fees', usd: 6 };
  return { label: `${chain} gas`, usd: 3 };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it so both sides of the market see the wallet.`;
  if (c.includes('cdp')) return `Open a $${capital} collateral position in ${name} on ${chain} and mint a small amount of its stablecoin against it.`;
  if (c.includes('dex') || c.includes('liquidity')) return `Swap $${capital} through ${name} on ${chain} and leave half of it as liquidity in its main pool.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in one app on the far side.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('synthetic')) return `Deposit $${capital} of USDC as margin on ${name} and trade one small hedged position to build volume history.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in the wallet.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it past the next distribution date.`;
  if (c.includes('basis')) return `Put $${capital} into ${name}'s basis vault on ${chain} and keep the position through a full funding cycle.`;
  if (c.includes('index')) return `Buy $${capital} of a ${name} index on ${chain} and hold the basket token in the wallet.`;
  if (c.includes('launchpad')) return `Commit $${capital} to one ${name} sale on ${chain} and complete its participation steps.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in a liquid ${name} market.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy to expiry.`;
  if (c.includes('stable') || c.includes('yield')) return `Deposit $${capital} into ${name} on ${chain} and keep the yield-bearing position open.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}'s chain and make one native swap and one native deposit there.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name} on ${chain} and make one shielded transfer to a second wallet you control.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly qualifying action, matched to the category. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Top up or adjust the ${name} position once a week so the wallet shows continuing use, not a single visit.`;
  if (c.includes('dex') || c.includes('liquidity')) return `Make one swap and rebalance the ${name} liquidity once a week, keeping the position in range.`;
  if (c.includes('bridge')) return `Bridge a small amount through ${name} once a week, alternating direction, and keep the receipts.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Trade one small position on ${name} each week and record the volume in the farm log.`;
  return `Make one qualifying action on ${name} each week, such as a deposit, a swap, a claim or a governance vote.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age and seven-day change), never from a
 * hand-written list of names: the sizing, the second-chain step, the hold and the caution all move
 * with the data.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, floorUsd: number): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.`,
      cost: `under $${gas.usd} of ${gas.label} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas.usd} of ${gas.label}`,
      time: '15 minutes to set up',
    },
  ];
  if (p.chains.length >= 2) {
    const second = p.chains[1]!;
    const gas2 = gasFor(second);
    steps.push({
      text: `Repeat a smaller version of the same action on ${second}, ${p.name}'s second chain, so the wallet is active on more than one of its ${p.chains.length} chains.`,
      cost: `about $${Math.max(25, Math.round(capital / 2))} of capital and $${gas2.usd} of ${gas2.label}`,
      time: '10 minutes',
    });
  } else {
    steps.push({
      text: `Deepen the same ${p.name} position once, a week later, rather than opening a second protocol: repeat activity in one place reads as use, not tourism.`,
      cost: `about $${Math.max(25, Math.round(capital / 2))} more capital and $${gas.usd} of ${gas.label}`,
      time: '10 minutes',
    });
  }
  steps.push({
    text: weeklyFor(p),
    cost: `about $${Math.max(1, Math.round(gas.usd / 2))} of gas a week`,
    time: '10 minutes a week',
  });
  steps.push({
    text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot of the protocol.`,
    cost: `the $${capital} stays in the position`,
    time: `${hold} days`,
  });
  if (p.change_7d !== null && p.change_7d <= -10) {
    steps.push({
      text: `Size down and watch before adding more: ${p.name}'s TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in the last seven days, so start at half size and re-check the trend weekly.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a week',
    });
  } else if (p.change_7d !== null && p.change_7d >= 25) {
    steps.push({
      text: `Do not chase size here: ${p.name}'s TVL rose ${p.change_7d.toFixed(1)}% in seven days, so scale in over two weeks instead of entering in one transaction.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a week',
    });
  } else if (age !== null && age >= 730) {
    steps.push({
      text: `${p.name} has run ${Math.floor(age / 365)} years with no token on record: check its governance forum and points or rewards page monthly, since a launch signal usually appears there first.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a month',
    });
  } else {
    steps.push({
      text: `Open ${p.name}'s own points or rewards page before you add more, and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    });
  }
  steps.push({
    text: `Write the wallet, the dates and every transaction in a farm log, and unwind in reverse order (withdraw, unbridge, consolidate) when you are done.`,
    cost: 'nothing but the log, plus exit gas at the same rates',
    time: '5 minutes to log, 20 minutes to unwind',
  });
  return steps;
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
    listed_at: row.listed_at,
    age_days: row.age_days,
    tier: row.tier,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_sample: row.model.peer_sample,
    momentum_multiplier: row.model.momentum_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    signal: row.signal,
    flags: row.flags,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerTable(snapshot, model);
  const early = board.filter((r) => r.tier === 'early').length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_peer_n: peers.globalN,
    global_peer_median: round4(peers.globalMedian),
    peers: peers.peers,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
