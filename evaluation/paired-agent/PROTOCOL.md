# Paired Coding-Agent Evaluation Protocol

## Purpose

This protocol tests the product claim that `resonant-code` helps a demanding
developer obtain more adoptable changes with fewer corrections than the same
coding agent working from repository instructions alone.

It does not create a composite quality score or infer that a policy is useful
from an event count. It records raw machine facts and blinded reviewer
judgments per task.

The current result state is recorded in `ledger.json`. A technical MVP release
may use an `unverified` effectiveness claim. No release material may claim a
measured improvement until the ledger references completed, protocol-conformant
pairs.

## Unit Of Comparison

One pair is one preregistered task run twice from the same repository commit:

- `control` — a fresh instance of the coding agent receives the task,
  repository instructions, and ordinary repository tools. It does not run or
  receive artifacts from the resonant-code lifecycle.
- `treatment` — a fresh instance of the same agent receives the same task,
  instructions, tools, and limits, and uses resonant-code `prepare` and
  `complete`.

The model identifier and build, host surface, tool permissions, reasoning
settings, time limit, and starting Git state must match. Each run uses a new
context and worktree. Knowledge, patches, messages, and tool output from one run
must not enter the other.

## Preregistration

Before either run, write a task record from `task.template.json` containing:

- immutable repository commit and submodule state;
- exact task prompt;
- allowed change paths and explicit scope exclusions;
- acceptance checks and their exact commands;
- agent configuration and run limit;
- condition order;
- reviewer rubric and reviewer identity or blinded reviewer pool.

Task selection must not depend on knowing how either condition solves the task.
Use real maintenance, bugfix, feature, refactor, or migration work for which the
reviewer can state their taste and acceptance boundary in advance.

Condition order is assigned before execution and recorded. Across a multi-task
pilot, alternate or randomly assign order and retain the assignment seed. Do
not rerun only the condition that performed poorly.

## Run Procedure

1. Create two clean worktrees at the preregistered commit.
2. Apply the same task-specific fixtures, dependencies, and environment.
3. Start a fresh agent context for the assigned first condition.
4. Preserve its initial patch, command facts, elapsed time, and agent messages.
5. Repeat from a fresh worktree and context for the second condition.
6. Run every preregistered acceptance check outside the agent context.
7. Record treatment lifecycle overhead separately from total task time.

If a run exceeds its registered time limit, fails infrastructure setup, or
deviates from the assigned condition, retain it and mark the registered
exclusion reason. Never silently replace it.

## Blind Review

Before review:

- remove condition names, harness paths, session IDs, timestamps, and other
  condition-revealing metadata from the presentation;
- label outputs `left` and `right` using a recorded random mapping;
- present the full changed-file set, diff, checks, and user-visible behavior;
- preserve semantic differences; do not rewrite or clean either patch.

The reviewer records:

- forced preference: `left`, `right`, `tie`, or `reject-both`;
- adoption decision for each output: `accept`, `needs-correction`, or `reject`;
- concrete correction requests with file/evidence references;
- unnecessary abstractions with evidence references;
- compatibility or behavior defects with evidence references;
- whether the implementation matches the reviewer’s declared taste.

Reveal the condition mapping only after the initial review is committed.

## Correction Rounds

When an output needs correction, return the reviewer’s exact correction request
to a fresh continuation of that condition and record every round. Stop when the
reviewer accepts the result, rejects it, or the preregistered round/time limit
is reached.

Correction count is the number of reviewer-to-agent correction messages after
the initial output. Do not count infrastructure retries as correction rounds;
record them separately.

## Machine Facts

Record without subjective weighting:

- initial and final changed files;
- changed files outside preregistered allowed paths;
- acceptance-check command, exit code, and output digest;
- initial-output time, final accepted/rejected time, and treatment harness
  overhead;
- number of correction rounds;
- final patch fingerprint.

Reviewer findings remain semantic judgments and require explanations and
evidence references.

## Reporting

Report every registered pair, exclusions included. Present:

- per-task blinded preference and adoption decisions;
- paired difference in correction rounds;
- paired difference in out-of-scope file counts;
- paired duration and treatment overhead;
- check failures and reviewer-cited defects;
- reviewer-cited unnecessary abstractions.

Do not collapse these into a weighted score. A narrative conclusion must cite
the individual pairs it relies on and retain contrary results.

## Validity Boundaries

The protocol measures one registered agent configuration, repository, policy
state, task set, and reviewer population. It does not establish universal agent
or language performance.

The evaluator must disclose:

- tasks or policies authored with knowledge of expected solutions;
- agent version drift between conditions;
- condition leakage;
- reviewer unblinding;
- missing artifacts or checks;
- any post-registration change.

Such pairs remain in the ledger with an explicit validity note.
