# Specs

A spec is the human-authored description of a feature that the pipeline implements. The `spec-reader` agent reads a spec from this directory, asks clarifying questions if needed, and turns it into an implementation plan.

## Authoring contract

- One file per feature, named `<feature-slug>.md` (lowercase, hyphenated, no spaces).
- Specs are intent documents, not designs. Describe what the feature does and why; leave file layout, API shapes, and data model decisions to the planning stage.
- Keep them short. A typical spec is one to two pages. If the feature is larger, split it into multiple specs.

## Recommended structure

```markdown
# <Feature Name>

## Problem

What user problem does this feature solve? Who is affected?

## Goals

- What "done" looks like, as a short list of measurable outcomes.

## Non-goals

- Explicit things this feature does NOT include, to bound the scope.

## User journeys

Walk through the key flows in plain prose.

## Constraints

Anything the implementation must respect (regulatory, performance, integration boundaries).

## Open questions

Anything the author is unsure about. The spec-reader will surface these.
```

A starter is provided at [`harness/templates/spec.template.md`](../templates/spec.template.md).

## Lifecycle

1. Author drops a spec file here.
2. `/implement <feature-slug>` initialises the agent queue and invokes `spec-reader`.
3. `spec-reader` writes `harness/plans/<feature-slug>-plan.md`.
4. Subsequent stages append review reports to the same `harness/plans/` directory.
5. The spec file itself is not edited by agents.
