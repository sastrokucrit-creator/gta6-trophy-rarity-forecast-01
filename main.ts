// gta6-trophy-rarity-forecast-01 — forecast of Exophase GTA VI PS5 trophy earn rates.
// Entry by sastrokucrit-creator. Node 22, standard library only, no network, no randomness.
//
// METHOD (full write-up in NOTES.md):
//   A trophy's earn rate is earners / players-tracked. We model the two counts
//   separately, each as a robust (Huber) log-linear fit against ln(1 + hours since
//   release) over the recent window of reads, with each trophy's slope shrunk toward
//   its tier's mean slope. The median is the ratio of the two extrapolations at the
//   target. The spread combines a random-walk term, the fits' residual uncertainty
//   (with extrapolation leverage), a refresh/dilution term from the tracked-population
//   growth, and a floor. Quantiles are normal on the logit scale around the median.
//   Every number traces to the case file or a stated, fixed constant — nothing is
//   tuned on any answer, and the program never sees one.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Release of Grand Theft Auto VI, the origin of the game-age transform. */
const RELEASE_MS = Date.parse('2026-11-19T00:00:00Z');
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** Standard normal quantiles at LEVELS. */
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];
/** Only reads from the last 48 h before the checkpoint feed the fits. */
const WINDOW_HOURS = 48;
/** Shrinkage strength: a trophy's slope weight is nEff / (nEff + SHRINK_K). */
const SHRINK_K = 8;
/** Random-walk spread, in logit units per square-root day. */
const SIGMA_RW = 0.5;
/** Minimum total logit spread (except the 100% trophy, which is handled apart). */
const SPREAD_FLOOR = 0.2;
/** Maximum total logit spread. */
const SPREAD_CAP = 2.0;
/** Allowed range for a fitted log-earners slope (per unit of ln(1 + hours)). */
const SLOPE_MIN = -0.2;
const SLOPE_MAX = 3.0;
/** A tenth of an earner: the floor that keeps a 0.00% rate's logarithm finite. */
const E_FLOOR = 0.1;
/** Difficulty prior for a tier's log-earners slope when the tier has no usable fit. */
const TIER_PRIOR: Record<string, number> = { platinum: 0.15, gold: 0.5, silver: 0.8, bronze: 1.2 };

interface Trophy {
  id: number;
  tier: string;
}

interface CaseFile {
  id: string;
  at: string;
  horizon_minutes: number;
  target: string;
  levels: number[];
  trophies: Trophy[];
  history: Array<{ at: string; players_tracked: number; rates: Array<number | null> }>;
}

interface Read {
  at: number;
  players: number;
  rates: Array<number | null>;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const clampPct = (x: number): number => clamp(x, 0.01, 99.99);
const logit = (pct: number): number => {
  const p = clampPct(pct) / 100;
  return Math.log(p / (1 - p));
};
const invLogit = (l: number): number => 100 / (1 + Math.exp(-l));
/** x rounded to 4 decimals. */
const round4 = (x: number): number => Math.round(x * 10000) / 10000;
const hoursSinceRelease = (ms: number): number => Math.max(0, (ms - RELEASE_MS) / 3600000);
const medianOf = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

interface Fit {
  slope: number;
  intercept: number;
  residSd: number;
  xMean: number;
  sxx: number;
  n: number;
}

/**
 * Weighted robust linear fit of y on x (Huber IRLS, one reweighting pass).
 * A degenerate x-spread returns slope 0 and the weighted mean as intercept.
 */
function robustFit(xs: number[], ys: number[], ws: number[]): Fit {
  const n = xs.length;
  const wls = (w: number[]): { slope: number; intercept: number; xMean: number; sxx: number } => {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sw += w[i];
      sx += w[i] * xs[i];
      sy += w[i] * ys[i];
    }
    const xMean = sw === 0 ? 0 : sx / sw;
    const yMean = sw === 0 ? 0 : sy / sw;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - xMean;
      sxx += w[i] * dx * dx;
      sxy += w[i] * dx * (ys[i] - yMean);
    }
    const slope = sxx < 1e-12 ? 0 : sxy / sxx;
    return { slope, intercept: yMean - slope * xMean, xMean, sxx };
  };
  let fit = wls(ws);
  const resid = xs.map((x, i) => ys[i] - (fit.intercept + fit.slope * x));
  const med = medianOf(resid);
  const mad = medianOf(resid.map((r) => Math.abs(r - med)));
  const sigma = Math.max(1.4826 * mad, 1e-6);
  const w2 = ws.map((w, i) => {
    const u = resid[i] / (1.345 * sigma);
    return w * (Math.abs(u) <= 1 ? 1 : 1 / Math.abs(u));
  });
  fit = wls(w2);
  const resid2 = xs.map((x, i) => ys[i] - (fit.intercept + fit.slope * x));
  let ss = 0;
  let sw2 = 0;
  for (let i = 0; i < n; i++) {
    ss += w2[i] * resid2[i] * resid2[i];
    sw2 += w2[i];
  }
  const residSd = sw2 === 0 ? 0 : Math.sqrt(ss / sw2);
  return { slope: fit.slope, intercept: fit.intercept, residSd, xMean: fit.xMean, sxx: fit.sxx, n };
}

/** Five quantiles from a median percent and a logit spread, sanitised. */
function quantiles(medianPct: number, spread: number): number[] {
  const s = clamp(spread, 0, SPREAD_CAP);
  const l = logit(medianPct);
  const qs = Z.map((z) => round4(clamp(invLogit(l + z * s), 0, 100)));
  // Enforce non-decreasing after rounding (equal is allowed).
  for (let i = 1; i < qs.length; i++) if (qs[i] < qs[i - 1]) qs[i] = qs[i - 1];
  return qs;
}

/** Fallback forecast: last rate, baseline-style spread. Never throws on a sane case. */
function fallbackRows(c: CaseFile): Array<{ id: number; q: number[] }> {
  const days = Math.max(c.horizon_minutes / 1440, 0);
  const spread = Math.sqrt(SIGMA_RW * SIGMA_RW * days + SPREAD_FLOOR * SPREAD_FLOOR);
  const last = c.history && c.history.length > 0 ? c.history[c.history.length - 1] : undefined;
  return c.trophies.map((t, i) => {
    const r = last && Array.isArray(last.rates) ? last.rates[i] : null;
    const median = r === null || r === undefined || !Number.isFinite(r) ? 1 : r;
    return { id: t.id, q: quantiles(median, spread) };
  });
}

function forecastCase(c: CaseFile): Array<{ id: number; q: number[] }> {
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error('unexpected levels');
  }
  if (!c.history || c.history.length === 0) throw new Error('no history');
  const checkpointMs = Date.parse(c.at);
  const targetMs = Date.parse(c.target);
  const horizonDays = Math.max(c.horizon_minutes / 1440, 0);
  const xTarget = Math.log(1 + hoursSinceRelease(targetMs));

  const reads: Read[] = c.history
    .map((h) => ({ at: Date.parse(h.at), players: h.players_tracked, rates: h.rates }))
    .filter((r) => Number.isFinite(r.at) && r.players > 0 && Array.isArray(r.rates))
    .sort((a, b) => a.at - b.at);
  if (reads.length === 0) throw new Error('no usable reads');
  const last = reads[reads.length - 1];

  const windowStart = checkpointMs - WINDOW_HOURS * 3600000;
  let window = reads.filter((r) => r.at >= windowStart);
  if (window.length < 3) window = reads;
  const maxN = Math.max(...window.map((r) => r.players));
  const xw = window.map((r) => Math.log(1 + hoursSinceRelease(r.at)));
  const ww = window.map((r) => r.players / maxN);

  // --- Tracked-population model (one fit, shared by every trophy). ---
  // A power law in game age: log N linear in ln(1 + hours since release), the
  // decelerating adoption curve (the same transform the house curve uses). An
  // exponential-in-hours form was tried and rejected: on decelerating data its
  // extrapolation overshoots log N by ~3.4 at the target, and blending it in
  // drags the median off by ~1.5 logit. The refresh term in the spread, not a
  // second form, carries the growth-form uncertainty.
  const nFit = robustFit(xw, window.map((r) => Math.log(r.players)), ww);
  const nSlope = clamp(nFit.slope, 0, 2);
  let nT = Math.exp(nFit.intercept + nSlope * xTarget);
  nT = Math.max(nT, last.players * 0.999);
  const nLeverage = nFit.sxx > 1e-12 ? 1 + (xTarget - nFit.xMean) * (xTarget - nFit.xMean) / nFit.sxx : 1;
  const nFitSd = Math.min(nFit.residSd * Math.sqrt(Math.min(nLeverage, 4)), 1);

  // --- Recent daily log-growth of the tracked population (refresh risk). ---
  const dayAgo = checkpointMs - 24 * 3600000;
  const recent = window.filter((r) => r.at >= dayAgo);
  let gN = nSlope;
  if (recent.length >= 2) {
    const first = recent[0];
    const lastR = recent[recent.length - 1];
    const dtDays = Math.max((lastR.at - first.at) / 86400000, 1e-6);
    gN = Math.log(lastR.players / first.players) / dtDays;
  }
  gN = clamp(gN, 0, 2);
  const sRefresh = 0.25 * Math.sqrt(horizonDays) * Math.min(2, gN);
  const sRw = SIGMA_RW * Math.sqrt(horizonDays);

  // --- Pass 1: per-trophy log-earners fits (for the tier-mean slopes). ---
  interface First {
    slope: number;
    intercept: number;
    residSd: number;
    xMean: number;
    sxx: number;
    nEff: number;
    usable: boolean;
    yMean: number;
    xBar: number;
    lastE: number;
    lastRate: number;
  }
  const firsts: First[] = c.trophies.map((t, i) => {
    const pts: Array<{ x: number; y: number; w: number }> = [];
    window.forEach((r, j) => {
      const rate = r.rates[i];
      if (rate === null || rate === undefined || !Number.isFinite(rate)) return;
      pts.push({ x: xw[j], y: Math.log(Math.max((rate / 100) * r.players, E_FLOOR)), w: ww[j] });
    });
    const lr = last.rates[i];
    const lastRate = lr === null || lr === undefined || !Number.isFinite(lr) ? 0 : lr;
    const lastE = Math.max((lastRate / 100) * last.players, E_FLOOR);
    // nEff counts the reads where the trophy actually has earners: a 0.00% read
    // carries no slope information (its log-earner value is only the floor).
    const nEff = window.reduce((n, r) => {
      const rate = r.rates[i];
      return n + (rate !== null && rate !== undefined && rate > 0 ? 1 : 0);
    }, 0);
    if (pts.length < 3) {
      return {
        slope: 0, intercept: Math.log(lastE), residSd: 0, xMean: xw[xw.length - 1], sxx: 0,
        nEff, usable: false, yMean: Math.log(lastE),
        xBar: xw[xw.length - 1], lastE, lastRate,
      };
    }
    const fit = robustFit(pts.map((p) => p.x), pts.map((p) => p.y), pts.map((p) => p.w));
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sw += p.w;
      sx += p.w * p.x;
      sy += p.w * p.y;
    }
    return {
      slope: fit.slope, intercept: fit.intercept, residSd: fit.residSd, xMean: fit.xMean,
      sxx: fit.sxx, nEff, usable: true, yMean: sw === 0 ? 0 : sy / sw,
      xBar: sw === 0 ? 0 : sx / sw, lastE, lastRate,
    };
  });

  // --- Tier-mean slopes (empirical-Bayes prior), with a global fallback. ---
  const tierSlopes = new Map<string, number>();
  const tiers = [...new Set(c.trophies.map((t) => t.tier))];
  for (const tier of tiers) {
    let num = 0;
    let den = 0;
    c.trophies.forEach((t, i) => {
      if (t.tier !== tier || !firsts[i].usable || firsts[i].nEff === 0) return;
      num += firsts[i].nEff * firsts[i].slope;
      den += firsts[i].nEff;
    });
    // No usable fit in the tier: fall back to the tier's difficulty prior, so a
    // unique trophy (the platinum is alone in its tier) never borrows the global
    // mean, which is dominated by bronze.
    tierSlopes.set(tier, den > 0 ? num / den : (TIER_PRIOR[tier] ?? 0));
  }
  const globalSlope = 0;

  // --- Pass 2: shrunk slopes, re-anchored medians, spreads. ---
  return c.trophies.map((t, i) => {
    const f = firsts[i];
    const tierSlope = tierSlopes.get(t.tier) ?? globalSlope;
    const w = f.nEff / (f.nEff + SHRINK_K);
    const slope = clamp(w * f.slope + (1 - w) * tierSlope, SLOPE_MIN, SLOPE_MAX);
    // Re-anchor the line at the trophy's own data centroid (or its last read).
    const intercept = f.usable ? f.yMean - slope * f.xBar : Math.log(f.lastE) - slope * xw[xw.length - 1];
    let eHat = Math.exp(intercept + slope * xTarget);
    eHat = clamp(eHat, 0.9 * f.lastE, nT);
    // Floor 0.01 matches logit's clamp: the scorer clamps both sides to
    // [0.01, 99.99] before the logit, so a median below 0.01% scores as 0.01%.
    const median = clamp(100 * eHat / nT, 0.01, 99.99);

    // The 100% trophy: it can only dip a little, when fresh tracked players arrive
    // without it yet — hedge just below 100 rather than claiming all five quantiles.
    if (f.lastRate >= 99.99) return { id: t.id, q: quantiles(99.9, 0.5) };

    const leverage = f.usable && f.sxx > 1e-12
      ? 1 + (xTarget - f.xMean) * (xTarget - f.xMean) / f.sxx
      : 1;
    const fitSd = f.usable && f.nEff > 0 ? Math.min(f.residSd * Math.sqrt(Math.min(leverage, 4)), 1) : 0.5;
    const zeroExtra = f.lastRate <= 0 ? 0.6 : 0;
    const total = Math.sqrt(
      sRw * sRw + fitSd * fitSd + nFitSd * nFitSd + sRefresh * sRefresh
      + SPREAD_FLOOR * SPREAD_FLOOR + zeroExtra * zeroExtra,
    );
    return { id: t.id, q: quantiles(median, total) };
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  let rows: Array<{ id: number; q: number[] }>;
  try {
    rows = forecastCase(c);
  } catch {
    // A case that fails the main forecast still gets a valid baseline-style row set.
    rows = fallbackRows(c);
  }
  // Final sanitize: every quantile finite, in [0, 100], non-decreasing.
  rows = rows.map((r) => {
    const qs = r.q.map((q) => (Number.isFinite(q) ? clamp(q, 0, 100) : 1));
    for (let j = 1; j < qs.length; j++) if (qs[j] < qs[j - 1]) qs[j] = qs[j - 1];
    return { id: r.id, q: qs };
  });
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies: rows })}\n`);
}
