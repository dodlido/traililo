# Decisions

## No friends' view (decided 2026-11-07)

**Decision.** TraiLilo has no read-only "friends' view". A trip is seen by its owner and by travel partners (full access). Showing a trip to friends and family will be done with shareables made for that purpose, one at a time, as we need them.

**What it replaced.** Until now, every save also wrote a second, filtered copy of the trip (`publicVersion()` in `privacy.ts`) that anyone the trip was shared with as a "friend" could read, and the owner could preview it with a "Your view" button.

**Why.**
1. *It was the biggest privacy risk in the app.* The filter worked by deleting known private fields, so any new field was shared by default. A review found Home coordinates, personal names and imported tracks still in the copy, and the database would store whatever the app sent. Keeping a second copy of everything private-except-some-bits means every new feature must also remember to leave itself out of it.
2. *It was always a poor fit for the people it was for.* Friends got an itinerary with no pictures, no journal entries and no recap or film, which is the part worth sharing. The review's photographer persona called this the top problem.
3. *The recap changes the need.* The recap and film are a better thing to show than a stripped copy of the planning app, and they can be built to contain only what is meant to be shown.
4. *Less to maintain.* One version of a trip, one set of access rules, no preview mode, no `shared` flag threaded through the screens.

**What changed.** `privacy.ts`, the friend role, the "Your view" preview, the per-day "show to friends" journal tick and the "Friends see these" hints are gone. Saves store only the map tracks in `trips.data`. `supabase/migration-5.sql` removes existing friend memberships, clears the old friends' copy from `trips.data` and leaves `partner` as the only role.

**What replaces it.** Shareables, designed one by one, each with an explicit list of what it contains (nothing is "everything except"). First candidates: the recap or film as a link or file, a picture or short summary of a day, a printable itinerary. An allowlist, not a filter, is the rule for any of them.


## 2026-11-07: Offline edits are kept on the phone, and the app is split into pieces

**Offline edits.** With no signal, an edit is applied on screen and the whole trip, plus the saved version it was built on, is kept on the phone. It uploads when the signal returns, when the app comes to the front, or every 30 seconds. If the database says the trip changed on another device meanwhile, editing pauses and the owner chooses which version to keep (with a way to save theirs as a file first). Chosen over merging because a trip is saved as one whole and two phones editing offline at once is rare; a wrong silent merge would be worse than one clear question. Signing out deletes everything on the phone, and warns first if something is unsent; a session that ends by itself keeps only unsent edits so a journal entry is never lost silently.

**Speed.** Database calls give up after 8 seconds and the phone's copy opens; the service worker does the same for the app after 4 seconds. The build splits the map, film, booking import and editor maps into pieces fetched on first use, and the service worker precaches all of them, so the first download is about 600 KB and nothing needs a connection afterwards.

**Trip shape.** Every trip carries a `schemaVersion` and goes through `migrate()` wherever it is read, so older or damaged trips never reach a screen in a shape it does not expect. Raise `SCHEMA` and add a step when the shape changes.

**Privacy.** Home positions are rounded before they go to routing (about 1 km) or weather (about 10 km). The Content-Security-Policy is a single list in `scripts/csp.mjs`.
