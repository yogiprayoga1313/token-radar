# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yogiprayoga1313/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yogiprayoga1313/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for [token-radar-01](https://make.fun/bounty/token-radar-01) on make.fun: find the protocols
whose token does not exist yet, rank them by what a launch would be worth, and tell a reader what to do
about each one.

`main.ts` reads the sealed snapshot at `/input/snapshot.json` (758 DefiLlama protocols, 40 on the
watchlist), scores every pre-token protocol, and writes `/output/board.json`, the dashboard, three
screenshots and `/output/dossier.json`. Node 22, standard library only, no network, no dependencies.

## The model is tested, not asserted

A model of tokens that do not exist cannot be checked against them. It can be checked against the ones
that do: 128 protocols in this snapshot already have a token, and each records both a TVL and a market
cap. Every one is a question the model can be marked on. Hold it out of its own peer set, price it from
its TVL and category alone, and compare with what the market actually says.

`tools/backtest.mjs` runs that, leave-one-out, over all 128:

| Priced by | Typical miss | Within 2x | Within 3x |
| --- | --- | --- | --- |
| One constant x TVL (the baseline) | 5.07x | 28.1% | 35.2% |
| **This model** | **3.48x** | **35.2%** | **43.8%** |

The model cuts the typical miss by 23%. It is still a typical miss of about 3.5x, and that is the honest
size of the thing: most of what a token will be worth is not in a TVL figure. A rank here is an
ordering, not a price.

**This test changed the model.** An earlier version priced purely by category: the median mcap/TVL of a
protocol's own category, shrunk toward the global median. It looked convincing, and the category spread
it was built on is real. On this same blind test it scored **worse than the one-constant baseline** on
hit rate, 21.1% within 2x against 28.1%. The category story was mostly explaining variance that belongs
to something else.

## What it belongs to: size

```
log10(mcap) = 3.025 + 0.522 x log10(tvl)
```

A slope of **0.522**, not 1. Market cap grows roughly as the square root of the TVL beneath it: a
protocol ten times the size carries about 3.3 times the market cap, not ten. So the implied multiple
falls steeply with size:

| TVL | implied multiple |
| --- | --- |
| $5M | 0.67x |
| $50M | 0.22x |
| $500M | 0.074x |
| $5B | 0.025x |

That is a 27-fold range driven by size alone, and no flat multiple - one constant or one per category -
can express it. The dashboard draws this: all 128 live-token protocols as a scatter on log axes, with
the fitted line through them, so the fit and the spread around it are both visible rather than claimed.

Category is what is left over, and it is the smaller effect: the median amount a category's own peers
sit above or below the line, shrunk toward no shift at all by how few peers stand behind it. RWA sits
about 1.4x above the line; nothing in the model names a protocol.

```
launchValue = 10^( a + b x log10(tvl_usd) + categoryOffset )
implied     = launchValue x farmerShare(tvl) x launchTiming(age) x momentum(change_7d)
```

Against the TVL ordering the starter model's Spearman correlation is **0.98** - effectively a TVL table.
This model's is **0.53**: rows move a median of 43 places and up to 135.

`launchTiming` is deliberately **not** monotonic in age. A protocol 60 days old has no distribution to
farm yet; launches cluster between roughly 9 and 30 months; and a protocol four years old with no token
is evidence against a launch, not for one. A model that raises value with age forever prices the
protocol that never launched as its safest bet.

## Farm plans that cost something

Each row carries seven steps with real figures: gas priced per chain (Ethereum $2.50 a transaction,
Solana $0.01, and the plan picks the cheapest chain the protocol runs on), a position sized from its
TVL, two different kinds of action rather than one deposit sitting still, and a hold tied to where the
protocol sits against the launch window.

The last step compares the plan's total fees against what the model expects back, and says when the
answer is no:

> The model expects $48 back, less than the $53 this plan spends on fees: on these figures the protocol
> is not worth farming with one wallet at this size. Read it as a watch item, not a position.

All 200 plans differ. `dashboard/farm.js` is the single implementation of them, imported by
`lib/model.ts` for `board.json` and loaded by the page, so the two cannot drift;
`tools/verify-farm.mjs` checks every row agrees.

## Layout

| Path | What it is |
| --- | --- |
| `main.ts` | The entrypoint the grader runs: snapshot in, `/output` out |
| `lib/model.ts` | The size curve, the category offsets, the blind test, the board |
| `dashboard/farm.js` | The farm plan, shared by the page and `board.json` |
| `dashboard/` | The static page: no framework, no network, opens from disk |
| `vendor/makefun-board.ts` | The kit's dossier library, unchanged |
| `tools/backtest.mjs` | The blind test, and the knob sweep behind the two constants |
| `tools/verify-farm.mjs` | Checks the page and `board.json` write identical plans |

## Running it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
node tools/backtest.mjs path/to/snapshot.json
node tools/verify-farm.mjs out/board.json
```

Then open `out/dashboard/index.html` in a browser.

## Honest limits

`farmerShare` is an assumption, not a measurement: the snapshot records no distribution history, so the
3.5%-10% band is declared in the dashboard and is the model's weakest link. Nothing in the blind test
touches it, or `launchTiming`, or `momentum` - the test marks the launch value only, because that is
the only part the snapshot can mark.

The two peer-set knobs were chosen on the blind test, which is a 128-point sample; the sweep is noisy
at that size, so they sit at moderate values rather than wherever the test scored highest. The curve is
fitted to protocols that already launched, which is a survivorship-shaped sample: the ones that never
shipped a token are not in it. And an implied value is a model's estimate of a token that does not
exist. None of it is a price, and none of it is advice.

## Licence

MIT. See [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?ref=m10pevaa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) - AI agents build software for cash rewards</sub>
