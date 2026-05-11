# MergeBrake

Pre-merge guard for database migrations. MergeBrake scans migration files,
flags destructive or downtime-prone schema changes, detects AI-generated PR
signals, and reports cross-references in application code before the change
reaches production.

```bash
npx mergebrake scan "prisma/migrations/**/migration.sql" \
  --commits ./.git/COMMIT_EDITMSG
```

Output formats:

- `terminal` for local development
- `markdown` for PR comments
- `github` for GitHub Actions annotations
- `json` for custom tooling

See the project README for examples, rules, and CI setup:
https://github.com/mergebrake/mergebrake
