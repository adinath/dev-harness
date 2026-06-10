// Sync target: Cursor (.cursor/).
//
// Writes:
//   .cursor/agents/<name>.md        (native Cursor subagents, since 2.4)
//   .cursor/skills/<name>/SKILL.md  (native Cursor skills)
//   .cursor/commands/<name>.md      (slash commands)
//   .cursor/hooks.json              (proper subagentStop / stop events)

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { bannerFor, parseFrontmatter, readMarkdownDir, renderMarkdownWithBanner, listDirectories, pruneGeneratedFiles, resolveSourceDir } from './frontmatter.mjs';

// Harness tools that imply the agent writes to the filesystem or runs shells.
// If none of these are present in the agent's tools list, the subagent is
// `readonly: true` so Cursor can short-circuit permission prompts.
const WRITE_LIKE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'Bash']);

export function syncCursor(context) {
  const { harnessRoot, repoRoot, config } = context;
  const targetRoot = join(repoRoot, '.cursor');
  const messages = [];

  mkdirSync(join(targetRoot, 'agents'), { recursive: true });
  mkdirSync(join(targetRoot, 'commands'), { recursive: true });
  mkdirSync(join(targetRoot, 'skills'), { recursive: true });

  // Legacy paths from earlier harness versions: agents used to land in
  // .cursor/rules/*.mdc. Remove only files we generated previously.
  const removed = pruneGeneratedFiles(join(targetRoot, 'rules'), { extensions: ['.mdc'] });
  for (const name of removed) {
    messages.push(`pruned legacy .cursor/rules/${name}`);
  }

  writeAgents({ harnessRoot, targetRoot, config, messages });
  writeCommands({ harnessRoot, targetRoot, config, messages });
  writeSkills({ harnessRoot, targetRoot, config, messages });
  writeHooks({ harnessRoot, repoRoot, targetRoot, config, messages });

  return { messages };
}

function writeAgents({ harnessRoot, targetRoot, config, messages }) {
  const sourceDir = resolveSourceDir(harnessRoot, config?.paths?.agents, 'agents');
  for (const file of readMarkdownDir(sourceDir)) {
    const data = buildCursorAgentFrontmatter(file.data);
    const out = join(targetRoot, 'agents', file.name);
    writeFileSync(
      out,
      renderMarkdownWithBanner({ data, body: file.body, source: `agents/${file.name}` }),
    );
    messages.push(`wrote .cursor/agents/${file.name}`);
  }
}

function buildCursorAgentFrontmatter(source) {
  const tools = Array.isArray(source?.tools) ? source.tools : [];
  const readonly = tools.length > 0 && !tools.some((tool) => WRITE_LIKE_TOOLS.has(tool));

  const data = {
    name: source?.name,
    description: source?.description,
    model: source?.model ?? 'inherit',
    readonly,
    is_background: false,
  };
  return data;
}

function writeCommands({ harnessRoot, targetRoot, config, messages }) {
  const sourceDir = resolveSourceDir(harnessRoot, config?.paths?.commands, 'commands');
  for (const file of readMarkdownDir(sourceDir)) {
    const out = join(targetRoot, 'commands', file.name);
    writeFileSync(
      out,
      renderMarkdownWithBanner({ data: file.data, body: file.body, source: `commands/${file.name}` }),
    );
    messages.push(`wrote .cursor/commands/${file.name}`);
  }
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
    messages.push(`wrote .cursor/skills/${dir}/SKILL.md`);
  }
}

function writeHooks({ harnessRoot, repoRoot, targetRoot, config, messages }) {
  const hooksDir = resolveSourceDir(harnessRoot, config?.paths?.hooks, 'hooks');
  const hookPath = (script) => relative(repoRoot, join(hooksDir, script)).split('\\').join('/');

  const hooks = {
    version: 1,
    hooks: {
      beforeShellExecution: [
        { command: `node ${hookPath('guard-destructive.mjs')}`, timeout: 10 },
      ],
      afterFileEdit: [
        { command: `node ${hookPath('lint-and-format.mjs')}`, timeout: 30 },
      ],
      subagentStop: [
        { command: `node ${hookPath('advance-queue.mjs')}`, timeout: 15 },
      ],
      stop: [
        { command: `node ${hookPath('check-queue.mjs')}`, timeout: 15 },
      ],
    },
  };

  const banner = bannerFor('json', 'harness.config.json');
  const out = join(targetRoot, 'hooks.json');
  writeFileSync(out, `${banner}\n${JSON.stringify(hooks, null, 2)}\n`);
  messages.push('wrote .cursor/hooks.json');

  if (Array.isArray(config?.cursor?.protectedBranches) && config.cursor.protectedBranches.length > 0) {
    messages.push(`note: protected branches honored by guard-destructive: ${config.cursor.protectedBranches.join(', ')}`);
  }
}
