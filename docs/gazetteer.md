# Gazetteer

The app places every report against a local list of named places from OpenStreetMap, one JSON file per area. A script builds the files and they are committed; the running app never calls OpenStreetMap.

## How it is built

`npm run gazetteer -- <area>` runs `scripts/build-gazetteer.ts`:

1. **One Overpass query** over the area's box from `lib/geo/areas.ts`. It asks for named stations; places of worship, town halls, schools, hospitals, police, post offices, libraries, theatres, cinemas and markets; historic sites; museums, attractions and artworks; parks, gardens, stadiums and forests; bridges; squares and neighbourhoods; and every named road from trunk down to footway, with its line.
2. **A category for each place:** church, metro_station, castle, town_hall, school, hospital, police, park, bridge, street or other, plus a subtype (the kind of road, the kind of "other").
3. **Every name it goes by:** `name`, `name:uk`, `name:fr`, `name:en`, `int_name`, `alt_name`, `short_name`, `official_name`, `old_name`, `loc_name`, `name:ru`, and a Latin spelling of the Ukrainian name, so "Khreshchatyk" matches when OpenStreetMap has no English name.
4. **Duplicates merge:** same name, same category, within 300 m. A station's point wins over its entrance or platform.
5. **Street pieces become streets:** see [Same-name streets](#same-name-streets).
6. **The file is written only when every query succeeded.** Overpass is often busy; the script retries, alternating with a mirror, and leaves the old file alone if it gives up.

The report endpoint loads the file once on the server (`lib/geo/gazetteer.ts`). Name search scans every entry with a cached index. The 100 place names sent to speech-to-text as spelling hints come from the same file, stations first.

Rebuild on purpose, not routinely: OpenStreetMap changes daily, so a rebuild can change counts and, rarely, ids. After one, compare the counts the build prints with the old file, run `npm test` and the scenarios, and update the counts in the README and [architecture.md](architecture.md).

## Same-name streets

OpenStreetMap stores a street as many pieces. The build joins pieces that share a name into one street, then splits that street again where the pieces are clearly two streets:

- Pieces within 150 m of each other are one street, whatever town they are in (a street broken by a junction or a square).
- Pieces in the same town up to 1 km apart are still one street: a town does not give two streets the same name.
- Anything else is a separate street, with the name of its town. The town is the admin area at the area's `townAdminLevel` that contains the street: the commune in France (8), the city for Kyiv (4). One extra Overpass query looks it up, only for names that split.

A report naming such a street is asked back, with the towns as the choices: "Which street: Rue Gambetta (Fontenay-sous-Bois), or Rue Gambetta (Montreuil)?" If the towns do not tell them apart, the question gives each one's distance instead. With a fresh last position, the usual rule applies: the nearest wins if it is clearly nearest.

Ids: a street with a unique name keeps `street/<name>`, for example `street/вулиця-хрещатик`. Streets that share a name get their town: `street/rue-gambetta/montreuil`.

In Vincennes (rebuilt 20 November), 16 names are two streets each, every pair in two different towns: Vincennes, Saint-Mandé, Montreuil, Fontenay-sous-Bois and Bagnolet. Before this rule, each pair was one street, and "on rue Gambetta" never asked which one. Two more names had pieces 200 to 300 m apart in one town and stay one street each. In central Kyiv, three names had pieces 350 to 660 m apart; all are inside the city, so they stay one street each and Kyiv has no same-name streets.

## Adding an area

1. Add the area to `lib/geo/areas.ts`: id, label, place description, centre, zoom, box, hint text and `townAdminLevel`. For the town level, use OpenStreetMap's `admin_level` of the municipality in that country, the level at which street names are unique.
2. Run `npm run gazetteer -- <id>` (needs network).
3. Import the new file in `lib/geo/gazetteer.ts`.
4. Run `npm test`, and try a few typed reports in the web page.

## Scaling the gazetteer

Not needed for the demo; this is the answer to "what would a country take". A city or one oblast is 1 to 2 days of work; a whole country about 1 to 2 person-weeks. Data volume is not the hard part. The build tool, search, and ambiguity over a larger area are.

What Ukraine looks like in OpenStreetMap (Geofabrik's download and tag counts, checked Friday 20 November):

| | Count |
|---|---|
| Download for all of Ukraine | 885 MB (France: 5.1 GB) |
| Objects with a name | 1.10 million |
| Named road pieces (one street is usually several pieces) | 448,000 |
| Settlements | 101 cities, 2,567 towns, 43,054 villages, 5,641 hamlets |
| Places of worship, schools, hospitals, town halls, police | 16,299 · 13,821 · 3,588 · 2,895 · 1,857 |
| Rail stations and halts | 1,979 + 2,799 |

For comparison, central Kyiv today is about 2,100 places in a file under 1 MB over about 27 km². With our filters, Ukraine would be a few hundred thousand places, very roughly 100 to 200 MB as one file like today's. That size is an estimate, not a measurement.

What breaks, in order:

1. **The download.** Overpass is a public service for small queries; a country query will not run there. Download Geofabrik's file and filter it with osmium instead, which takes minutes on a laptop. The sorting and naming code stays. About 1 day.
2. **Streets with the same name.** Solved for our two areas ([above](#same-name-streets)). Over a country the same rule holds, but the town lookup has to come from the boundaries in the downloaded file instead of Overpass, and the town level differs per country. Part of the day above.
3. **Towns and villages are missing.** Only squares and neighbourhoods are kept, so "I'm in Bucha" cannot be placed. A small change.
4. **Search.** The report endpoint loads the whole file and checks every name on every report. At hundreds of thousands of places, each cold start would load about 150 MB and each search would walk every entry. Use a store with a location index and a name index, and search only around the speaker. One SQLite file per region does both and works the same offline on the laptop; the hosted site can use the same file, or PostGIS. About 2 to 3 days.
5. **Ambiguity.** "Nearest" is measured from the last position or the area's centre. Over a country, a name with no recent position matches hundreds of places. Each session needs an operating area, searched first, and the intent needs a town when one is said ("the church in Irpin"). The 100 place names sent to speech-to-text must come from around the speaker, not the whole area. About 1 to 2 days, plus testing.

How the gazetteers would be managed:

- **Built by a pipeline, never edited by hand.** Each file records the date of its OpenStreetMap data, the script version, counts per category and a checksum, as the voice model does [45].
- **One file per region.** Ukraine has 24 oblasts plus Kyiv city. A laptop or phone loads only its operating area; the hosted server can hold them all.
- **An overlay per operation** for names OpenStreetMap does not have or should not have: nicknames and reference points ("checkpoint 3", "the water tower"), corrections, places that no longer exist. It sits on top of the OpenStreetMap layer and wins where they disagree. The OpenStreetMap layer is public anyway; the overlay is where the sensitive data lives, so access to it needs controlling.
- **Updates on purpose, not automatically.** Geofabrik publishes daily. On a rebuild: compare it with the previous version (counts per category, places renamed or removed), run the scenario and evaluation tests, then switch over. Never mid-operation. Each saved report records which version placed it, so it replays exactly. The comparison matters more in Ukraine, where contested areas may be edited, vandalised or deliberately left blank.
- **Licence.** OpenStreetMap data is under the ODbL. A gazetteer built from it must credit OpenStreetMap, and a database handed to others outside the team must carry the same licence. Whether an overlay counts as part of that database needs a proper check before anything ships.
