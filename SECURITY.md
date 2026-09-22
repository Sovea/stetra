# Security

Stetra runs locally with the filesystem permissions of its Host. It does not sandbox the Host, run repository code, or call a model service. Engineering investigation and execution use the Host's existing tools and permissions.

`init` writes generated Skills, native integration settings, and a runtime snapshot into the selected project. It does not grant Host trust or change global configuration. `--dry-run` shows planned changes; conflicts are checked before writes. `--force` applies only to identified Stetra-managed content. Keep the portable ownership record intact when refreshing an installation.

The copied CLI and pi extension execute local code with Host permissions. Supply them from a trusted Stetra build in each checkout. Host trust and execution policies remain in force after setup.

The CLI is intended for a trusted local user or coding Host. Its `--project` option selects a directory, not a remote access-control boundary. There is no browser server or remote API. Pass request JSON through files or stdin rather than interpolating developer text into shell commands.

Knowledge is attributed project data. Source labels, references, search matches, and active status do not authenticate its claims or grant authority to change code. The Agent must reconcile applicability and current developer direction. Refresh reports and cache revisions do not prove that a model discarded earlier guidance.

Markdown files are the knowledge authority. The derived index can contain indexed knowledge text; the bounded session cache contains selected IDs, paths, and supplied revisions. Keep derived files untracked. Runtime updates use revision checks, guarded paths, and cooperative filesystem locking; external editors and Git do not participate in that lock.

Use private version control or leave knowledge untracked when it should not be shared. Deleting or withdrawing an item stops its body from future active retrieval, but does not erase previous Host context, Git history, backups, or filesystem snapshots. Existing legacy task databases are not read or automatically deleted by the new runtime.

Report security-sensitive issues privately through the repository's GitHub security advisory feature when available. Do not include credentials or private project data in public issues.
