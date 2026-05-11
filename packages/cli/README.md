# MergeBrake

MergeBrake catches database-breaking pull requests before merge. It maps schema
changes to the application code they will break, detects AI-generated PR
signals, and gives reviewers a safe rollout plan instead of a generic warning.

```bash
npx mergebrake scan "prisma/migrations/**/migration.sql" \
  --commits ./.git/COMMIT_EDITMSG
```

For deploy-order checks, compare the PR checkout with a base-branch checkout:

```bash
npx mergebrake scan "prisma/migrations/**/migration.sql" \
  --base-repo ../my-app-base
```

Output formats:

- `terminal` for local development
- `markdown` for PR comments
- `github` for GitHub Actions annotations
- `json` for custom tooling

See the project README for examples, rules, and CI setup:
https://github.com/mergebrake/mergebrake
