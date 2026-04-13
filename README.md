# Gothenburg Parking Guardian

> **Fine prevention, not just parking info.** A production-grade PWA that saves Gothenburg drivers from 1,300 SEK+ fines by combining real geospatial data, a Swedish rules parser, and proactive push alerts — all in a sub-100ms interactive map.

---
<img width="684" height="678" alt="Screenshot 2026-04-13 at 16 57 03" src="https://github.com/user-attachments/assets/65a4a740-5304-4d76-ab86-95fffe71c6d1" /><img width="1707" height="919" alt="Screenshot 2026-04-13 at 13 52 45" src="https://github.com/user-attachments/assets/b498425d-7340-4356-95b3-0e1812931f43" />
<img width="1709" height="934" alt="Screenshot 2026-04-13 at 13 53 41" src="https://github.com/user-attachments/assets/45219e4b-f048-4c15-9d71-ce70834f5074" />
<img width="1709" height="918" alt="Screenshot 2026-04-13 at 16 55 40" src="https://github.com/user-attachments/assets/3b91281e-c20e-4045-a744-6e5e2932ee3d" />
<img width="1709" height="905" alt="Screenshot 2026-04-13 at 16 56 22" src="https://github.com/user-attachments/assets/bb3f9686-2bcb-4583-b8d4-8e6bd674bacd" />
<img width="619" height="858" alt="Screenshot 2026-04-13 at 19 28 28" src="https://github.com/user-attachments/assets/bd1b3852-c9cf-4b07-a1cc-d33986b5d9e4" />

## Why This Exists

Parking in Gothenburg is a trap for the uninitiated. Signs say things like `Vardagar 09-18 (09-15) Städning 1:a–3:e torsdag varje månad 09-14` — and getting it wrong costs 1,300 SEK. Existing solutions (the city's own P-karta, Google Maps) show you where to park. They don't tell you **when you'll get fined**.

GPG is built around a single principle: **surface the dangerous exceptions before the user ever parks**, not after.

---

## Differentiators

| What | Why it matters |
|------|----------------|
| **Swedish Rules Parser** (`src/lib/parser.ts`) | Converts raw Swedish sign text into typed, machine-readable `ParkingSchedule` JSON. Handles `Vardagar`, `Lördag`, `Röd dag`, bracket exceptions, and multi-rule strings. |
| **Real Gothenburg geometry** | Taxa zone polygons are imported from the city's live GeoServer/WFS pipeline (`scripts/import_taxa_to_supabase.ts`), not hand-drawn or approximated. |
| **PostGIS point-in-zone** | `cleaning_zone_at_point`, `get_taxa_in_bounds` and related RPCs run spatial queries server-side via Supabase. No client-side polygon math on large datasets. |
| **DST-aware Stockholm time** | All temporal decisions (schedule windows, alert dispatch, cron) use `Europe/Stockholm` with correct DST offsets — never UTC shortcuts. |
| **Proactive Web Push (VAPID)** | Alerts fire **12 h and 1 h before** cleaning starts, while the car is still parked safely. Not a post-incident notification. |
| **Installable PWA** | Service worker + `app/manifest.ts` = full offline shell, home-screen install, background push delivery. |

---

## Architecture

```mermaid
flowchart TD
    subgraph EXT["🌐  External Sources"]
        OD["Gothenburg Open Data\nParkingService v2.3"]
        WFS["GeoServer · WFS\nTaxa geometry"]
        MB["Mapbox\nTile API"]
    end

    subgraph PIPE["📦  Import Pipeline"]
        S1["sync_cleaning_zones.ts"]
        S2["import_taxa_to_supabase.ts"]
    end

    subgraph DB["🗄️  Supabase · PostGIS"]
        T1[("cleaning_zones")]
        T2[("parking_taxa_zones")]
        T3[("push_subscriptions")]
        T4[("scheduled_push_alerts")]
        RPC{{"PostGIS RPCs\ncleaning_zone_at_point · get_taxa_in_bounds"}}
        T1 & T2 --- RPC
    end

    subgraph SERVER["⚙️  Next.js 14 · Vercel"]
        A1["/api/cleaning-zones"]
        A2["/api/parking-taxa"]
        A3["/api/cleaning-zone-preview"]
        A4["/api/parking/check-in"]
        A5["/api/push/register"]
        A6["⏱  /api/cron/dispatch-alerts\nevery 5 min"]
    end

    subgraph CLIENT["📱  Browser · PWA"]
        MAP["CleaningSafetyMap\nMapbox GL"]
        BAR["ParkHereBar\nCheck-in · Countdown"]
        PARSER["Swedish Rules Parser\nparser.ts"]
        SW["Service Worker\nWorkbox · push-handler.js"]
        MAP & BAR --> PARSER
    end

    OD --> S1 --> T1
    WFS --> S2 --> T2
    MB --> MAP

    RPC --> A1 & A2 & A3
    A1 & A2 --> MAP
    A3 --> BAR
    A4 -- "queue alert" --> T4
    A5 -- "upsert" --> T3
    T4 & T3 --> A6
    A6 -- "VAPID Web Push" --> SW

    style EXT    fill:#F9FAFB,stroke:#9CA3AF,color:#374151
    style PIPE   fill:#F5F3FF,stroke:#8B5CF6,color:#4C1D95
    style DB     fill:#FFF7ED,stroke:#F59E0B,color:#78350F
    style RPC    fill:#FEF3C7,stroke:#D97706,color:#78350F
    style SERVER fill:#EFF6FF,stroke:#3B82F6,color:#1E3A8A
    style CLIENT fill:#F0FDF4,stroke:#10B981,color:#065F46
```

---

## Core Features

### 1. Cleaning Zone Overlay
- Fetches city `CleaningZones` via `scripts/sync_cleaning_zones.ts` into Supabase.
- Map renders LineString / MultiLineString / Polygon via a GeoJSON source + Mapbox line layer.
- Color-coded by **time-to-cleaning**: red (< 1 h), amber (< 12 h), green (safe).

### 2. Parking Taxa (Taxeområde) Visualization
- Real geometry imported from Gothenburg's open data WFS/GeoServer endpoint into `parking_taxa_zones`.
- `GET /api/parking-taxa?bbox=...` returns FeatureCollection; Mapbox line layer colored by `taxa_name` and hourly rate.
- Supports taxa comparison at zone borders — the exact moment a cheaper zone begins.

### 3. Park Here Check-In
- One-tap check-in stores a `ParkingSession` client-side.
- At check-in: queries taxa at GPS point, previews the next cleaning window, and inserts a row into `scheduled_push_alerts` for 12 h and 1 h pre-cleaning delivery.
- Session survives page refresh; countdown timer shows remaining safe-park time.

### 4. Proactive Push Alerts
- `POST /api/push/register` upserts VAPID `PushSubscription`.
- `GET /api/cron/dispatch-alerts` (Vercel Cron, every 5 min) queries due alerts and sends Web Push via `web-push` library.
- `public/push-handler.js` (loaded via Workbox `importScripts`) handles `push` and `notificationclick` events in the service worker.

### 5. Swedish Parking Rules Parser
- `src/lib/parser.ts`: tokenizes Swedish schedule strings → structured `DayRule[]` with `{ day, startHour, endHour, isException }`.
- Handles: `Vardagar`, `Lördag`, `Söndag`, `Röd dag`, parenthesized bracket exceptions, and multi-segment rules separated by `,` or `.`.
- Consumed by cleaning-safety helpers and the check-in preview card.

### 6. Resident Zone (Boendeparkering) — Step 2, In Progress
- `ResidentZoneContext` stores the user's home zone (e.g., Zone L, Zone V) in `localStorage`.
- UI modal lets the user set / change zone.
- Planned: taxa pricing override to `Free / Discounted` when the parked point is inside the resident zone; distinct map highlight layer for "my" areas.

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Next.js 14 (App Router) | Server components for zero-client DB calls; file-based API routes |
| Language | TypeScript strict | Spatial + schedule types demand compile-time guarantees |
| Database | Supabase + PostGIS | Managed PG, RPC support, real-time hooks, row-level security |
| Maps | Mapbox GL JS (`react-map-gl`) | Expression-based layer styling for dynamic taxa coloring |
| Styling | Tailwind CSS | Nordic Minimalist design tokens (see `AI.md §3`) |
| Icons | Lucide React | Consistent, tree-shakeable SVG icon set |
| Push | Web Push / VAPID | Browser-native, no third-party push service dependency |
| PWA | `@ducanh2912/next-pwa` | Workbox precaching + custom push handler injection |
| Spatial scripts | `ts-node` + `node-fetch` | WFS → GeoJSON → Supabase bulk upsert pipeline |

---

## Quick Start

```bash
npm install

# Copy and fill in the required env vars (see DEPLOYMENT.md)
cp .env.example .env.local

npm run dev
# → http://localhost:3003
```

Minimum required in `.env.local`:

```env
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Web Push and cron require additional VAPID + `CRON_SECRET` vars — see `DEPLOYMENT.md`.

---

## Database Setup

Apply migrations in order (filenames are the order key):

```bash
# From your Supabase project SQL editor, or via the CLI:
supabase db push
```

Migrations live in `supabase/migrations/` and cover: PostGIS extension, `cleaning_zones`, `parking_taxa_zones`, `push_subscriptions`, `scheduled_push_alerts`, and all RPC definitions (`cleaning_zone_at_point`, `get_taxa_in_bounds`, etc.).

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server on port **3003** |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | Next.js ESLint |
| `npm run import-taxa` | Bulk import taxa geometries from WFS → Supabase |
| `npm run sync-cleaning-zones` | Pull latest cleaning zones from city API → Supabase |
| `npm run verify-cleaning-zone` | CLI: point-in-zone sanity check for a given lat/lng |

---

## Roadmap

- [x] **Step 0** — PostGIS infrastructure, cleaning zones end-to-end
- [x] **Step 1** — Taxa visualization with real geometry (WFS import pipeline)
- [ ] **Step 2** — Resident zone (Boendeparkering) pricing override + map emphasis *(active)*
- [ ] **Step 3** — Time Slider: temporal simulation, morning-rush prediction
- [ ] **Step 4** — Proximity finder: nearest cheaper / safe zone within 20–100 m (Turf.js)

---

## Docs

- **`DEPLOYMENT.md`** — Vercel env vars, cron setup, service worker / PWA notes, VAPID key generation
- **`AI.md`** — Product goals, Gothenburg Parking API reference (`data.goteborg.se/ParkingService/v2.3/`), design tokens, full roadmap

---

## License

Private / project use unless stated otherwise.



