# Outreach Templates

Use these only after you have a concrete finding or context from the person's
repo, post, or thread. Do not send generic pitches.

## Public Reply

```text
I ran your public Prisma/Drizzle migrations through MergeBrake, a small OSS
pre-merge schema-impact guard I am building.

It flagged this migration as risky: [file/link]
Reason: [specific rule + one sentence]

Full report: [gist]
Would love to know whether this would have been useful in the PR review or just
noise.
```

## Discord / DM

```text
Hey [name], I saw your note about [Prisma drift / migration issue / AI-generated
migration].

I am building MergeBrake: a GitHub Action that checks Postgres + Prisma/Drizzle
migration PRs before merge and maps dangerous schema changes to the app code
they can break.

I ran a quick scan on [repo/public example]. The top finding was:
- [finding]

Report: [link]

If useful, I can help install it in CI and tune the initial config for your repo.
```

## Warm Lead To Pilot

```text
If you want something more structured, I am doing a EUR 500 founder pilot:
historical migration audit, MergeBrake CI setup, Prisma/Drizzle rule tuning,
and an optional drift check if you can share a safe schema snapshot.

It runs for 14 days. Money back if we do not find at least one useful migration
risk or workflow improvement. The OSS action stays free either way.
```

## Follow-Up After No Reply

```text
Quick follow-up, then I will leave it here.

The practical question I am trying to answer is: would a PR comment that links a
dangerous migration to the exact app code it breaks be useful to your team, or
would it be noise?

Either answer helps.
```

## Do Not Send

Avoid messages that:

- lead with pricing;
- claim MergeBrake is unique without a repo-specific finding;
- mention "AI safety" generically without tying it to a migration or DB risk;
- ask for a call before the person has shown interest.

