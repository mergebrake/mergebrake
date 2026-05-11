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
`scan-scope: all` when you intentionally want a full repository audit, or set
`scan-scope` in `.mergebrake.yml`.

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
| `scan-scope` | `.mergebrake.yml`, then `changed` | `changed` scans only migration files touched by the PR; `all` scans the full input glob. |
| `sticky-comment` | `true` | Post or update a sticky PR comment. |
| `comment-marker` | `mergebrake:sticky-comment` | Hidden marker used to find the comment on subsequent runs. |
| `skip-comment-when-safe` | `false` | Do not comment when the verdict is `SAFE` with zero findings. |
| `github-token` | `${{ github.token }}` | Token used to post the sticky comment. |
| `mergebrake-version` | `latest` | Pin the `mergebrake` npm version. |
| `output-annotations` | `true` | Also emit inline `::error` / `::warning` annotations. |
| `sarif-file` | _empty_ | Write a SARIF 2.1.0 report to this path for `github/codeql-action/upload-sarif`. |
| `config` | _empty_ | Explicit path to a `.mergebrake.yml`. Auto-discovered when omitted. |

## Outputs

- `verdict`: `SAFE` \| `EXPAND_CONTRACT` \| `BLOCK`.
- `risk-score`: aggregated risk number used to derive the verdict.
- `finding-count`: number of findings reported.
- `sarif-file`: absolute path to the SARIF report when `sarif-file` input is set.
- `comment-action`: `created`, `updated`, or `skipped` for the sticky PR comment.

## Uploading findings to GitHub Code Scanning

```yaml
permissions:
  contents: read
  pull-requests: write
  security-events: write   # required by upload-sarif

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
          sarif-file: mergebrake.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()    # upload even when MergeBrake fails the check
        with:
          sarif_file: mergebrake.sarif
          category: mergebrake
```

Findings then appear in **Security › Code scanning** with the same severity
mapping the sticky comment uses.

## `@mergebrake recheck` from a PR comment

Add an `issue_comment` trigger to your workflow and the action will re-run
when a maintainer comments `@mergebrake recheck` on the pull request. The
sticky comment is updated in place — no extra commit needed.

```yaml
on:
  pull_request:
    paths: ['prisma/**', 'drizzle/**', 'migrations/**', 'src/**']
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write

jobs:
  schema-impact:
    if: >-
      github.event_name == 'pull_request' ||
      (github.event_name == 'issue_comment' && github.event.issue.pull_request != null)
    runs-on: ubuntu-latest
    steps:
      - if: github.event_name == 'pull_request'
        uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: mergebrake/mergebrake@v0
        with:
          fail-on: BLOCK
```

A full copy-pasteable workflow lives in
[`examples/workflow-with-recheck.yml`](./examples/workflow-with-recheck.yml).

By default only `OWNER`, `MEMBER`, and `COLLABORATOR` author associations are
allowed to trigger a recheck — drive-by commenters can't burn your
Actions minutes. Override with the `recheck-allowed-associations` input. Set
`recheck-trigger-phrase: ''` to disable the feature entirely.

## Configuration file

Drop a `.mergebrake.yml` at the repository root and the action will pick it
up automatically. See [`.mergebrake.example.yml`](../../.mergebrake.example.yml)
for the full annotated example. To use a non-default path:

```yaml
- uses: mergebrake/mergebrake@v0
  with:
    config: ops/mergebrake-prod.yml
```

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
