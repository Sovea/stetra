# Semantic Handoff Paired-Agent Evaluation Protocol

## Purpose

This protocol tests whether the Semantic Handoff MVP lowers the total cost from
a developer request to a confidently adoptable change without degrading the
developer's system understanding or decision quality.

It is this repository's effectiveness-test contract. It is not Runtime, a
distributable benchmark harness, or a registry of candidate tasks.

Deterministic tests establish protocol consistency, not product effectiveness.
No measured-effectiveness claim is allowed until `ledger.json` references at
least three preregistered, protocol-conformant pairs across at least two task
types and a Human product owner accepts a scoped conclusion from the raw data.

## Pair

One pair runs the same task twice from the same immutable repository state:

- `control`: a fresh instance of the coding agent receives the task,
  repository instructions, and ordinary repository tools.
- `treatment`: a fresh instance of the same agent receives the same inputs and
  uses `change prepare`, `change collect`, and `change finalize` under the
  `semantic-delegation` protocol.

Model/build, Host surface, tool policy, reasoning settings, time limit,
dependencies, and starting Git state must match. Context, patches, messages,
and tool output from one condition must not leak into the other.

If a task has a preregistered clarification, both conditions receive the exact
same response only after satisfying the same delivery rule. A clarification
must not be volunteered to rescue one condition after observing its solution.

The pilot requires:

- at least three completed pairs;
- at least two of bugfix, feature, refactor, migration, maintenance, docs, or test;
- one compatibility- or ownership-sensitive task;
- one treatment run containing repair followed by recollection.

## Historical replay boundary

A historical task may use an already merged change as a sealed behavioral
reference. Historical replay is one task-selection method, not a required
evaluation lifecycle or a product feature.

Before either condition:

- pin the exact pre-change commit, not a moving branch;
- keep the known implementation, discussion, and oracle-only checks outside
  both Agent contexts;
- expose only the registered prompt, repository state, and clarifications
  delivered by their preregistered rules;
- record public-solution memory risk and any possible leakage.

Reveal the historical oracle only after both condition outputs are archived.
Judge externally visible behavior, invariants, compatibility, checks, and
adoptability. Patch similarity may be reported descriptively but cannot be an
acceptance criterion. Historical results should be paired with prospective
work before supporting a broad production-effectiveness conclusion.

Candidate pools, source checkouts, dependency trees, raw transcripts, and
sealed oracles are not part of this protocol. A selected preregistration and a
compact completed result may be committed when the ledger uses them as
inspectable claim evidence; raw working data remains outside the source tree.

## Third-party source boundary

When a task replays work from an uninvolved third-party project, that repository
is a read-only source. Do not create a fork, remote branch, pull request, issue,
comment, review, reaction, release, or any other upstream state. Local commits
are allowed only inside disposable evaluation workspaces. Record an attempted
or actual external mutation as a protocol deviation.

The evaluator chooses local isolation and resource controls appropriate to the
Host and records any limit or deviation that could affect comparability. Those
controls are run configuration, not persistent product architecture.

## Preregistration

Before either condition, create a task record from `task.template.json` with:

- immutable commit and submodule state;
- exact task prompt and task type;
- expected behavior and review-relevant invariants;
- compatibility, ownership, and failure-entry questions where applicable;
- any clarification delivery rules and exact registered responses;
- allowed paths only for measuring unexpected scope, not as Agent permissions;
- acceptance checks and exact argv;
- matched Agent configuration and limits;
- assigned condition order and seed;
- reviewer identity/pool and rubric.

Do not select tasks after seeing either solution. Alternate or randomly assign
condition order. Never rerun only the weaker condition.

## Execution

1. Materialize a clean workspace at the registered state for each condition;
   the workspaces may run sequentially when resources are constrained.
2. Apply identical fixtures, dependencies, and environment.
3. Run each condition in a fresh context in registered order.
4. Preserve initial/final patches, commands, elapsed time, and Agent messages.
5. Run registered acceptance checks outside the Agent context.
6. For treatment, preserve prepare/collect/finalize JSON, patch, checks,
   handoff, and any stale/recollection transition.
7. Record harness overhead separately from task and review time.
8. For historical replay, reveal the sealed reference only after both
   condition outputs are archived.

Retain timeouts, infrastructure failures, and protocol deviations with an
explicit validity note. Do not silently replace them.

## Condition-neutral review

Before review, render both conditions as `left` and `right`:

- remove condition names, harness paths, IDs, timestamps, and identifying metadata;
- include the full changed-file set, complete patch, check facts, and a compact
  system explanation for each output;
- preserve semantic differences and unknowns without polishing one condition;
- present treatment Review Map information in a neutral review-attention form;
- commit the randomized mapping before review.

The reviewer records raw judgments for each side:

- adoption: `accept`, `needs-correction`, or `reject`;
- time to a confident adoption decision;
- concrete correction requests and evidence references;
- compatibility/behavior defects and unnecessary abstraction;
- whether changed behavior was understood correctly;
- whether important invariants were understood correctly;
- whether state/architecture ownership was understood correctly;
- whether failure and recovery entry points were understood correctly;
- whether the supplied review-attention map directed attention to risks the
  reviewer independently considered material.

Understanding fields use `correct`, `partial`, `incorrect`, or
`not-applicable`, always with a concrete explanation. Do not create a weighted
or composite score.

Reveal the condition mapping only after the initial review is committed.

## Corrections

When correction is required, send the exact reviewer request to a continuation
of that condition and record each round. Stop at acceptance, rejection, or the
registered limit. Infrastructure retries are recorded separately and never
counted as correction rounds.

## Reporting

Report every registered pair, including excluded or adverse results. For each
pair publish:

- blinded preference and per-side adoption decision;
- adoption-decision time;
- correction rounds and total task time;
- treatment harness overhead;
- changed/out-of-scope files and acceptance checks;
- raw cognition findings for behavior, invariants, ownership, and failure entry;
- Review Map usefulness finding;
- defects, unnecessary abstraction, contrary evidence, and protocol
  deviations.

A narrative conclusion must cite individual pairs, state its repository/Agent/
task/reviewer scope, preserve contrary results, and avoid a composite score.
Inconclusive or adverse results return the MVP to iteration.

## Human acceptance boundary

After the minimum pilot, the Human product owner reviews raw results and records
whether the scoped evidence supports that the MVP is useful without degrading
system understanding or decision quality. This is an explicit human product
decision, not a Runtime status. Until then, effectiveness remains `unverified`.
