// Sync target: GitHub Copilot (.github/).
//
// Writes:
//   .github/copilot-instructions.md         (project guidance + pipeline overview)
//   .github/agents/<name>.agent.md          (custom agents, with handoffs for the pipeline)
//   .github/skills/<name>/SKILL.md          (agent skills)
//   .github/prompts/<name>.prompt.md        (slash commands as prompts)
//   .github/hooks.json                      (PascalCase events, mirrors Claude Code)
//
// Notes:
//   - `.github/chatmodes/<name>.chatmode.md` is deprecated as of Oct 2025;
//     this sync writes the new `.github/agents/<name>.agent.md` format.
//   - VS Code's Copilot reads `.claude/agents/` and `.claude/skills/` for
//     compatibility, but we still emit native `.github/` paths so the harness
//     works even when the Claude target is disabled.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import { bannerFor, parseFrontmatter, readMarkdownDir, renderMarkdownWithBanner, listDirectories, pruneGeneratedFiles, resolveSourceDir } from './frontmatter.mjs';

export function syncCopilot(context) {
  const { harnessRoot, repoRoot, config } = context;
  const targetRoot = join(repoRoot, '.github');
  const messages = [];

  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(join(targetRoot, 'agents'), { recursive: true });
  mkdirSync(join(targetRoot, 'skills'), { recursive: true });
  if (config?.copilot?.emitPrompts !== false) {
    mkdirSync(join(targetRoot, 'prompts'), { recursive: true });
  }

  // Legacy paths from earlier harness versions: agents used to land in
  // .github/chatmodes/*.chatmode.md. That format is deprecated as of
  // VS Code 1.106; remove only files we generated previously.
  const removed = pruneGeneratedFiles(join(targetRoot, 'chatmodes'), { extensions: ['.md'] });
  for (const name of removed) {
    messages.push(`pruned legacy .github/chatmodes/${name}`);
  }

  writeInstructions({ harnessRoot, targetRoot, messages });
  writeAgents({ harnessRoot, targetRoot, config, messages });
  writeSkills({ harnessRoot, targetRoot, config, messages });
  if (config?.copilot?.emitPrompts !== false) {
    writePrompts({ harnessRoot, targetRoot, config, messages });
  }
  writeHooks({ harnessRoot, repoRoot, targetRoot, config, messages });

  return { messages };
}

function writeInstructions({ harnessRoot, targetRoot, messages }) {
  const agentsMdPath = join(harnessRoot, 'AGENTS.md');
  if (!existsSync(agentsMdPath)) {
    throw new Error(`Missing ${agentsMdPath}`);
  }
  const guidance = readFileSync(agentsMdPath, 'utf8');
  const banner = `${bannerFor('markdown', 'AGENTS.md')}\n`;
  const pipelineOverview = `\n## Pipeline overview for Copilot\n\nThis repository uses a spec-driven pipeline coordinated by an agent queue stored in \`harness/queue/agent-queue.json\`. Each pipeline stage is a custom agent in \`.github/agents/\` with a \`handoffs\` button that takes you to the next stage. The queue is auto-advanced by hooks in \`.github/hooks.json\`.\n`;
  const out = join(targetRoot, 'copilot-instructions.md');
  writeFileSync(out, `${banner}${guidance}${pipelineOverview}`);
  messages.push('wrote .github/copilot-instructions.md');
}

function writeAgents({ harnessRoot, targetRoot, config, messages }) {
  const sourceDir = resolveSourceDir(harnessRoot, config?.paths?.agents, 'agents');
  const stages = Array.isArray(config?.pipeline?.stages) ? config.pipeline.stages : [];
  const stageOrder = stages.map((stage) => stage?.id).filter(Boolean);

  for (const file of readMarkdownDir(sourceDir)) {
    const data = buildCopilotAgentFrontmatter(file.data, stageOrder);
    const baseName = file.name.replace(/\.md$/, '');
    const out = join(targetRoot, 'agents', `${baseName}.agent.md`);
    writeFileSync(
      out,
      renderMarkdownWithBanner({ data, body: file.body, source: `agents/${file.name}` }),
    );
    messages.push(`wrote .github/agents/${baseName}.agent.md`);
  }
}

function buildCopilotAgentFrontmatter(source, stageOrder) {
  const data = {
    name: source?.name,
    description: source?.description,
  };
  if (Array.isArray(source?.tools) && source.tools.length > 0) {
    data.tools = source.tools;
  }
  if (source?.model) {
    data.model = source.model;
  }

  const handoffs = buildHandoffs(source?.name, stageOrder);
  if (handoffs.length > 0) {
    data.handoffs = handoffs;
  }

  return data;
}

function buildHandoffs(currentName, stageOrder) {
  if (!currentName || stageOrder.length === 0) return [];
  const index = stageOrder.indexOf(currentName);
  if (index === -1 || index === stageOrder.length - 1) return [];
  const next = stageOrder[index + 1];
  return [
    {
      label: `Continue: ${next}`,
      agent: next,
      prompt: `Continue the pipeline. Read harness/queue/agent-queue.json for context and run the ${next} stage.`,
      send: false,
    },
  ];
}

function writeSkills({ harnessRoot, targetRoot, config, messages }) {
  const sourceRoot = resolveSourceDir(harnessRoot, config?.paths?.skills, 'skills');
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
    messages.push(`wrote .github/skills/${dir}/SKILL.md`);
  }
}

function writePrompts({ harnessRoot, targetRoot, config, messages }) {
  const sourceDir = resolveSourceDir(harnessRoot, config?.paths?.commands, 'commands');
  for (const file of readMarkdownDir(sourceDir)) {
    const baseName = file.name.replace(/\.md$/, '');
    const data = {
      mode: 'agent',
      description: file.data?.description ?? `Command: ${baseName}`,
    };
    const out = join(targetRoot, 'prompts', `${baseName}.prompt.md`);
    writeFileSync(
      out,
      renderMarkdownWithBanner({ data, body: file.body, source: `commands/${file.name}` }),
    );
    messages.push(`wrote .github/prompts/${baseName}.prompt.md`);
  }
}

function writeHooks({ harnessRoot, repoRoot, targetRoot, config, messages }) {
  const hooksDir = resolveSourceDir(harnessRoot, config?.paths?.hooks, 'hooks');
  const hookPath = (script) => relative(repoRoot, join(hooksDir, script)).split('\\').join('/');

  // VS Code Copilot uses PascalCase event names that mirror Claude Code's,
  // but `.github/hooks.json` expects a flat array per event (no matcher
  // wrapper). The same hook scripts run unchanged since our hooks accept
  // both snake_case and camelCase tool_input field names.
  const hooks = {
    hooks: {
      PreToolUse: [
        { type: 'command', command: `node ${hookPath('guard-destructive.mjs')}` },
      ],
      PostToolUse: [
        { type: 'command', command: `node ${hookPath('lint-and-format.mjs')}` },
      ],
      SubagentStop: [
        { type: 'command', command: `node ${hookPath('advance-queue.mjs')}` },
      ],
      Stop: [
        { type: 'command', command: `node ${hookPath('check-queue.mjs')}` },
      ],
    },
  };

  const banner = bannerFor('json', 'harness.config.json');
  const out = join(targetRoot, 'hooks.json');
  writeFileSync(out, `${banner}\n${JSON.stringify(hooks, null, 2)}\n`);
  messages.push('wrote .github/hooks.json');
}
