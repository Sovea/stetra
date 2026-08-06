# Releasing

Releases are built from an exact commit on `main` and published by
`.github/workflows/publish.yml` when a GitHub Release is published. npm
authentication uses GitHub Actions OIDC. The repository stores no npm publish
token. Source commits carry a stable release-line version such as `0.0.1`;
prerelease versions such as `0.0.1-alpha.1` come from the GitHub Release tag
and are applied only inside the publishing runner.

## Release invariants

- Core, CLI, and `PRODUCT_VERSION` use the same committed stable SemVer baseline
  without a prerelease suffix or build metadata.
- A stable release tag exactly matches that baseline, for example `v0.0.1`.
- A prerelease tag adds a suffix to the same baseline, for example
  `v0.0.1-alpha.1`. The workflow applies that exact version transiently to the
  two package manifests and `PRODUCT_VERSION`; it does not create a version
  commit.
- Release tags do not use SemVer build metadata and point to commits reachable
  from `main`.
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

The first version used to exercise this OIDC path must be unpublished; the
planned first candidate is `0.0.1-alpha.1`.

1. Confirm that `main` carries the stable baseline for the intended release
   line. For `0.0.1-alpha.1`, all three source locations remain `0.0.1`:

   - `packages/core/package.json`
   - `packages/cli/package.json`
   - `PRODUCT_VERSION` in `packages/cli/src/version.ts`

   Change these together only when starting a different stable release line,
   such as moving from `0.0.1` to `0.0.2`.
2. Ensure `CHANGELOG.md` and the GitHub Release notes describe the code being
   released. A new prerelease sequence number alone does not require a source
   version commit.
3. Run the complete local gate against the stable source baseline:

   ```sh
   corepack pnpm verify
   corepack pnpm audit --audit-level high
   ```

4. Merge any release-content changes into `main`.
5. Create and push an annotated `v<version>` tag at the intended `main` commit.
   A prerelease tag must retain the committed baseline as its core version;
   `v0.0.1-alpha.1` is valid on a `0.0.1` baseline, while
   `v0.0.2-alpha.1` is not.
6. Before publishing the GitHub Release, make the repository public and
   confirm the workflow and tag are visible.
7. Create the GitHub Release from the existing tag. Mark it as a prerelease if
   and only if the version has a SemVer prerelease suffix.
8. Publish the GitHub Release. This is the human action that starts npm
   publication.

The workflow checks repository visibility, release metadata, the stable source
baseline, and `main` ancestry before it installs dependencies. It runs the
complete gate against that committed baseline. For a prerelease, it then
changes exactly the two package manifests and `PRODUCT_VERSION` in the runner
and rejects any broader tracked diff. Stable releases skip this preparation.
The workflow packs the resulting Core and CLI archives, installs those exact
archives together, and validates the CLI's exact Core dependency.

After publishing a stable release, update the three source locations together
only when development begins on the next release line. This keeps stable
version changes reviewable while allowing repeated alpha, beta, and rc releases
without version-only commits.

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
