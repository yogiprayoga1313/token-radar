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

## What makes this board different from a TVL table

TVL spans four orders of magnitude in this snapshot, so **any** constant multiple of TVL reproduces the
TVL order exactly. A board built that way is a TVL table with extra columns.

This model prices each protocol against its **own category's live-token peers, read out of the same
snapshot**. 128 of the snapshot's protocols already have a token, and each one records both a market cap
and a TVL — so the market has already said what a dollar of TVL is worth in every category:

```
peerMultiple(category) = median(mcap_usd / tvl_usd) over that category's live-token protocols,
                         shrunk toward the global median by how many peers it has
```

Those medians run from **0.04x** (Liquid Staking) to **1.22x** (Cross Chain Bridge) around a 0.21x global
median — a thirty-fold spread. Two protocols of equal TVL in different categories are priced thirty times
apart, and nothing in the model names a protocol.

The whole value chain:

```
implied = tvl_usd                      the capital the protocol actually holds
        x peerMultiple(category)       what the market pays per dollar of TVL, in its category
        x farmerShare(tvl_usd)         the slice an early-user distribution hands to farmers
        x launchTiming(age_days)       how close it is to the window where tokens actually ship
        x momentum(change_7d)          whether the capital is arriving or leaving
```

Measured against the TVL ordering, the starter model's Spearman correlation is **0.98** — effectively a
TVL table. This model's is **0.79**: rows move a median of 16 places and up to 121.

`launchTiming` is deliberately **not** monotonic in age. A protocol 60 days old has no distribution to
farm yet; launches cluster between roughly 9 and 30 months; and a protocol four years old with no token
is evidence against a launch, not for one. A model that raises value with age forever prices the
protocol that never launched as its safest bet.

Where a category has too few live-token peers to quote — Risk Curators and Onchain Capital Allocator have
none between them — it borrows its **category family's** peers before falling back to the global median.
That cut the rows priced on the global fallback from 89 of 200 to 9, and every row carries a
`conviction` saying which peer set priced it.

## Farm plans that cost something

Each row carries seven steps with real figures: gas priced per chain (Ethereum $2.50 a transaction,
Solana $0.01), a position sized from the protocol's TVL, two different kinds of action rather than one
deposit sitting still, and a hold tied to where the protocol sits against the launch window.

The last step compares the plan's total fees against what the model expects back, and says when the
answer is no:

> The model expects $48 back, less than the $53 this plan spends on fees: on these figures the protocol
> is not worth farming with one wallet at this size. Read it as a watch item, not a position.

All 200 plans differ.

## Layout

| Path | What it is |
| --- | --- |
| `main.ts` | The entrypoint the grader runs: snapshot in, `/output` out |
| `lib/model.ts` | The value model: peer multiples, farmer share, launch timing, momentum |
| `dashboard/farm.js` | The farm plan, shared by the page and `board.json` so the two cannot drift |
| `dashboard/` | The static page: no framework, no network, opens from disk |
| `vendor/makefun-board.ts` | The kit's dossier library, unchanged |
| `tools/verify-farm.mjs` | Checks the page and `board.json` write identical plans for every row |

## Running it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
node tools/verify-farm.mjs out/board.json
```

Then open `out/dashboard/index.html` in a browser.

## Honest limits

`farmerShare` is an assumption, not a measurement: the snapshot records no distribution history, so the
3.5%–10% band is declared in the dashboard and is the model's weakest link. The peer multiples are
medians of small samples — some categories have three live peers, which is why thin sets are shrunk
toward the global median and marked low conviction. And an implied value is a model's estimate of a
token that does not exist. None of it is a price, and none of it is advice.

## Licence

MIT. See [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?ref=m10pevaa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
