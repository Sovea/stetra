# @sovea/stetra

CLI for carrying a coding change from exact developer intent through Agent
delivery and Runtime-collected facts to an informed Human decision.

```sh
npm install --global @sovea/stetra
cd /path/to/project
stetra init .
stetra status .
```

The task path is:

```text
prepare -> implement -> collect -> diagnose or recover when needed
        -> handoff -> decide
```

Generated Codex and Claude Code adapters are deliberately thin. Their Hooks
project the current action, and their Skill teaches the Host to follow the exact
action without recreating Stetra's protocol in prose. Input-bearing actions use
a Stetra-owned, prefilled, one-shot Draft and a task-specific Guide:

```sh
stetra input reserve . --kind prepare --json
# Edit the returned Draft, then execute the exact submit.argv.
```

Later lifecycle responses provide their own exact `hostAction.command.argv` and,
when input is required, `hostAction.inputBinding.reserve.argv`. Main commands
include:

```sh
stetra change collect . --task <task-id> --json
stetra change diagnose . --task <task-id> --input <owned-draft-path> --json
stetra change revise-verification . --task <task-id> --input <owned-draft-path> --json
stetra change handoff . --task <task-id> --input <owned-draft-path> --json
stetra change decide . --task <task-id> --input <owned-draft-path> --json
stetra change resolve . --task <task-id> --input <owned-draft-path> --json
```

Lifecycle responses stay compact. Canonical Contract, baseline, attempts,
checks, Handoff, Decision Packet, and event detail remain available through
`stetra change explain` with an explicit section or selector.

Task state lives under `.stetra/tasks/<taskId>/`. Runtime owns collected Git and
verification facts; the Agent owns interpretation and recommendation; the
developer owns intent, exceptions, and adoption. A passing command is evidence,
not proof of semantic correctness, and `handoff-ready` never means adopted.

The current generated adapters do not claim native Host control, independent
subagent execution, or tool-policy enforcement. When independent evidence is
unavailable, Stetra preserves that gap in the Handoff and directs developer
review instead of simulating an attested Challenger.
