# Playbook Resolution

Runtime, not the skill or host agent, resolves Playbook guidance.

## Inputs

Pass these sources to `compileChange`:

- the plugin `playbook/` directory
- optional `.resonant-code/playbook/local-augment.yaml`
- optional user-scoped `~/.resonant-code/playbook/personal-overlay.yaml`
- optional `.resonant-code/rccl.yaml`
- a concrete task with change type and target paths when known
- optional bounded directive/observation relation proposals
- an optional explicit delivery selection when optional guidance exceeds the
  configured byte ceiling

Do not manually merge YAML, rank directives, or silently choose optional
guidance in a skill.

## Compile

```js
const decision = await runtime.compileChange({
  projectRoot,
  builtinRoot,
  localAugmentPath,
  personalOverlayPath,
  rcclPath,
  task: {
    description,
    changeType: 'bugfix',
    targets: ['src/parser.ts'],
    constraints: [],
    avoid: [],
  },
});
```

If strict mode returns `needs-interpretation`, supply only the listed missing fields and compile again.

If Runtime returns `guidance-overflow`, no decision has been compiled and no
session should be created. Mandatory guidance cannot be removed. When optional
guidance caused the overflow, inspect `selectableConsider` together with
`candidateDetails`, choose the IDs that semantically matter to this task, record
a concrete rationale, and compile again:

```js
deliverySelection: {
  considerIds: ['bugfix-add-supporting-validation-01'],
  rationale: 'This task fixes a defect and needs a regression test.',
}
```

The default limit is 6,000 UTF-8 bytes and may be changed explicitly with
`guidanceByteLimit`. There are no per-section item limits.

## Apply the decision

Use sections in this order:

1. `guidance.required` — implementation constraints.
2. `guidance.tensions` — repository boundaries with an explicit resolution.
3. `guidance.avoid` — prohibited patterns.
4. `guidance.consider` — relevant non-binding advice and repository observations.

Only delivered guidance IDs are eligible for postflight evaluation. Trace
omissions identify the host selection and its rationale; they are not hidden
requirements.

## Complete

After implementation call `evaluateChange` with the actual changed files, check results, evidence for delivered IDs, and any approved exceptions. Do not infer satisfaction from the preflight decision.

If Runtime is unavailable, report that the harness could not run and proceed using explicit user/repository instructions. Do not parse the Playbook manually as a substitute.
