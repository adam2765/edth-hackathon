# Voice-to-Map: instructions for coding agents

This file is the one set of project instructions for every coding agent on the team: Claude Code and Codex both read `AGENTS.md`. Put project rules here (or in `transmitter/AGENTS.md` for the app), not in a tool-specific file such as `CLAUDE.md`, so every agent sees the same rules.

EDTH Paris 2026, challenge 01 (Lysk): spoken position reports become live map updates, and the app asks back instead of guessing when a report could mean more than one place.

## Read first

- `docs/README.md`: the index of the design docs, one file per topic: overview, architecture, contracts, plan, gazetteer, open questions, known gaps, glossary. Update the matching file in the same change as the code.
- `README.md`: how the pipeline works, the resolver rules, demo scripts, how to run.
- `DECISIONS.md`: every choice made, one numbered line each. Check it before changing behaviour; a rule that looks odd usually has a decision behind it.
- `CONTRIBUTING.md`: setup, checks and working agreements for the four of us.
- `docs/setup.md`: setting up a computer step by step, with a check after each step: the coordinator, offline mode with Ollama, the transmitter on a phone. Follow it when asked to set up a machine or get the project running.

## Layout

```
app/api/report/route.ts     the coordinator: POST multipart (audio | text, area, lastPosition, clientTs, session, callsign, seq)
app/api/answer, app/api/sessions   the tapped choice in; missions: list, open, join, end, delete, and each one's log
app/api/places              place search by name, for a mission's start point
lib/reports/                missions and their logs: entry types (a contract with the receiver and the transmitter), store, record, foldLog
components/Receiver.tsx     the receiver at /receiver: shared map, units, feed, replay; MissionPanel.tsx opens and ends missions
lib/providers/              Transcriber and IntentExtractor interfaces, Mistral implementations
lib/geo/resolver.ts         pure resolver: intent + last position + gazetteer -> pin, question or prompt
lib/geo/types.ts            shared types; the transmitter imports them, so this is a contract
lib/geo/tracks.ts           tracks, things a unit sees and reports: who a report is about, whose a track is, where it is
lib/geo/trackKinds.ts       the kinds of track, their words and their standard symbol codes; safe on the client
data/gazetteer.<area>.json  place data from OpenStreetMap (vincennes, kyiv, izium); rebuilt by a script, not by hand
components/VoiceMapApp.tsx  the phone web page
lib/tts/                    Ukrainian voice in the browser (onnxruntime-web)
scenarios/                  scripted reports with expected answers
evals/                      extraction eval: cases, baselines, saved runs, the prompt journal
.agents/skills/             skills for every agent: prompt-attack, prompt-tune, git-sync, pr (.claude/skills links here)
.agents/hooks/              guard hooks for every agent: secrets, keys, deletes, worktrees (.claude/settings.json, .codex/hooks.json)
transmitter/                native app (Expo); its own package.json, tooling and AGENTS.md
tests/                      vitest
.github/workflows/ci.yml    CI: the checks below, a build and the transmitter's types, on every push to main and every pull request
docs/                       design docs, one Markdown file per topic; start at docs/README.md
```

## Commands

```bash
npm install
npm run build              # build changed components and load phone app when needed
npm start                  # restart servers; leave launching phone app to the person
npm stop                   # stop project processes, including servers and connected phone app
npm run dev -- -p 3117      # port 3117, not 3000; hosted mode, needs MISTRAL_API_KEY
PROVIDER_MODE=local npm run dev -- -p 3117   # offline mode: no key, needs Ollama (docs/setup.md)
npm test                    # unit tests; no network or key needed
npx tsc --noEmit            # type-check (excludes transmitter/)
npm run lint
npm run gazetteer -- kyiv   # rebuild data/gazetteer.<area>.json from Overpass (network)
npm run scenarios           # regenerate scenario clips (macOS only, uses `say`)
npm run eval:extract        # score intent extraction (evals/README.md); needs a key or PROVIDER_MODE=local
npm run eval:outcomes -- --check   # check the eval's expected outcomes against the resolver (no model)
```

Run `npm test`, `npx tsc --noEmit` and `npm run lint` before calling a task done. If you changed `lib/geo/types.ts`, also run `npx tsc --noEmit` in `transmitter/`. CI runs the same checks after a push (`CONTRIBUTING.md`, CI); it does not replace running them first.

A Mistral key is optional. Hosted mode (the default) calls Mistral and needs `MISTRAL_API_KEY` and network access. Offline mode (`PROVIDER_MODE=local npm run dev -- -p 3117`) needs no key: Ollama with `ministral-3:3b` and whisper.cpp/ffmpeg with the host speech models on the same computer (`docs/setup.md`). Never stop work to wait for a key; use offline mode instead. A sandbox without network can run the tests, not the live pipeline.

## Rules

- The language model never produces coordinates. It extracts intent; `lib/geo/resolver.ts` places it against the gazetteer. Do not add a path where a model output becomes a position.
- The app never reads the phone's GPS.
- When a report is ambiguous, ask back. Do not add silent guesses.
- Tracks are for reconnaissance only (decision 145). Nothing is hostile unless the speaker said so, a report about a track never moves the speaker, and the app works out nothing between a unit and a track: no range check, no pairing, no "target" wording.
- Providers stay European and behind the interfaces in `lib/providers/`. Do not add a US-hosted service to the request path (decision 42).
- Work on a branch, never on `main`: one session, one worktree in `.claude/worktrees/`, one branch, one pull request (decision 173). Catch up by merging `origin/main`; never rebase a pushed branch or force-push. The steps are in `CONTRIBUTING.md` (Git workflow); `git-sync` and `pr` are the skills.
- Record every choice in `DECISIONS.md`: append one numbered line at the end. If someone else appended at the same time, keep both lines and renumber yours; on a branch, do it when you merge `main` in. `tests/decisions.test.ts` checks the numbers.
- The hooks in `.agents/hooks/` refuse reading `.env` files, writing keys into files, deleting outside the repo and worktrees outside `.claude/worktrees/`. Do not work around a refusal; ask the person to run the command.
- Secrets live in env vars only. The repo is public.
- `lib/geo/types.ts` and the fields of `POST /api/report` are a contract with the transmitter and the receiver. Change them on purpose, and say so in the decision line.
- Do not deploy to production, push, or move the `prior-work-fri-1800` tag unless the person you are working for asks.
- The extraction prompt (`systemPrompt()` in `lib/providers/extractor.ts`) changes only with an eval run before and after on both models, and no regression against `evals/baselines/` unless the person accepts it. The `prompt-tune` skill is the procedure; `prompt-attack` grows the cases.
- Skills live in `.agents/skills/`, one folder each, so every agent reads the same ones.
- Write user-facing text and docs in plain, short sentences, in the same style as `README.md` and `DECISIONS.md`.
- The docs live only in this repo, as Markdown. Do not create or update copies in other tools (Claude Docs, Google Docs, Notion); not everyone on the team uses them.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
