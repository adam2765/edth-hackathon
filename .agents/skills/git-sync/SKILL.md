---
name: git-sync
description: Commit, catch up with main and push the current branch in one pass - one commit per change in this repo's style, merge origin/main (never rebase), renumber colliding decisions, run the checks, push without force, then offer a pull request. Use when asked to sync, commit and push, update or catch up a branch, or run git-sync.
---

# Git sync

Commits the working tree, merges `main` in, pushes the branch and says what it did. It follows the workflow in `CONTRIBUTING.md` (Git workflow). Running this skill is the person asking to push their branch; `main` itself still needs their yes. Stop and tell the person when a step says stop. Never force-push, never rebase a pushed branch, never skip a hook (`--no-verify`).

## 1. Look

1. Run `git status`, `git branch --show-current` and `git fetch origin`.
2. Stop on a detached HEAD, or when a merge, rebase, cherry-pick or revert is in progress that this run did not start.
3. **On `main`, do not commit.** Offer to move the work to a new branch (`git switch -c claude/<short-name>`) and go on there after a yes. A session's worktree is already on its own branch.
4. Nothing to commit, and nothing ahead of or behind `origin/main` and the branch's remote: say "in sync" and stop.

## 2. Commit

1. Read the diff, staged and unstaged, and the untracked files. Group it into changes: one change, one commit.
2. Stage each group by path (`git add -- <path>…`). Never `git add -A`, `git add .` or `git commit -a`.
3. Never stage a secret: a `.env*` file other than `.env.example`, a `*.pem`, a key or credential file, or a line that holds a key. Stop and name the file.
4. A file you cannot explain from this conversation is someone else's work in progress. Leave it unstaged and list it in the report.
5. Changes the person already staged are one group. Commit them as they are.
6. Write the subject in this repo's style, `Area: what changed`, in plain words, for example `Gazetteer: roads in the Bois de Vincennes closed to cars, kept as streets`. `git log --oneline -15` shows the areas in use. Add a short body only when the reason is not obvious.
7. A commit that changes behaviour carries its docs and its `DECISIONS.md` line (`AGENTS.md`, Rules). If one is missing, say so in the report; do not invent a decision.
8. Keep any attribution line the session asks for.

## 3. Merge main

1. Run `git merge --no-edit origin/main`. Merge, never rebase.
2. On a conflict, resolve hunk by hunk and keep both sides' intent. Never use `-X ours`, `-X theirs`, or `git checkout --ours` or `--theirs` on a whole file. A hunk whose intent is unclear: stop and show both sides.
3. **`DECISIONS.md`:** when both sides added lines at the end, keep both, `main`'s first, and renumber this branch's lines to follow. Fix the references to a renumbered line (`[172]`, "decision 172", and a **Changed by 172.** or **Replaced by 172.** at the start of an older line) in the files this branch changed. When both sides marked the same older line, join the markers in number order: **Changed by 182 and 183.**
4. Run the checks: `npm test && npx tsc --noEmit && npm run lint`, and `npx tsc --noEmit` in `transmitter/` when `lib/geo/types.ts` changed. Fix the merge, not the checks. Still failing: stop and report.
5. Conclude a conflicted merge with `git commit --no-edit`.

## 4. Push

1. Run `git push -u origin <branch>`, or plain `git push` once the branch has an upstream. Never `--force` or `--force-with-lease`.
2. Never push `main` itself without the person's yes in this conversation.
3. Rejected as non-fast-forward: merge the branch's remote once (`git merge origin/<branch>`), run the checks and push again. Rejected again: stop.

## 5. Pull request

`gh pr view --json number,url` shows whether the branch has one. If it has none, offer to open one, with the `pr` skill for the title and body. Open it only after a yes.

## 6. Report

```
Committed  <sha> <subject>
Merged     origin/main: <N> commits, <no conflicts | conflicts in N files | decisions renumbered 172 → 174>
Checks     <pass | what failed>
Pushed     <N> commits to origin/<branch>
PR         <url | none, offered>
Left out   <path>: <why>
```

Leave out the lines that do not apply.

Adapted from the `git-sync` skill in the team's DevDay repo (404-brainnotfound). The Supabase gate is dropped; merging `main` and renumbering decisions are new here.
