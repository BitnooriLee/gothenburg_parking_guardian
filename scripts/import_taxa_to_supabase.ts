/**
 * One-off import: real_parking_taxa.json → public.parking_taxa_zones (bulk upsert).
 *
 * Requires:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (insert/upsert; bypasses RLS)
 *
 * Run (after `npm install`):
 *   npx tsx scripts/import_taxa_to_supabase.ts [path/to/real_parking_taxa.json]
 *
 * Apply migration 009 (generic geometry) before importing LineString WFS data.
 *
 * Boende (resident) area polygons come from the same GeoJSON when generated with
 * `scripts/fetch_real_parking_taxa.py` (includes `parkering:boendeparkering-omrade`).
 * Those rows use `taxa_name` like `Boende M` (from `ParkingCharge`); there is no
 * filter that drops them — if they are missing, re-fetch WFS and re-run this script.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import type { Feature, FeatureCollection, Geometry } from "geojson";

const BATCH_SIZE = 150;

/**
 * Parse primary tariff as SEK/hour from Swedish `ParkingCost` strings (WFS).
 * Uses the main time window (text before "Övrig tid"); supports kr/tim and kr/30 min.
 */
function parseHourlyRateFromParkingCost(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\s+/g, " ");
  const beforeOffPeak = normalized.split(/\.\s*Övrig tid/i)[0] ?? normalized;

  const parseNum = (s: string): number | null => {
    const n = parseFloat(s.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const per30 = beforeOffPeak.match(
    /(\d+(?:[.,]\d+)?)\s*kr\s*\/\s*30\s*min\b/i,
  );
  if (per30) {
    const n = parseNum(per30[1]);
    if (n != null && n >= 0) return Math.round(n * 2 * 100) / 100;
  }

  const perMin = beforeOffPeak.match(
    /(\d+(?:[.,]\d+)?)\s*kr\s*\/\s*(\d+)\s*min\b/i,
  );
  if (perMin && !/^30$/i.test(perMin[2])) {
    const kr = parseNum(perMin[1]);
    const mins = parseInt(perMin[2], 10);
    if (kr != null && kr >= 0 && Number.isFinite(mins) && mins > 0) {
      return Math.round(kr * (60 / mins) * 100) / 100;
    }
  }

  const perHour = beforeOffPeak.match(
    /(\d+(?:[.,]\d+)?)\s*kr\s*\/\s*tim\b/i,
  );
  if (perHour) {
    const n = parseNum(perHour[1]);
    if (n != null && n >= 0) return Math.round(n * 100) / 100;
  }

  return null;
}

/** Fallback SEK/hour when `ParkingCost` is missing or unparsable. */
const HOURLY_RATE_BY_TAXA_CODE: Record<string, number> = {
  "1": 40,
  "2": 30,
  "3": 25,
  "4": 22,
  "5": 20,
  "6": 18,
  "7": 0,
  "8": 15,
  "9": 16,
  "12": 28,
  "22": 17,
  "24": 15,
  "62": 12,
  a: 35,
  A: 35,
};

const COLOR_BY_TAXA_NAME: Record<string, string> = {
  "Taxa 1": "#ef4444",
  "Taxa 2": "#f97316",
  "Taxa 3": "#facc15",
  "Taxa 4": "#eab308",
  "Taxa 5": "#ca8a04",
  "Taxa 6": "#a16207",
  "Taxa 7": "#22c55e",
  "Taxa 8": "#14b8a6",
  "Taxa 9": "#0d9488",
  "Taxa 12": "#f97316",
  "Taxa 22": "#84cc16",
  "Taxa 24": "#65a30d",
  "Taxa 62": "#78716c",
  "Taxa A": "#ef4444",
};

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function taxaDisplayName(taxaCode: string, parkingCharge: unknown): string {
  const pc = typeof parkingCharge === "string" ? parkingCharge.trim() : "";
  if (pc.length > 0) return pc;
  const c = taxaCode.trim();
  if (c.toLowerCase() === "a") return "Taxa A";
  return `Taxa ${c}`;
}

function hourlyRateForCode(taxaCode: string): number {
  const c = taxaCode.trim();
  if (HOURLY_RATE_BY_TAXA_CODE[c] !== undefined) return HOURLY_RATE_BY_TAXA_CODE[c];
  const lower = c.toLowerCase();
  if (HOURLY_RATE_BY_TAXA_CODE[lower] !== undefined) {
    return HOURLY_RATE_BY_TAXA_CODE[lower];
  }
  return 0;
}

function resolveHourlyRate(taxaCode: string, parkingCost: unknown): number {
  const parsed = parseHourlyRateFromParkingCost(parkingCost);
  if (parsed != null) return parsed;
  return hourlyRateForCode(taxaCode);
}

function colorHintForName(taxaName: string): string | null {
  return COLOR_BY_TAXA_NAME[taxaName] ?? null;
}

function stableFeatureId(
  feature: Feature,
  index: number,
  taxaCode: string,
): string {
  const rawId = (feature as Feature & { id?: string | number }).id;
  if (rawId !== undefined && rawId !== null) {
    const s = String(rawId).replace(/[^a-zA-Z0-9._-]/g, "_");
    if (s.length > 0 && s.length <= 200) return s;
  }
  const code = taxaCode.replace(/[^a-zA-Z0-9]/g, "");
  return `gtbg-taxa-${code || "x"}-${String(index).padStart(5, "0")}`;
}

type TaxaRow = {
  id: string;
  taxa_name: string;
  hourly_rate: number;
  geom: Geometry;
  color_hint: string | null;
  updated_at: string;
};

function featureToRow(feature: Feature, index: number): TaxaRow | null {
  if (!feature.geometry) return null;
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const taxaCode = String(props.taxa_code ?? "").trim() || "unknown";
  const taxa_name = taxaDisplayName(taxaCode, props.ParkingCharge);
  const id = stableFeatureId(feature, index, taxaCode);
  return {
    id,
    taxa_name,
    hourly_rate: resolveHourlyRate(taxaCode, props.ParkingCost),
    geom: feature.geometry,
    color_hint: colorHintForName(taxa_name),
    updated_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  loadEnvLocal();

  const jsonPath =
    process.argv[2] ?? path.join(process.cwd(), "real_parking_taxa.json");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (check .env.local).",
    );
    process.exit(1);
  }

  if (!fs.existsSync(jsonPath)) {
    console.error(`File not found: ${jsonPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, "utf8");
  let fc: FeatureCollection;
  try {
    fc = JSON.parse(raw) as FeatureCollection;
  } catch (e) {
    console.error("Invalid JSON:", e);
    process.exit(1);
  }

  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    console.error("Expected a GeoJSON FeatureCollection.");
    process.exit(1);
  }

  const rows: TaxaRow[] = [];
  let parsedRates = 0;
  let fallbackRates = 0;
  for (let i = 0; i < fc.features.length; i++) {
    const feat = fc.features[i];
    if (!feat.geometry) continue;
    const props = (feat.properties ?? {}) as Record<string, unknown>;
    if (parseHourlyRateFromParkingCost(props.ParkingCost) != null) {
      parsedRates += 1;
    } else {
      fallbackRates += 1;
    }
    const row = featureToRow(feat, i);
    if (row) rows.push(row);
  }

  console.info(`Parsed ${fc.features.length} features → ${rows.length} rows (skipped null geometry).`);
  console.info(
    `hourly_rate: ${parsedRates} from ParkingCost text, ${fallbackRates} fallback by taxa_code`,
  );

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let ok = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("parking_taxa_zones").upsert(batch, {
      onConflict: "id",
    });
    if (error) {
      console.error(`Upsert failed at offset ${i}:`, error.message, error);
      process.exit(1);
    }
    ok += batch.length;
    console.info(`Upserted ${ok} / ${rows.length}`);
  }

  console.info("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
