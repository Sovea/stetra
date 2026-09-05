# @sovea/stetra

Portable Runtime for Stetra's embedded coding-change harness.

```sh
npm install --global @sovea/stetra
cd /path/to/project
stetra init .
stetra status .
```

Developers keep using Codex or Claude Code through ordinary conversation. The
generated Skill and lifecycle Hooks apply the project admission policy and
guide admitted changes through a small visible path:

```text
Align -> Work -> Decide
```

The primary Agent commands are:

```sh
stetra task begin . --input - --json
stetra task collect . --task <task-id> --json
stetra task handoff . --task <task-id> --input - --json
stetra task inspect . --task <task-id> --section summary --json
```

Use `stetra task begin --input-schema --json` (also `handoff` and `decide`) to
read the installed input schema and a validated example without creating state.
Submit input through stdin or a file outside the project worktree.

Deep inspection can select one Fact Collection, Check Attempt, or bounded log
tail without expanding those details on the successful path.
`task inspect --section handoff` restores the complete current Decision Brief,
including Human corrections, verification boundaries, and review entry points.

The developer's later message may be recorded with `stetra task decide`.
Corrections start a new delivery attempt inside the same task. Routine failures
return ordinary Check facts for normal repair and recollection; they do not
create a separate diagnosis protocol.
After a non-timeout external failure, an available `--refresh-reason <text>`
permits one explicit recheck for unchanged inputs and preserves the old failure.
Completed Host sessions can admit another task with the same binding token.

Task state lives under `.stetra/tasks/<taskId>/`. Runtime owns exact identities,
the Git baseline and current changes, frozen Check attempts, logs, and ordering.
The Agent owns interpretation, implementation, explanation, and recommendation.
The developer owns the exact request and adoption decision. Passing checks are
evidence, never adoption.
