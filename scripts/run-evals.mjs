#!/usr/bin/env node
/**
 * run-evals — Phase 7 eval harness with automated grading + cost cap.
 *
 * Walks `evals/<skill>/<case-id>/` directories. Phase 6 shipped discovery +
 * raw `--run` capture; Phase 7 adds rubric-based automated grading via a
 * second `claude -p` per case plus a pre-run cost cap.
 *
 *   node scripts/run-evals.mjs                            # discover (no LLM cost)
 *   node scripts/run-evals.mjs --skill brain-read         # filter by skill
 *   node scripts/run-evals.mjs --run                      # spawn claude -p per case
 *   node scripts/run-evals.mjs --run --grade              # also grade each output
 *   YIELDE_EVALS_MAX_COST_CENTS=20 \
 *     node scripts/run-evals.mjs --run --grade            # refuse if estimate > 20¢
 *
 * Cost model (rough; per case):
 *   - run leg:   ~5¢ (Sonnet, short skill output)
 *   - grade leg: ~1¢ (short rubric + short JSON response)
 *   - default per-case estimate: 6¢ — override via YIELDE_EVALS_CENTS_PER_CASE
 *
 * The cap is a pre-run guardrail, not an actual spend tracker — `claude -p`
 * does not surface cost back. Real billing comes from the kernel session.cost
 * stream landing in runtime.db, which the /run/cost panel in yielde-bridge
 * already rolls up.
 *
 * Hard rules:
 *   - Never promote brain drafts; promotion stays `/brain-log promote`-only.
 *   - Cases that touch real services must declare a fixtures dir and avoid live data.
 *   - The grader's verdict is informational — pass/fail does NOT short-circuit
 *     later cases. Final report rolls up pass-rate + total estimated spend.
 */

import { readdir, stat } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { stripBom } from "./io-utils.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const EVALS_ROOT = join(REPO_ROOT, "evals");

const DEFAULT_CENTS_PER_CASE = Number(process.env.YIELDE_EVALS_CENTS_PER_CASE || 6);
const COST_CAP_CENTS = process.env.YIELDE_EVALS_MAX_COST_CENTS
  ? Number(process.env.YIELDE_EVALS_MAX_COST_CENTS)
  : null;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    out[key] = v;
  }
  return out;
}

async function isDir(p) {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function discoverCases(filterSkill) {
  if (!existsSync(EVALS_ROOT)) return [];
  const skills = await readdir(EVALS_ROOT);
  const cases = [];
  for (const skill of skills) {
    if (skill.startsWith(".") || skill === "README.md") continue;
    if (filterSkill && skill !== filterSkill) continue;
    const skillDir = join(EVALS_ROOT, skill);
    if (!(await isDir(skillDir))) continue;
    const caseIds = await readdir(skillDir);
    for (const caseId of caseIds) {
      const caseDir = join(skillDir, caseId);
      if (!(await isDir(caseDir))) continue;
      const inputPath = join(caseDir, "input.md");
      const expectedPath = join(caseDir, "expected.md");
      const metaPath = join(caseDir, "meta.json");
      if (!existsSync(inputPath)) continue;
      let meta = { description: "", tags: [], timeout_sec: 120, pass_threshold: 7 };
      if (existsSync(metaPath)) {
        try { meta = { ...meta, ...JSON.parse(stripBom(readFileSync(metaPath, "utf8"))) }; } catch { /* keep defaults */ }
      }
      cases.push({
        skill,
        case_id: caseId,
        dir: caseDir,
        input_path: inputPath,
        expected_path: existsSync(expectedPath) ? expectedPath : null,
        meta,
      });
    }
  }
  return cases;
}

function runCase(c, timeoutSec) {
  const inputText = stripBom(readFileSync(c.input_path, "utf8"));
  const t = Math.max(30, Number(c.meta.timeout_sec || timeoutSec || 120)) * 1000;
  const res = spawnSync("claude", ["-p", inputText], { cwd: REPO_ROOT, encoding: "utf8", timeout: t });
  return {
    exit: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    timed_out: res.signal === "SIGTERM" || res.error?.code === "ETIMEDOUT",
  };
}

function buildRubricPrompt(expectedText, actualText, passThreshold) {
  return [
    "You are an evaluation grader. Read the EXPECTED acceptance criteria and",
    "the ACTUAL output from an AI assistant, then return a single JSON object",
    "on stdout. No prose outside the JSON. No code fences.",
    "",
    "Scoring rubric (0-10):",
    "  10 = matches every acceptance criterion exactly.",
    "  7-9 = matches most criteria; minor structural/wording deviations.",
    "  4-6 = partial match; some criteria fail outright.",
    "  1-3 = on-topic but mostly fails the criteria.",
    "  0 = wrong skill, wrong intent, or empty.",
    "",
    `A "pass" is true when score >= ${passThreshold}.`,
    "",
    'Return exactly this JSON shape (no extra keys, no whitespace beyond the JSON itself):',
    '{"pass": true|false, "score": 0-10, "rationale": "1-2 sentence justification"}',
    "",
    "=== EXPECTED (acceptance criteria) ===",
    expectedText,
    "",
    "=== ACTUAL (assistant output) ===",
    actualText,
    "",
    "Return the JSON now.",
  ].join("\n");
}

function extractGraderJson(stdout) {
  if (!stdout) return null;
  // Tolerant: find the first {...} that parses as our expected shape.
  const candidates = stdout.match(/\{[^{}]*"pass"[^{}]*"score"[^{}]*"rationale"[^{}]*\}/);
  if (!candidates) {
    // Try the more permissive grab — first {...} block.
    const idx = stdout.indexOf("{");
    if (idx === -1) return null;
    const end = stdout.lastIndexOf("}");
    if (end <= idx) return null;
    try {
      const parsed = JSON.parse(stdout.slice(idx, end + 1));
      if (typeof parsed.pass === "boolean" && typeof parsed.score === "number") return parsed;
    } catch { /* fall through */ }
    return null;
  }
  try {
    const parsed = JSON.parse(candidates[0]);
    if (typeof parsed.pass === "boolean" && typeof parsed.score === "number") return parsed;
  } catch { /* fall through */ }
  return null;
}

function gradeCase(c, actualStdoutTail) {
  if (!c.expected_path) {
    return { ok: false, reason: "no expected.md", verdict: null };
  }
  const expectedText = stripBom(readFileSync(c.expected_path, "utf8"));
  const prompt = buildRubricPrompt(expectedText, actualStdoutTail, c.meta.pass_threshold ?? 7);
  // Grader is cheaper than the run — cap at 60s.
  const res = spawnSync("claude", ["-p", prompt], { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 });
  const stdout = res.stdout ?? "";
  const verdict = extractGraderJson(stdout);
  if (!verdict) {
    return {
      ok: false,
      reason: "grader output was not parseable JSON",
      verdict: null,
      grader_stdout_tail: stdout.slice(-1000),
      grader_exit: res.status ?? -1,
    };
  }
  return { ok: true, verdict, grader_exit: res.status ?? 0 };
}

// ---------- main ----------

const flags = parseArgs(process.argv.slice(2));
const filterSkill = typeof flags.skill === "string" ? flags.skill : null;
const doRun = Boolean(flags.run);
const doGrade = Boolean(flags.grade);
const writeReport = typeof flags.report === "string" ? flags.report : null;

const cases = await discoverCases(filterSkill);

if (!doRun) {
  // Discovery mode — just list.
  const report = {
    ok: true,
    mode: "discover",
    evals_root: EVALS_ROOT,
    cases_total: cases.length,
    cases: cases.map((c) => ({
      skill: c.skill,
      case_id: c.case_id,
      description: c.meta.description,
      tags: c.meta.tags,
      pass_threshold: c.meta.pass_threshold ?? 7,
    })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (writeReport) {
    mkdirSync(dirname(writeReport), { recursive: true });
    writeFileSync(writeReport, JSON.stringify(report, null, 2));
  }
  process.exit(0);
}

// Run mode — pre-flight cost check.
const perCaseEstimate = doGrade ? DEFAULT_CENTS_PER_CASE : DEFAULT_CENTS_PER_CASE - 1;
const estimatedTotalCents = cases.length * perCaseEstimate;

if (COST_CAP_CENTS !== null && Number.isFinite(COST_CAP_CENTS) && estimatedTotalCents > COST_CAP_CENTS) {
  const refusal = {
    ok: false,
    mode: doGrade ? "run+grade" : "run",
    reason: "estimated cost exceeds YIELDE_EVALS_MAX_COST_CENTS",
    cases_total: cases.length,
    cents_per_case_estimate: perCaseEstimate,
    estimated_total_cents: estimatedTotalCents,
    cost_cap_cents: COST_CAP_CENTS,
    hint: "raise the cap, narrow the --skill filter, or unset YIELDE_EVALS_MAX_COST_CENTS",
  };
  console.log(JSON.stringify(refusal, null, 2));
  if (writeReport) {
    mkdirSync(dirname(writeReport), { recursive: true });
    writeFileSync(writeReport, JSON.stringify(refusal, null, 2));
  }
  process.exit(3);
}

// Run mode — actually invoke claude -p per case.
const runs = [];
let passes = 0;
let fails = 0;
let ungraded = 0;
for (const c of cases) {
  const started = new Date().toISOString();
  const r = runCase(c, 120);
  const entry = {
    skill: c.skill,
    case_id: c.case_id,
    started_at: started,
    finished_at: new Date().toISOString(),
    exit_code: r.exit,
    timed_out: r.timed_out,
    stdout_chars: r.stdout.length,
    stderr_chars: r.stderr.length,
    stdout_tail: r.stdout.slice(-4000),
    stderr_tail: r.stderr.slice(-2000),
  };
  if (doGrade) {
    const g = gradeCase(c, entry.stdout_tail);
    entry.grader = g;
    if (g.ok && g.verdict) {
      if (g.verdict.pass) passes++; else fails++;
    } else {
      ungraded++;
    }
  }
  runs.push(entry);
}

const report = {
  ok: true,
  mode: doGrade ? "run+grade" : "run",
  cases_total: cases.length,
  cents_per_case_estimate: perCaseEstimate,
  estimated_total_cents: estimatedTotalCents,
  cost_cap_cents: COST_CAP_CENTS,
  pass_rate: doGrade && cases.length > 0
    ? Math.round((passes / cases.length) * 100) / 100
    : null,
  rollup: doGrade ? { passes, fails, ungraded } : null,
  runs,
  note: doGrade
    ? "Grader is informational — pass/fail does not short-circuit later cases."
    : "Add --grade to enable rubric-based automated grading via a second claude -p call.",
};

console.log(JSON.stringify(report, null, 2));

if (writeReport) {
  mkdirSync(dirname(writeReport), { recursive: true });
  writeFileSync(writeReport, JSON.stringify(report, null, 2));
}
process.exit(0);
