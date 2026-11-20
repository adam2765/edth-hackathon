# Decisions

One line each, numbered, newest last.

1. Repo lives in `~/Code/Apps/edth-hackathon` (Alex, section 10). Local git only so far; the private GitHub remote (`beverage/edth-hackathon`) waits for Alex's go-ahead.
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
