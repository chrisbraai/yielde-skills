#!/usr/bin/env node
/**
 * operator-bridge-dispatch — Phase 5 co-founder rollout.
 *
 * Programmatic seam used by the `operator-bridge` skill to invoke a /operator agent.
 * Tier-1 (Chris's machine): records dispatch intent as a JSONL line under
 * ~/.claude/operator/runs/<name>/<run-id>.jsonl. The interactive /operator deploy still
 * does the real work; this script proves a request reached the operator surface.
 * Tier-2 (Devon / Lyell): opens a GitHub issue against chrisbraai/yielde-brain with the
 * structured request body and label `operator-request`. Chris's machine sweeps these and
 * runs the matching /operator deploy.
 *
 * Usage:
 *   node operator-bridge-dispatch.mjs --name <agent> [--input k=v ...] [--reason "..."]
 *                                     [--author <name>] [--session-id <id>]
 *
 * Honors YIELDE_OPERATOR_DIR for smoke tests (set to /nonexistent to force the Tier-2 path).
 *
 * Exit 0 on success, 1 on bad args, 2 on registry/manifest mismatch, 3 on dispatch failure.
 * Always prints a single JSON object to stdout.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

function parseArgs(argv) {
  const out = { input: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") {
      out.input.push(argv[++i]);
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function readJsonSafe(path, fallback) {
  try {
    return JSON.parse(stripBom(readFileSync(path, "utf8")));
  } catch {
    return fallback;
  }
}

function stripLibuvNoise(s) {
  if (!s) return s;
  return s
    .split(/\r?\n/)
    .filter((line) => !/Assertion failed:.*UV_HANDLE_CLOSING/.test(line))
    .join("\n");
}

function makeRunId() {
  const now = new Date();
  const stamp =
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-` +
    `${String(now.getUTCDate()).padStart(2, "0")}-` +
    `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

function parseInputPairs(pairs) {
  const out = {};
  for (const raw of pairs) {
    const idx = raw.indexOf("=");
    if (idx === -1) {
      throw new Error(`--input expects key=value, got ${JSON.stringify(raw)}`);
    }
    out[raw.slice(0, idx)] = raw.slice(idx + 1);
  }
  return out;
}

// ---------- main ----------

const flags = parseArgs(process.argv.slice(2));
const name = typeof flags.name === "string" ? flags.name : null;
if (!name) {
  console.log(JSON.stringify({ ok: false, error: "--name <agent> is required" }));
  process.exit(1);
}

let inputs;
try {
  inputs = parseInputPairs(flags.input);
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}

const reason = typeof flags.reason === "string" ? flags.reason : "";
const author = typeof flags.author === "string" ? flags.author : "operator-bridge";
const sessionId = typeof flags["session-id"] === "string" ? flags["session-id"] : null;

const operatorDir =
  process.env.YIELDE_OPERATOR_DIR
  ?? join(homedir(), ".claude", "operator");

const operatorDirExists = existsSync(operatorDir);

// Tier 1: local operator dispatch intent.
if (operatorDirExists) {
  const registryPath = join(operatorDir, "registry.json");
  const manifestPath = join(operatorDir, "agents", `${name}.md`);
  const registry = readJsonSafe(registryPath, null);

  if (registry?.agents && !registry.agents[name]) {
    console.log(JSON.stringify({
      ok: false,
      tier: 1,
      error: `agent ${name} not in registry`,
      registry_path: registryPath,
    }));
    process.exit(2);
  }
  if (!existsSync(manifestPath)) {
    console.log(JSON.stringify({
      ok: false,
      tier: 1,
      error: `agent manifest not found: ${manifestPath}`,
    }));
    process.exit(2);
  }

  const runId = makeRunId();
  const runsDir = join(operatorDir, "runs", name);
  if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
  const runFile = join(runsDir, `${runId}.jsonl`);
  const now = new Date().toISOString();
  const events = [
    {
      ts: now,
      event: "dispatch.intent",
      source: "operator-bridge-skill",
      author,
      session_id: sessionId,
      agent: name,
      inputs,
      reason,
    },
    {
      ts: now,
      event: "dispatch.queued",
      note: "Run intent recorded. /operator deploy will execute on the next interactive or cron pass.",
    },
  ];
  writeFileSync(runFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

  console.log(JSON.stringify({
    ok: true,
    tier: 1,
    agent: name,
    run_id: runId,
    run_log: runFile,
    inputs,
  }));
  process.exit(0);
}

// Tier 2: GitHub-issue fallback.
const ghCheck = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
if (ghCheck.status !== 0) {
  console.log(JSON.stringify({
    ok: false,
    tier: 2,
    error: "gh CLI not available or not authenticated",
    detail: stripLibuvNoise(ghCheck.stderr || ghCheck.stdout || "").trim().slice(0, 300),
    hint: "Install gh from https://cli.github.com and run `gh auth login`. Then re-run operator-bridge-dispatch.",
  }));
  process.exit(3);
}

const repo = process.env.YIELDE_BRAIN_REPO ?? "chrisbraai/yielde-brain";
const title = `[operator-request] ${name}`;
const bodyLines = [
  `**Operator request from ${author}**`,
  "",
  `**Agent**: \`${name}\``,
];
if (sessionId) bodyLines.push(`**Originating session**: \`${sessionId}\``);
if (reason) {
  bodyLines.push("", `**Reason**: ${reason}`);
}
bodyLines.push("", "**Inputs**:");
const inputKeys = Object.keys(inputs);
if (inputKeys.length === 0) bodyLines.push("- _(none)_");
else for (const k of inputKeys) bodyLines.push(`- \`${k}\`: \`${inputs[k]}\``);
bodyLines.push("", "Promote on the Tier-1 machine with: `/operator deploy " + name + "`.");
const body = bodyLines.join("\n");

const create = spawnSync(
  "gh",
  ["issue", "create", "--repo", repo, "--label", "operator-request", "--title", title, "--body", body],
  { encoding: "utf8" },
);
if (create.status !== 0) {
  console.log(JSON.stringify({
    ok: false,
    tier: 2,
    error: "gh issue create failed",
    exit_code: create.status,
    detail: stripLibuvNoise(create.stderr || create.stdout || "").trim().slice(0, 300),
  }));
  process.exit(3);
}

const url = (create.stdout || "").trim();
console.log(JSON.stringify({
  ok: true,
  tier: 2,
  agent: name,
  issue_url: url,
  repo,
  inputs,
}));
process.exit(0);
