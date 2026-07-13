---
name: init
description: "Initialize resonant-code by selecting playbook layers from explicit strong repository signals. Use when setting up resonant-code for a project."
metadata:
  version: "0.0.1"
  author: "Sovea"
---

# Initialize Resonant Code

Bootstrap `.resonant-code/playbook/local-augment.yaml` for the current project by selecting built-in playbook layers from explicit strong repository signals.

This skill is not a codebase wiki generator. Its job is only to decide which built-in layers should be loaded into the local playbook and then write the deterministic local-augment file.

The generated file is the project's local playbook. It extends the resonant-code built-in ruleset and is the entry point for all project-specific taste and conventions. Commit it to the repository so the whole team benefits.

## Instructions

### Step 1 - Prepare init layer selection

```sh
node <this-skill-directory>/scripts/init.mjs prepare <project-root> <this-plugin-directory>/playbook
```

The script prints JSON:

```json
{
  "status": "prepared",
  "prompt": "<inline prompt text>",
  "candidateSchema": "{ ...json schema... }",
  "candidateArtifact": {
    "suggestedPath": "<path-to-candidate-json>",
    "format": "json",
    "usage": "..."
  },
  "projectNameDefault": "<name>",
  "defaults": {
    "extends": ["builtin/core", "builtin/task-types/*"]
  },
  "availableLayers": {
    "repoSpecific": ["..."]
  },
  "signals": [
    { "path": "tsconfig.json", "reason": "TypeScript configuration file" }
  ],
  "augment": {
    "path": ".resonant-code/playbook/local-augment.yaml",
    "exists": false
  },
  "debugArtifacts": {
    "enabled": false
  }
}
```

Use the inline `prompt` text and returned schema to produce a single JSON candidate file at `candidateArtifact.suggestedPath`.
If you need a saved prompt artifact for debugging, run prepare with `--debug-artifacts` or set `RESONANT_CODE_DEBUG_ARTIFACTS=1`.

The commit step accepts either a file path or stdin via `--input -`.

```sh
node <this-skill-directory>/scripts/init.mjs commit <project-root> <this-plugin-directory>/playbook --input <path-to-candidate-json|-> [--force] [--debug-artifacts]
```

When using `--input -`, pass the JSON candidate on stdin.

Critical constraints for the host-produced candidate:
- this is not a codebase wiki task
- do not summarize the repository or describe architecture broadly
- only choose repo-specific layers when there is explicit strong signal evidence
- do not infer from vague dependency presence alone
- prefer leaving a layer out over weak inference
- include a `signals` entry with evidence for every selected repo-specific layer

### Step 2 - Commit the selected layers

```sh
node <this-skill-directory>/scripts/init.mjs commit <project-root> <this-plugin-directory>/playbook --input <path-to-candidate-json> [--force]
```

The commit phase is deterministic. It validates the candidate JSON, keeps the default baseline layers, filters repo-specific selections against installed built-in layers, writes `.resonant-code/playbook/local-augment.yaml`, and updates `.gitignore` for generated runtime context artifacts.

**Exit 0 - Created successfully**

Parse stdout JSON and print the included `message` plus the raw details when useful.

Important output fields:
- `extends.final` — final ordered extends entries written to local-augment
- `extends.included` — selected repo-specific layers that exist in this installation
- `extends.unavailable` — evidence-backed canonical layers not installed yet
- `signals` — evidence and rationale for each selected repo-specific layer
- `gitignore.ignored` — generated runtime context artifacts now ignored

**Exit 1 - File already exists**

Tell the user `.resonant-code/playbook/local-augment.yaml` already exists and ask whether to overwrite.
If the user confirms, re-run commit with `--force`:

```sh
node <this-skill-directory>/scripts/init.mjs commit <project-root> <this-plugin-directory>/playbook --input <path-to-candidate-json> --force
```

Then print the success summary.

**Any other error**

Report the error from stderr to the user verbatim.
Do not attempt to create the file manually.
