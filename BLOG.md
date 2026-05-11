# Show HN: I ran a schema-impact analyzer on 1,066 real migrations. Here's what it found.

> Draft post for Hacker News / Lobsters / Twitter. Keep the title under 80 chars
> and the body skimmable. Suggested HN title:
> **"Show HN: MergeBrake – catch DB-breaking PRs by mapping schema changes to app code"**

## TL;DR

I built [MergeBrake](https://github.com/mergebrake/mergebrake), a pre-merge
schema impact guard for Postgres apps. It uses Postgres' own parser (via
[`libpg_query`](https://github.com/launchql/libpg-query-node)) to read your
migrations, parses your Prisma `@map` / Drizzle aliases, and tells you in one
sticky PR comment which application files will break if the migration ships.

To validate it, I ran the default ruleset against the full migration history
of three popular open-source projects:

- [`documenso/documenso`](https://github.com/documenso/documenso) — 157
  migrations, **391 findings**, verdict **🔴 BLOCK** (risk **7,680**)
- [`triggerdotdev/trigger.dev`](https://github.com/triggerdotdev/trigger.dev) —
  768 migrations, **1,243 findings**, verdict **🔴 BLOCK** (risk **30,698**)
- [`formbricks/formbricks`](https://github.com/formbricks/formbricks) — 141
  migrations, **249 findings**, verdict **🔴 BLOCK** (risk **5,368**)

That's **1,883 risky patterns across 1,066 migrations**. The full breakdown is
in [`examples/dogfood/`](./examples/dogfood/README.md).

## Why I started

In the last six months, three different "AI agent deleted my database"
stories went viral:

- A Cursor + Claude Opus 4.6 agent dropped the entire **PocketOS** production
  database — backups included — in a single Railway API call.
- Replit's AI agent wiped SaaStr founder Jason Lemkin's production database.
- Anthropic's own Claude Code logged a March 2026 incident where it ran
  `prisma migrate reset --force` on a dev DB without consent.

These are the spectacular ones. The boring ones are far more common: an agent
drops a column from a Prisma schema and the application keeps reading it via
its camelCase alias, so deploy succeeds and the next request crashes.

Existing tools cover slivers of this:

- **Squawk / pgfence / Atlas** lint the SQL.
- **CodeRabbit / Greptile / Cursor Bugbot** review the diff.

Neither side connects the schema change to the code that will break. That's
the gap MergeBrake sits in.

## What it does

1. Parses the migration with libpg_query — no regex, comments don't fool it,
   and schema-qualified names are resolved precisely.
2. Reads the Prisma `@map` / `@@map` and Drizzle `pgTable("users", { fullName:
   text("full_name") })` blocks in your repo to learn what each column maps to
   in TypeScript.
3. Greps the application code (13 languages) for the SQL name *and* its ORM
   alias.
4. Optionally checks out the base branch and runs the
   `contract-without-expand` rule: did this PR delete the code references and
   drop the column in the same release?
5. Detects when the commit was authored by an AI agent
   (`Co-Authored-By: Claude / Cursor / Codex / Copilot / Aider / Devin`) and
   raises the scrutiny multiplier to 2.5–3×.
6. Posts (or updates) a single sticky PR comment with verdict + every
   finding + an expand/contract recipe.

## What I actually found in the wild

Three patterns dominate every Prisma-based repo I looked at:

| Pattern | Findings | Why it matters |
|---|---:|---|
| `locking/add-foreign-key-without-not-valid` | 624 | Prisma's default emit is `ADD FOREIGN KEY` (no `NOT VALID`). Once your table has tens of millions of rows, validation blocks writes for minutes. |
| `locking/create-index-non-concurrent` | 499 | Same story: `CREATE INDEX`, not `CREATE INDEX CONCURRENTLY`. The first emergency rollback a growing startup hits. |
| `destructive/drop-column` | 244 | The migration that pairs with "the app still reads `user.fullName`". |

The single riskiest migration in the dataset is
[`schema_redesign_for_new_system`](https://github.com/triggerdotdev/trigger.dev/blob/a5ba4065/internal-packages/database/prisma/migrations/20230512085413_schema_redesign_for_new_system/migration.sql)
from trigger.dev. It drops 18 columns and 30+ tables in a single migration.
The file even opens with Prisma's `⚠ Warnings` block — the team knew it was
risky, but the warning has no idea which lines of TypeScript still reference
the symbols being deleted. That's the conversation MergeBrake's sticky
comment is built to start.

Documenso has its own version: a hand-edited
[`add_organisations` migration](https://github.com/documenso/documenso/blob/87315adb/packages/prisma/migrations/20250522054050_add_organisations/migration.sql)
that opens with `Search "CUSTOM_CHANGE" to find areas where custom changes
have occurred`. The team flagged the migration in the file itself; MergeBrake
would have flagged it in the PR.

The full case-study list with permalinks is in
[`examples/dogfood/README.md`](./examples/dogfood/README.md).

## What this isn't

- Not a migration **executor**. MergeBrake never connects to your database.
- Not a generic AI code reviewer. It's narrow on purpose: schema → app code.
- Not a replacement for human review. It collapses the mechanical part of
  schema review so reviewers can focus on intent.

## Trying it

```bash
# One-off
npx mergebrake scan "prisma/migrations/**/migration.sql"

# As a GitHub Action with a sticky PR comment
# .github/workflows/mergebrake.yml
permissions:
  contents: read
  pull-requests: write
jobs:
  schema-impact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: mergebrake/mergebrake@v0
        with:
          fail-on: BLOCK
```

The CLI, action, and 15 default rules are MIT. The repository is
[mergebrake/mergebrake](https://github.com/mergebrake/mergebrake).

## What's next

- Replace one more piece of inferred behaviour with parsed behaviour: an
  optional **stats snapshot** the user can run locally to give MergeBrake row
  counts and index sizes. That lets the risk score calibrate against the
  actual table — instead of warning identically on a 100-row dev table and a
  100-million-row prod table.
- Add the **`@mergebrake recheck`** PR comment command so reviewers can
  re-run the analysis after changes without pushing a new commit.

I'd love feedback on the ruleset and which patterns I missed. The
[issue tracker](https://github.com/mergebrake/mergebrake/issues) is open.

— [@yourhandle](https://twitter.com/yourhandle)

---

### Submission notes (don't post these)

**Hacker News title**: `Show HN: MergeBrake – catch DB-breaking PRs by mapping schema changes to app code`

**First comment template** (drop ~2 min after submitting):

> Author here. I built this after the third "AI agent deleted my database"
> story this year (PocketOS, Replit/SaaStr, Anthropic's own Claude Code
> incident report). Happy to answer questions on the ruleset, the
> libpg_query integration, or how MergeBrake differs from Squawk/pgfence/Atlas
> (TL;DR: those lint SQL, MergeBrake also reads your ORM mapping and your
> application code). Source + dogfood case studies on three real OSS Postgres
> repos (1,066 migrations / 1,883 findings) here:
> https://github.com/mergebrake/mergebrake/tree/main/examples/dogfood

**Tags for crossposting**:
`#postgres #prisma #drizzle #devtools #databases #migrations #ai`

**Pre-launch checklist**:

- [ ] Register `mergebrake.dev` and deploy `website/` to Cloudflare Pages.
- [ ] Publish `@mergebrake/shared`, `@mergebrake/core`, `mergebrake` to npm.
- [ ] Push the repo to GitHub and enable issues + discussions.
- [ ] List the action on the GitHub Marketplace.
- [ ] Take one good screenshot of the sticky PR comment running on a fresh
      PR in a test repo and embed it as the HN OG image.
- [ ] Pin the dogfood README at the top of the GitHub repo.
