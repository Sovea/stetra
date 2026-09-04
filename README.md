# Stetra

**Let the Agent implement. Keep the engineering thread and the final say.**

Stetra is an engineering harness for coding agents.

Its objective is to reduce the total cost from request to confident adoption
without weakening the developer's system understanding or engineering
judgment.

## Install

```sh
npm install --global @sovea/stetra
```

## Use

Initialize Stetra in the repository where the Agent will work:

```sh
cd /path/to/project
stetra init .
stetra status .
```

Review and trust the generated project hooks when Codex or Claude Code prompts
you to do so.

Then give the coding task to your Agent as usual. Project admission policy,
generated Host hooks, and one compact Skill apply Stetra only to admitted coding
changes. The visible path is `Align -> Work -> Decide`: the Agent implements
normally, Stetra collects exact Git and Check facts, the Agent explains the
actual change, and you accept, correct, reject, or defer it.
