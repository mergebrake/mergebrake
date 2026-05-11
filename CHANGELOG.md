# Changelog

All notable changes to MergeBrake are recorded here. The format is loosely
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The GitHub Action mobile tag `v0` always points at the latest `0.x.y` release.

## [Unreleased]

(Each merged PR appends an entry here. Rolled into the next published version
at release time.)

### Added

- _placeholder_

### Changed

- _placeholder_

### Fixed

- _placeholder_

## 0.0.2 — Pre-release main snapshot

Snapshot of the v0 work between the initial commit and the first public
publish. Until `0.1.0` ships there are no breaking-version guarantees, but
these are the broad strokes:

### Added

- Postgres AST engine via `libpg_query` (WASM, no native build).
- 21 default rules covering destructive DDL, locking patterns,
  expand/contract recipes, and AI-PR scrutiny.
- ORM-aware impact mapping for Prisma (`@map` / `@@map`) and Drizzle
  (`pgTable("name", { alias: col_type("real_col") })`).
- Sticky PR comment via `mergebrake comment` and the GitHub Action.
- SARIF 2.1.0 output (`--format sarif`) for GitHub Code Scanning.
- `.mergebrake.yml` configuration with `ignore`, `severity`, `ignore-paths`,
  scoped `overrides`, `scan-scope`, and `cross-ref` tuning.
- `@mergebrake recheck` PR-comment command (issue_comment trigger with
  author-association gating).
- Default `scan-scope: changed` in PR workflows so first-install does not
  drown a repo in historical findings.
- Dogfood case studies on documenso, trigger.dev, formbricks (2,339 findings
  across 1,066 migrations).
- Landing page (`website/`) with OpenGraph image.

### Notes

This entry will be merged into a real `0.0.x` release tag when we cut one;
until then the npm packages are not yet published.

[Unreleased]: https://github.com/mergebrake/mergebrake/compare/v0.0.2...HEAD
