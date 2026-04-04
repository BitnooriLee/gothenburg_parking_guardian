/**
 * Verify resident / Boende-related rows in public.parking_taxa_zones.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 *   npx tsx scripts/verify_parking_taxa_boende.ts
 */

import { createClient } from "@supabase/supabase-js";
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count: total, error: countErr } = await supabase
    .from("parking_taxa_zones")
    .select("*", { count: "exact", head: true });

  if (countErr) {
    console.error("Count failed:", countErr.message);
    process.exit(1);
  }

  console.log(`parking_taxa_zones total rows (estimate): ${total ?? "?"}`);

  const { data: boendeRows, error: bErr } = await supabase
    .from("parking_taxa_zones")
    .select("id, taxa_name")
    .ilike("taxa_name", "%Boende%")
    .limit(50);

  if (bErr) {
    console.error("Boende filter query failed:", bErr.message);
    process.exit(1);
  }

  console.log(`Rows with taxa_name ILIKE '%Boende%': ${boendeRows?.length ?? 0}`);
  if (boendeRows?.length) {
    console.log("Sample:", boendeRows.slice(0, 10));
  }

  const letters = ["C", "G", "H", "K", "L", "M", "S", "V", "Ä", "Ö"];
  for (const L of letters) {
    const pattern = `Boende ${L}%`;
    const { data, error } = await supabase
      .from("parking_taxa_zones")
      .select("id, taxa_name", { count: "exact" })
      .ilike("taxa_name", pattern)
      .limit(5);
    if (error) {
      console.error(`Boende ${L} query failed:`, error.message);
      continue;
    }
    const n = data?.length ?? 0;
    const sample = (data ?? []).map((r) => r.taxa_name);
    console.log(`taxa_name ILIKE '${pattern}': ${n} rows (sample: ${JSON.stringify(sample)})`);
  }

  const { data: distinctSample, error: dErr } = await supabase
    .from("parking_taxa_zones")
    .select("taxa_name")
    .limit(2000);

  if (dErr) {
    console.error("Sample taxa_name fetch failed:", dErr.message);
    return;
  }

  const uniq = [...new Set((distinctSample ?? []).map((r) => r.taxa_name))].sort();
  console.log(`Distinct taxa_name in first 2000 rows (${uniq.length} unique):`);
  console.log(uniq.join(" | "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
