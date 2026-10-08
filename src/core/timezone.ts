import { toUtc } from "./time";
import type { TrackIndex } from "./track";
import type { MatchSettings } from "./types";

export const STATIONARY_KMH = 7;
export const TIE_MARGIN = 0.03;
export const SUGGEST_MARGIN = 0.1;

export interface OffsetCandidate {
  offsetMin: number;
  total: number;
  matched: number;
  coverage: number;
  stationaryRatio: number;
  medianNearestSec: number | null;
  score: number;
}

export interface OffsetDetection {
  ranked: OffsetCandidate[];
  recommended: OffsetCandidate | null;
  ambiguous: boolean;
}

export const CANDIDATE_OFFSETS: number[] = Array.from({ length: (26 * 60) / 15 + 1 }, (_, i) => -12 * 60 + i * 15);

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function evaluateOffset(
  naiveTimes: number[],
  index: TrackIndex,
  offsetMin: number,
  settings: MatchSettings,
  adjustSec = 0,
): OffsetCandidate {
  let matched = 0;
  let stationary = 0;
  const nearest: number[] = [];
  for (const naive of naiveTimes) {
    const r = index.locate(toUtc(naive, offsetMin, adjustSec), settings);
    if (!r) continue;
    matched++;
    nearest.push(r.nearestSec);
    if (r.speedKmh === null) stationary += 0.5;
    else if (r.speedKmh <= STATIONARY_KMH) stationary += 1;
  }
  const total = naiveTimes.length;
  const coverage = total ? matched / total : 0;
  const stationaryRatio = matched ? stationary / matched : 0;
  return {
    offsetMin,
    total,
    matched,
    coverage,
    stationaryRatio,
    medianNearestSec: median(nearest),
    score: coverage * (0.5 + 0.5 * stationaryRatio),
  };
}

export function detectOffset(
  naiveTimes: number[],
  index: TrackIndex,
  settings: MatchSettings,
  preferredMin: number,
): OffsetDetection {
  if (!naiveTimes.length || !index.size) return { ranked: [], recommended: null, ambiguous: false };

  const ranked = CANDIDATE_OFFSETS.map((o) => evaluateOffset(naiveTimes, index, o, settings))
    .filter((c) => c.matched > 0)
    .sort((a, b) => b.score - a.score || Math.abs(a.offsetMin - preferredMin) - Math.abs(b.offsetMin - preferredMin));
  if (!ranked.length) return { ranked, recommended: null, ambiguous: false };

  const best = ranked[0].score;
  const ties = ranked.filter((c) => best - c.score <= TIE_MARGIN);
  const recommended = ties.reduce((acc, c) => {
    const d = Math.abs(c.offsetMin - preferredMin) - Math.abs(acc.offsetMin - preferredMin);
    if (d < 0) return c;
    if (d === 0 && c.offsetMin % 60 === 0 && acc.offsetMin % 60 !== 0) return c;
    return acc;
  });
  const ambiguous = ties.some((c) => Math.abs(c.offsetMin - recommended.offsetMin) >= 60);
  return { ranked, recommended, ambiguous };
}

export function shouldSuggest(current: OffsetCandidate, recommended: OffsetCandidate | null): boolean {
  if (!recommended || recommended.offsetMin === current.offsetMin) return false;
  return recommended.score - current.score >= SUGGEST_MARGIN;
}
