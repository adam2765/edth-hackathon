# Decisions

One line each, numbered, newest last.

1. Repo lives in `~/Code/Apps/edth-hackathon` (Alex, section 10), pushed to the private GitHub repo `beverage/edth-hackathon` on Alex's go-ahead.
2. No Vercel team called `edth-hackathon` exists on the account, so the project `edth-hackathon` is deployed under the only team, "Beverage" (`beverage2`). Move it when a team exists.
3. Next.js 16.4.6 from `create-next-app`, App Router, TypeScript, no Tailwind (plain CSS keeps the page small), npm.
4. Removed `cacheComponents` and `partialPrefetching` from the scaffolded `next.config.ts`; the app is one client page plus one dynamic POST route and needs neither.
5. MapLibre GL v6 loads its worker from `import.meta.url`, which the Next bundler rewrites; `scripts/copy-maplibre-worker.mjs` copies the worker to `/public` before dev and build, and the app calls `setWorkerUrl`.
6. Map style is OpenFreeMap `https://tiles.openfreemap.org/styles/liberty` (checked on openfreemap.org quick start, 20 Nov); attribution shown uncompacted.
7. Speech-to-text model is `voxtral-mini-transcribe-3`, not `voxtral-mini-latest`: the current Mistral docs recommend it and `voxtral-mini-2602` (behind `-latest`) is past its 31 Oct 2026 deprecation date. Overridable with `MISTRAL_STT_MODEL`.
8. Extraction model is `mistral-small-latest` with `response_format: json_schema` (strict). Measured on 20 Nov: 0.55-0.85 s and more accurate than `ministral-8b-latest` (0.75-1.3 s). Overridable with `MISTRAL_EXTRACT_MODEL`.
9. Mistral STT verified live with m4a (iOS) and webm/opus (Android): both accepted, ~0.3-0.9 s for a 3 s clip. `return_language=true` returns the detected language.
10. `context_bias` is sent as a repeated multipart field, capped at 100 terms (150 were accepted; 100 was the old documented cap). Terms are ordered stations, castle, town halls, churches, police, hospitals, bridges, parks, other POIs, major streets.
11. Gazetteer box S 48.835 W 2.410 N 48.856 E 2.460 as briefed; 889 features (6 stations, 11 churches, 2 town halls, 1 castle, 464 streets). Duplicates (same name and category within 300 m) are merged; streets are merged by name and keep their polylines.
12. RER "Vincennes" is in `metro_station` (subtype `rail`): the intent schema has no separate rail category, and people say "the station" for both.
13. Only Christian places of worship are `church`; others are `other` with a subtype, so "the church" never offers a synagogue or Kingdom Hall.
14. Name matching: canonical tokens (accents folded, st→saint, street/road→rue, church→eglise, castle→chateau), score = 0.6 recall + 0.25 precision + 0.15 contiguous phrase; good match ≥ 0.7 and within 0.1 of the best. An exact name match drops partial ones ("Châtelet du Château de Vincennes").
15. A category narrows a shared name only when a category word is said outside the name (checked deterministically on the transcript), so "the château de Vincennes" stays ambiguous and "the Château de Vincennes metro station" resolves.
16. A name said as only category words ("the church", "la mairie") is treated as a category search, whatever the model returns.
17. A name not in the gazetteer with a category falls back to asking among that category; it never auto-resolves.
18. Each candidate carries its own precomputed placement (pin, radius, heading), so tapping a choice needs no second server call.
19. Streets: pin is the point on the street nearest the last position; with no last position, the street's middle vertex with a radius of half its extent (max 400 m). Parks and the château use their own extent (max 500 m) as minimum radius.
20. "Towards" with no last position draws only a target ring, since there is no origin for an arrow.
21. A movement report does not refresh the last-position timestamp: the speaker's location is not newly known.
22. Mic is released after each clip so iOS plays the spoken question through the speaker, not the earpiece. Cost: a short mic start-up on each press.
23. Hold-to-talk with a 400 ms threshold; a shorter tap (or a release during the permission prompt) switches to tap-to-stop. Clips under 350 ms are discarded.
24. Rate limit is per serverless instance, 30 requests per minute per IP; good enough for stage 1, not a security control.
25. Vercel function region pinned to `cdg1` (Paris) so phone → function → Mistral stays in Europe.
26. Local dev uses port 3117 because port 3000 is taken on Alex's machine.
27. Ukrainian speech output will use the Piper voice `uk_UA-ukrainian_tts-medium` (CC0, 77 MB; speakers lada, mykyta, tetiana): Alex, 20 Nov, after hearing sample clips ("much better"). Not wired in yet, so questions still use `speechSynthesis`. The model is in `models/piper/`, ignored locally and not in the repo. Open: which speaker, where it runs, and whether its stress marks work (a rough check was inconclusive). Piper's own engine is GPL-3.0; Claude's proposal is to run the model through onnxruntime (MIT) instead.
28. Central Kyiv is a second area next to Vincennes, not a replacement: each area has its own gazetteer file, the page has a Vincennes / Київ switch, `?area=kyiv` opens Kyiv directly, and `/api/report` takes an `area` field (default `vincennes`).
29. Kyiv box S 50.428 W 30.485 N 50.472 E 30.565 (main railway station to the Lavra, Olimpiiska to Podil): 2,112 features (26 stations, 67 churches, 317 streets, 7 bridges, 5 "town halls", which in Kyiv are the city administration and ministries).
30. Gazetteer names now also keep `name:uk`, `name:ru`, `int_name` and a Latin transliteration of the Ukrainian name (official 2010 system), so "Khreshchatyk" matches where OpenStreetMap has no English name.
31. The name normaliser keeps any script: Cyrillic is kept as written (й and ї are not folded), only Latin accents are folded, and apostrophes inside Cyrillic words are dropped.
32. Ukrainian case endings: the extractor also returns `landmark_name_lemma`, the name in dictionary form ("Софійського собору" → "Софійський собор"). It is a spelling normalisation of what was said, never a new place. The resolver searches both forms, and two Cyrillic words count as the same if their first four or more letters agree and only endings of up to three letters differ.
33. Ukrainian (and common Russian) category words are matched by stem plus case ending ("церкви", "мостом"). "міст" (bridge) is matched exactly only, because "міста" means "of the city".
34. Streets are also indexed without their street word, because people say "на Хрещатику", not "на вулиці Хрещатик". A street and a station of the same name are then both exact matches, and the app asks which.
35. Same-name matches within 120 m of each other (or one inside the other), neither larger than 300 m, are one place: they fold into one candidate and the circle widens to the largest of them. Examples: Bérault station and Place Bérault; Maidan Nezalezhnosti station, square and street. A long street never folds into its station.
36. When no name matches and the spoken name includes type words ("станція метро Хрещатик"), the type words are dropped and only places of that type are searched, so "Gare du Nord" cannot land on "Rue du Nord".
37. Speech-to-text language is not pinned in Kyiv. With the 100 Ukrainian bias terms, short Ukrainian clips stopped coming back as Russian in tests (20 Nov, synthetic voice) and an English clip was still transcribed correctly. The language Mistral reports is unreliable with bias terms (the English clip was reported as `uk`), so the question language comes from the extractor.
38. Language is `en`, `fr` or `uk`. A report in Russian is answered in Ukrainian.
39. Interface text (buttons, status lines, choice subtitles) stays English in stage 1; only the question and the place names are in the speaker's language.
40. Questions name the kind of an "other" place from its OpenStreetMap subtype ("Золоті ворота (театр)"), instead of a generic "(place)".
41. Bias-term order is now stations, castle, town halls, bridges, major streets, churches, parks, police, hospitals, other places (replaces the order in decision 10): street names are what speech-to-text most often gets wrong.
