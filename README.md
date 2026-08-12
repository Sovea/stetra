# Stetra

**Let the Agent implement. Keep the engineering thread and the final say.**

Stetra is an engineering harness for coding agents. It preserves the chain from
an exact developer request, through Agent delivery and Runtime-collected facts,
to an informed Human adoption decision.

Its objective is to reduce the total cost from request to confident adoption
without weakening the developer's system understanding or engineering
judgment.

## Current MVP

```text
exact developer event
       |
       v
Semantic Contract + falsifiable Evidence Obligations
       |
       v
Agent implementation
       |
       v
Runtime baseline/current facts
       |
       +--> Agent diagnosis of every non-passing check
       |       +--> bounded implementation repair
       |       +--> verification revision / challenge / Human resolution
       |
       +--> fact-triggered fresh-context challenge when required
       |
       v
layered Cognitive Handoff
       |
       v
exact Human Decision
```

The executable initial-version lifecycle is:

```text
prepare -> implement -> collect -> diagnose when needed
        -> resolve, repair, revision, or challenge -> handoff -> decide
```

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

`prepare` keeps the quoted developer event physically separate from Host task
interpretation. It generates canonical identities, compiles explicit
Conditions, Evidence Obligations, and checks, runs only selected task-start
baseline checks, records their side effects, and freezes the resulting worktree
as the implementation baseline. Routine work may have no conditions.

`collect` records the complete baseline-to-current change, check attempts,
bounded logs with complete-stream digests, check-induced changes, declared
verifier-surface mutations, non-secret environment identity, and mechanical
baseline/current check relationships. A larger-budget timeout retry preserves
every prior attempt in the same Attempt.

`diagnose` requires the Agent to classify every current non-passing check as an
implementation, environment, verification, or unknown cause with a
falsification attempt. Runtime never guesses cause from errors or repository
shape. Only an explicit implementation cause inside the current meaning and
repair budget creates a successor Attempt.

`revise-verification` preserves the Semantic Contract while creating an
immutable Verification Plan, exact Definition lineage, honest baseline status,
and successor Attempt. Mechanical relaxation requires exact Human authority.

`challenge` is requested by an explicit Evidence Obligation or when a
fact-triggered Obligation depends on a declared Verifier acceptance surface
changed by the patch. Agent input cannot self-assert Host independence.

`handoff` rejects stale facts first, then binds one conclusion per Evidence
Obligation and Condition, important system effects, residual unknowns, review
questions, and Agent recommendation to current evidence. It returns decision,
condition, and raw fact layers plus consolidated Attention. `handoff-ready`
never means adopted.

`decide` records `accepted`, `correction-requested`, `rejected`, or `deferred`
with the developer's exact message. Acceptance with Attention requires an
explicit exception for every item. It does not commit, merge, publish, deploy,
or activate a rule for later tasks.

`resolve` records exact mid-task Human authority and closes semantic-impact,
Host-policy, and correction continuation paths.

## Authority boundary

- Developers own outcomes, constraints, non-goals, long-lived tradeoffs,
  exceptions, and adoption.
- Coding Agents own investigation, interpretation, reversible engineering
  choices, implementation, evidence diagnosis, repair, challenge conclusions,
  handoff, and recommendation.
- Runtime owns only what the workflow observes plus deterministic identity,
  ordering, references, budgets, routing, and currency validation.

A Human exception cannot erase a fact. A fact cannot decide product meaning.
Agent prose cannot become Human authority or Runtime fact through a label.

## Persistence and packages

Task data lives under `.stetra/tasks/<taskId>/`. `events.jsonl` is the
append-only source and `task.json` is a rebuildable projection. Contracts,
baseline verification, Attempts, facts, evidence dispositions, Verification
Revisions, Challenges, handoffs, resolutions, and decisions remain separate
immutable artifacts. The initial schema has no migration path.

- `@sovea/stetra-core` — deterministic compilation and handoff evaluation. Its
  root exposes exactly `compileDelegation` and `evaluateHandoff`.
- `@sovea/stetra` — CLI lifecycle, Git/check collection, diagnosis routing,
  packet assembly, initialization, presentation, and generated Host workflows.

```text
Generated Host adapter -> CLI -> Core
```

Neither package calls an LLM.

See [Product direction](docs/product-direction.md),
[Architecture](docs/architecture.md), and
[Change workflow](docs/change-workflow.md).

## Current evidence

Technical tests establish internal consistency and distributability, not
product effectiveness. The first three-pair historical replay exposed useful
design failures but lacks protocol-complete Human blind review and timing data;
it is recorded as inconclusive. Effectiveness remains `unverified` until
results satisfy [`evaluation/paired-agent/PROTOCOL.md`](evaluation/paired-agent/PROTOCOL.md)
and support an explicit scoped product-owner conclusion.

## Development

Use Node.js 22 and pnpm 10.33.0:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing public behavior.
Generated `dist/` files are not committed. Maintainer releases follow
[the trusted publishing process](docs/releasing.md).
