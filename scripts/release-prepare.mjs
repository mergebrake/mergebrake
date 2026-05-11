#!/usr/bin/env node
// Run from the monorepo root:
//   node scripts/release-prepare.mjs 0.0.3
//   node scripts/release-prepare.mjs 0.0.3 --dry-run
//
// What it does:
//   1. Validates the version string.
//   2. Bumps `version` in the root + every package.json under packages/*.
//   3. Replaces workspace deps that use "*" with the new exact version so the
//      tarball is reproducible from outside the monorepo.
//   4. Runs `npm run build` and `npm test` — refuses to tag a broken release.
//   5. Verifies `npm pack --dry-run` for the public packages.
//   6. Commits ("chore(release): vX.Y.Z") and tags `vX.Y.Z`.
//
// What it does NOT do:
//   - publishing — that is the CI job (.github/workflows/release.yml)
//   - pushing — you stay in control of `git push && git push origin vX.Y.Z`

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipTests = args.includes("--skip-tests");
const version = args.find((a) => !a.startsWith("--"));

if (!version) {
  console.error("Usage: node scripts/release-prepare.mjs <version> [--dry-run] [--skip-tests]");
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/.test(version)) {
  console.error(`Invalid version: ${version}. Expected semver (e.g. 0.0.3 or 0.1.0-rc.1).`);
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
process.chdir(repoRoot);

const PUBLIC_PACKAGES = ["packages/shared", "packages/core", "packages/cli"];
const PACKAGE_FILES = [
  "package.json",
  ...PUBLIC_PACKAGES.map((p) => path.join(p, "package.json")),
];
const WORKSPACE_DEPS = ["@mergebrake/shared", "@mergebrake/core"];

const summary = [];

for (const rel of PACKAGE_FILES) {
  const abs = path.join(repoRoot, rel);
  const raw = await fs.readFile(abs, "utf-8");
  const json = JSON.parse(raw);
  const before = JSON.stringify(json, null, 2);

  if ("version" in json && !json.private) {
    json.version = version;
  } else if (rel === "package.json") {
    // Root monorepo package: do not bump (stays 0.0.0 private).
  } else if ("version" in json) {
    json.version = version;
  }

  for (const dep of WORKSPACE_DEPS) {
    if (json.dependencies && json.dependencies[dep] === "*") {
      json.dependencies[dep] = version;
      summary.push(`  ${rel}: ${dep} * -> ${version}`);
    }
  }

  const after = JSON.stringify(json, null, 2) + "\n";
  if (after !== before + "\n") {
    if (dryRun) {
      console.log(`would update ${rel}`);
    } else {
      await fs.writeFile(abs, after);
      console.log(`updated  ${rel}`);
    }
  } else {
    console.log(`unchanged ${rel}`);
  }
}

if (summary.length) {
  console.log("\nWorkspace dep rewrites:");
  for (const line of summary) console.log(line);
}

console.log("\nRunning build…");
run("npm run build");

if (!skipTests) {
  console.log("\nRunning tests…");
  run("npm test");
}

console.log("\nRunning npm pack --dry-run for each public package…");
for (const pkg of PUBLIC_PACKAGES) {
  run(`npm pack --dry-run --silent`, pkg);
}

if (dryRun) {
  console.log("\n--dry-run set — stopping before commit/tag.");
  process.exit(0);
}

const status = execSync("git status --porcelain", { encoding: "utf-8" });
if (!status.trim()) {
  console.log("\nNothing changed in working tree — version bump may already be committed.");
  console.log("If you only want to retag, run: git tag v" + version);
  process.exit(0);
}

console.log("\nCommitting and tagging…");
run("git add package.json packages/shared/package.json packages/core/package.json packages/cli/package.json package-lock.json 2>/dev/null || git add -A");
run(`git commit -m "chore(release): v${version}"`);
run(`git tag -a v${version} -m "v${version}"`);

console.log("\nDone. Next:");
console.log(`  git push`);
console.log(`  git push origin v${version}`);
console.log(`\nThe release workflow will publish to npm when the tag arrives.`);

function run(cmd, cwd = ".") {
  try {
    execSync(cmd, { stdio: "inherit", cwd: path.resolve(repoRoot, cwd) });
  } catch (err) {
    console.error(`\nCommand failed: ${cmd}`);
    process.exit(typeof err.status === "number" ? err.status : 1);
  }
}
