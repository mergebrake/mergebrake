# MergeBrake Founder Pilot

## Offer

**DB PR Risk Audit + Drift Check - EUR 500, 14 days.**

MergeBrake stays open source. The pilot is a hands-on service for teams that
want to know whether their Prisma/Drizzle/Postgres migration workflow is likely
to break application code before merge.

## Who It Is For

- B2B SaaS with 3-30 developers.
- GitHub pull requests and GitHub Actions.
- Postgres with Prisma or Drizzle.
- Frequent deploys.
- AI coding agents are already used for app or schema work.

Do not sell this to teams that do not have production Postgres, do not use
GitHub, or cannot share a repo-level migration history.

## Deliverables

1. Historical migration audit.
   - Full scan of migration history.
   - Top 10 risky migrations with file links and rule IDs.
   - One-line "why this matters" for each finding.

2. App-code impact review.
   - Destructive schema changes mapped to the code references they can break.
   - Prisma `@map` / `@@map` and Drizzle `pgTable` aliases checked.
   - False-positive notes where the current static analyzer overreaches.

3. CI setup.
   - GitHub Action installed or PR-ready workflow file supplied.
   - `.mergebrake.yml` tuned for the repo.
   - Recommended `fail-on` policy for the first 30 days.

4. Optional drift check.
   - Only if the customer can provide a safe non-production database URL,
     schema dump, or Prisma schema/migration state.
   - Output is a manual recovery plan, not an automated destructive command.

5. Closeout report.
   - Keep / remove / tune decision.
   - Top policy recommendations.
   - Conversion proposal, if the team wants ongoing support.

## Guarantee

Refund the pilot if the audit does not surface at least one useful migration
risk or workflow improvement. "Useful" means the team agrees it would have
changed a PR review, rollout plan, or CI policy.

## Boundaries

- No production database credentials are required for the core audit.
- No automated production changes.
- No runtime proxy, dashboard, SSO, or billing integration during the pilot.
- Drift review is advisory unless the customer explicitly asks for a paid
  implementation phase.

## Suggested Message To A Warm Lead

```text
If you want something more structured, I am doing a EUR 500 founder pilot:
historical migration audit, MergeBrake CI setup, Prisma/Drizzle rule tuning,
and an optional drift check if you can share a safe schema snapshot.

It runs for 14 days. Money back if we do not find at least one useful migration
risk or workflow improvement. The OSS action stays free either way.
```

