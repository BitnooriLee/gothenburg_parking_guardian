/**
 * One-shot sync: Gothenburg CleaningZones API → Supabase cleaning_zones.
 *
 *   npm run sync-cleaning-zones
 *
 * Env (.env.local): GOTHENBURG_DATA_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Supabase must have migration 005 (upsert_cleaning_zone_from_sync) applied.
 */

import { syncCleaningZonesFromGothenburg } from "@/lib/cleaning-zones-sync";
import * as fs from "fs";
import * as path from "path";

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

async function main(): Promise<void> {
  loadEnvLocal();
  console.log("Syncing CleaningZones from data.goteborg.se …");
  const result = await syncCleaningZonesFromGothenburg();
  console.log("Done:", {
    upserted: result.upserted,
    skipped: result.skipped,
    errorCount: result.errors.length,
  });
  if (result.errors.length > 0) {
    console.log("First errors:", result.errors.slice(0, 15));
    process.exit(1);
  }
  console.log("\nVerify a point: npx tsx scripts/verify_cleaning_zone_at_point.ts");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
