# Cognitive Adoption Paired-Agent Evaluation Protocol

## Purpose

This protocol tests whether the Cognitive Adoption MVP lowers the total cost from
a developer request to a confidently adoptable change without degrading the
developer's system understanding or decision quality.

It is this repository's effectiveness-test contract. It is not Runtime, a
distributable benchmark harness, a registry of candidate tasks, or an archive
of evaluation runs.

This directory contains only the protocol and reusable record templates. Active
preregistrations, run ledgers, observations, results, source workspaces, sealed
material, and raw evidence remain in an evaluator-owned workspace outside the
source tree. Their digests and ordering must be frozen there before either
condition starts.

Deterministic tests establish protocol consistency, not product effectiveness.
No measured-effectiveness claim is allowed until an immutable evidence manifest
references at least three preregistered, protocol-conformant pairs across at
least two task types and a Human product owner accepts a scoped conclusion from
the raw data.

## Pair

One pair runs the same task twice from the same immutable repository state:

- `control`: a fresh instance of the coding agent receives the task,
  repository instructions, ordinary repository tools, and the registered
  strong Handoff prompt. It receives no Stetra Runtime facts.
- `treatment`: a fresh instance of the same agent receives the same inputs and
  uses the generated Host adapter and `begin`, `collect`, optional repair or
  timeout retry, `handoff`, and Human `decide` lifecycle under schema `2` of
  the `cognitive-adoption` protocol.

Model/build, Host surface, tool policy, reasoning settings, time limit,
dependencies, and starting Git state must match. Context, patches, messages,
and tool output from one condition must not leak into the other.

Tool restrictions are enforced outside both conditions and attested by the
Evaluator. Treatment-side Stetra instructions cannot be the sole mechanism for
disabling Web search, network access, or external mutation; otherwise Host
capability differs between conditions.

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

Candidate pools, active preregistrations, run ledgers, source checkouts,
dependency trees, observations, results, raw transcripts, and sealed oracles do
not belong in this protocol directory. After a Human product owner accepts a
scoped conclusion, a compact immutable evidence bundle may be published outside
`paired-agent/` when it is needed as inspectable claim evidence. Raw working
data remains outside the source tree.

Published evidence bundles contain the preregistration digest and expected
baseline/oracle exit behavior of each sealed acceptance fixture, but not the
fixture content.
The evaluator materializes source checkouts, dependencies, fixtures, patches,
logs, and Agent transcripts outside this repository. A fixture is injected
only into an archived copy after both Agent outputs are frozen. Its path in the
task record is the injection path inside that copy, not a tracked source path.

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
- exact strong Handoff prompt used by the control;
- expected behavior and review-relevant invariants;
- compatibility, ownership, and failure-entry questions where applicable;
- any clarification delivery rules and exact registered responses;
- allowed paths only for measuring unexpected scope, not as Agent permissions;
- acceptance checks and exact argv;
- an evaluator-only Coverage Matrix connecting every important requirement to
  sealed assertions or explicit manual review;
- at least one preregistered plausible wrong implementation for every
  adoption-critical semantic dimension, or a concrete reason that no automated
  negative control can represent it;
- matched Agent configuration and limits;
- assigned condition order and seed;
- reviewer identity/pool and rubric.

The task record has a canonical registration fingerprint. Changing any field
after registration changes that fingerprint and invalidates the pair. The
external run ledger lists every registered task even before a corresponding
result exists.

Do not select tasks after seeing either solution. Alternate or randomly assign
condition order. Never rerun only the weaker condition.

The Coverage Matrix and negative-control materialization remain evaluator-only.
They may reveal boundary cases, historical solution shape, or sealed fixture
design, so neither Agent sees them before both outputs are archived. Registration
must reject a requirement with neither sealed assertion nor manual review, a
sealed assertion whose fixture does not fail at baseline and pass at the oracle,
or an adoption-critical requirement whose declared negative control is not
actually rejected.

## Preflight

Before either Agent starts, freeze a `preflight.template.json` record containing:

- exact repository commit, submodule and workspace identity;
- exact Stetra commit plus Core, CLI, and generated Host Adapter archive digests;
- exact requested model availability and exact Host surface/version;
- symmetric tool-policy enforcement attestation for both conditions;
- identical sandbox argv/policy, writable-cache policy, network-stack capability,
  and a record that no other suite runs concurrently;
- dependency, runtime, executable resolved-path, script/shebang, and worktree identity;
- actual stdout, stderr, and nonzero exit propagation from a nested subprocess
  under each condition's enforced sandbox, using the same fixed sentinel probe;
- sealed fixture fingerprint plus actual baseline, oracle, and negative-control
  exit behavior;
- equality checks for all condition-neutral configuration.

Expected exit codes in a task record are declarations. Only the actual preflight
observations establish that a fixture and negative control are usable. A failed
preflight blocks both conditions; it never selectively delays or replaces one.
An exit code without the expected nested stdout/stderr does not pass the IO
probe. Archive such a Host or sandbox failure separately; do not reinterpret
missing output as a quiet successful check or change product behavior to hide it.

## Execution

Before effectiveness pairs, the treatment workflow must pass a black-box
usability gate using only packed `@sovea/stetra-core`, packed `@sovea/stetra`,
and the generated Host Adapter. The treatment Agent may not inspect the Stetra
source repository or tests. A routine task should require zero input-shape
corrections; a consequential or Attention-bearing task may require at most one.
Failure is a product-usability finding, not Agent noncompliance.

Every run preregisters one wall-clock deadline and communicates the exact
absolute deadline to both Agents before work starts. The outer evaluator
enforces it symmetrically and records a timeout as a delivery outcome; an
undisclosed external kill cannot be attributed to either workflow's ability to
manage its remaining lifecycle. Stetra does not persist this evaluator limit or
infer a stage schedule from it.

1. Materialize a clean workspace at the registered state for each condition;
   the workspaces may run sequentially when resources are constrained.
2. Apply identical fixtures, dependencies, and environment.
3. Run each condition in a fresh context in registered order.
4. Preserve initial/final patches, commands, elapsed time, and Agent messages.
5. Run registered acceptance checks outside the Agent context.
6. For treatment, preserve the Task Contract, Attempt lineage, every
   collection, patch, check attempts, handoff evaluation, Human Decision, and
   any stale/recollection transition.
7. Record harness overhead separately from task and review time. Attribute time
   by provenance: Host-observed implementation and authoring, Runtime-
   observed check/Git collection, Human-observed active review/clarification,
   and wall-clock queue or wait time.
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
- present treatment review-focus information in a neutral review-attention form;
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
- provenance-separated phase durations rather than one inferred “thinking” time;
- changed/out-of-scope files and acceptance checks;
- raw cognition findings for behavior, invariants, ownership, and failure entry;
- review-focus usefulness finding;
- defects, unnecessary abstraction, contrary evidence, and protocol
  deviations.

A narrative conclusion must cite individual pairs, state its repository/Agent/
task/reviewer scope, preserve contrary results, and avoid a composite score.
Inconclusive or adverse results return the MVP to iteration.

An interrupted or protocol-incomplete pilot may retain a compact observation in
the external run archive when it exposes reproducible product behavior. Such a
record must name the missing protocol evidence, remain excluded from
completed-pair gates, and cannot support an effectiveness claim. It may contain
patch fingerprints and bounded findings, but never raw workspaces, transcripts,
logs, patches, or sealed fixture contents.

## Human acceptance boundary

After the minimum pilot, the Human product owner reviews raw results and records
whether the scoped evidence supports that the MVP is useful without degrading
system understanding or decision quality. This is an explicit human product
decision, not a Runtime status. Until then, effectiveness remains `unverified`.
