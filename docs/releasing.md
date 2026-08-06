# Releasing

Releases are built from an exact commit on `main` and published by
`.github/workflows/publish.yml` when a GitHub Release is published. npm
authentication uses GitHub Actions OIDC. The repository stores no npm publish
token.

## Release invariants

- Core and CLI use the same version.
- `packages/cli/src/version.ts` uses that version as `PRODUCT_VERSION`.
- The release tag is `v<version>` and points to a commit reachable from `main`.
- GitHub's prerelease flag agrees with the SemVer prerelease suffix.
- The workflow packs and verifies both archives before publishing either one.
- Core is published and visible before the matching CLI is published.
- The repository must be public at publication time. Trusted publishing works
  for private repositories, but npm cannot attach provenance to a public
  package built from a private source repository.

The channel follows the first prerelease identifier: `alpha`, `beta`, and `rc`
use matching npm dist-tags, other prereleases use `next`, and stable releases
use `latest`.

## One-time setup

The publish workflow must be present on the default branch before configuring
the npm trust relationships.

1. Create a GitHub environment named `npm`. Add deployment protection or a
   required reviewer if the repository's release policy needs another explicit
   gate.
2. Configure each npm package to trust only this repository, workflow, and
   environment:

   ```sh
   npm trust github @sovea/resonant-code-core \
     --repo Sovea/resonant-code \
     --file publish.yml \
     --env npm \
     --allow-publish

   npm trust github @sovea/resonant-code \
     --repo Sovea/resonant-code \
     --file publish.yml \
     --env npm \
     --allow-publish
   ```

   npm requires an interactive 2FA confirmation for these account changes.
   The commands create trust relationships, not reusable credentials.
3. Confirm both relationships:

   ```sh
   npm trust list @sovea/resonant-code-core
   npm trust list @sovea/resonant-code
   ```

This setup may be completed while the GitHub repository is private. The
workflow's release contract deliberately stops before packing or publishing
until the repository is public.

See npm's [trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
and GitHub's [OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)
for the external trust model.

## Prepare a release

Use a release branch for the version and release notes. The first version used
to exercise this OIDC path must be an unpublished version; the planned first
candidate is `0.0.1-alpha.1`.

1. Update these three source versions together:

   - `packages/core/package.json`
   - `packages/cli/package.json`
   - `PRODUCT_VERSION` in `packages/cli/src/version.ts`

2. Update `CHANGELOG.md` for the exact version.
3. Run the complete local gate:

   ```sh
   corepack pnpm verify
   corepack pnpm audit --audit-level high
   ```

4. Merge the release commit into `main`.
5. Create and push an annotated `v<version>` tag at that exact `main` commit.
6. Before publishing the GitHub Release, make the repository public and
   confirm the workflow and tag are visible.
7. Create the GitHub Release from the existing tag. Mark it as a prerelease if
   and only if the version has a SemVer prerelease suffix.
8. Publish the GitHub Release. This is the human action that starts npm
   publication.

The workflow checks repository visibility, release metadata, source versions,
and `main` ancestry before it installs dependencies. It then runs the complete
gate, packs the exact Core and CLI archives, installs those archives together,
and validates the CLI's exact Core dependency.

## Publication and recovery

The workflow publishes Core, waits for its version and provenance to become
visible in the public registry, and then publishes CLI. A final installation
from npm verifies both package versions, the CLI binary, the Core API, and npm
signatures.

If Core succeeds and CLI fails, rerun the failed workflow. Recovery skips an
existing package only when its registry integrity and provenance match the
newly prepared archive. These states stop for investigation instead of being
silently repaired:

- CLI exists while the matching Core does not;
- either existing archive has a different integrity;
- an existing version has no provenance;
- the source, tag, GitHub Release, or `main` ancestry disagrees.

Do not change or reuse the version after a partial publication. npm versions
are immutable.

## After the first trusted publication

Verify both package pages expose provenance and run a clean channel install.
For an alpha release:

```sh
npm view @sovea/resonant-code-core@alpha dist.attestations --json
npm view @sovea/resonant-code@alpha dist.attestations --json
npm install --global @sovea/resonant-code@alpha
resonant-code --version
```

After the OIDC path has succeeded, set each package's npm publishing access to
require 2FA and disallow tokens. Trusted publishers continue to work, while
long-lived and local publish tokens can no longer publish a release.
