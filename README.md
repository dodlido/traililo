# TraiLilo

A private adventure journal: itineraries, hikes, stays and routes. It does not book anything.

The website holds **no trip data**. Trips live in a private Supabase database; you sign in with email and password plus a
two-step code, and the database itself refuses to return anything before both.

## Who sees what

| Role | Sees | Can edit |
| --- | --- | --- |
| Owner | everything | yes |
| Travel partner | everything | yes (same editing rights as the owner, except deleting the trip and sharing it) |

There is no read-only "friends' view". A trip is yours, or you add a travel partner by email from the trip's page (`share_trip`, `unshare_trip`, `list_members`). Showing a trip to friends and family
will be done with purpose-made shareables (the recap and film are the first candidates), not with a second copy of the whole app. The reasoning is in [docs/decisions.md](docs/decisions.md).

## What it does

- **Journey**: day-by-day chapters with hikes, activities, getting-there legs, stays, notes and a per-day journal (text and photos). Reorder entries with Up/Down.
- **Map**: MapLibre with four looks (Old West, Dark, Terrain, Satellite). Pins and emblems per kind of place, tonight's bed highlighted, hike trails, routes on roads and water, flight arcs, and a day bar that keeps the map and journey on the same day.
- **Map edit mode**: press Edit on the map, tap anywhere (or an existing dot), and choose what to add; the tapped spot becomes its start.
- **Getting there**: every mode (drive, bus, taxi, ferry, flight) uses the same legs editor with a required start and end found by search or by tapping the map. Roads come from OSRM, ferries follow charted ferry lines from OpenStreetMap where there is one, and a live mini-map shows each leg's distance and time with a total.
- **Hikes**: either from a link (GPX, AllTrails, GetYourGuide) or by hand (waypoints you search for or pin, in order).
- **Hand-drawn routes**: lines on the map that also appear as entries in the journey and can be edited.
- **Place search and map fields** everywhere show the whole plan (stays, hikes, activities, travel stops, spots) as labelled dots, plus every trail and drive as lines, centred on the day being edited.
- **Plan tab**: what to book per day, weather per region and a packing list. Weather (`weather.ts`) is the Open-Meteo forecast when a day is within about two weeks, otherwise the same dates last year; each day also shows its weather (`DayWeather.tsx`). The packing list (`packing.ts`) is generated from the trip, then you tick, add and remove items.
- **Today mode**: while the trip is on, the journey opens on today's chapter; before it starts the home screen counts down the days (`today.ts`).
- **Home**: a "Home" kind of place to sleep whose position is set once on the account (`home.ts`), never stored in a trip.
- **Restaurants and nights out**: `meal` and `hang` entries with time, party size and a booking.
- **Journal entries**: add a "Journal" entry anywhere in a day, between activities (also from the gaps between entries). It holds your words and the Drive pictures you pin to it. Private to the trip's owner and partners.
- **Trail files**: every hike with a trail has an "Open in maps app" button. It hands the trail as a GPX file to the phone's share sheet (Organic Maps, CoMaps, Maps.me, OsmAnd, Gaia and so on), or downloads it on a computer. Use that app for offline maps and live tracking; TraiLilo does not store map tiles. The service worker (`public/sw.js`) keeps every file of the app (the build writes the list in), so the app opens with no signal even if the map or the film was never opened on that phone; after 4 seconds without an answer it serves its saved copy.
- **Booking import**: in the place-to-sleep editor, paste a Booking.com or Airbnb confirmation email and the form fills in the name, dates, confirmation number, address, phone, PIN, free-cancellation deadline and a map pin. The text is read in the browser (`bookingEmail.ts`) and never stored. The address, phone and PIN go in the private notes. Booking.com emails in English or Hebrew, Airbnb emails in English (Airbnb's map link also gives the exact pin); whatever is not found is left blank for you to fill in.
- **Import bookings** (journey page, edit mode): takes a file of parsed confirmations, or one pasted GetYourGuide email (`activityEmail.ts`), matches each booking to a stay by night and name or to an activity by date, shows what it will change, and only saves what you tick.
- **Find bookings in my Gmail**: the same screen can search your own Gmail (read-only, `gmail.readonly`) for the last months of mail from Booking.com, Airbnb and GetYourGuide (`gmail.ts`, `mailImport.ts`). Emails are read on the device and not sent anywhere; the access token lives in memory for about an hour; only the ids of emails that were not about this trip are remembered. It keeps bookings inside the trip's dates, merges several emails about one booking, and sets cancelled ones aside. It is hidden unless the build has a Google client id.
- **Pictures**: chosen in Google Photos (the Photos picker) and saved to a folder the app makes in the owner's own Google Drive (`drive.file` scope, `drive.ts`, `DrivePhotos.tsx`). The trip stores only Drive file ids and, when Google passes it on, where each picture was taken. Nothing else of the pictures is on the server. Place photos from Wikimedia Commons (`photos.ts`) and the owner's own cover photos per place (Supabase storage, `migration-3.sql`) are separate.
- **Recap** (after or during the trip): cover, numbers, route, automatic highlights you can hide, and each place with what was written on a day over that day's pictures (`Recap.tsx`, `recap.ts`).
- **Play the journey**: a film of the trip (`film.ts`, `Film.tsx`): 3D satellite terrain, the route drawing itself, the camera following the road, stops with pictures and journal text, polaroids on the way, a live odometer, a scrubber, speeds, and an end card. Pictures go to the stop where they were taken when they carry a location and the nearest stop is close enough (stop 1.2 km, rough point 6 km, hike 2.5 km, road 0.4 km, night's place 0.5 km), and otherwise by the time they were taken; pictures pinned to a journal entry always win. The start screen says how many were placed which way. Length scales with the trip (about a minute for 3 days, about three and a half for 36). Satellite and elevation tiles come from public servers (Esri, Terrarium on AWS).
- **Export**: "Export trip" saves the whole trip, private notes included, as one JSON file made on the device.

## Layout

- `src/` React 19 + TypeScript, bundled with esbuild
  - `App.tsx` shell, tabs, sheets; `MapView.tsx` the map; `Edit.tsx` editors and `PlaceSearch`; `Pick.tsx` tap-to-pin map, plan dots and lines, route mini-map
  - `roads.ts`, `ferry.ts`, `autoroute.ts` routing; `backend.ts` Supabase calls and roles
  - `Plan.tsx`, `weather.ts`, `packing.ts`, `Journal.tsx`, `OpenTrail.tsx`, `DriveGap.tsx` (one-tap legs and journal entries between entries)
  - `bookingEmail.ts`, `activityEmail.ts`, `mailImport.ts`, `gmail.ts`, `ImportBookings.tsx` booking import and Gmail search
  - `drive.ts`, `DrivePhotos.tsx`, `Pic.tsx` pictures; `recap.ts`, `Recap.tsx`, `film.ts`, `Film.tsx` recap and film
  - `today.ts`, `home.ts`, `totals.ts`, `derive.ts`, `geo.ts`, `exportTrip.ts`, `ui.ts` (text size)
  - `migrate.ts` (brings any saved trip to the current shape; raise `SCHEMA` there when the shape changes), `same.ts`, `SyncBar.tsx`, `ErrorBoundary.tsx`, `dialog.ts`, `PickMap.tsx` (editor maps, loaded on demand)
- `supabase/schema.sql` tables, privacy rules and functions; run once in the SQL editor, then `migration-2.sql` to `migration-6.sql` in order (`migration-3.sql` makes the photo bucket; `migration-5.sql` removes the friends' view; `migration-6.sql` moves Home out of the account metadata into its own table, and tightens `share_trip` and picture reads)
- `src/config.ts` the project address and public anon key (never put the service-role key anywhere in this repo)
- `node scripts/build.mjs` builds the site into `dist/`; pushing to `main` publishes it to GitHub Pages. Optional build settings (environment variables): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (override `src/config.ts`) and `GOOGLE_CLIENT_ID` (the public id of the Google project; without it Gmail import and Drive pictures are hidden). The Google project stays in Testing mode, with the owner's account as a test user.

## Offline and weak signal

- Edits made with no signal stay on the phone (the whole trip and the version it was built on) and upload when the signal returns, when the app comes to the front, or every 30 seconds. A bar at the top says so. If the trip was also changed on another device meanwhile, editing pauses until you choose which version to keep (with an option to save yours as a file first).
- Database calls give up after 8 seconds and open the copy kept on the phone. Signing out deletes everything kept on the phone, and warns first if something has not been uploaded. A session that ends by itself keeps only the unsent changes.
- The first download is about 600 KB; the map, the film, the booking import and the editor maps load when first used (`scripts/build.mjs` splits them).
- `npm run check` (types) and `npm test` (`test/`, Node's own test runner) run before every deploy.

## Known limits

- The page carries a Content-Security-Policy (`scripts/csp.mjs`, the one list of outside services the app may contact) and sends only the site address, never the page path, to other sites. When the app starts using a new service, add it to that list or the browser will refuse the request (the console says "Refused to ...").

- Ferries without a charted line stay straight; trek lines between points are straight segments.
- Routing, place names and weather depend on public services (OSRM, Overpass, Nominatim, Open-Meteo) and can be slow or unavailable; the editors fall back to straight lines and coordinates.
- Sharing with a travel partner (a second real account) has not yet been tested end to end.
- Locations for pictures: it is not verified with real Google that the Photos picker and the Drive copy keep each picture's location. If the film's start screen says pictures were placed by time because they carry no location, journal entries are the way to fix a mismatch.
- The film and its terrain have only been checked with test data and a software renderer, not on a real phone with real tiles; a looked-up picture location is kept for the session only; a film already playing does not re-place pictures when locations arrive late; hike tracks are not drawn in the film.
- There is no way yet to show the trip to friends and family; see "Next steps".

## Next steps

1. In Supabase, turn off new sign-ups (Authentication, Sign In / Providers, switch off "Allow new users to sign up"). The app only signs in; accounts, including a travel partner's, are created by you under Authentication, Users.
1. Create two test accounts and check travel-partner sharing end to end.
2. Verify on a phone: the "Open in maps app" share sheet with the chosen maps app, real map tiles, weather, the live routing services, and the film on real terrain.
3. Check with real Google whether the pictures keep their location, and keep an eye on the film's speed on older phones.
4. Fill in the remaining trail gaps and "needs checking" flags.
5. Shareables for friends and family, built as we go (the recap or film as a read-only link or file is the first candidate; no private data in it).
6. Optional per-day "just me" journal setting for partners.
7. Make the highlighted bed more prominent where pins overlap.
8. Ideas: background music, saving the film as a video, remembering picture locations between sessions, moving a picture to another day.
