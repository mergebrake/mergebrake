# MergeBrake

> Hit the brake before AI-generated PRs hit production.

MergeBrake is a pre-merge guard for database migrations. It scans your pull
request, detects destructive or downtime-prone schema changes, and tells you
in one line whether the PR is **SAFE**, needs an **EXPAND / CONTRACT**
rollout, or must be **BLOCKED**.

It also knows when the PR was written by an AI coding agent (Claude Code,
Cursor, Copilot, Codex, Aider) and increases its scrutiny accordingly —
because that's where the [Replit-deleted-our-database](https://x.com/jasonlk/status/1946069562723897802),
[Cursor-Opus-snuffed-out-PocketOS](https://www.theregister.com/2026/04/27/cursoropus_agent_snuffs_out_pocketos/)
and [Claude-Code-prisma-migrate-reset](https://github.com/anthropics/claude-code/issues/34729)
incidents keep coming from.

```bash
npx mergebrake scan "prisma/migrations/**/migration.sql" \
  --commits ./.git/COMMIT_EDITMSG
```

```text
MergeBrake — pre-merge migration guard
────────────────────────────────────────────────────────
Verdict:    🔴 BLOCK — data loss or downtime risk
Risk score: 150
ORM stack:  prisma    Dialect: postgres
AI-PR detected (scrutiny x3.00): Claude

#1  CRITICAL  DROP COLUMN users.full_name is destructive
  prisma/migrations/20260511_drop_full_name/migration.sql:1
  This migration drops column `full_name` from `users`. Dropping a column
  is irreversible…

  Cross-surface impact (5 references in app code):
    • src/api/profile.ts:9   name: u.fullName,
    • src/api/users.ts:11    full_name: true,
    • src/api/users.ts:18    SELECT id, email, full_name FROM users …

  Expand/contract recipe:
    Split the column removal into two deploys (expand/contract).
    [expand]        Deploy app code that no longer reads or writes `full_name`.
    [migrate-data]  CREATE TABLE archive_users_full_name AS SELECT …
    [contract]      ALTER TABLE users DROP COLUMN full_name;
```

## Why MergeBrake exists

In early 2026, [Sonar reported](https://www.sonarsource.com/) that **42% of
the code committed to GitHub is AI-generated** and **96% of developers don't
fully trust the output, but only 48% always verify it before commit**.

The result, predictably, is a string of public database disasters:

- A **Cursor + Claude Opus 4.6** agent deleted the entire PocketOS production
  database — backups included — in **9 seconds** through a single Railway
  API call (April 2026).
- The **Replit AI agent** deleted SaaStr founder Jason Lemkin's production
  database while it had unrestricted write access.
- **Claude Code itself** logged an incident in March 2026 where it ran
  `prisma migrate reset --force` without explicit consent.

Existing tools either focus on:

| Tool | What it does | What it misses |
|---|---|---|
| [Atlas](https://atlasgo.io/) (Ariga) | Schema-as-code + lint behind a $9/dev paywall | Paywalled, complex, no AI-PR awareness |
| [pgroll](https://pgroll.com/) (Xata) | Zero-downtime executor | Runs migrations; doesn't analyze them |
| [Squawk](https://squawkhq.com/) | 32 Postgres rules, no auto-fix | Linter only, no cross-app awareness, no recipes |
| [pgfence](https://pgfence.com/) | Postgres lock-mode analysis | Postgres-only, doesn't scan app code |
| [strong_migrations](https://github.com/ankane/strong_migrations) | Rails-only, but excellent | Rails only |
| [CodeRabbit](https://coderabbit.ai/), [Greptile](https://greptile.com/) | Generic AI PR review | Not specialized in DB risk |

**MergeBrake is the only tool that does all four:**

1. **Cross-surface analysis.** When a migration drops `users.full_name`,
   MergeBrake greps your TypeScript / Python / JavaScript code for every
   place that still reads it — including the camelCase variant `fullName`.
2. **Multi-ORM auto-detection.** Prisma, Drizzle, Knex, Sequelize, TypeORM,
   and raw SQL — one tool, no per-stack adapter to install.
3. **Expand / contract recipes.** Every finding ships with a copy-pasteable
   two- or three-step rollout plan, not a lecture.
4. **AI-PR amplification.** Commits with `Co-Authored-By: Claude / Cursor /
   Codex / Copilot / Aider / Devin` raise the scrutiny multiplier to 2.5×–3×.
   A change that's borderline-safe from a human becomes a BLOCK when the AI
   wrote it.

## Install

```bash
npm install -g mergebrake
```

Or run on demand:

```bash
npx mergebrake scan path/to/migration.sql
```

Requires Node.js 20+.

## Usage

### Local scan

```bash
mergebrake scan "prisma/migrations/**/migration.sql"
mergebrake scan db/migrate
mergebrake scan migrations/20260511_drop_user_name.sql --dialect postgres
```

### CI / GitHub Action

```yaml
# .github/workflows/migration-guard.yml
name: MergeBrake
on: pull_request

jobs:
  migration-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Collect commit messages from PR
        run: git log --format='%B%n---' origin/${{ github.event.pull_request.base.ref }}..HEAD > /tmp/commits.txt
      - name: Run MergeBrake
        run: npx mergebrake scan "prisma/migrations/**/migration.sql" --commits /tmp/commits.txt --format github
```

The `--format github` mode emits annotations on the changed lines so they
appear inline in the PR diff.

### Output formats

| Flag | Use case |
|---|---|
| `--format terminal` | Default. Colorized output for local dev. |
| `--format markdown` | Paste into a PR comment. |
| `--format github` | GitHub Actions inline annotations. |
| `--format json` | Pipe into your own tooling. |

### Fail policy

```bash
mergebrake scan ... --fail-on BLOCK             # exit 1 only on BLOCK (default)
mergebrake scan ... --fail-on EXPAND_CONTRACT   # exit 1 on EXPAND_CONTRACT or worse
mergebrake scan ... --fail-on SAFE              # strict: exit 1 on any finding
```

## How the verdict works

MergeBrake computes a **risk score** by summing severity weights of every
finding and applying the AI-PR scrutiny multiplier.

| Severity | Weight |
|---|---|
| critical | 50 |
| high | 20 |
| medium | 8 |
| low | 3 |

| Verdict | Risk score |
|---|---|
| **SAFE** 🟢 | < 15 |
| **EXPAND_CONTRACT** 🟡 | 15 – 49 |
| **BLOCK** 🔴 | ≥ 50 |

Examples:

- One `DROP COLUMN` (critical, 50) → **BLOCK**.
- One `ADD COLUMN NOT NULL` without default (high, 20) → **EXPAND_CONTRACT**.
- One `CREATE INDEX` missing CONCURRENTLY (medium, 8) → **SAFE**, but flagged.
- One medium finding × AI-PR multiplier 3× → **EXPAND_CONTRACT** (24 ≥ 15).

## Rules (v0.0.1)

| Rule ID | Severity | Detects |
|---|---|---|
| `destructive/drop-column` | critical | `ALTER TABLE … DROP COLUMN` |
| `destructive/drop-table` | critical | `DROP TABLE` and `DROP TABLE CASCADE` |
| `destructive/rename-column` | high | `ALTER TABLE … RENAME COLUMN` |
| `locking/add-not-null-without-default` | high | `ADD COLUMN x NOT NULL` (no default) |
| `locking/create-index-non-concurrent` | medium | `CREATE INDEX` without `CONCURRENTLY` (Postgres) |

More rules ship weekly. The full taxonomy is at
[mergebrake.dev/rules](https://mergebrake.dev/rules).

## What MergeBrake is _not_

- Not a migration executor. We never touch your database.
- Not a replacement for review. We replace the part of review that's
  mechanical and easy to miss — irreversible DDL, lock duration, drift
  between schema and app code. Humans still own design.
- Not a security scanner. Use [Snyk](https://snyk.io/) or
  [Semgrep](https://semgrep.dev/) for that.

## License

MIT. See [LICENSE](./LICENSE).

## Status

🚧 **v0.0.1 — early alpha.** APIs and rule IDs may change. We're shipping
in public — open an issue with your favorite migration disaster and we'll
add a rule for it.
