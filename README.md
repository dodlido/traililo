# TraiLilo

A private adventure journal: itineraries, hikes, stays and routes. It does not book anything.

The website holds **no trip data**. Trips live in a private Supabase database; you sign in with email and password plus a
two-step code, and the database itself refuses to return anything before both. Friends you share a trip with see the
friends' version (no bookings, to-dos or private notes); only the owner sees the full one.

- `supabase/schema.sql`: tables and privacy rules (run once in the Supabase SQL editor)
- `src/config.ts`: the project address and public anon key
- `node scripts/build.mjs`: builds the site into `dist/`
