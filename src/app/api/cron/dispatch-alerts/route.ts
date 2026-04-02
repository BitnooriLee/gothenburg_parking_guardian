import { configureWebPush, webpush } from "@/lib/web-push-env";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Server-side notification dispatch (stable path): reads due rows and calls `web-push.sendNotification`.
 * Replace this route with a Supabase Edge Function + scheduler if you want everything on Supabase;
 * keep VAPID keys on the sender that calls the push endpoint.
 *
 * Cron / manual trigger: send due web pushes and mark rows sent.
 * Secure with CRON_SECRET: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!configureWebPush()) {
    return NextResponse.json({ error: "VAPID not configured" }, { status: 500 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(url, key);
  const now = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from("scheduled_push_alerts")
    .select("id, endpoint, keys, payload")
    .eq("sent", false)
    .lte("fire_at", now);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  for (const row of rows ?? []) {
    const sub = {
      endpoint: row.endpoint,
      keys: row.keys as { p256dh: string; auth: string },
    };
    try {
      await webpush.sendNotification(sub, JSON.stringify(row.payload));
      await supabase.from("scheduled_push_alerts").update({ sent: true }).eq("id", row.id);
      sent++;
    } catch (e) {
      console.error("push failed", row.id, e);
    }
  }

  return NextResponse.json({ ok: true, dispatched: sent, pending: (rows?.length ?? 0) - sent });
}
