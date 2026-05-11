#!/usr/bin/env node
// Discovers public Prisma / Drizzle Postgres repos, runs MergeBrake against
// their migrations, and prints a ranked list of high-value pilot targets.
//
// Usage:
//   GITHUB_TOKEN=ghp_xxx node scripts/discover-targets.mjs               (Prisma + Drizzle, 30 candidates)
//   GITHUB_TOKEN=ghp_xxx node scripts/discover-targets.mjs --orm prisma  (Prisma only)
//   GITHUB_TOKEN=ghp_xxx node scripts/discover-targets.mjs --limit 60    (cast a wider net)
//   GITHUB_TOKEN=ghp_xxx node scripts/discover-targets.mjs --out my.md
//
// What it does:
//   1. Searches the GitHub repo index for "topic:prisma" / "topic:drizzle-orm",
//      TypeScript, recently pushed, decent star count.
//   2. For each candidate, checks whether it actually has a migrations folder,
//      counts unique contributors, and filters out forks / archived.
//   3. Shallow-clones each survivor into a temp directory.
//   4. Runs `mergebrake scan --format json` against its migrations.
//   5. Writes a Markdown report ranked by risk score, with the top rules and
//      a paste-ready DM template per repo.
//
// Cost: ~50 GitHub API calls + N shallow git clones. Uses ~500MB temp disk.
//
// Requires:
//   - GITHUB_TOKEN env (classic PAT with `public_repo` scope, or GH_TOKEN)
//   - `mergebrake` CLI built (npm run build at the repo root)
//   - git available on PATH

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return args[i + 1];
}

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("Set GITHUB_TOKEN (a classic PAT with 'public_repo' scope is enough).");
  console.error("Create one at: https://github.com/settings/tokens");
  process.exit(1);
}

const ORM_FILTER = flag("orm", "both");
const LIMIT = Number.parseInt(flag("limit", "30"), 10);
const OUT_PATH = flag("out", "discovery-targets.md");
const MIN_STARS = Number.parseInt(flag("min-stars", "100"), 10);
const MIN_CONTRIBUTORS = Number.parseInt(flag("min-contributors", "3"), 10);
const KEEP_CLONES = args.includes("--keep-clones");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const CLI_PATH = path.join(repoRoot, "packages", "cli", "dist", "cli.js");

await fs.access(CLI_PATH).catch(() => {
  console.error(`mergebrake CLI not built. Run \`npm run build\` first.`);
  console.error(`expected: ${CLI_PATH}`);
  process.exit(1);
});

const tmpDir = path.join(os.tmpdir(), "mergebrake-discover");
await fs.mkdir(tmpDir, { recursive: true });

async function gh(url) {
  const res = await fetch(`https://api.github.com${url}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mergebrake-discovery/0.1",
    },
  });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    throw new Error(`GitHub rate-limited (${res.status}). Resets at ${reset ? new Date(reset * 1000).toISOString() : "unknown"}.`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${url}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

const sinceISO = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 4);
  return d.toISOString().slice(0, 10);
})();

const queries = [];
if (ORM_FILTER === "both" || ORM_FILTER === "prisma") {
  queries.push({
    orm: "prisma",
    q: `topic:prisma stars:>${MIN_STARS} language:TypeScript pushed:>${sinceISO} archived:false fork:false`,
  });
}
if (ORM_FILTER === "both" || ORM_FILTER === "drizzle") {
  queries.push({
    orm: "drizzle",
    q: `topic:drizzle-orm stars:>${MIN_STARS} language:TypeScript pushed:>${sinceISO} archived:false fork:false`,
  });
}

console.log(`Search window: pushed since ${sinceISO}, ≥${MIN_STARS} stars, ≥${MIN_CONTRIBUTORS} contributors.`);
console.log(`Targets: ${LIMIT}.  Output: ${OUT_PATH}.\n`);

const candidates = [];
for (const { orm, q } of queries) {
  console.log(`Searching: ${q}`);
  const per = Math.min(50, Math.ceil(LIMIT * 1.5));
  const data = await gh(`/search/repositories?q=${encodeURIComponent(q)}&per_page=${per}&sort=updated`);
  for (const repo of data.items ?? []) {
    candidates.push({ ...repo, _orm: orm });
  }
}

// Deduplicate (a repo may show up in both Prisma and Drizzle topics).
const byFullName = new Map();
for (const c of candidates) {
  if (!byFullName.has(c.full_name)) byFullName.set(c.full_name, c);
}
const unique = [...byFullName.values()].slice(0, LIMIT * 2);
console.log(`Found ${candidates.length} candidates (${unique.length} unique after dedupe).\n`);

async function hasMigrations(fullName) {
  // Prisma first.
  try {
    const list = await gh(`/repos/${fullName}/contents/prisma/migrations`);
    if (Array.isArray(list) && list.some((entry) => entry.type === "dir")) {
      return { orm: "prisma", glob: "prisma/migrations/**/migration.sql" };
    }
  } catch {}
  // Drizzle (the default `drizzle.config.ts` outputs `./drizzle/*.sql`).
  for (const dir of ["drizzle", "db/migrations", "migrations"]) {
    try {
      const list = await gh(`/repos/${fullName}/contents/${dir}`);
      if (Array.isArray(list) && list.some((entry) => entry.name.endsWith(".sql"))) {
        return { orm: "drizzle", glob: `${dir}/**/*.sql` };
      }
    } catch {}
  }
  return null;
}

async function contributorCount(fullName) {
  try {
    const data = await gh(`/repos/${fullName}/contributors?per_page=30&anon=0`);
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

const qualified = [];
for (const repo of unique) {
  if (qualified.length >= LIMIT) break;
  process.stdout.write(`  • ${repo.full_name} (★${repo.stargazers_count})… `);
  const hint = await hasMigrations(repo.full_name);
  if (!hint) {
    console.log("no migrations folder");
    continue;
  }
  const contribs = await contributorCount(repo.full_name);
  if (contribs < MIN_CONTRIBUTORS) {
    console.log(`only ${contribs} contributors`);
    continue;
  }
  console.log(`✓ ${hint.orm}, ${contribs} contributors`);
  qualified.push({ ...repo, _orm: hint.orm, _glob: hint.glob, _contribs: contribs });
}

console.log(`\n${qualified.length} repos qualified. Cloning + scanning…\n`);

const reports = [];
for (const repo of qualified) {
  const safeName = repo.full_name.replace("/", "__");
  const dest = path.join(tmpDir, safeName);
  try { await fs.rm(dest, { recursive: true, force: true }); } catch {}

  process.stdout.write(`  ⤵ clone ${repo.full_name}… `);
  const clone = spawnSync(
    "git",
    ["clone", "--depth", "1", "--quiet", repo.clone_url, dest],
    { encoding: "utf-8", stdio: ["ignore", "ignore", "pipe"] },
  );
  if (clone.status !== 0) {
    console.log(`FAIL (${(clone.stderr || clone.error?.message || "").toString().slice(0, 60)})`);
    continue;
  }
  console.log("done");

  process.stdout.write(`    ⤵ scan… `);
  const result = spawnSync(
    "node",
    [CLI_PATH, "scan", repo._glob, "--repo", dest, "--format", "json"],
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (!result.stdout) {
    console.log(`scan produced no output (${(result.stderr || "").slice(0, 80)})`);
    if (!KEEP_CLONES) await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    continue;
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.log("invalid JSON from scan");
    if (!KEEP_CLONES) await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    continue;
  }

  const findings = report.findings || [];
  console.log(`${report.verdict} · risk ${report.riskScore} · ${findings.length} findings`);
  reports.push({ repo, report });

  if (!KEEP_CLONES) await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
}

// Score each report. Critical findings + destructive count dominate.
function score({ report }) {
  const findings = report.findings || [];
  const sevWeight = { critical: 50, high: 20, medium: 8, low: 3, info: 1 };
  let s = 0;
  for (const f of findings) s += sevWeight[f.severity] ?? 1;
  return s;
}
reports.sort((a, b) => score(b) - score(a));

function topRulesOf(report) {
  const counts = new Map();
  for (const f of report.findings || []) {
    counts.set(f.ruleId, (counts.get(f.ruleId) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule, n]) => `\`${rule}\` (${n})`);
}

function severityHist(report) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of report.findings || []) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
  }
  return counts;
}

function dmFor(repo, report) {
  const findings = report.findings || [];
  const critical = findings.filter((f) => f.severity === "critical").length;
  const sample = findings.find((f) => f.severity === "critical") ?? findings[0];
  const sampleLine = sample
    ? `e.g. ${sample.ruleId} at ${sample.location?.file || "migration"}:${sample.location?.line || "?"}`
    : "";
  return `Hi — I'm building MergeBrake, a pre-merge schema-impact check for Postgres + ${repo._orm === "prisma" ? "Prisma" : "Drizzle"}. I ran it on the migrations in **${repo.full_name}** and it flagged ${findings.length} findings (${critical} critical) — ${sampleLine}. Full report (anonymized if you want): [link]. Happy to drop the GitHub Action into your CI for free and see what it produces on your next migration PR.`;
}

const lines = [];
lines.push(`# MergeBrake — Discovery targets`);
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Window: pushed since ${sinceISO}, ≥${MIN_STARS} stars, ≥${MIN_CONTRIBUTORS} contributors`);
lines.push(`Scanned: ${reports.length} repos`);
lines.push("");
lines.push(`## Ranked by risk score (higher = more interesting for outreach)`);
lines.push("");

for (const entry of reports) {
  const { repo, report } = entry;
  const findings = report.findings || [];
  const hist = severityHist(report);
  lines.push(`### ${repo.full_name}  ·  ★${repo.stargazers_count}  ·  ${repo._orm}`);
  lines.push("");
  lines.push(`- **Verdict:** ${report.verdict}  ·  **Risk score:** ${report.riskScore}  ·  **Findings:** ${findings.length}`);
  lines.push(`- **Severity:** ${hist.critical} critical · ${hist.high} high · ${hist.medium} medium · ${hist.low} low`);
  lines.push(`- **Top rules:** ${topRulesOf(report).join(", ") || "—"}`);
  lines.push(`- **Repo:** <${repo.html_url}>  ·  **Contributors:** ${repo._contribs}  ·  **Updated:** ${repo.pushed_at?.slice(0, 10)}`);
  lines.push("");
  lines.push(`<details><summary>DM template</summary>`);
  lines.push("");
  lines.push(`> ${dmFor(repo, report)}`);
  lines.push("");
  lines.push(`</details>`);
  lines.push("");
}

if (reports.length === 0) {
  lines.push(`_No repos were successfully scanned. Try widening the search with \`--limit 60\` or \`--min-stars 50\`._`);
}

await fs.writeFile(path.resolve(repoRoot, OUT_PATH), lines.join("\n"));
console.log(`\nWrote ${OUT_PATH} — ${reports.length} ranked targets.`);
