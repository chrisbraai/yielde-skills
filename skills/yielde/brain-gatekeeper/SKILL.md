---
name: brain-gatekeeper
description: "Use when an agent needs to record a decision, incident, SOP update, staff contribution, or client update for yielde-brain — writes _inbox/ draft only, NEVER canonical files. Chris promotes drafts via /brain-log promote."
version: 1.0.0
author: "Chris (Yielde)"
license: MIT
platforms: [linux, macos, windows]
tags: [yielde, brain, audit, gatekeeper, write-path]
related_skills: [brain-read, brain-sync, operator-bridge]
requires_tools: [Write, Bash]
requires_capabilities: [brain-canon-write]
provenance: yielde-native
pinned: true
when_to_use: |
  An agent or session produced new content destined for yielde-brain:
  - A locked decision was made or changed.
  - An error symptom resolved with a root-cause fix.
  - A co-founder (Lyell or Devon) shipped work, took a call, or ran a process.
  - An SOP was discovered to be wrong, or a new SOP emerged.
  - A client was onboarded, churned, or had tier/DPA changes.
when_not_to_use: |
  - The user invoked /brain-log directly — that command handles drafting itself.
  - The content belongs to code, config, secrets, or any path documented in
    yielde-platform/docs/ — point to those instead.
  - The work is outside Yielde scope.
---

# brain-gatekeeper

The audit-enforcing write path into yielde-brain. Every write goes to `_inbox/` as a draft; Chris (or any co-founder) promotes via `/brain-log promote <inbox-file>`. Drafts NEVER auto-promote.

## Hard rules

These paths are **canonical** and writes are forbidden through this skill:

- `Decisions/*.md` (except `_index.md` updates handled by `/brain-log promote`)
- `Incidents/*.md`
- `Staff/<name>.md`
- `Clients/*.md`
- `SOPs/*.md`
- `Platform/*.md`
- `Site/*.md`
- `Glossary.md`
- `Backlog.md`
- `INDEX.md`
- `Alignment.excalidraw.md`

The **only** writable path is:

- `_inbox/YYYY-MM-DD-HHMM-<slug>.md` (or `YYYY-MM-DD-<slug>.md` for daily-resolution events)

If you ever find yourself about to write outside `_inbox/`, **abort and surface the attempt** as a violation in the session output. The user can override with explicit confirmation, but the default is hard-fail.

## Draft frontmatter schema

```yaml
---
kind: decision | incident | staff-work | sop-update | client-update
date: YYYY-MM-DD
author: chris | lyell | devon
session: <session_id or "manual">
status: draft
tags: [...]
promote_target: <relative path under yielde-brain/, e.g. Decisions/2026-05-12-foo.md>
---
```

## Procedure

1. **Determine kind.** What category of brain entry is this? If unclear, ask the user before writing.

2. **Generate filename.** `_inbox/YYYY-MM-DD-HHMM-<kebab-slug>.md` — use the current date/time. Slug is descriptive: `deploy-yielde-site-vercel-cli-success`, `paystack-webhook-retry-investigation`, `lyell-shipped-booking-form-v2`, etc.

3. **Write frontmatter + body.** Body structure depends on kind:

   - **decision**: Decision · Why · What got considered and ruled out · Locked / Open · Promote target.
   - **incident**: Symptom · Detection · Root cause · Fix · Verification · Prevention · Promote target.
   - **staff-work**: Who · What shipped · Date range · Linked PRs / commits · Notes · Promote target (typically appended to `Staff/<name>.md`).
   - **sop-update**: Which SOP · What changed · Why · Verification · Promote target.
   - **client-update**: Slug · Change (onboarded/churned/tier-change/DPA) · Effective date · Linked decisions · Promote target.

4. **Sync.** After the write, immediately invoke `brain-sync` so the draft is pushed to GitHub and the other co-founders see it within minutes.

5. **Tell the user.** Output:
   ```
   Draft written: _inbox/2026-05-12-1432-foo.md
   Promote with: /brain-log promote 2026-05-12-1432-foo.md
   Pushed: <commit-hash>
   ```

## What this skill does NOT do

- Never promote a draft. Only `/brain-log promote` does that, and only Chris runs it.
- Never edit existing canonical files. Even fixing a typo in `Decisions/` is a separate Chris-approved action.
- Never delete files in `_inbox/`. Old drafts stay until Chris promotes or discards.

## Verification

After running, the user should see exactly one new file in `_inbox/`, a successful `git push`, and no diff to any canonical path. If `git status` shows changes to anything outside `_inbox/`, abort and revert.
