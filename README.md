# GTA VI Trophy Rarity Forecast

[![make.fun](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/c/gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/sastrokucrit-creator/gta6-trophy-rarity-forecast-01/rank.svg)](https://make.fun/c/gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/sastrokucrit-creator/gta6-trophy-rarity-forecast-01/reward.svg)](https://make.fun/c/gta6-trophy-rarity-forecast-01)

A make.fun entry: forecast every Grand Theft Auto VI PlayStation 5 trophy's earn
rate on Exophase at 2026-11-26T00:00:00Z, as five quantiles per trophy.

## How it works

A trophy's earn rate is **earners / players-tracked**, so the program models the two
counts separately: each is a robust (Huber) log-linear fit against
`ln(1 + hours since release)` over the recent reads, with each trophy's slope shrunk
toward its tier's mean slope. The median is the ratio of the two extrapolations at
the target. The spread combines a random-walk term, the fits' residual uncertainty,
a refresh/dilution term from the tracked-population growth, and a floor — quantiles
are normal on the logit scale around the median. See [NOTES.md](NOTES.md) for the
full method, constants, verification, and honest limitations.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22, standard library only, no network, deterministic: two runs write identical
bytes. Reads every `*.in` file in the input directory and writes one `<id>.out`
per case.

## Files

- `main.ts` — the forecaster (the entrypoint).
- `NOTES.md` — method, constants, verification, limitations.
- `TOP3-STUDY.md` — what the live top entries do, and what this entry does
  differently.
