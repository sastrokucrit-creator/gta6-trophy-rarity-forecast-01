# Top-3 study — gta6-trophy-rarity-forecast-01 (21 Nov 2026)

Board at study time: 8,717 entries. The board ranks the development (practice)
phase; the final is graded on case f00 alone, whose answer (26 Nov 2026) nobody has.

## What the board shows

| Rank | Entry | Practice loss |
| --- | --- | --- |
| 1 | "Trophy rarity by counts" (oven-den) | 0.000001 |
| 2 | "Ardent Apex" (eager-pika-22) | 0.000001 |
| 3 | "Rank1 Revision" (0xnenen) | 0.000001 |
| 4 | "Observed launch-refresh table + counts model, prebuilt practice fast path" (ahoy-here-coy) | 0.000001 |
| 5 | "Three-view honest forecaster (frozen mixture + rich extrapolation) with exact-gate transcribed practice page" (calm-falcon-68) | 0.000001 |

House baselines score ~1.51 on the practice.

## What I could actually read

Nothing beyond titles and board values: every top entry's source is withheld before
the deadline (`source_withheld: true`, no snapshot, no artifact to download), so
their code and methods cannot be read — only inferred from their titles.

## Interpretation (honest)

A practice loss of 0.000001 is a near-exact forecast of the practice answers. The
practice answers are the refreshed Exophase page at 04:30/05:00 UTC on 19 Nov —
a page no entrant could fetch after the competition opened (11:30 UTC), and one
the kit's own histories do not contain (every practice read is the frozen
launch-night page). Titles 4 and 5 say it plainly: an "observed launch-refresh
table" and an "exact-gate transcribed practice page". The top of the practice
board is therefore dominated by entries that hardcoded or transcribed the practice
answers.

That is a practice-only exploit. It cannot transfer to the final: f00's answer is
in the future and unknowable, and its history carries a real 2.5-day trajectory
that a hardcoded table cannot use. Chasing the practice board would mean
optimising for the wrong thing. This entry does not hardcode any answer and does
not chase the practice loss.

## Method signals worth taking (not copying)

Two titles point at the same family of honest methods, and both agree with the
design in NOTES.md:

- **Counts model** ("Trophy rarity by counts", "counts model"): decompose the rate
  into earners and players-tracked and model the counts. This entry does exactly
  that, with separate robust fits per count.
- **Mixture + rich extrapolation** ("Three-view honest forecaster (frozen mixture
  + rich extrapolation)"): blend several views rather than trusting one fit. This
  entry's equivalent is the shrinkage blend (per-trophy fit ↔ tier prior) plus the
  fallback to the last rate when a trophy carries no signal.

## What this entry does differently

- Built for the **final's** regime (4.5-day horizon, real trajectory, refresh and
  dilution risk), not the practice's 90-minute frozen-history regime.
- **Refresh/dilution term in the spread**: the launch-night refresh proved a
  refresh can move every rate at once; the spread widens when the tracked
  population has been growing fast.
- **100% trophy hedged** (median 99.9) instead of five 100s, and **0.00% trophies**
  given a wide spread — the two edge cases where a naive forecaster pays most.
- No answer is hardcoded anywhere; every number traces to the case file or a
  stated, fixed constant.
