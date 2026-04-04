/**
 * Web Push VAPID configuration (server + client).
 *
 * Environment variables:
 * - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — URL-safe base64 pair (generate once: `npx web-push generate-vapid-keys`).
 * - NEXT_PUBLIC_VAPID_PUBLIC_KEY — same public key for the browser (`PushManager.subscribe`). Server `configureWebPush()` falls back to this if `VAPID_PUBLIC_KEY` is unset.
 * - VAPID_SUBJECT — contact URI, usually `mailto:you@domain` (RFC 8292).
 *
 * Notification architecture (prefer server-triggered delivery):
 * - Reliable: schedule sends on the server (`web-push.sendNotification`) when a row is due (e.g. this app: Supabase + cron hitting `/api/cron/dispatch-alerts`). Same logic can run inside a Supabase Edge Function + `pg_cron` or queue.
 * - Not reliable: scheduling only with `setTimeout` / `showNotification` in the page — tab may be closed; use only as a supplement.
 * - Service worker `showNotification` here is for displaying the payload after a push arrives, not for time-based scheduling.
 */
import webpush from "web-push";

let configured = false;

export function configureWebPush(): boolean {
  const publicKey =
    process.env.VAPID_PUBLIC_KEY?.trim() || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.VAPID_SUBJECT ?? "mailto:dev@localhost";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  const fromPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (fromPublic) return fromPublic;
  const fromServer = process.env.VAPID_PUBLIC_KEY?.trim();
  return fromServer || null;
}

export { webpush };
