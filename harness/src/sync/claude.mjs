// Sync target: Claude Code (.claude/).
//
// Writes:
//   .claude/CLAUDE.md                Project memory that imports root AGENTS.md
//   .claude/settings.json            Hook wiring (Pre/PostToolUse, Stop, SubagentStop)
//   .claude/agents/<name>.md         Subagents with optional model/color
//   .claude/commands/<name>.md       Slash commands with argument-hint
//   .claude/skills/<name>/SKILL.md   Skills (preserved as-is from harness/skills)
//
// Why CLAUDE.md is generated:
//   Claude Code reads CLAUDE.md, NOT root AGENTS.md. Per the official docs,
//   the recommended pattern is a CLAUDE.md that @-imports AGENTS.md so the
//   same guidance is shared with other tools.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

import { bannerFor, parseFrontmatter, readMarkdownDir, renderMarkdownWithBanner, listDirectories } from './frontmatter.mjs';

// Cycles through the colors Claude Code recognises for agent display.
// Helps users visually track which pipeline stage is running.
const STAGE_COLORS = ['blue', 'cyan', 'purple', 'green', 'orange'];

export function syncClaude(context) {
  const { harnessRoot, repoRoot, config } = context;
  const targetRoot = join(repoRoot, '.claude');
  const messages = [];

  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(join(targetRoot, 'agents'), { recursive: true });
  mkdirSync(join(targetRoot, 'commands'), { recursive: true });
  mkdirSync(join(targetRoot, 'skills'), { recursive: true });

  writeClaudeMemory({ targetRoot, messages });
  writeSettings({ harnessRoot, repoRoot, targetRoot, config, messages });
  copyAgents({ harnessRoot, targetRoot, config, messages });
  copyCommands({ harnessRoot, targetRoot, messages });
  copySkills({ harnessRoot, targetRoot, messages });

  return { messages };
}

function writeClaudeMemory({ targetRoot, messages }) {
  // Claude Code reads CLAUDE.md from .claude/CLAUDE.md or ./CLAUDE.md.
  // We write to .claude/CLAUDE.md so it sits next to the rest of the
  // generated config and does not collide with a user-authored root file.
  const banner = bannerFor('markdown', 'AGENTS.md');
  const body = [
    banner,
    '',
    '# Claude Code Memory',
    '',
    'This file is loaded automatically at the start of every Claude Code session.',
    'It imports the project-wide guidance from `AGENTS.md` so Claude Code follows',
    'the same conventions as Cursor, GitHub Copilot, and any other tool that',
    'reads `AGENTS.md`.',
    '',
    '@../AGENTS.md',
    '',
    '## Claude Code specifics',
    '',
    'The spec-driven pipeline lives under `harness/`. Use `/implement <spec>`',
    'to start a new feature, and `/pipeline-status` to check progress.',
    '',
    'Hook scripts under `harness/hooks/*.mjs` auto-advance the queue between',
    'pipeline stages. Do not edit generated files in `.claude/` directly;',
    'edit the source under `harness/` and run `harness sync`.',
    '',
  ].join('\n');
  writeFileSync(join(targetRoot, 'CLAUDE.md'), body);
  messages.push('wrote .claude/CLAUDE.md');
}

function writeSettings({ harnessRoot, repoRoot, targetRoot, config, messages }) {
  const hooksDir = relative(repoRoot, join(harnessRoot, 'hooks')).split('\\').join('/');
  const cmd = (script) => `node "$CLAUDE_PROJECT_DIR/${hooksDir}/${script}"`;

  const settings = {
    permissionMode: config?.claude?.permissionMode ?? 'auto',
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: cmd('guard-destructive.mjs'), timeout: 10 }],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit',
          hooks: [{ type: 'command', command: cmd('lint-and-format.mjs'), timeout: 30 }],
        },
      ],
      Stop: [
        {
          hooks: [{ type: 'command', command: cmd('check-queue.mjs'), timeout: 15 }],
        },
      ],
      SubagentStop: [
        {
          hooks: [{ type: 'command', command: cmd('advance-queue.mjs'), timeout: 15 }],
        },
      ],
    },
  };
  // Only pin a model when the user has explicitly configured one. Omitting
  // the `model` key lets Claude Code use whatever the user has selected.
  if (config?.claude?.model) {
    settings.model = config.claude.model;
  }

  const settingsPath = join(targetRoot, 'settings.json');
  const banner = bannerFor('json', 'harness.config.json');
  const body = JSON.stringify(settings, null, 2);
  writeFileSync(settingsPath, `${banner}\n${body}\n`);
  messages.push(`wrote ${relative(repoRoot, settingsPath)}`);
}

function copyAgents({ harnessRoot, targetRoot, config, messages }) {
  const sourceDir = resolveSourceDir(harnessRoot, config?.paths?.agents, 'agents');
  const defaultModel = config?.claude?.model;
  const stages = Array.isArray(config?.pipeline?.stages) ? config.pipeline.stages : [];
  const stageOrder = stages.map((stage) => stage?.id).filter(Boolean);

  for (const file of readMarkdownDir(sourceDir)) {
    const data = { ...file.data };
    // Only set `model` if explicitly configured. Claude Code defaults to
    // `inherit` (use the main conversation's model), which is more
    // future-proof than pinning a specific model ID.
    if (defaultModel && !data.model) data.model = defaultModel;
    // Cosmetic: cycle through colors so each pipeline stage is easy to
    // distinguish in the Claude Code transcript.
    if (!data.color) {
      const stageIndex = stageOrder.indexOf(file.data?.name);
      if (stageIndex >= 0) data.color = STAGE_COLORS[stageIndex % STAGE_COLORS.length];
    }
    const out = join(targetRoot, 'agents', file.name);
    writeFileSync(out, renderMarkdownWithBanner({ data, body: file.body, source: `agents/${file.name}` }));
    messages.push(`wrote .claude/agents/${file.name}`);
  }
}

function copyCommands({ harnessRoot, targetRoot, messages }) {
  const sourceDir = join(harnessRoot, 'commands');
  for (const file of readMarkdownDir(sourceDir)) {
    const data = { ...file.data };
    // Auto-derive `argument-hint` when the command body references $ARGUMENTS
    // and the author hasn't set one explicitly. Hint text shows in Claude
    // Code's autocomplete next to the slash command.
    if (!data['argument-hint'] && /\$ARGUMENTS/.test(file.body)) {
      data['argument-hint'] = '<argument>';
    }
    const out = join(targetRoot, 'commands', file.name);
    writeFileSync(out, renderMarkdownWithBanner({ data, body: file.body, source: `commands/${file.name}` }));
    messages.push(`wrote .claude/commands/${file.name}`);
  }
}

function copySkills({ harnessRoot, targetRoot, messages }) {
  const sourceRoot = join(harnessRoot, 'skills');
  if (!existsSync(sourceRoot)) return;

  for (const dir of listDirectories(sourceRoot)) {
    const skillPath = join(sourceRoot, dir, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    const source = readFileSync(skillPath, 'utf8');
    const { data, body } = parseFrontmatter(source);
    const destDir = join(targetRoot, 'skills', dir);
    mkdirSync(destDir, { recursive: true });
    writeFileSync(
      join(destDir, 'SKILL.md'),
      renderMarkdownWithBanner({ data, body, source: `skills/${dir}/SKILL.md` }),
    );
    messages.push(`wrote .claude/skills/${dir}/SKILL.md`);
  }
}

function resolveSourceDir(harnessRoot, configured, fallback) {
  if (!configured) return join(harnessRoot, fallback);
  if (configured.startsWith('harness/')) {
    return resolve(harnessRoot, '..', configured);
  }
  return resolve(harnessRoot, configured);
}
