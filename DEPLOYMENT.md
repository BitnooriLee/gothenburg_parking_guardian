# Deployment checklist (Vercel + Supabase)

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes (map) | Mapbox GL access token |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (DB + RPC) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (client/API reads) | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (push schedule, register) | Server-only; check-in + cron + `/api/push/register` |
| `VAPID_PUBLIC_KEY` | Yes (Web Push send) | URL-safe base64 public key |
| `VAPID_PRIVATE_KEY` | Yes (Web Push send) | URL-safe base64 private key |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Recommended | Same value as `VAPID_PUBLIC_KEY` for `PushManager.subscribe` |
| `VAPID_SUBJECT` | Optional | e.g. `mailto:you@domain` |
| `CRON_SECRET` | Yes (production cron) | `Authorization: Bearer` for `/api/cron/dispatch-alerts` |
| `DISABLE_PWA` | Optional | Set `true` to disable next-pwa (local debugging) |

Generate VAPID keys once: `npx web-push generate-vapid-keys`

## Supabase

1. Run migrations under `supabase/migrations/` (PostGIS, cleaning zones, scheduled alerts, push subscriptions).
2. Enable Row Level Security policies as needed; server routes use the **service role** where required.

## Vercel

1. Add all env vars in Project → Settings → Environment Variables.
2. **Cron**: `vercel.json` defines `/api/cron/dispatch-alerts` every 5 minutes. **Vercel Cron** requires a paid plan on some tiers; otherwise use an external cron hitting the same URL with `CRON_SECRET`.
3. **Service worker / next-pwa caching**
   - Production build generates `public/sw.js` with Workbox precaching for static assets and runtime routes for navigations/APIs.
   - **Push handler** is loaded via `workboxOptions.importScripts: ["/push-handler.js"]` — keep `public/push-handler.js` in deploy output.
   - After deploy, bump cache: new `sw.js` activates with `skipWaiting: true`; users get updated SW on next visit.
   - If debugging stale assets, temporarily set `DISABLE_PWA=true` or hard-refresh / clear site data.

## Integration summary

- **Park Here**: `POST /api/parking/check-in` — saves session client-side (`localStorage`) and inserts `scheduled_push_alerts` when Supabase + VAPID + subscription are present.
- **Push register only**: `POST /api/push/register` — upserts `push_subscriptions` (optional).
- **Cron**: `GET /api/cron/dispatch-alerts` with `Authorization: Bearer CRON_SECRET` sends due pushes.

Icons: `app/manifest.ts` uses `/icons/icon.svg`. For stricter iOS/Android install prompts, add `public/icons/icon-192.png` and `icon-512.png` (PNG) and register them in `manifest.ts`.

`public/manifest.json` is not used; Next.js emits `/manifest.webmanifest` from `app/manifest.ts`.
