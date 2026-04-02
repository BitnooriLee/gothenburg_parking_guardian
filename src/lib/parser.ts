import type { ParsedRule, TimeRange } from "../types/parking";

/** Mon–Fri (vardagar). */
const WEEKDAYS = [1, 2, 3, 4, 5] as const;
/** Saturday (lördag). */
const SATURDAY = [6] as const;
/** Sunday / public holiday (söndag, helgdag). */
const SUNDAY_HOLIDAY = [0] as const;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Regex strategy (primary): strict hour–hour pairs like 09-18.
 * Fallback: single-digit hours and optional minutes (09:30-17:45).
 */
const TIME_PAIR_STRICT = /(\d{2})\s*[-–]\s*(\d{2})/g;
const TIME_PAIR_FLEX = /(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?/gi;

/** Parenthetical block — usually Saturday hours; non-greedy, allows newlines inside. */
const PAREN_BLOCK = /\(([\s\S]*?)\)/g;

const PAID_HINT = /\bavgift\b|parkeringstaxa|taxa|kr\s*\/\s*h|betala\b/i;
/** 24h / all-day Swedish phrases (incl. "Dygnet runt" = around the clock). */
const FULL_DAY =
  /24\s*tim|24\s*h\b|hela\s*dagen|hela\s*dygnet|dygnet\s+runt|00\s*[-–]\s*24(?::00)?|00:00\s*[-–]\s*24:00|midnatt\s*till\s*midnatt/i;

function normalizeEmpty(): ParsedRule {
  return { isPaid: false, ranges: [] };
}

function toHHMMFromFlexible(m: RegExpExecArray): { start: string; end: string } {
  const h1 = m[1];
  const mm1 = m[2];
  const h2 = m[3];
  const mm2 = m[4];
  const start = mm1 != null ? `${h1.padStart(2, "0")}:${mm1}` : `${h1.padStart(2, "0")}:00`;
  const end = mm2 != null ? `${h2.padStart(2, "0")}:${mm2}` : `${h2.padStart(2, "0")}:00`;
  return { start, end };
}

/** Strict `09-18` uses two-digit pairs; single-digit `9-18` falls through to flex + padStart → `09:00` / `18:00`. */
function collectTimeRanges(segment: string): { start: string; end: string }[] {
  const strict: { start: string; end: string }[] = [];
  for (const m of segment.matchAll(new RegExp(TIME_PAIR_STRICT.source, "g"))) {
    strict.push({ start: `${m[1]}:00`, end: `${m[2]}:00` });
  }
  if (strict.length > 0) return strict;

  const flex: { start: string; end: string }[] = [];
  const re = new RegExp(TIME_PAIR_FLEX.source, TIME_PAIR_FLEX.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    flex.push(toHHMMFromFlexible(m));
  }
  return flex;
}

function detectDaySet(segment: string): number[] | null {
  const s = segment.toLowerCase();
  if (s.includes("lördag") || /(^|[\s,;])lör([\s,.;]|$)/i.test(segment)) return [...SATURDAY];
  if (s.includes("söndag") || s.includes("helgdag") || /röd\s*dag/i.test(s)) return [...SUNDAY_HOLIDAY];
  if (
    s.includes("vardagar") ||
    s.includes("vardag") ||
    s.includes("måndag") ||
    s.includes("tisdag") ||
    s.includes("onsdag") ||
    s.includes("torsdag") ||
    s.includes("fredag") ||
    /\b(mån|tis|ons|tor|fre)\b/i.test(s) ||
    /\bman[-.]?fre\b|\bmån[-.]?fre\b/i.test(s)
  ) {
    return [...WEEKDAYS];
  }
  return null;
}

function rangeKey(r: TimeRange): string {
  return `${r.start}|${r.end}|${[...r.days].sort((a, b) => a - b).join(",")}`;
}

function dedupeRanges(ranges: TimeRange[]): TimeRange[] {
  const seen = new Set<string>();
  const out: TimeRange[] = [];
  for (const r of ranges) {
    const k = rangeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function parseHHMMToMinutes(s: string): number {
  const [hStr, mStr = "0"] = s.split(":");
  const h = Number(hStr);
  const mi = Number(mStr);
  if (h === 24 && mi === 0) return 24 * 60;
  return h * 60 + mi;
}

/** Weekday 0–6 (Sun–Sat) and minutes from midnight in Europe/Stockholm. */
export function getStockholmWeekdayAndMinutes(d: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = map[wd] ?? 0;

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { weekday, minutes: hour * 60 + minute };
}

/** Half-open [start, end) in minutes on the same calendar day; overnight ranges not handled. */
function isMinutesInRange(nowMin: number, start: string, end: string): boolean {
  const a = parseHHMMToMinutes(start);
  let b = parseHHMMToMinutes(end);
  if (b <= a) {
    return false;
  }
  if (b >= 24 * 60) {
    b = 24 * 60;
  }
  return nowMin >= a && nowMin < b;
}

/**
 * Returns true when `now` (default: current instant) is **outside** every restricted window.
 * Times not covered by any `TimeRange` are treated as free parking.
 */
export function isCurrentlyFree(rules: ParsedRule, now: Date = new Date()): boolean {
  if (rules.ranges.length === 0) {
    return true;
  }

  const { weekday, minutes } = getStockholmWeekdayAndMinutes(now);

  for (const r of rules.ranges) {
    if (!r.days.includes(weekday)) continue;
    if (isMinutesInRange(minutes, r.start, r.end)) {
      return false;
    }
  }

  return true;
}

/**
 * Parses Swedish parking restriction text into machine-readable time ranges.
 * Day model: 0 Sun/helgdag, 1–5 Mon–Fri (vardagar), 6 Sat (lördag).
 * Parentheses often denote Saturday hours, e.g. "Vardagar 09-18 (09-15)".
 */
export function parseSwedishRestriction(raw: string): ParsedRule {
  const text = raw.trim().normalize("NFKC");
  if (!text) {
    return normalizeEmpty();
  }

  const isPaid = PAID_HINT.test(text);
  let fullDaily = FULL_DAY.test(text);

  const ranges: TimeRange[] = [];

  /** Parenthetical blocks → usually lördag hours (`\(([\s\S]*?)\)`). */
  for (const m of text.matchAll(PAREN_BLOCK)) {
    const inner = m[1].trim();
    if (!inner) continue;
    if (FULL_DAY.test(inner)) {
      fullDaily = true;
      continue;
    }
    for (const pair of collectTimeRanges(inner)) {
      ranges.push({ ...pair, days: [...SATURDAY] });
    }
  }

  const withoutParens = text.replace(/\([\s\S]*?\)/g, " ").replace(/\s+/g, " ").trim();

  let segments = withoutParens
    .split(/(?:\n|[|;/])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0 && withoutParens.length > 0) {
    segments = [withoutParens];
  }

  const unassignedTimes: { start: string; end: string }[] = [];

  for (const seg of segments) {
    const times = collectTimeRanges(seg);
    if (times.length === 0) continue;

    const daySet = detectDaySet(seg);
    if (daySet) {
      for (const pair of times) {
        ranges.push({ ...pair, days: [...daySet] });
      }
    } else {
      for (const pair of times) {
        unassignedTimes.push(pair);
      }
    }
  }

  /** Default: bare "09-18" → vardagar (Swedish street-sign convention). */
  for (const pair of unassignedTimes) {
    ranges.push({ ...pair, days: [...WEEKDAYS] });
  }

  if (fullDaily && ranges.length === 0) {
    ranges.push({
      start: "00:00",
      end: "24:00",
      days: [...ALL_DAYS],
    });
  }

  return {
    isPaid,
    ranges: dedupeRanges(ranges),
    ...(fullDaily ? { fullDaily: true } : {}),
  };
}

/*
 * --- Manual expectations (Stockholm time) — verify after changes ---
 *
 * 1) parseSwedishRestriction("Vardagar 09-18 (09-15)")
 *    - Expect two ranges from strict (\d{2}-\d{2}):
 *      • days [1–5]: 09:00–18:00 (main line after stripping parens)
 *      • days [6]:    09:00–15:00 (inside parentheses → Saturday)
 *    - isCurrentlyFree: Mon 10:00 → false (inside weekday window); Mon 19:00 → true;
 *      Sat 12:00 → false; Sat 16:00 → true (after Saturday end).
 *
 * 2) parseSwedishRestriction("09-18")  // no keywords
 *    - Expect one range: [1–5] 09:00–18:00 (default vardagar).
 *
 * 3) parseSwedishRestriction("Avgift vardagar 09-18")
 *    - isPaid true; same ranges as (1) main line without paren.
 *
 * 4) parseSwedishRestriction("Dygnet runt") / "Hela dygnet"
 *    - fullDaily true; fallback range 00:00–24:00 on all days if no other times parsed.
 *
 * Run in REPL: JSON.stringify(parseSwedishRestriction("Vardagar 09-18 (09-15)"), null, 2)
 */
