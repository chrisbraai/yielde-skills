---
name: brain-read
description: "Use when work touches yielde-platform, yielde-site, a Yielde client slug, the team (Chris/Lyell/Devon), or the business — loads only the brain files the trigger table indicates, never the whole vault."
version: 1.0.0
author: "Chris (Yielde)"
license: MIT
platforms: [linux, macos, windows]
tags: [yielde, brain, routing, context]
related_skills: [brain-gatekeeper, brain-sync, operator-bridge]
requires_tools: [Read, Grep, Glob]
requires_capabilities: []
provenance: yielde-native
pinned: true
when_to_use: |
  The user's request matches any trigger in yielde-brain/INDEX.md (platform, site, client slug,
  Paystack, webhook taxonomy, decision lookup, incident symptom, staff query, SOP filename,
  glossary term). Run this BEFORE answering so the response is informed by canonical context.
when_not_to_use: |
  The work is outside Yielde scope (Braambos farm site, Personal vault, Yielde-System scaffolding,
  AI-Organization-*, Lead Qualifier product). Or the request is already covered by an /operator
  agent — operator agents load their own context bundles.
---

# brain-read

The router into Yielde's second brain. Loads **only** the files the INDEX trigger table indicates, never the whole vault.

## Procedure

1. **Operator-first check.** Before reading any brain file, check `~/.claude/operator/INDEX.md`. If the user's request matches a registered agent (deploy-yielde-site, new-client-onboarding, handle-llm-cost-spike, fix-admin-ip-lockout, declare-dashboard-workflow, cred-rotation, etc.), recommend `/operator deploy <name>` instead — the agent loads its own minimal bundle. Stop here.

2. **If no operator match, read the INDEX.** Read `C:\Users\chris\yielde-brain\INDEX.md`. Apply the trigger table to the user's prompt. Read **only** the files the matching row points at.

3. **Platform architecture work — add the diagram.** If the work touches services, infrastructure, data flow, cost, scaling, n8n, LiteLLM, Traefik, Infisical, or any shared/per-client layer, also read `yielde-brain/Alignment.excalidraw.md`. Only the `## Text Elements` section — stop before `## Drawing` (compressed JSON, useless).

4. **Default to nothing.** If no trigger matches, do not load brain files. Answer from global memory and the always-loaded files only.

## What this skill does NOT do

- Does **not** write. Read-only. For writes use `brain-gatekeeper`.
- Does **not** `git pull` — that is `brain-sync`'s job. Run `brain-sync` first if you suspect the working copy is stale.
- Does **not** load files outside `yielde-brain/`. The vault has hard scope boundaries.

## Out-of-scope (never load)

- `AI-Organization-Master/`, `AI-Organization-Executive/`
- `Vault/Projects/Yielde-System/`
- `Personal/`, `Vault/Research/`
- `yielde-lead-qualifier/` (separate product, separate memory)

## Verification

After loading, name the files you read in one sentence so the user can confirm the routing was correct. If the trigger table mapped to no files, say so explicitly — silence is a bug.
