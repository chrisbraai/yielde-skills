# yielde-skills

Hermes-compatible SKILL.md files for the **Yielde Bridge** stack. Each skill is a self-contained markdown document with YAML frontmatter, optionally accompanied by `references/`, `templates/`, `scripts/`, and `assets/` subdirectories.

## Layout

```
skills/
├── INDEX.md                      auto-generated compact index (name + description per skill)
├── .usage.json                   telemetry sidecar (use_count, last_used, state, pinned)
├── yielde/                       Yielde-native skills
│   ├── brain-read/SKILL.md
│   ├── brain-gatekeeper/SKILL.md
│   ├── brain-sync/SKILL.md
│   └── operator-bridge/SKILL.md
├── software-development/         imported / written later
└── research/
```

## Frontmatter schema

```yaml
---
name: brain-gatekeeper                # REQUIRED, kebab-case, <= 64 chars
description: "Use when ..."           # REQUIRED, <= 1024 chars (activation oracle)
version: 1.0.0
author: "Chris (Yielde)"
license: MIT
platforms: [linux, macos, windows]
tags: [yielde, brain, audit]
related_skills: [brain-read, brain-sync]
requires_tools: [Write, Bash]
requires_capabilities: []             # references ~/.claude/os/capabilities/
provenance: yielde-native             # yielde-native | hermes-import | auto-generated
pinned: true                          # curator never archives
when_to_use: |
  Single-source-of-truth trigger description.
when_not_to_use: |
  When this skill is the wrong fit.
---
```

This schema is a **superset of the Hermes flattened format** described in [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) — Hermes skills can be imported with a small adapter that flattens `metadata.hermes.*` to top-level fields. See `scripts/import-hermes.mjs` (coming in Phase 1).

## Building the index

```bash
node scripts/build-index.mjs
```

Reads every `SKILL.md` frontmatter, writes `skills/INDEX.md` for compact activation lookup.

## How Claude Code finds these skills

`~/.claude/skills/yielde/` is a Windows directory junction pointing at `skills/yielde/` in this repo. Claude Code sees skills at the canonical path without disturbing the existing global skills bundle.

## License

MIT. Forks and contributions welcome.
