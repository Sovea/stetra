# @sovea/resonant-code

CLI for running a fact-bound change handoff around a production coding task.

```sh
npm install --global @sovea/resonant-code
cd /path/to/project
resonant-code init .
resonant-code doctor . --strict
```

`init` generates a thin Codex and/or Claude Code workflow. The normal agent path
uses three JSON commands:

```sh
resonant-code change prepare . --input - --json
resonant-code change collect . --run <run-id> --json
resonant-code change finalize . --run <run-id> --json
```

- `prepare` compiles the task contract and proportional Assurance Plan,
  captures the dirty/untracked worktree baseline, and freezes explicit checks.
- `collect` executes those checks without a shell and records the complete
  actual change, patch, ordered check attempts, output integrity, and
  verifier-surface mutations. Runtime supplies the normal timeout budget; an
  actually timed-out check can retry in the same run with
  `--retry-check <id>=<larger-milliseconds>`.
- `finalize` rejects stale facts and binds the agent's claims, unknowns,
  falsification, and Review Map to the current collection.

The Assurance Plan is explicit and inspectable. Routine work can omit claims
and Review Map entries when no semantic or factual escalation applies.
Standard and critical work must cover declared material or adoption-critical
dimensions, while failed checks, verifier mutations, unrepresentable changes,
unknowns, and Host-disclosed critical claims can only add obligations.

Exact canonical detail is available on demand:

```sh
resonant-code change explain . --run <run-id> --section contract --json
resonant-code change explain . --run <run-id> --section facts --json
resonant-code change explain . --run <run-id> --section handoff --json
resonant-code change explain . --run <run-id> --section evaluation --json
resonant-code change explain . --run <run-id> --section presentation --json
```

The CLI owns project initialization, task-run IO, exact repository-evidence
windows, Git and check collection, bounded logs with complete-stream digests,
fact-staleness detection, retention, and the final presentation. The host agent
cannot submit changed-file or check facts.

`handoff-ready` means ready for developer review, never adopted.
`needs-attention` and `rejected` results identify the adoption impact, exact
references, and the next repair, evidence, validation, recollection, or direct
review action.

The CLI pins the exact matching `@sovea/resonant-code-core` version. Neither
package calls an LLM.
