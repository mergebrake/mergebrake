# MergeBrake — GitHub Action

> Catch database-breaking PRs before merge. Sticky review comment + GitHub
> annotations + configurable fail policy.

## Quick start

Drop this file at `.github/workflows/mergebrake.yml`:

```yaml
name: MergeBrake
on:
  pull_request:
    paths:
      - 'prisma/**'
      - 'drizzle/**'
      - 'migrations/**'
      - 'db/migrate/**'
      - 'src/**'

# The action posts a sticky review comment, so it needs write access on PRs.
permissions:
  contents: read
  pull-requests: write

jobs:
  schema-impact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: mergebrake/mergebrake@v0
        with:
          fail-on: BLOCK
```

The first run posts a new comment on the PR. Every push to the same PR updates
the same comment in place — no comment spam.

By default, pull request runs scan only migration files changed in that PR. This
keeps the first install from failing on years of historical migrations. Set
`scan-scope: all` when you intentionally want a full repository audit.

## What the comment shows

- the verdict (`SAFE` 🟢 / `EXPAND_CONTRACT` 🟡 / `BLOCK` 🔴) and the risk score;
- AI-PR signals (Claude / Cursor / Codex / Copilot / Aider / Devin co-authors);
- every destructive or downtime-prone migration finding;
- the lines in your application code that still read or write the columns the
  migration is about to break (using Prisma `@map` / Drizzle aliases to follow
  the rename);
- an expand / contract recipe reviewers can paste into the PR conversation.

## Inputs

| Input | Default | Description |
|---|---|---|
| `inputs` | Prisma/Drizzle/Knex defaults | Glob(s) of migration files to scan. |
| `fail-on` | `BLOCK` | Verdict that fails the workflow (`BLOCK`, `EXPAND_CONTRACT`, `SAFE`). |
| `dialect` | `postgres` | `postgres` \| `mysql` \| `sqlite`. |
| `orm` | (auto) | Override ORM detection: `prisma`, `drizzle`, `knex`, `sequelize`, `typeorm`, `raw-sql`. |
| `base-repo` | _empty_ | Path to a base-branch checkout (enables deploy-order checks). |
| `scan-scope` | `changed` | `changed` scans only migration files touched by the PR; `all` scans the full input glob. |
| `sticky-comment` | `true` | Post or update a sticky PR comment. |
| `comment-marker` | `mergebrake:sticky-comment` | Hidden marker used to find the comment on subsequent runs. |
| `skip-comment-when-safe` | `false` | Do not comment when the verdict is `SAFE` with zero findings. |
| `github-token` | `${{ github.token }}` | Token used to post the sticky comment. |
| `mergebrake-version` | `latest` | Pin the `mergebrake` npm version. |
| `output-annotations` | `true` | Also emit inline `::error` / `::warning` annotations. |

## Outputs

- `verdict`: `SAFE` \| `EXPAND_CONTRACT` \| `BLOCK`.
- `risk-score`: aggregated risk number used to derive the verdict.
- `finding-count`: number of findings reported.
- `comment-action`: `created`, `updated`, or `skipped` for the sticky PR comment.

## Running multiple times on the same PR

Give each run a unique marker so the comments don't stomp on each other:

```yaml
- uses: mergebrake/mergebrake@v0
  with:
    inputs: 'prisma/migrations/**/migration.sql'
    comment-marker: 'mergebrake:prisma'

- uses: mergebrake/mergebrake@v0
  with:
    inputs: 'src/db/queries/**/*.sql'
    comment-marker: 'mergebrake:raw-sql'
```

## Enabling deploy-order checks

Check out the base branch into a separate path and point MergeBrake at it. This
unlocks the `deploy-order/contract-without-expand` rule, which flags PRs that
remove application references and drop the column in the same release:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
    path: head

- uses: actions/checkout@v4
  with:
    ref: ${{ github.base_ref }}
    path: base

- uses: mergebrake/mergebrake@v0
  with:
    base-repo: base
```

## Required permissions

For the sticky comment to work, the workflow must declare:

```yaml
permissions:
  contents: read
  pull-requests: write
```

If you cannot grant `pull-requests: write` (e.g. on forks via `pull_request`
events), MergeBrake still emits inline annotations and fails the workflow when
the verdict matches `fail-on`.
