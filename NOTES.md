# gta6-trophy-rarity-forecast-01 — method notes

Entry by sastrokucrit-creator. Program: `main.ts` (Node 22, stdlib only, no network,
no randomness, deterministic — two runs write identical bytes). The entrypoint is
written from scratch for this entry (the kit starter was removed, not used).

## The problem

Forecast every GTA VI PS5 trophy's Exophase earn rate at 2026-11-26T00:00:00Z, as five
quantiles (0.05, 0.25, 0.5, 0.75, 0.95) per trophy. Scored by mean pinball loss on the
logit scale (both the forecast and the answer are clamped to [0.01, 99.99] before the
logit). The final case (f00) is cut at the deadline 2026-11-21T11:30:00Z and its
history holds ~2.5 days of reads (every 30 min, then every 10 min) with real trajectory.
The practice cases (p00/p01) hold only the unchanged launch-night page (638 players,
all rates frozen) — they check format and validity, not forecasting skill.

## Method: earners / tracked decomposition

A rate is `earners / players-tracked`. We model the two counts separately:

- **Tracked players N(t):** one robust (Huber) log-linear fit of `log N` against
  `x = ln(1 + hours since release 2026-11-19T00:00:00Z)`, over the recent window
  (last 48 h of reads, or all reads if fewer). Reads are weighted by N, so the
  large, reliable recent reads dominate. Slope clamped to [0, 2]; the forecast N is
  never below the last observed N.
- **Earners E_i(t) per trophy:** `E = rate/100 * N`, floored at a tenth of an earner
  (so a 0.00% rate keeps a finite logarithm). Robust log-linear fit of `log E_i`
  against the same x, same weights. A trophy with fewer than 3 usable points gets
  no fit.
- **Shrinkage:** each trophy's slope is shrunk toward its tier's mean slope
  (platinum/gold/silver/bronze, empirical-Bayes from the trophies that fitted),
  weight `nEff / (nEff + 8)` where nEff counts the reads where the trophy actually
  has earners (rate > 0) — a 0.00% read carries no slope information, its log-earner
  value being only the floor. Slopes are clamped to [-0.2, 3]. A tier with no usable
  fit falls back to a fixed difficulty prior (platinum 0.15, gold 0.5, silver 0.8,
  bronze 1.2), so a unique trophy (the platinum is alone in its tier) never borrows
  the global mean, which is dominated by bronze. The line is re-anchored at the
  trophy's own data centroid (or its last read), so a shrunk slope cannot drift the
  level away from the recent data. Predicted earners are clamped to
  [0.9 * last earners, N(target)].
- **Median:** `100 * E_hat / N_hat`, clamped to [0.01, 99.99] — the 0.01 floor
  matches the scorer's clamp, so the median that is written is the median that is
  scored.

Why split the counts instead of fitting the rate directly (the house curve fits
logit(rate) vs ln(1+h))? The two counts move for different reasons: earners grow as
players play, while the tracked population jumps when Exophase refreshes its counts —
and a refresh can push a rate DOWN even while earners rise (the launch-night refresh
did exactly that: 638 → 3,868 players, every rate but the 100% one fell). Separate
slopes let the rate fall when N outgrows E, and let the noisy rare-trophy fits borrow
strength from their tier instead of chasing quantization noise.

## Spread (logit standard deviation)

Components added in quadrature, capped at 2.0:

- random walk `0.5 * sqrt(horizon in days)` (the house baseline's term);
- fit residual sd of the log-earners fit, inflated by extrapolation leverage
  (capped), plus the same for the N fit;
- refresh/dilution term `0.25 * sqrt(horizon days) * min(2, recent daily log-growth
  of N)` — a fast-growing tracked population means a refresh near the target can
  dilute rates, so the band widens when N has been growing fast;
- floor 0.20; an extra 0.6 for a trophy still at 0.00% (its first earners are a
  coin flip).

Quantiles are normal on the logit scale around the median
(`q = invLogit(logit(median) + z_tau * s)`), rounded to 4 decimals, clamped to
[0, 100], forced non-decreasing.

## Special cases

- **The 100% trophy:** a rate of 100% can only dip a little, when fresh tracked
  players arrive without it yet. We forecast median 99.9, spread 0.5 — a hedge,
  not a claim of five 100s.
- **Flat history (practice cases):** all slopes are 0, the median is the last rate,
  and the spread is `sqrt(0.125^2 + 0.20^2) ≈ 0.236` — wider than the house
  baseline's 0.125, because the practice refresh proves a refresh can move every
  rate at once.
- **Failure safety:** if the main forecast throws for a case, a baseline-style
  fallback (last rate, random-walk + floor spread) is written instead, so the case
  stays valid. A final sanitize forces every quantile finite, in [0, 100], and
  non-decreasing.

## Rejected ideas (tested, not shipped)

- **Exponential-in-hours N-form, blended 50/50 with the power law.** On
  decelerating (power-law) data its extrapolation overshoots log N by ~3.4 at the
  target, and blending it in dragged the smooth-case median off by ~1.5 logit
  (mean pinball 0.60 vs 0.26 without it). The power law alone is the better
  extrapolator for adoption curves; the refresh term in the spread, not a second
  form, carries the growth-form uncertainty. (Documented in main.ts.)

## Constants — fixed in advance, never tuned on an answer

Window 48 h, shrink K=8, sigma_rw=0.5, floor 0.20, cap 2.0, slope range [-0.2, 3],
refresh coefficient 0.25, tenth-earner floor 0.1, tier priors
platinum 0.15 / gold 0.5 / silver 0.8 / bronze 1.2, global fallback 0. No constant
was fitted to the practice answers (the practice histories carry no signal at all —
every read is identical — so there is nothing to tune on). The spread constants
were set by the reasoning in this file and checked, not optimised, on two synthetic
cases built from the stated generating processes (see Verification).

## Verification (run locally, 21 Nov 2026)

- **Practice p00/p01:** program runs end to end in ~0.2 s, 55 rows each, 5
  quantiles each, monotone, in [0, 100], files ~2.8 KB (under the 65,536-byte cap);
  two runs byte-identical; medians exactly equal the last read rates (flat history);
  trophy id 4's quantiles match a hand computation exactly (spread 0.236).
- **Smooth synthetic case** (fabricated history with growing N and earners, true
  target rates known, compared after the scorer's [0.01, 99.99] clamp): medians
  within 0.91–1.12x of the truth for 10 sampled trophies, every true rate inside
  its [q05, q95] band; median logit error p50 0.08, max 0.17. Mean pinball loss
  0.2625 vs the house baseline's 0.2218 on the same case — the gap is the wider
  spread (the medians are nearly perfect); the baseline wins exactly the world
  where nothing surprising happens, which is the world its narrow spread assumes.
- **Jumpy synthetic case** (N as a step function, 1.6x jumps every 12 h, earners
  smooth — the Exophase refresh pattern): ours 2.1130 vs the house baseline's
  2.2055 — we win. But the medians are off by ~3.1 logit in both: a power-law N-fit
  cannot capture sustained exponential growth, and no spread fully insures that.
  The lesson is that functional-form risk dominates the final; the spread prices
  it, it does not remove it.
- **Edge cases:** single-read history, all-null rates for a trophy, a 0.00%
  trophy, a 100% trophy — all produce valid rows.

## Honest limitations

- The final answer is the page's state at the first valid read in the hour from the
  target — i.e. Exophase's last refresh before the target, which may be hours stale.
  No model can remove that refresh-lag noise; the spread prices it, it does not
  eliminate it.
- 26 Nov 2026 is Thanksgiving Day in the US. Holiday play could lift earners
  above trend or, if players travel, cut it. The model does not guess which; the
  spread carries the uncertainty.
- The house model forecast (superbot, max effort) is a strong rival: it sees the
  same data. Our edge is numerical: per-trophy robust fits across the full
  trajectory, computed by code at run time, rather than one model's judgment call.
  A prize needs a loss strictly below the best house entry — that is the bar, and
  no honest forecast can promise to clear it.
