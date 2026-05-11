# DB PR Risk Audit Report Template

## Account

- Team:
- Repo:
- Stack:
- Date:
- Contact:

## Executive Summary

- Verdict:
- Migrations scanned:
- Findings:
- Critical/high findings:
- App-code impact findings:
- Recommended first policy:

## Top Risks

| # | Migration | Risk | Rule | Impact | Recommendation |
| - | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |

## App-Code Impact

| Migration | Schema change | Code references | Owner guess | Action |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Drift Check

Use this section only if the team provided a safe schema snapshot,
non-production database URL, or Prisma migration status output.

- Drift source:
- Conflict:
- Safe recovery plan:
- Commands to review manually:

## Recommended CI Policy

```yaml
fail-on: BLOCK
ignore-paths:
  - "prisma/migrations/legacy/**"
```

## Decision

- Keep MergeBrake:
- Tune rules:
- Convert to paid support:
- Follow-up date:

