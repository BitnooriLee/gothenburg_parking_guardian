import { syncCleaningZonesFromGothenburg } from "@/lib/cleaning-zones-sync";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Sync CleaningZones (Gatusopning) from data.goteborg.se into `cleaning_zones`.
 * Auth: Authorization: Bearer <CRON_SECRET> (same pattern as `/api/cron/dispatch-alerts`).
 *
 * Env:
 * - GOTHENBURG_DATA_API_KEY: ParkingService v2.3 APPID (path segment, not a header).
 * - SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
 * - CRON_SECRET
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncCleaningZonesFromGothenburg();
    return NextResponse.json({
      ok: true,
      ...result,
      errorCount: result.errors.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
