# Radar Jujur

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/inikangai14-sys/token-radar-01-kang-ai/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/inikangai14-sys/token-radar-01-kang-ai/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Radar Jujur ranks pre-token protocols with a fitted value model: a size curve
from protocols whose tokens already trade, a shrunk category premium, a 7-day
momentum term, and launch odds from category-and-age peers. Every row carries
its own tight P25–P75 quartile range, launch odds, full arithmetic, nearest
traded comparables, and a costed 8-step farm plan. The dashboard shows an
out-of-fold KPI, a farm-economics panel with MULT and net-cost columns and
verdict tabs, leave-one-out and by-time validation figures, plus an audit seal.

Board: 198 rows — all 40 watchlist protocols (40/40) and 158 largest rankable
pre-token protocols below the floor. Deterministic, snapshot-only, no network.

## Run it

```sh
node main.ts
```

Reads `/input/snapshot.json`; writes `board.json`, `data.js`, `dossier.json`,
`dashboard/` and `screenshots/` into `/output`. Override paths with
`--input <file|dir>` and `--output <dir>`.

## Structure

- `main.ts` — entry point: selection, ranking, board, dossier, output.
- `lib/model.ts` — fitted curve, category shrinkage, launch odds, implied value, P25–P75.
- `lib/validate.ts` — out-of-sample validation figures and audit seal.
- `dashboard/` — static sortable/filterable page (`index.html`, `app.css`, `app.js`).
- `screenshots/` — board, detail and filtered views.
- `vendor/makefun-board.ts` — make.fun's `buildDossier`, byte for byte.

## License

MIT — see [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?ref=rw980we8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
