#!/usr/bin/env node
// Import Hermes skills into yielde-skills.
//
// Modes:
//
//   1) Single import (existing Phase 1 behaviour):
//        node scripts/import-hermes.mjs <slug-or-url> [--dry] [--force]
//      Writes directly to skills/hermes/<name>/SKILL.md.
//
//   2) Bulk import (Phase 7 6d):
//        node scripts/import-hermes.mjs --bulk [<repo>] [--filter <substr>] [--limit N] [--dry]
//      <repo> defaults to NousResearch/hermes-agent.
//      Walks the repo tree, finds */SKILL.md under skills/, applies optional
//      substring filter, downloads each and writes flattened drafts to
//      _pending/<name>/SKILL.md (NOT skills/hermes/). Skips if the name
//      already exists in skills/hermes/ OR _pending/.
//
//   3) Promote a pending draft (Phase 7 6d):
//        node scripts/import-hermes.mjs --promote <name> --operator chris
//      Refuses without --operator chris flag. Moves _pending/<name>/SKILL.md
//      to skills/hermes/<name>/SKILL.md and refreshes imported_at.
//
// Hermes frontmatter nests platform-portable metadata under
//   metadata.hermes.{tags, related_skills, requires_tools}
// Yielde flattens these to top-level and adds:
//   - provenance: hermes-import
//   - pinned: false
//   - requires_capabilities: []
//   - imported_from / imported_at
//
// Exit codes: 0 success, 1 fetch/parse error, 2 already imported (no --force),
// 3 cost/safety refusal (e.g. promote without --operator chris).

import { writeFile, mkdir, readFile, stat, readdir, rename, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./io-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = join(__dirname, "..", "skills");
const HERMES_DIR = join(SKILLS_ROOT, "hermes");
const PENDING_DIR = join(__dirname, "..", "_pending");
const DEFAULT_REPO = "NousResearch/hermes-agent";

function parseArgs(argv) {
  const out = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out.positional.push(a); continue; }
    const key = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    out[key] = v;
  }
  return out;
}

async function ghApi(path) {
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync(`gh api ${path}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out);
  } catch {
    const res = await fetch(`https://api.github.com/${path}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
    return await res.json();
  }
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return await res.text();
}

async function resolveSource(input) {
  if (/^https?:\/\//.test(input)) {
    const blob = input.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if (blob) {
      const [, owner, repo, branch, path] = blob;
      return {
        url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
        source: `${owner}/${repo}:${path}@${branch}`,
      };
    }
    return { url: input, source: input };
  }
  const repoPath = input.match(/^([^/]+\/[^:]+):(.+)$/);
  if (repoPath) {
    const [, repo, path] = repoPath;
    return {
      url: `https://raw.githubusercontent.com/${repo}/main/${path}`,
      source: `${repo}:${path}@main`,
    };
  }
  const tree = await ghApi(`repos/${DEFAULT_REPO}/git/trees/main?recursive=1`);
  const match = tree.tree.find(
    (e) => e.type === "blob" && e.path.endsWith(`/${input}/SKILL.md`)
  );
  if (!match) throw new Error(`slug "${input}" not found under ${DEFAULT_REPO}/skills/`);
  return {
    url: `https://raw.githubusercontent.com/${DEFAULT_REPO}/main/${match.path}`,
    source: `${DEFAULT_REPO}:${match.path}@main`,
  };
}

function quoteYamlString(v) {
  if (typeof v !== "string") return String(v);
  if (/[:#"'\n]|^\s|\s$/.test(v)) return JSON.stringify(v);
  return v;
}

function emitFrontmatter(fm) {
  const order = [
    "name", "description", "version", "author", "license", "platforms",
    "tags", "related_skills", "requires_tools", "requires_capabilities",
    "provenance", "pinned", "when_to_use", "when_not_to_use",
    "imported_from", "imported_at",
  ];
  const seen = new Set();
  const lines = ["---"];
  for (const k of order) {
    if (!(k in fm)) continue;
    seen.add(k);
    const v = fm[k];
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => quoteYamlString(x)).join(", ")}]`);
    } else if (typeof v === "string" && v.includes("\n")) {
      lines.push(`${k}: |`);
      for (const bl of v.split("\n")) lines.push(`  ${bl}`);
    } else if (typeof v === "boolean" || typeof v === "number") {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: ${quoteYamlString(v)}`);
    }
  }
  for (const k of Object.keys(fm)) {
    if (seen.has(k)) continue;
    const v = fm[k];
    if (v && typeof v === "object" && !Array.isArray(v)) continue;
    lines.push(`${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : quoteYamlString(v)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function flatten(fm, source) {
  const out = { ...fm };
  if (out.metadata && typeof out.metadata === "object" && out.metadata.hermes) {
    const h = out.metadata.hermes;
    for (const key of ["tags", "related_skills", "requires_tools"]) {
      if (h[key] !== undefined && out[key] === undefined) out[key] = h[key];
    }
    delete out.metadata;
  }
  if (!out.tags) out.tags = [];
  if (!out.related_skills) out.related_skills = [];
  if (!out.requires_tools) out.requires_tools = [];
  if (!out.requires_capabilities) out.requires_capabilities = [];
  out.provenance = "hermes-import";
  out.pinned = false;
  out.imported_from = source;
  out.imported_at = new Date().toISOString();
  return out;
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

// ---------- Single import ----------

async function runSingle(target, { dryRun, force }) {
  const { url, source } = await resolveSource(target);
  const text = await fetchText(url);
  const { fm, body } = parseFrontmatter(text);
  if (!fm.name) throw new Error("frontmatter missing `name`");

  const flat = flatten(fm, source);
  const out = `${emitFrontmatter(flat)}\n\n${body.trimStart()}`;

  const destDir = join(HERMES_DIR, flat.name);
  const destFile = join(destDir, "SKILL.md");

  if (!force && (await exists(destFile))) {
    process.stderr.write(`already imported: ${destFile} (use --force to overwrite)\n`, () => {
      process.exit(2);
    });
    return;
  }
  if (dryRun) {
    console.log(`# would write: ${destFile}`);
    console.log(out.slice(0, 400));
    return;
  }
  await mkdir(destDir, { recursive: true });
  await writeFile(destFile, out, "utf8");
  console.log(`imported: hermes/${flat.name} from ${source}`);
}

// ---------- Bulk import ----------

async function runBulk(repo, { filter, limit, dryRun }) {
  const repoSlug = repo || DEFAULT_REPO;
  const tree = await ghApi(`repos/${repoSlug}/git/trees/main?recursive=1`);
  // Find every SKILL.md under any depth; filter to /skills/.../SKILL.md to avoid
  // top-level README hits.
  const candidates = tree.tree.filter(
    (e) => e.type === "blob"
      && e.path.endsWith("/SKILL.md")
      && (e.path.startsWith("skills/") || e.path.includes("/skills/"))
  );
  const filtered = filter
    ? candidates.filter((c) => c.path.toLowerCase().includes(String(filter).toLowerCase()))
    : candidates;
  const capped = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? filtered.slice(0, Number(limit))
    : filtered;

  const report = {
    ok: true,
    mode: "bulk",
    repo: repoSlug,
    filter: filter || null,
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    dry_run: dryRun,
    candidates_total: candidates.length,
    after_filter: filtered.length,
    after_limit: capped.length,
    entries: [],
  };

  for (const c of capped) {
    const segments = c.path.split("/");
    const name = segments[segments.length - 2]; // .../<name>/SKILL.md
    const pendingFile = join(PENDING_DIR, name, "SKILL.md");
    const liveFile = join(HERMES_DIR, name, "SKILL.md");

    if (await exists(liveFile)) {
      report.entries.push({ name, status: "skipped_existing_live", path: c.path });
      continue;
    }
    if (await exists(pendingFile)) {
      report.entries.push({ name, status: "skipped_existing_pending", path: c.path });
      continue;
    }
    try {
      const url = `https://raw.githubusercontent.com/${repoSlug}/main/${c.path}`;
      const source = `${repoSlug}:${c.path}@main`;
      const text = await fetchText(url);
      const { fm, body } = parseFrontmatter(text);
      if (!fm.name) {
        report.entries.push({ name, status: "skipped_no_name", path: c.path });
        continue;
      }
      const flat = flatten(fm, source);
      // Trust the manifest's own `name` over the directory segment.
      const finalName = flat.name;
      const finalPendingDir = join(PENDING_DIR, finalName);
      const finalPendingFile = join(finalPendingDir, "SKILL.md");
      if (await exists(join(HERMES_DIR, finalName, "SKILL.md"))) {
        report.entries.push({ name: finalName, status: "skipped_existing_live", path: c.path });
        continue;
      }
      if (await exists(finalPendingFile)) {
        report.entries.push({ name: finalName, status: "skipped_existing_pending", path: c.path });
        continue;
      }
      const out = `${emitFrontmatter(flat)}\n\n${body.trimStart()}`;
      if (!dryRun) {
        await mkdir(finalPendingDir, { recursive: true });
        await writeFile(finalPendingFile, out, "utf8");
      }
      report.entries.push({
        name: finalName,
        status: dryRun ? "would_import" : "imported_pending",
        path: c.path,
        description: flat.description ?? "",
      });
    } catch (err) {
      report.entries.push({ name, status: "error", path: c.path, error: err.message });
    }
  }

  report.summary = report.entries.reduce(
    (acc, e) => { acc[e.status] = (acc[e.status] || 0) + 1; return acc; },
    {},
  );
  console.log(JSON.stringify(report, null, 2));
}

// ---------- Promote ----------

async function runPromote(name, { operator }) {
  if (operator !== "chris") {
    const refusal = {
      ok: false,
      mode: "promote",
      reason: "promote requires --operator chris (curator gate)",
      name,
      operator_provided: operator ?? null,
    };
    console.log(JSON.stringify(refusal, null, 2));
    process.exit(3);
  }
  const fromDir = join(PENDING_DIR, name);
  const fromFile = join(fromDir, "SKILL.md");
  if (!(await exists(fromFile))) {
    console.log(JSON.stringify({
      ok: false, mode: "promote", reason: "no pending draft for that name",
      name, looked_for: fromFile,
    }, null, 2));
    process.exit(1);
  }
  const toDir = join(HERMES_DIR, name);
  const toFile = join(toDir, "SKILL.md");
  if (await exists(toFile)) {
    console.log(JSON.stringify({
      ok: false, mode: "promote",
      reason: "destination already exists in skills/hermes/ — manual review required",
      name, destination: toFile,
    }, null, 2));
    process.exit(2);
  }

  // Refresh imported_at on promote so we know when the live skill landed.
  const raw = await readFile(fromFile, "utf8");
  const { fm, body } = parseFrontmatter(raw);
  fm.provenance = "hermes-import";
  fm.imported_at = new Date().toISOString();
  const refreshed = `${emitFrontmatter(fm)}\n\n${body.trimStart()}`;

  await mkdir(toDir, { recursive: true });
  await writeFile(toFile, refreshed, "utf8");

  // Remove the pending dir (and the file inside it).
  try { await rm(fromDir, { recursive: true, force: true }); } catch { /* swallow */ }

  console.log(JSON.stringify({
    ok: true, mode: "promote", name,
    promoted_from: fromFile, promoted_to: toFile,
    imported_at: fm.imported_at,
  }, null, 2));
}

// ---------- Entrypoint ----------

const flags = parseArgs(process.argv.slice(2));
const positional = flags.positional ?? [];

(async () => {
  if (flags.bulk !== undefined) {
    const repo = typeof flags.bulk === "string" ? flags.bulk : (positional[0] || DEFAULT_REPO);
    await runBulk(repo, {
      filter: typeof flags.filter === "string" ? flags.filter : null,
      limit: flags.limit,
      dryRun: Boolean(flags.dry),
    });
    return;
  }
  if (flags.promote !== undefined) {
    const name = typeof flags.promote === "string" ? flags.promote : (positional[0] || null);
    if (!name) {
      console.error("usage: import-hermes.mjs --promote <name> --operator chris");
      process.exit(1);
    }
    await runPromote(name, {
      operator: typeof flags.operator === "string" ? flags.operator : null,
    });
    return;
  }
  const target = positional[0];
  if (!target) {
    console.error([
      "usage:",
      "  import-hermes.mjs <slug-or-url> [--dry] [--force]   # single import",
      "  import-hermes.mjs --bulk [<repo>] [--filter S] [--limit N] [--dry]",
      "  import-hermes.mjs --promote <name> --operator chris",
    ].join("\n"));
    process.exit(1);
  }
  await runSingle(target, {
    dryRun: Boolean(flags.dry),
    force: Boolean(flags.force),
  });
})().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
