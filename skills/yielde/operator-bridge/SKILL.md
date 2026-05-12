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

1. **Check the registry.** Read `C:\Users\chris\.claude\operator\registry.json`. Verify the requested agent name exists and its `status` is `verified` or `draft` (never deploy `retired`).

2. **Verify inputs.** Read the agent manifest at `C:\Users\chris\.claude\operator\agents\<name>.md`. Validate that all required `inputs` are present in the caller's request. Reject with a clear error if anything is missing — never invent values.

3. **Dispatch on Chris's machine.** Shell out:

   ```powershell
   & "C:\Users\chris\.claude\operator\lib\operator.ps1" deploy <name> @args
   ```

   Where `@args` are `--key=value` pairs derived from the validated inputs.

4. **Capture the run_id.** The CLI writes a JSONL log at `~/.claude/operator/runs/<name>/<YYYY-MM-DD-HHMM>.jsonl`. The run_id is the timestamp portion. Return it to the caller.

5. **Tail the log.** If the caller wants synchronous behavior, tail the JSONL until the final `operator.run.end` event is written. If async, return the run_id and let the caller poll.

## Co-founder fallback (Tier 2 — Devon / Lyell)

If `~/.claude/operator/` does not exist on the running machine (Devon's or Lyell's), do not error. Instead, **open a GitHub issue** against the `yielde-brain` repo with a structured body:

```markdown
**Operator request from <author>**

Agent: <name>
Inputs:
- key1: value1
- key2: value2

Reason: <why this is needed>
Originating session: <session_id>
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
