# Voice-to-Map: instructions for coding agents

This file is the one set of project instructions for every coding agent on the team: Claude Code and Codex both read `AGENTS.md`. Put project rules here (or in `transmitter/AGENTS.md` for the app), not in a tool-specific file such as `CLAUDE.md`, so every agent sees the same rules.

EDTH Paris 2026, challenge 01 (Lysk): spoken position reports become live map updates, and the app asks back instead of guessing when a report could mean more than one place.

## Read first

- `docs/README.md`: the index of the design docs, one file per topic: overview, architecture, contracts, plan, gazetteer, open questions, known gaps, glossary. Update the matching file in the same change as the code.
- `README.md`: how the pipeline works, the resolver rules, demo scripts, how to run.
- `DECISIONS.md`: every choice made, one numbered line each. Check it before changing behaviour; a rule that looks odd usually has a decision behind it.
- `CONTRIBUTING.md`: setup, checks and working agreements for the four of us.

## Layout

```
app/api/report/route.ts     the coordinator: POST multipart (audio | text, area, lastPosition, clientTs)
lib/providers/              Transcriber and IntentExtractor interfaces, Mistral implementations
lib/geo/resolver.ts         pure resolver: intent + last position + gazetteer -> pin, question or prompt
lib/geo/types.ts            shared types; the transmitter imports them, so this is a contract
data/gazetteer.<area>.json  place data from OpenStreetMap (vincennes, kyiv); rebuilt by a script, not by hand
components/VoiceMapApp.tsx  the phone web page
lib/tts/                    Ukrainian voice in the browser (onnxruntime-web)
scenarios/                  scripted reports with expected answers
transmitter/                native app (Expo); its own package.json, tooling and AGENTS.md
tests/                      vitest
docs/                       design docs, one Markdown file per topic; start at docs/README.md
```

## Commands

```bash
npm install
npm run dev -- -p 3117      # port 3117, not 3000
npm test                    # unit tests; no network or key needed
npx tsc --noEmit            # type-check (excludes transmitter/)
npm run lint
npm run gazetteer -- kyiv   # rebuild data/gazetteer.<area>.json from Overpass (network)
npm run scenarios           # regenerate scenario clips (macOS only, uses `say`)
```

Run `npm test`, `npx tsc --noEmit` and `npm run lint` before calling a task done. If you changed `lib/geo/types.ts`, also run `npx tsc --noEmit` in `transmitter/`.

Anything that calls Mistral needs `MISTRAL_API_KEY` and network access (see `.env.example`). A sandbox without network can run the tests, not the live pipeline.

## Rules

- The language model never produces coordinates. It extracts intent; `lib/geo/resolver.ts` places it against the gazetteer. Do not add a path where a model output becomes a position.
- The app never reads the phone's GPS.
- When a report is ambiguous, ask back. Do not add silent guesses.
- Providers stay European and behind the interfaces in `lib/providers/`. Do not add a US-hosted service to the request path (decision 42).
- Record every choice in `DECISIONS.md`: append one numbered line at the end. If someone else appended at the same time, keep both lines and renumber yours.
- Secrets live in env vars only. The repo is public.
- `lib/geo/types.ts` and the fields of `POST /api/report` are a contract with the transmitter and the receiver. Change them on purpose, and say so in the decision line.
- Do not deploy to production, push, or move the `prior-work-fri-1800` tag unless the person you are working for asks.
- Write user-facing text and docs in plain, short sentences, in the same style as `README.md` and `DECISIONS.md`.
- The docs live only in this repo, as Markdown. Do not create or update copies in other tools (Claude Docs, Google Docs, Notion); not everyone on the team uses them.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
