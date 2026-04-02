import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Body = {
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
};

/**
 * Register push subscription only (no check-in). Cron scheduling still uses POST /api/parking/check-in
 * which stores rows in scheduled_push_alerts. Call this if you want to persist the device for future use.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({
      ok: true,
      persisted: false,
      note: "Supabase not configured; subscription not stored server-side.",
    });
  }

  const admin = createClient(url, key);
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      endpoint: sub.endpoint,
      keys: sub.keys,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, persisted: true });
}
