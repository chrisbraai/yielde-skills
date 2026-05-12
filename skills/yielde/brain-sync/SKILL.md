---
name: brain-sync
description: "Use to pull/push yielde-brain so co-founders stay in sync — pre-flight git pull --rebase, post-write commit + push, conflict-safe merge. Wraps the yielde-brain/CLAUDE.md protocol so no agent has to remember it."
version: 1.0.0
author: "Chris (Yielde)"
license: MIT
platforms: [linux, macos, windows]
tags: [yielde, brain, git, sync]
related_skills: [brain-read, brain-gatekeeper]
requires_tools: [Bash]
requires_capabilities: []
provenance: yielde-native
pinned: true
when_to_use: |
  - Start of any session that will read yielde-brain (pull latest before reading).
  - Immediately after brain-gatekeeper writes a draft (push so co-founders see it).
  - When the user manually edits a brain file (sync the change out).
when_not_to_use: |
  - Mid-session if the brain has not changed since the last sync.
  - When the user is about to do a complex git operation by hand — don't auto-sync underneath them.
---

# brain-sync

Wraps the yielde-brain git protocol from `yielde-brain/CLAUDE.md` so every agent obeys it without remembering.

## Pre-flight (before reading any brain file)

```powershell
Set-Location C:\Users\chris\yielde-brain
git pull --rebase --autostash
```

On Devon's or Lyell's machine the path differs — use whatever clone path is configured. Exit non-zero if pull fails so the calling skill knows the working copy is potentially stale.

## Post-write (after brain-gatekeeper draft)

```powershell
Set-Location C:\Users\chris\yielde-brain
git add .
git commit -m "<short description of what changed>"
git push
```

The commit message should be a one-line summary. Prefix with `draft:` for `_inbox/` writes, `promote:` for promotion commits (typically done by `/brain-log promote`, not this skill).

## Conflict resolution

If `git pull` reports a merge conflict on a markdown file:

1. Open each conflicted file.
2. **Combine** both co-founders' content — never discard one side. The default merge strategy is union, not winner-takes-all.
3. Remove conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
4. Stage the resolved file: `git add <file>`.
5. Continue the rebase: `git rebase --continue` (or commit if a normal merge).
6. Push.

If the conflict is on a non-markdown file (rare — almost everything here is markdown), abort and surface the conflict to the user. Do not auto-resolve.

## Verification

After every sync, output:

```
Pulled: <n> commits from origin
Pushed: <commit-hash>  (or "nothing to push")
Working tree clean: yes/no
```

If "working tree clean: no" appears, the agent left uncommitted work — surface it explicitly so the user can decide what to do.

## What this skill does NOT do

- Never `git push --force`. yielde-brain is shared; force-push would destroy co-founder commits.
- Never skip hooks (`--no-verify`) or signing (`--no-gpg-sign`). If hooks fail, surface the failure.
- Never auto-resolve a non-markdown conflict.
- Never `git reset --hard` to escape a bad state — that destroys local drafts.
