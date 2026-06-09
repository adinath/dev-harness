#!/usr/bin/env bun
// PostToolUse hook — runs project-configured lint/format commands against
// the file just written. Config lives at harness.config.json#hooks.lint.commands
// and maps glob patterns (relative globs OK) to a shell command. The hook
// substitutes `{file}` for the file path; if absent, the file is appended.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(here, '..', 'harness.config.json');

const LINT_TIMEOUT_MS = 30_000;

function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function loadCommands() {
  if (!existsSync(configPath)) return {};
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const commands = config?.hooks?.lint?.commands;
    return commands && typeof commands === 'object' ? commands : {};
  } catch {
    return {};
  }
}

function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const expanded = escaped
    .replace(/\\\{([^}]+)\\\}/g, (_, group) => `(${group.split(',').join('|')})`)
    .replace(/\*\*\//g, '.{0,}')
    .replace(/\*\*/g, '.{0,}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${expanded}$`);
}

function shouldSkip(filePath) {
  return (
    filePath.includes(`${sep}node_modules${sep}`) ||
    filePath.includes(`${sep}.git${sep}`) ||
    filePath.includes(`${sep}dist${sep}`) ||
    filePath.includes(`${sep}build${sep}`)
  );
}

const input = readHookInput();
const filePaths = extractFilePaths(input?.tool_input);

if (filePaths.length === 0) process.exit(0);

const commands = loadCommands();

for (const filePath of filePaths) {
  if (shouldSkip(filePath)) continue;
  const relativePath = relative(process.cwd(), filePath);

  const matches = Object.entries(commands).filter(([glob]) =>
    globToRegex(glob).test(relativePath),
  );
  if (matches.length === 0) continue;

  for (const [, rawCommand] of matches) {
    const command = rawCommand.includes('{file}')
      ? rawCommand.replaceAll('{file}', JSON.stringify(filePath))
      : `${rawCommand} ${JSON.stringify(filePath)}`;
    try {
      execSync(command, { stdio: 'pipe', timeout: LINT_TIMEOUT_MS });
    } catch (error) {
      const stdout = error.stdout?.toString().trim();
      const stderr = error.stderr?.toString().trim();
      const output = [stdout, stderr].filter(Boolean).join('\n');
      if (output) {
        process.stderr.write(`\nlint-and-format issues in ${relativePath}:\n${output}\n`);
      }
      // Warn only; do not block the file write.
    }
  }
}

process.exit(0);

// Extracts file path(s) from a tool input, accepting both Claude/Cursor
// snake_case (`file_path`, `path`, `files`) and VS Code Copilot camelCase
// (`filePath`, `files[]`) shapes.
function extractFilePaths(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const single = toolInput.file_path ?? toolInput.filePath ?? toolInput.path;
  const list = Array.isArray(toolInput.files)
    ? toolInput.files.filter((entry) => typeof entry === 'string')
    : [];
  const all = [];
  if (typeof single === 'string' && single.length > 0) all.push(single);
  for (const entry of list) {
    if (!all.includes(entry)) all.push(entry);
  }
  return all;
}
