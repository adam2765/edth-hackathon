# Decisions

One line each, numbered, newest last.

1. Repo lives in `~/Code/Apps/edth-hackathon` (Alex, section 10), private GitHub repo `beverage/edth-hackathon`.
2. No Vercel team called `edth-hackathon` exists on the account, so the project `edth-hackathon` is deployed under the only team, "Beverage" (`beverage2`). Move it when a team exists.
3. Next.js 16.4.6 from `create-next-app`, App Router, TypeScript, no Tailwind (plain CSS keeps the page small), npm.
4. Removed `cacheComponents` and `partialPrefetching` from the scaffolded `next.config.ts`; the app is one client page plus one dynamic POST route and needs neither.
5. MapLibre GL v6 loads its worker from `import.meta.url`, which the Next bundler rewrites; `scripts/copy-maplibre-worker.mjs` copies the worker to `/public` before dev and build, and the app calls `setWorkerUrl`.
6. Map style is OpenFreeMap `https://tiles.openfreemap.org/styles/liberty` (checked on openfreemap.org quick start, 20 Nov); attribution shown uncompacted.
7. Speech-to-text model is `voxtral-mini-transcribe-3`, not `voxtral-mini-latest`: the current Mistral docs recommend it and `voxtral-mini-2602` (behind `-latest`) is past its 31 Oct 2026 deprecation date. Overridable with `MISTRAL_STT_MODEL`.
