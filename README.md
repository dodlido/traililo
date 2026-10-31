# TraiLilo

A private adventure journal: itineraries, hikes, stays and routes. It does not book anything.

The website holds **no trip data**. Trips live in a private Supabase database; you sign in with email and password plus a
two-step code, and the database itself refuses to return anything before both.

## Who sees what

| Role | Sees | Can edit |
| --- | --- | --- |
| Owner | everything | yes |
| Travel partner | everything | yes (same editing rights as the owner, except deleting the trip and sharing it) |
| Friend | the friends' version: no bookings, to-dos, packing, private notes or unshared journals | no |

Sharing is by email from the trip's page (`share_trip`, `unshare_trip`, `list_members`). The friends' version is built by
`publicVersion()` in `src/privacy.ts`, and the database stores it separately from the full trip.

## What it does

- **Journey**: day-by-day chapters with hikes, activities, getting-there legs, stays, notes and a per-day journal (text and photos). Reorder entries with Up/Down.
- **Map**: MapLibre with four looks (Old West, Dark, Terrain, Satellite). Pins and emblems per kind of place, tonight's bed highlighted, hike trails, routes on roads and water, flight arcs, and a day bar that keeps the map and journey on the same day.
- **Map edit mode**: press Edit on the map, tap anywhere (or an existing dot), and choose what to add; the tapped spot becomes its start.
- **Getting there**: every mode (drive, bus, taxi, ferry, flight) uses the same legs editor with a required start and end found by search or by tapping the map. Roads come from OSRM, ferries follow charted ferry lines from OpenStreetMap where there is one, and a live mini-map shows each leg's distance and time with a total.
- **Hikes**: either from a link (GPX, AllTrails, GetYourGuide) or by hand (waypoints you search for or pin, in order).
- **Hand-drawn routes**: lines on the map that also appear as entries in the journey and can be edited.
- **Place search and map fields** everywhere show the whole plan (stays, hikes, activities, travel stops, spots) as labelled dots, plus every trail and drive as lines, centred on the day being edited.
- **Plan tab** (editors only): what to book per day, weather per region (Open-Meteo), and a packing list.
- **Trail files**: every hike with a trail has an "Open in maps app" button. It hands the trail as a GPX file to the phone's share sheet (Organic Maps, CoMaps, Maps.me, OsmAnd, Gaia and so on), or downloads it on a computer. Use that app for offline maps and live tracking; TraiLilo does not store map tiles. The service worker (`public/sw.js`) only keeps the app itself so it opens on a weak signal.

## Layout

- `src/` React 19 + TypeScript, bundled with esbuild
  - `App.tsx` shell, tabs, sheets; `MapView.tsx` the map; `Edit.tsx` editors and `PlaceSearch`; `Pick.tsx` tap-to-pin map, plan dots and lines, route mini-map
  - `roads.ts`, `ferry.ts`, `autoroute.ts` routing; `backend.ts` Supabase calls and roles; `privacy.ts` the friends' version
  - `Plan.tsx`, `weather.ts`, `packing.ts`, `Journal.tsx`, `OpenTrail.tsx`
- `supabase/schema.sql` tables, privacy rules and functions; run once in the SQL editor, then `migration-2.sql` to `migration-4.sql` in order
- `src/config.ts` the project address and public anon key (never put the service-role key anywhere in this repo)
- `node scripts/build.mjs` builds the site into `dist/`; pushing to `main` publishes it to GitHub Pages

## Known limits

- Ferries without a charted line stay straight; trek lines between points are straight segments.
- Routing, place names and weather depend on public services (OSRM, Overpass, Nominatim, Open-Meteo) and can be slow or unavailable; the editors fall back to straight lines and coordinates.
- Sharing with a second real account has not yet been tested end to end.

## Next steps

1. Create two test accounts and check friend and partner sharing end to end.
2. Verify on a phone: the "Open in maps app" share sheet with the chosen maps app, real map tiles, weather, and the live routing services.
3. Trip recap page for after the trip.
4. Photos for places that have none yet; fill in the remaining trail gaps and "needs checking" flags.
5. Optional per-day "just me" journal setting for partners.
6. Make the highlighted bed more prominent where pins overlap.
