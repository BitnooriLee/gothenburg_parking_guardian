/**
 * Verify cleaning_zones data and `cleaning_zone_at_point(lat, lng)` (same RPC as check-in).
 *
 *   npx tsx scripts/verify_cleaning_zone_at_point.ts
 *   npx tsx scripts/verify_cleaning_zone_at_point.ts 57.6941 11.955
 *
 * Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Optionally compares with anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) like the app.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_LAT = 57.694122064052976;
const DEFAULT_LNG = 11.954957137227227;

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

function parseArgs(): { lat: number; lng: number } {
  const a = process.argv.slice(2).filter((x) => !x.startsWith("-"));
  if (a.length >= 2) {
    const lat = Number(a[0]);
    const lng = Number(a[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    console.error("Invalid lat/lng arguments; using defaults.");
  }
  return { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).");
    process.exit(1);
  }

  const { lat, lng } = parseArgs();
  console.log("Point (WGS84):", { lat, lng });

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count: total, error: totalErr } = await admin
    .from("cleaning_zones")
    .select("*", { count: "exact", head: true });

  if (totalErr) {
    console.error("cleaning_zones count failed:", totalErr.message);
    process.exit(1);
  }

  const { count: withGeom, error: geomErr } = await admin
    .from("cleaning_zones")
    .select("*", { count: "exact", head: true })
    .not("geom", "is", null);

  if (geomErr) {
    console.error("cleaning_zones geom count failed:", geomErr.message);
    process.exit(1);
  }

  console.log(`cleaning_zones rows: ${total ?? "?"} (with geom: ${withGeom ?? "?"})`);

  if ((total ?? 0) === 0) {
    console.log("\nNo rows — run cleaning zone sync:");
    console.log("  npm run sync-cleaning-zones");
    console.log("  (needs GOTHENBURG_DATA_API_KEY + migration 005/006 on Supabase)");
    process.exit(2);
  }

  if ((withGeom ?? 0) === 0) {
    console.warn("\nWarning: no rows have geom; point-in-polygon will always miss. Re-sync from API (WKT).");
  }

  const { data: rpcRows, error: rpcErr } = await admin.rpc("cleaning_zone_at_point", { lat, lng });

  if (rpcErr) {
    console.error("\ncleaning_zone_at_point RPC error (service role):", {
      message: rpcErr.message,
      code: rpcErr.code,
      details: rpcErr.details,
      hint: rpcErr.hint,
    });
    console.log("\nIf function is missing, apply supabase/migrations through 006_cleaning_zone_at_point_srid.sql on this project.");
    process.exit(1);
  }

  const rows = rpcRows as unknown[] | null;
  const n = rows?.length ?? 0;
  console.log(`\ncleaning_zone_at_point(${lat}, ${lng}) → ${n} row(s) (service role)`);
  if (n > 0 && rows?.[0]) {
    const r = rows[0] as Record<string, unknown>;
    console.log("Match:", {
      id: r.id,
      street_name: r.street_name,
      has_schedule: r.schedule != null,
    });
  } else {
    console.log("No polygon contains this point — check-in will return 422.");
    console.log("Try another coordinate inside Göteborg on the map, or confirm WKT polygons synced.");
    const pad = 0.006;
    const { data: near, error: nearErr } = await admin.rpc("cleaning_zones_in_bounds", {
      west: lng - pad,
      south: lat - pad,
      east: lng + pad,
      north: lat + pad,
    });
    if (nearErr) {
      console.warn("cleaning_zones_in_bounds (neighborhood) error:", nearErr.message);
    } else {
      const k = (near as unknown[] | null)?.length ?? 0;
      console.log(
        `cleaning_zones_in_bounds (~${Math.round(pad * 111)} km pad): ${k} zone(s) in bbox (if >0 but point miss: geometry/SRID or hole/gap)`,
      );
    }
  }

  if (anonKey) {
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: anonRows, error: anonErr } = await anon.rpc("cleaning_zone_at_point", { lat, lng });
    if (anonErr) {
      console.warn("\ncleaning_zone_at_point as anon (like check-in): ERROR", anonErr.message);
      console.warn("Grant EXECUTE on cleaning_zone_at_point to anon, or fix RLS so the RPC can read geometries.");
    } else {
      const m = (anonRows as unknown[] | null)?.length ?? 0;
      console.log(`cleaning_zone_at_point as anon → ${m} row(s) (should match service if RLS allows)`);
    }
  } else {
    console.log("\n(No NEXT_PUBLIC_SUPABASE_ANON_KEY — skipped anon comparison.)");
  }

  console.log("\nSupabase SQL Editor (same checks): see scripts/sql/verify_cleaning_zone_at_point.sql");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
