# Releasing MergeBrake

This is the sequence one human runs to ship a new version. Everything that can
be automated is in `scripts/release-prepare.mjs` and
`.github/workflows/release.yml`; the steps below are the things that have to be
done by a human with the right credentials.

The published artifacts are:

- `mergebrake-shared` on npm
- `mergebrake-core` on npm
- `mergebrake` on npm (CLI; this is the public entrypoint)
- a GitHub release for the same tag
- a moved major mobile tag (e.g. `v0` always points at the latest `v0.x.y`) so
  `mergebrake/mergebrake@v0` in a workflow file keeps working

## One-time setup

1. **npm account + token.** Create (or reuse) an npm account that owns the
   `mergebrake`, `mergebrake-core`, and `mergebrake-shared` packages. Generate
   an **Automation** token (`npm token create --type=automation`). Save it in
   the GitHub repository under `Settings → Secrets and variables → Actions →
   New repository secret` as `NPM_TOKEN`.
2. **Trusted Publisher (optional but recommended).** If you want full SLSA
   provenance, follow npm's [trusted publisher setup](https://docs.npmjs.com/trusted-publishers)
   so npm validates that the publish came from this repo's workflow. The
   workflow already requests `id-token: write` and runs
   `npm publish --provenance`.
3. **Verify nothing else needs auth.** `softprops/action-gh-release@v2` uses
   the built-in `GITHUB_TOKEN`; you do not need a PAT.

## Each release

```bash
# 1. From a clean main, decide the next version.
node scripts/release-prepare.mjs 0.0.3 --dry-run     # rehearsal
node scripts/release-prepare.mjs 0.0.3               # bumps + builds + tests
                                                     # + commits + tags v0.0.3

# 2. Push.
git push
git push origin v0.0.3
```

The release workflow picks the tag up and:

1. Re-validates that every `packages/*/package.json` version matches the tag
   and contains no `"*"` workspace deps.
2. Re-runs `npm run build` and `npm test`.
3. Runs `npm pack --dry-run` for each public package.
4. Publishes in order: `mergebrake-shared` → `mergebrake-core` →
   `mergebrake`. (Inter-package deps require this order — npm registry caches
   propagate quickly enough that the next publish resolves the previous one.)
5. Force-moves the major mobile tag (`v0` → `v0.0.3`) so
   `uses: mergebrake/mergebrake@v0` keeps following the latest stable patch.
6. Creates a GitHub release with auto-generated release notes.

## After the release

- **Marketplace listing.** Edit the GitHub release once and tick *Publish this
  release to the GitHub Marketplace*. After the first time, future releases
  inherit the listing automatically.
- **Update `CHANGELOG.md`.** The release workflow writes auto-generated notes
  to the GitHub release. Mirror the meaningful bullets into `CHANGELOG.md` and
  commit — the human-curated changelog is what end users read.

## Versioning policy

We follow semver for the npm packages:

- **Patch (`0.0.x`).** Internal rule tweaks, bug fixes, doc edits, false-
  positive reductions. Never changes a finding's `ruleId` or output schema.
- **Minor (`0.x.0`).** New rules, new CLI flags, new Action inputs.
- **Major (`x.0.0`).** Breaking changes to a rule's id, the JSON report shape,
  the CLI flag surface, or the GitHub Action input names. We expect to stay
  on `0.x` until we have at least a dozen production users in MergeBrake.

The GitHub Action mobile tag follows the major: `v0` is always the latest
`0.x.y`. When we cut `1.0.0`, the workflow auto-creates `v1`.

## Pre-release (release candidates)

```bash
node scripts/release-prepare.mjs 0.1.0-rc.1
git push && git push origin v0.1.0-rc.1
```

Tags with a dash in them are marked as pre-release on GitHub. They do **not**
move the major mobile tag — `v0` continues to point at the previous stable
release.

## Recovering from a failed release

If the workflow fails *after* publishing one of the packages, the npm registry
has the version already. Do not try to republish the same version. Instead:

1. `npm deprecate <package>@<version> "broken release, use <next>"` for each
   of `mergebrake`, `mergebrake-core`, `mergebrake-shared` that already
   published.
2. Bump to the next patch, run `release-prepare.mjs` again, push.

If the workflow fails *before* any publish (typical for the
"versions don't match the tag" guard), just fix locally, force the tag, and
re-push:

```bash
git tag -d v0.0.3                # local
git push origin :v0.0.3          # delete remote
# fix, re-run release-prepare, re-tag, push
```

## Manual fallback

If GitHub Actions is down or you need to publish from a laptop:

```bash
node scripts/release-prepare.mjs 0.0.3 --dry-run
node scripts/release-prepare.mjs 0.0.3

npm publish --access public packages/shared
npm publish --access public packages/core
npm publish --access public packages/cli

git push
git push origin v0.0.3

gh release create v0.0.3 --generate-notes
git tag -f v0 v0.0.3 && git push origin v0 --force
```

This is the unhappy path. The CI workflow is the supported one.
