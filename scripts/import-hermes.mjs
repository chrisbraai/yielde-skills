#!/usr/bin/env node
// Import a Hermes skill into yielde-skills/skills/hermes/<name>/SKILL.md.
//
// Hermes frontmatter nests platform-portable metadata under `metadata.hermes.{tags,
// related_skills}`. Yielde flattens these to top-level and adds three fields:
//   - provenance: hermes-import
//   - pinned: false
//   - requires_capabilities: []
//
// Usage:
//   node scripts/import-hermes.mjs <slug-or-url> [--dry]
//
//   <slug-or-url> accepts:
//     - A bare skill slug: "systematic-debugging" — searches NousResearch/hermes-agent
//       tree for skills/*/<slug>/SKILL.md (the canonical Hermes layout).
//     - A GitHub blob/raw URL pointing at a SKILL.md.
//     - A repo:path form: "NousResearch/hermes-agent:skills/research/arxiv/SKILL.md"
//
// Exit codes: 0 success, 1 fetch/parse error, 2 already imported (no --force).

import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./io-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = join(__dirname, "..", "skills");
const HERMES_DIR = join(SKILLS_ROOT, "hermes");
const DEFAULT_REPO = "NousResearch/hermes-agent";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const force = args.includes("--force");
const target = args.find((a) => !a.startsWith("--"));

if (!target) {
  console.error("usage: import-hermes.mjs <slug-or-url> [--dry] [--force]");
  process.exit(1);
}

async function ghApi(path) {
  // Use gh CLI when present — handles auth + rate limits. Falls back to raw fetch.
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
  // 1. Full URL
  if (/^https?:\/\//.test(input)) {
    // github.com/owner/repo/blob/branch/path -> raw.githubusercontent.com/owner/repo/branch/path
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

  // 2. repo:path form
  const repoPath = input.match(/^([^/]+\/[^:]+):(.+)$/);
  if (repoPath) {
    const [, repo, path] = repoPath;
    return {
      url: `https://raw.githubusercontent.com/${repo}/main/${path}`,
      source: `${repo}:${path}@main`,
    };
  }

  // 3. Bare slug — find under NousResearch/hermes-agent
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
  // Promote nested metadata.hermes.* to top-level
  if (out.metadata && typeof out.metadata === "object" && out.metadata.hermes) {
    const h = out.metadata.hermes;
    for (const key of ["tags", "related_skills", "requires_tools"]) {
      if (h[key] !== undefined && out[key] === undefined) out[key] = h[key];
    }
    delete out.metadata;
  }
  // Yielde-required fields
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

(async () => {
  const { url, source } = await resolveSource(target);
  const text = await fetchText(url);
  const { fm, body } = parseFrontmatter(text);
  if (!fm.name) throw new Error("frontmatter missing `name`");

  const flat = flatten(fm, source);
  const out = `${emitFrontmatter(flat)}\n\n${body.trimStart()}`;

  const destDir = join(HERMES_DIR, flat.name);
  const destFile = join(destDir, "SKILL.md");

  if (!force && (await exists(destFile))) {
    // Use callback form so the pipe is fully drained before exit (Windows libuv
    // asserts UV_HANDLE_CLOSING if a child exits with stderr writes in flight).
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
})().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
