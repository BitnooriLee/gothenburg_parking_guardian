/**
 * Web Push VAPID configuration (server + client).
 *
 * Environment variables:
 * - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — URL-safe base64 pair (generate once: `npx web-push generate-vapid-keys`).
 * - NEXT_PUBLIC_VAPID_PUBLIC_KEY — same public key for the browser (`PushManager.subscribe`); can mirror VAPID_PUBLIC_KEY.
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
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:dev@localhost";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? null;
}

export { webpush };
