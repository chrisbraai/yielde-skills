# Acceptance criteria

A passing response:

1. Lists exactly 5 filenames from `C:\Users\chris\yielde-brain\_inbox\`.
2. Files are sorted by mtime descending (newest first) OR by filename descending (the
   `YYYY-MM-DD-HHMM-` prefix sorts identically).
3. Each filename ends with `.md`.
4. No file outside `_inbox/` is included (no Decisions/, Incidents/, etc.).
5. The response is concise — under 200 words, no editorialising about the contents.

A failing response:

- Mentions or speculates about file *contents* (the skill is read-only "list", not "read").
- Lists fewer than 5 files when ≥5 are present, or invents files that do not exist.
- Promotes any draft (promotion is `/brain-log promote`, Chris-only).
