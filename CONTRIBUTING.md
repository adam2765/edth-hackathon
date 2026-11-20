# Contributing

Four of us work on this repo with different tools: Claude Code, Codex, or an editor by hand. Everything shared lives here as plain files, so any of them works. Start with [docs/README.md](docs/README.md) to find your way around.

## Set up

```bash
git clone git@github.com:beverage/edth-hackathon.git
cd edth-hackathon
```

Then follow [docs/setup.md](docs/setup.md): the coordinator, offline mode with Ollama, and the transmitter on a phone, with a check after each step. It is written so Claude Code or Codex can do it for you: ask yours to "set up this computer by following docs/setup.md". The short version is [Run locally](README.md#run-locally) in the README. A Mistral key is optional: without one, the guide sets up offline mode with Ollama. The unit tests need no key and no network.

The transmitter app has its own `package.json` and tooling; see [transmitter/README.md](transmitter/README.md). iOS builds need a Mac with Xcode.

## Before you push

```bash
npm test && npx tsc --noEmit && npm run lint
```

If you changed `lib/geo/types.ts`, also run `npx tsc --noEmit` in `transmitter/`.

## Working agreements (proposed)

- **Record every choice in [DECISIONS.md](DECISIONS.md):** one numbered line, appended at the end. If two people add one at the same time, keep both lines and renumber yours.
- **Update the docs in the same commit as the change.** [docs/README.md](docs/README.md) says which file covers what.
- **Secrets live in env vars only.** The repo is public, and so are commit author emails.
- **Contracts change on purpose.** Changing `lib/geo/types.ts` or the fields of `POST /api/report` changes what the transmitter and the receiver rely on: say so in the decision line, and tell whoever works on the other side ([contracts](docs/contracts.md)).
- **Leave the `prior-work-fri-1800` tag alone.** It marks the work done before the event.
- **Deploys go through Alex** until the deploy question is settled ([open questions](docs/open-questions.md)).
- **Git workflow** is still open: everyone on `main` with small commits and `git pull --rebase`, or short branches with pull requests.

## Coding agents

[AGENTS.md](AGENTS.md) at the root, plus [transmitter/AGENTS.md](transmitter/AGENTS.md) inside that folder, is the one instruction file for both Claude Code and Codex. Put project rules there, not in a tool-specific file such as `CLAUDE.md`, so every agent sees the same ones. Unit tests need no network or key; anything that calls Mistral or Overpass needs both, so an agent in a sandbox without network can run the tests but not the evaluation or the gazetteer build.

## Writing docs

The design docs are in [docs/](docs/README.md), one file per topic. Write plain, short sentences; say when a status was checked; link instead of copying. Do not keep a second copy anywhere else: to share with someone outside the repo, send a GitHub link.
