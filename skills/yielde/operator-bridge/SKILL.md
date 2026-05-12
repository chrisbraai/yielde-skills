---
name: operator-bridge
description: "Use when a skill or agent needs to invoke a /operator agent on Chris's machine — validates inputs, calls the operator CLI, returns the run_id. On co-founder machines without /operator, falls back to opening a GitHub issue against yielde-brain."
version: 1.0.0
author: "Chris (Yielde)"
license: MIT
platforms: [linux, macos, windows]
tags: [yielde, operator, agents, dispatch]
related_skills: [brain-read, brain-gatekeeper]
requires_tools: [Bash, Read]
requires_capabilities: []
provenance: yielde-native
pinned: true
when_to_use: |
  - An automated flow needs to deploy a /operator agent (deploy-yielde-site, new-client-onboarding,
    handle-llm-cost-spike, fix-admin-ip-lockout, declare-dashboard-workflow, cred-rotation, etc.).
  - A skill produced a structured request that maps to an operator agent rather than
    direct execution.
when_not_to_use: |
  - The user invoked /operator directly — let the slash command handle it.
  - The task does not map to a registered /operator agent — recommend the relevant SOP instead.
---

# operator-bridge

Programmatic dispatch into `/operator` from inside another skill or agent context. The /operator framework is local to Chris's machine; this skill provides a stable, validated API so callers don't shell out to PowerShell directly.

## Procedure

The dispatch path is implemented in `yielde-skills/scripts/operator-bridge-dispatch.mjs`. Invoke it via Bash; never re-implement the tier logic inside the skill body.

1. **Validate the request.** Required: `--name <agent>`. Optional: any number of `--input key=value`, plus `--reason`, `--author`, `--session-id`. Reject with a clear error if a required value is missing — never invent input values.

2. **Invoke the dispatch CLI.**

   ```bash
   node C:/Users/chris/yielde-skills/scripts/operator-bridge-dispatch.mjs \
     --name <agent> \
     --input key1=value1 --input key2=value2 \
     --reason "<why this is needed>" \
     --author "<caller>" \
     --session-id "<session_id>"
   ```

   The script prints a single JSON object to stdout:

   - **Tier 1** (Chris's machine, `~/.claude/operator/` present): records `dispatch.intent` + `dispatch.queued` events at `~/.claude/operator/runs/<name>/<run-id>.jsonl` and returns `{ ok, tier: 1, agent, run_id, run_log, inputs }`. The interactive `/operator deploy` or cron sweep then executes the agent for real.
   - **Tier 2** (Devon / Lyell, no operator dir): opens a GitHub issue against `chrisbraai/yielde-brain` (override via `YIELDE_BRAIN_REPO`) with label `operator-request` and returns `{ ok, tier: 2, agent, issue_url, repo, inputs }`. Chris's machine sweeps these and dispatches the matching agent.

3. **Surface the response.** Return the parsed JSON to the caller. If `ok: false`, propagate the error. If `tier: 2`, tell the user "Operator unavailable locally — issue opened: \<issue_url\>".

4. **Smoke test the Tier-2 path.** Set `YIELDE_OPERATOR_DIR=/nonexistent` to force the GitHub-issue branch even on Chris's machine. This is the standard verification before shipping a change to this skill.

## Co-founder fallback (Tier 2 — Devon / Lyell)

The fallback is implemented in the same dispatch CLI; this section documents the contract.

Issue body shape (rendered by `operator-bridge-dispatch.mjs`):

```markdown
**Operator request from <author>**

**Agent**: `<name>`
**Originating session**: `<session_id>`

**Reason**: <why this is needed>

**Inputs**:
- `key1`: `value1`
- `key2`: `value2`

Promote on the Tier-1 machine with: `/operator deploy <name>`.
```

Label: `operator-request`. Chris's machine polls these issues and dispatches matching ones via `/operator deploy`. Result is posted back as an issue comment.

## What this skill does NOT do

- Never bypasses the operator capability gate. If `~/.claude/hooks/yielde-os-capability-gate.ps1` blocks the call, surface the block to the user — do not retry.
- Never edits operator manifests or the registry. That is `/operator update` and `/operator create`.
- Never invokes hard-gated agents without explicit user confirmation in the same turn.
- Never silently swallows operator run failures. Always surface the JSONL exit status.

## Verification

After a successful dispatch:

```
Agent:    <name> v<version>
Run ID:   <YYYY-MM-DD-HHMM>
Log:      ~/.claude/operator/runs/<name>/<run_id>.jsonl
Status:   <success | failure | running>
```

If Tier-2 fallback fired:

```
Operator unavailable locally — issue opened: <issue-url>
Chris's machine will pick this up on next /operator dispatch sweep.
```
