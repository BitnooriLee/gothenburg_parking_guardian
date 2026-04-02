# Gothenburg Parking Guardian

PWA for parking and **street cleaning safety** in Göteborg: Mapbox map, cleaning zones overlay, check-in with Web Push reminders.

## Stack

- **Next.js 14** (App Router) · TypeScript · Tailwind (utility classes in components)
- **Mapbox GL** · **Supabase** + PostGIS · **Web Push** (VAPID)

## Quick start

```bash
npm install
# Create .env.local with keys from DEPLOYMENT.md (Mapbox, Supabase, VAPID, etc.)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Set `NEXT_PUBLIC_MAPBOX_TOKEN` in `.env.local` for the map.

## Docs

- **`DEPLOYMENT.md`** — environment variables, Vercel, Supabase migrations, PWA / service worker notes
- **`AI.md`** — product context and data sources

## Scripts

| Command        | Description        |
|----------------|--------------------|
| `npm run dev`  | Development server |
| `npm run build`| Production build   |
| `npm run start`| Run production     |

## License

Private / project use unless stated otherwise.
