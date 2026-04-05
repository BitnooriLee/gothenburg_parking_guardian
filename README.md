# Gothenburg Parking Guardian

PWA for **parking cost awareness** and **street cleaning safety** in Göteborg: Mapbox map, cleaning zones and parking taxa (price zone) overlays, **Park Here** check-in with optional Web Push reminders.

## Stack

- **Next.js 14** (App Router) · TypeScript (strict) · Tailwind CSS
- **Mapbox GL** (`react-map-gl`) · **Supabase** + **PostGIS** · **Web Push** (VAPID) · **Lucide** icons
- **PWA**: `@ducanh2912/next-pwa` (see `DEPLOYMENT.md` for service worker / push handler notes)

## What’s implemented (high level)

- **Cleaning zones**: Bbox fetch from Supabase RPC, GeoJSON on the map (LineString / MultiLineString / polygon handling). Point-in-zone and proximity helpers via migrations (e.g. `cleaning_zone_at_point`, related RPCs).
- **Parking taxa (Taxeområde)**: `parking_taxa_zones` + `get_taxa_in_bounds` and point/radius lookups; Mapbox line layer colored by taxa / hourly rate. **Real geometry** is imported from Gothenburg open data (WFS / GeoServer pipeline) using `scripts/import_taxa_to_supabase.ts` (see `AI.md` for context).
- **Park Here bar**: Check-in stores session client-side; integrates taxa at point, cleaning schedule preview, and optional push scheduling when Supabase + VAPID + subscription exist.
- **Resident zone (early)**: Device-local “home” zone profile (`ResidentZoneContext` / modal) to align taxa labels such as `Boende {zone}` with user choice — full Step 2 logic is still in progress (`AI.md`).
- **Swedish rules parsing**: `src/lib/parser.ts` and cleaning schedule utilities (`cleaning-safety`, DB JSONB) — ongoing hardening for edge cases.
- **API routes** (App Router): `cleaning-zones`, `parking-taxa`, `cleaning-zone-preview`, `parking/check-in`, `push/register`, `push/vapid-public`, `cron/dispatch-alerts`, `admin/sync` (see `DEPLOYMENT.md`).

Time-sensitive logic is intended to follow **Europe/Stockholm** (including DST); see codebase comments and `AI.md`.

## Quick start

```bash
npm install
# Create .env.local — see DEPLOYMENT.md (Mapbox, Supabase, VAPID, CRON_SECRET, etc.)
npm run dev
```

Open [http://localhost:3003](http://localhost:3003). Set `NEXT_PUBLIC_MAPBOX_TOKEN` in `.env.local` for the map.

## Docs

- **`DEPLOYMENT.md`** — environment variables, Vercel cron, Supabase migrations, PWA / Web Push
- **`AI.md`** — product goals, Gothenburg Parking API reference, roadmap (Steps 2–4)

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Dev server (port **3003**) |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | Next.js ESLint |
| `npm run import-taxa` | Bulk import taxa geometries into Supabase (`scripts/import_taxa_to_supabase.ts`) |
| `npm run sync-cleaning-zones` | Sync cleaning zones from city API (`scripts/sync_cleaning_zones.ts`) |
| `npm run verify-cleaning-zone` | Point-in-zone verification helper (`scripts/verify_cleaning_zone_at_point.ts`) |

## Database

Apply SQL under **`supabase/migrations/`** on your Supabase project (PostGIS, cleaning zones, taxa zones, push subscriptions, scheduled alerts, RPCs). Order is defined by migration filenames.

## License

Private / project use unless stated otherwise.
