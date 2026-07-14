# Playbook Resolution

Runtime, not the skill or host agent, resolves Playbook guidance.

## Inputs

Pass these sources to `compileChange`:

- the plugin `playbook/` directory
- optional `.resonant-code/playbook/local-augment.yaml`
- optional `.resonant-code/rccl.yaml`
- a concrete task with change type and target paths when known
- optional bounded directive/observation relation proposals

Do not manually merge YAML or recreate Runtime ranking in a skill.

## Compile

```js
const decision = await runtime.compileChange({
  projectRoot,
  builtinRoot,
  localAugmentPath,
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

## Apply the decision

Use sections in this order:

1. `guidance.required` — implementation constraints.
2. `guidance.tensions` — repository boundaries with an explicit resolution.
3. `guidance.avoid` — prohibited patterns.
4. `guidance.consider` — relevant non-binding advice and repository observations.

Only delivered guidance IDs are eligible for postflight evaluation. Trace omissions explain budget behavior but are not hidden requirements.

## Complete

After implementation call `evaluateChange` with the actual changed files, check results, evidence for delivered IDs, and any approved exceptions. Do not infer satisfaction from the preflight decision.

If Runtime is unavailable, report that the harness could not run and proceed using explicit user/repository instructions. Do not parse the Playbook manually as a substitute.
