# dev-harness

A tool-agnostic developer harness for spec-driven development with AI coding agents. Write your agent roles, slash commands, hooks, and skills once; `harness sync` projects them into Claude Code, Cursor, and GitHub Copilot.

## Why

AI coding agents are most useful when they share a consistent operating model across tools and team members. This harness gives you:

- A **five-stage spec-driven pipeline** (`spec-reader` → `architect-review` → `implementer` → `test-writer` → `code-reviewer`) coordinated by an explicit agent queue.
- **One source of truth** for every agent role, command, hook, and skill — written once, projected into all supported tools.
- A **small Node CLI** (`harness sync`) that regenerates tool-specific configs on demand.

## Prerequisites

- Node.js 20 or newer
- At least one of: Claude Code, Cursor, or a repository that uses GitHub Copilot

## Getting started in a new project

**Option A — copy into your project (recommended)**

```bash
# Copy the harness/ directory into your project root
cp -r /path/to/dev-harness/harness ./harness

# Install the CLI globally so you can run `harness` from anywhere
npm install -g ./harness

# Generate tool configs for Claude Code, Cursor, and Copilot
harness sync
```

**Option B — run directly without installing globally**

```bash
node harness/bin/harness.mjs sync
```

After `sync`, do not edit the generated files (`.claude/`, `.cursor/`, `.github/`, `AGENTS.md`) directly — they are overwritten each time. Edit the canonical files under `harness/` instead.

## The pipeline

Every non-trivial change flows through five agent stages, each gated by the next:

```
spec-reader → architect-review → implementer → test-writer → code-reviewer
```

State is persisted in `harness/queue/agent-queue.json`. Hooks automatically advance the queue between stages and surface the next action after each agent turn.

### Starting a feature

1. Write a spec in `harness/specs/<name>.md` (copy from `harness/templates/spec.template.md`).
2. In your AI coding tool, run:
   ```
   /implement <name>
   ```
3. The pipeline runs end-to-end, invoking each agent in turn. Check progress at any time:
   ```
   /pipeline-status
   ```
   or via the CLI:
   ```bash
   harness status
   ```

## Configuring the harness

`harness/harness.config.json` controls everything. Key fields:

| Field | Purpose |
|---|---|
| `targets` | Which configs to generate: `claude`, `cursor`, `copilot`, `agents-md` |
| `pipeline.stages` | Ordered stages; drives the hooks' queue transitions, status hints, and Copilot handoffs |
| `hooks.guard.extraPatterns` | Project-specific shell-command patterns to block |
| `hooks.lint.commands` | Map of glob → shell command run after each file write |
| `claude.model` | Pin a Claude model in `.claude/settings.json`, or `null` to inherit |
| `claude.permissionMode` | Permission mode written as `permissions.defaultMode` (`default`, `acceptEdits`, `plan`, `bypassPermissions`) |
| `cursor.protectedBranches` | Branches (globs allowed) the guard hook refuses to push to or force-reset |

After editing `harness.config.json`, run `harness sync` to apply.

## Adding content

| Want to | Edit |
|---|---|
| Change a project rule that applies everywhere | `harness/AGENTS.md` |
| Add or refine an agent role | `harness/agents/<name>.md` |
| Add a slash command | `harness/commands/<name>.md` |
| Add a reusable knowledge pack (skill) | `harness/skills/<name>/SKILL.md` |
| Add a feature spec | `harness/specs/<name>.md` (copy from `harness/templates/spec.template.md`) |
| Add a custom hook | `harness/hooks/<name>.mjs` and wire it in `harness.config.json` |

Always run `harness sync` after any edit.

## Generated outputs

| Concept | Claude Code | Cursor | GitHub Copilot |
|---|---|---|---|
| Project guidance | `.claude/CLAUDE.md` | `AGENTS.md` (root) | `.github/copilot-instructions.md` |
| Agent role | `.claude/agents/<name>.md` | `.cursor/agents/<name>.md` | `.github/agents/<name>.agent.md` |
| Skill | `.claude/skills/<name>/SKILL.md` | `.cursor/skills/<name>/SKILL.md` | `.github/skills/<name>/SKILL.md` |
| Slash command | `.claude/commands/<name>.md` | `.cursor/commands/<name>.md` | `.github/prompts/<name>.prompt.md` |
| Hooks | `.claude/settings.json` | `.cursor/hooks.json` | `.github/hooks.json` |

## CLI reference

```
harness init                   Create harness.config.json from defaults
harness sync [--target NAME]   Regenerate one or all tool configs
harness status                 Print the current pipeline queue
harness queue reset            Clear the queue (asks before writing)
harness help                   Show help
```

Targets: `claude`, `cursor`, `copilot`, `agents-md`

Run the harness's own tests with `cd harness && npm test` (uses `node --test`).

## Directory structure

```
harness/                  Source of truth — edit here, never in generated dirs
  agents/                 Agent role definitions
  commands/               Slash command definitions
  hooks/                  Hook scripts (shared across all tools)
  skills/                 Reusable knowledge packs
  specs/                  Feature specifications (inputs to the pipeline)
  plans/                  Plans and review outputs (pipeline outputs)
  queue/                  Pipeline state (agent-queue.json)
  templates/              Starter templates for specs and skills
  tests/                  Test suite for the harness itself (`npm test`)
  bin/harness.mjs         CLI entry point
  harness.config.json     Harness configuration
.claude/                  Generated — Claude Code config
.cursor/                  Generated — Cursor config
.github/                  Generated — GitHub Copilot config
AGENTS.md                 Generated — universal agent guidance (root)
```

## Common issues

- **"no targets configured"** — check `harness/harness.config.json` has a non-empty `targets` array.
- **Generated files keep being overwritten** — that's intentional; edit source under `harness/` and re-run sync.
- **Upgrading from an older version** — `harness sync` auto-prunes legacy generated files identified by the "GENERATED BY harness sync" banner.

## License

MIT
