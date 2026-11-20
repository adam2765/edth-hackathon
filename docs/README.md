# Documentation

Everything the team needs to know about Voice-to-Map, as plain Markdown in this repo. It reads the same on GitHub, in any editor and to any coding agent, so nobody needs a particular tool or account. This folder is the one store: there is no other copy to keep in step.

## Start here

New to the project? Read these in order:

1. [Overview](overview.md): the challenge, what the jury looks at, our approach, the timeline.
2. [Architecture](architecture.md): the parts, where each step runs, what is built.
3. [Plan](plan.md): the work ahead, part by part.
4. [CONTRIBUTING.md](../CONTRIBUTING.md): set up, run the checks, how we work together.
5. [Setup](setup.md): get it running on your computer and phone, step by step. A coding agent can follow it.

## What is where

| File | What it holds | Update it when |
|---|---|---|
| [overview.md](overview.md) | The challenge, judged items, our approach, timeline | Scope or schedule changes |
| [architecture.md](architecture.md) | The parts, where each step runs, what is built, the resolver in brief | A part is built, moved or deployed |
| [contracts.md](contracts.md) | Report endpoint, intent, resolution, utterance, scenario and gazetteer files, provider interfaces | A contract changes, on purpose, with a decision line |
| [plan.md](plan.md) | Receiver, missions (start, join, check in, end), local mode, transmitter, evaluation, demo | Work starts, finishes or changes scope |
| [gazetteer.md](gazetteer.md) | How place data is built, same-name streets, adding an area, scaling | The build or the data changes |
| [open-questions.md](open-questions.md) | Questions for the team and for Lysk | A question is asked, answered or dropped |
| [known-gaps.md](known-gaps.md) | Known limits and risks | One is found or fixed |
| [glossary.md](glossary.md) | Terms we use | A new term comes up |
| [setup.md](setup.md) | Setting up a computer and phone, with a check after each step | A tool, version, command or port changes |
| [handoff-android-microphone.md](handoff-android-microphone.md) | Handoff: the Android microphone transcribed on the phone, so it needs no key | Delete it when the work is done |

Elsewhere in the repo:

| File | What it holds |
|---|---|
| [README.md](../README.md) | How the pipeline works, the resolver rules, demo scripts, how to run |
| [DECISIONS.md](../DECISIONS.md) | Every choice made, one numbered line each, append-only |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, checks, working agreements |
| [AGENTS.md](../AGENTS.md) | Instructions for coding agents; Claude Code and Codex read the same file |
| [transmitter/README.md](../transmitter/README.md) | The native app: build, run, speech-to-text options |
| [scenarios/README.md](../scenarios/README.md) | Scripted reports and their file format |

## How these docs work

- **Docs say what is true now; DECISIONS.md says why.** A number in brackets, such as [46], is a decision there. Cite one when it explains a rule.
- **Change the docs in the same commit as the code they describe.** The table above says which file.
- **Give status a date.** "Built", "not started" and "measured" go stale. Say when something was checked, in Paris time.
- **Plain, short sentences,** in the same style as the README and DECISIONS.md. Write for a teammate who joined this morning.
- **Diagrams as text:** ASCII in a code block, or Mermaid, which GitHub draws. No images that only one tool can edit.
- **Link, don't copy.** To share with someone outside the repo, send a GitHub link. Link to another file or heading instead of repeating it.
- **New topic, new file.** Add it to the table above in the same commit.
