# Launch Radar — a token-radar-01 entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/shutokasai1207-wq/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/shutokasai1207-wq/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's token-radar-01 bounty. `main.ts` (Node 22,
standard library only) reads the sealed DefiLlama snapshot at
`/input/snapshot.json` and writes a ranked board of pre-token protocols to
`/output/board.json`, the dashboard data to `/output/data.js`, and copies
`dashboard/` and `screenshots/` to `/output`, finishing with the `dossier.json`
the judge reads (built with the vendored `vendor/makefun-board.ts`).

## The model (radar-2)

Implied value is peer-calibrated, not a flat multiple: each pre-token protocol
is valued at the median market-cap/TVL multiple of the live protocols in its
own category in the same snapshot, shrunk toward the market-wide median when
the peer set is thin, then adjusted for log-damped seven-day momentum,
tokenless maturity and chain breadth. The board ranks every rankable pre-token
protocol (the watchlist is the floor, never the ceiling), and each row carries
a seven-step farm plan with costs and times derived from its own record.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

MIT licensed; see `LICENSE`.

---
<sub>Entered on [make.fun](https://make.fun/?ref=tbtbaqb8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
