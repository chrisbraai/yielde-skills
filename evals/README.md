# Skill evals — yielde-skills

Phase 6e scaffold. Each skill under `yielde-skills/skills/{yielde,hermes}/` can have a folder
under `evals/<skill>/` containing one or more case folders:

```
evals/
  <skill-name>/
    <case-id>/
      input.md      # the user prompt or task to run the skill against
      expected.md   # acceptance criteria — what a passing response looks like
      meta.json     # { description, tags, timeout_sec? }
```

`scripts/run-evals.mjs` walks this directory tree and produces a JSON report:

```bash
node scripts/run-evals.mjs                       # list discoverable cases
node scripts/run-evals.mjs --skill brain-read    # filter
node scripts/run-evals.mjs --run                 # actually invoke claude -p for each case
                                                 #   (LLM cost — opt-in)
```

## Hard rules

1. Evals never auto-promote drafts. Curation stays Chris-only via `/brain-log promote`.
2. Cases must be deterministic enough that a Claude-based grader can rule pass/fail with
   a short rubric. If the rubric requires open-ended judgment, the case is too soft —
   tighten it.
3. Cases run against the real skill content as installed in `~/.claude/skills/`.
4. Inputs that touch real services (brain repo, operator runtime, Stripe, etc.) must use
   the local fixtures under `evals/<skill>/<case-id>/fixtures/` — never live data.

## Case skeleton

See `evals/brain-read/list-recent/` for the canonical layout.
