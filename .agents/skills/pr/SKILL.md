---
name: pr
description: Write a pull request title and body that are fast to review - a small picture of the change, before-and-after evidence, the decisions and contract changes it carries, and how hard it is to undo. Use when opening a pull request, or writing or updating a PR description.
---

# Pull request

The title is a commit subject: `Area: what changed`. The body follows the template below. Keep the prose short, skip preambles, and use the words in `docs/glossary.md`.

```markdown
## Summary

<one or two sentences, then the smallest picture that makes the point>

## Evidence

- **Before:** <failing test, output or screenshot>
- **After:** <passing test, output or screenshot>

## Decisions and contracts

- **Decisions:** <the numbers this adds to DECISIONS.md, and the older ones they replace or change, or none>
- **Contract change:** <none, or what changes in lib/geo/types.ts, the fields of POST /api/report or the log entry types in lib/reports/, and who has to update>
- **Extraction prompt:** <unchanged, or the eval runs before and after on both models and their result>

## Merge danger

**Door:** <two-way: a revert undoes it | one-way: why not>
**Blast radius:** <one word, then what could break>
```

Keep any attribution line the session asks for at the end of the body.

## Summary: pick one picture

Choose the smallest view that makes the point. One is usually enough.

- **Pseudocode** for logic or a rule, such as the order of the resolver's checks.
- **A call tree** for control flow: `POST /api/report` → transcribe → extract → resolve → record.
- **A component tree** for a screen, with the state that matters.
- **A shallow file tree** for what each file does after a move or a split.
- **A Mermaid sequence diagram** for who talks to whom: transmitter, coordinator, command post.
- **A `diff` block** when the point is what changes in a shape that already exists. Diff the tree, the call stack or the rule, not the raw patch.
- **The whole block** only when most of it is new, or a reader needs to copy it.

Put each picture next to the sentence it supports. Show only the calls, files, fields and states a reviewer needs.

## Evidence

Show that it works, before and after. A screenshot is best for a change you can see (the command post, the transmitter). Otherwise, test output or a command's output: name the test that failed and now passes. For a change to extraction, give the eval scores. Say what was not checked: a real phone, hosted mode, the live site.

## Merge danger

A two-way door can be walked back with a revert. A one-way door cannot: a contract change the installed transmitter already relies on, data saved in a new format, a deploy. The blast radius is what breaks if the change is wrong: the map, the transmitter build, replay of old missions, the demo.

Adapted from the `pr` skill in the team's DevDay repo (404-brainnotfound). Its menu of pictures comes from Dex Horthy's `show-me` skill ([HumanLayer](https://github.com/humanlayer/humanlayer)).
