# @sovea/stetra

CLI for carrying a coding change from exact developer intent through Agent
delivery and Runtime-collected facts to an informed Human decision.

```sh
npm install --global @sovea/stetra
cd /path/to/project
stetra init .
stetra doctor . --strict
```

The initial-version task path is:

```text
prepare -> implement -> collect -> diagnose when needed
        -> resolve, repair, revision, or challenge -> handoff -> decide
```

All authoring documents travel on stdin or from outside the worktree:

```sh
stetra change prepare . --input - --json
stetra change collect . --task <task-id> --json
stetra change diagnose . --task <task-id> --input - --json
stetra change revise-verification . --task <task-id> --input - --json
stetra change challenge . --task <task-id> --input - --json
stetra change handoff . --task <task-id> --input - --json
stetra change decide . --task <task-id> --input - --json
stetra change resolve . --task <task-id> --input - --json
```

- `prepare` compiles a compact authority-separated contract, generates stable
  identities, runs selected task-start checks, records their side effects, and
  freezes the post-check Git baseline.
- `collect` records the actual change, current checks, mechanical baseline
  relations, check-induced changes, verifier mutations, bounded logs, patch
  identity, and non-secret environment facts.
- `diagnose` covers every non-passing check with Agent cause judgment and a
  falsification attempt. Only explicit implementation cause creates a bounded
  successor Attempt; other causes route to challenge, handoff, or Human choice.
- `revise-verification` preserves task meaning while creating immutable exact
  Definition lineage and an honestly unknown original baseline when necessary.
- `challenge` records fresh-context falsification when explicitly required or
  when a fact-triggered Obligation relies on a changed declared acceptance
  surface.
- `handoff` produces decision, condition, and fact layers with consolidated
  Attention. Post-collection edits return `facts-stale` first.
- `decide` preserves the developer's exact message. Acceptance with Attention
  requires exact exceptions. It performs no external adoption side effects.
- `resolve` records exact mid-task Human authority and continues correction or
  evidence decisions without overwriting prior artifacts.

Task state lives under `.stetra/tasks/<taskId>/`. `events.jsonl` is the
append-only source; `task.json` is a rebuildable projection. The initial schema
has no task-state migration path.

Exact detail is available on demand:

```sh
stetra change explain . --task <task-id> --section contract --json
stetra change explain . --task <task-id> --section baseline --json
stetra change explain . --task <task-id> --section attempts --json
stetra change explain . --task <task-id> --section challenge --json
stetra change explain . --task <task-id> --section revision --json
stetra change explain . --task <task-id> --section handoff --json
stetra change explain . --task <task-id> --section decision --json
stetra change explain . --task <task-id> --section events --json
```

The Host cannot submit changed-file or check facts. Runtime facts cannot decide
product meaning. Agent recommendation cannot become Human adoption through a
label. Neither package calls an LLM.

## Programmatic Host integration

A Host that actually controls Agent contexts, tool policy, and the
before-final-response boundary can embed the same CLI and read-only guard:

```ts
import {
  guardFinalResponse,
  runCli,
  type HostAttestationProvider,
} from '@sovea/stetra/host';

const attestations: HostAttestationProvider = {
  provenance: 'native-adapter',
  async evaluatePolicies({ requirements }) {
    return requirements.map((requirement) => ({
      requirementId: requirement.id,
      mode: 'unsupported',
      provenance: 'native-adapter',
    }));
  },
};

await runCli(['change', 'collect', '.', '--task', taskId, '--json'], {
  hostAttestations: attestations,
  interactive: false,
});

const guard = await guardFinalResponse({
  projectRoot: '.',
  taskId,
  hostAttestations: attestations,
});
```

The provider must report only controls the embedding Host actually enforces.
Importing this subpath does not itself create a hook or make a thin Markdown
adapter trustworthy. The Host must invoke the guard at its real final-response
boundary and follow the returned exact disposition and `hostAction`.
