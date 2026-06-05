# Skills

Skills are reusable knowledge packs that agents can auto-load when a task matches the skill's trigger. They live in `harness/skills/<skill-name>/SKILL.md`.

## When to author a skill

Author a skill when the same body of domain knowledge is needed across many tasks. Typical examples:

- A computational or accounting pattern with strict invariants.
- A regulatory regime with specific limits and formulas.
- A migration playbook for a particular framework or library version.

If the knowledge applies once, write it inline in the spec instead.

## Authoring contract

Each skill is a single Markdown file named `SKILL.md` inside its own folder. The folder name is the skill identifier.

```
harness/skills/<skill-name>/
  SKILL.md
  (optional supporting files referenced from SKILL.md)
```

### Required frontmatter

```yaml
---
name: skill-name                    # must match the folder name
description: One-sentence trigger.  # Used by agents to decide when to load
---
```

The `description` should be written as a load trigger ("Load this skill when implementing..."). Agents scan descriptions to decide whether to read the body.

### Body

The body is free-form Markdown. Keep it focused: a skill should be readable in under five minutes. If it is longer, split it.

A useful skill body covers:

- Core invariants (one sentence each).
- Canonical patterns with concrete code or pseudocode.
- Common mistakes and how to spot them.
- Edge cases that change the answer.

## Generated outputs

When you run `harness sync`, each skill is projected into:

- `.claude/skills/<skill-name>/SKILL.md` — copied verbatim.
- `.cursor/rules/skill-<skill-name>.mdc` — converted to an opt-in Cursor rule.

GitHub Copilot does not have a native skills concept; project-level guidance in `harness/AGENTS.md` is the recommended substitute there.

## Starter template

See [`harness/templates/skill.template.md`](../templates/skill.template.md).
