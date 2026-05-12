#!/usr/bin/env node
/**
 * run-evals — Phase 6e scaffolding for yielde-skills eval harness.
 *
 * Walks `evals/<skill>/<case-id>/` directories and produces a JSON report.
 *
 *   node scripts/run-evals.mjs                       # list discoverable cases
 *   node scripts/run-evals.mjs --skill brain-read    # filter by skill
 *   node scripts/run-evals.mjs --run                 # actually shell out to `claude -p`
 *                                                    # (LLM cost — opt-in)
 *   node scripts/run-evals.mjs --run --grader simple # grade output against expected.md
 *                                                    # rubric using a separate `claude -p` call
 *
 * Phase 6e ships discovery + listing + dry-run report. The `--run` path spawns the local
 * `claude` CLI in headless mode and captures stdout per case. Pass/fail grading is left as
 * a Phase 7 follow-up — for now `--run` reports raw outputs and the human grades.
 *
 * Hard rules:
 *   - Never promote brain drafts; promotion stays `/brain-log promote`-only.
 *   - Cases that touch real services must declare a fixtures dir and avoid live data.
 */

import { readdir, stat } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const EVALS_ROOT = join(REPO_ROOT, "evals");

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

function stripBom(s) { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }

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
      let meta = { description: "", tags: [], timeout_sec: 120 };
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
  // Spawn `claude -p` with the input.md contents. The eval harness is responsible for setting
  // up any working directory / env that the skill needs — for now we just run from REPO_ROOT.
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

const flags = parseArgs(process.argv.slice(2));
const filterSkill = typeof flags.skill === "string" ? flags.skill : null;
const doRun = Boolean(flags.run);
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
    })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (writeReport) {
    mkdirSync(dirname(writeReport), { recursive: true });
    writeFileSync(writeReport, JSON.stringify(report, null, 2));
  }
  process.exit(0);
}

// Run mode — actually invoke claude -p per case.
const runs = [];
for (const c of cases) {
  const started = new Date().toISOString();
  const r = runCase(c, 120);
  runs.push({
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
  });
}

const report = {
  ok: true,
  mode: "run",
  cases_total: cases.length,
  runs,
  note: "Phase 6e: human grader reads expected.md and the stdout_tail per case. Automated grading is Phase 7+.",
};

console.log(JSON.stringify(report, null, 2));

if (writeReport) {
  mkdirSync(dirname(writeReport), { recursive: true });
  writeFileSync(writeReport, JSON.stringify(report, null, 2));
}
process.exit(0);
