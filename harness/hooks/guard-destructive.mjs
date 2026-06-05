#!/usr/bin/env node
// PreToolUse hook for shell tools — blocks generic destructive commands.
// Extra patterns can be added via harness.config.json#hooks.guard.extraPatterns.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(here, '..', 'harness.config.json');

const BUILTIN_PATTERNS = [
  { pattern: '\\brm\\s+-rf?\\s+/(?:\\s|$)', flags: '', reason: 'Recursive delete from filesystem root is not allowed' },
  { pattern: '\\bDROP\\s+TABLE\\b', flags: 'i', reason: 'Direct DROP TABLE is not allowed; use a migration' },
  { pattern: '\\bDROP\\s+DATABASE\\b', flags: 'i', reason: 'DROP DATABASE is not allowed' },
  { pattern: '\\bTRUNCATE\\s+TABLE\\b', flags: 'i', reason: 'TRUNCATE TABLE is not allowed' },
  { pattern: '\\bDELETE\\s+FROM\\b[^;]*\\bWHERE\\s+1\\s*=\\s*1\\b', flags: 'i', reason: 'Unconditional DELETE is not allowed' },
  { pattern: '\\bDELETE\\s+FROM\\s+[\\w."`]+\\s*;', flags: 'i', reason: 'DELETE without WHERE clause is not allowed' },
  { pattern: '\\bgit\\s+push\\s+(?:--force|-f)\\b', flags: '', reason: 'Force push requires explicit human approval' },
  { pattern: '\\bgit\\s+reset\\s+--hard\\s+HEAD', flags: '', reason: 'Hard reset to HEAD requires explicit human approval' },
  { pattern: ':\\(\\)\\{.*\\|:&\\}', flags: '', reason: 'Fork bomb pattern detected' },
];

function loadExtraPatterns() {
  if (!existsSync(configPath)) return [];
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const extras = config?.hooks?.guard?.extraPatterns;
    return Array.isArray(extras) ? extras : [];
  } catch {
    return [];
  }
}

function compile(rule) {
  try {
    return { regex: new RegExp(rule.pattern, rule.flags ?? ''), reason: rule.reason ?? 'Blocked by guard' };
  } catch {
    return null;
  }
}

function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

const input = readHookInput();
const toolInput = input?.tool_input ?? {};
// Claude/Cursor use `command`; VS Code Copilot's runTerminalCommand uses
// `command` as well, but defensive double-check `cmd` for older shells.
const command = toolInput.command ?? toolInput.cmd ?? '';

if (!command) process.exit(0);

const rules = [...BUILTIN_PATTERNS, ...loadExtraPatterns()].map(compile).filter(Boolean);

for (const { regex, reason } of rules) {
  if (regex.test(command)) {
    process.stderr.write(
      JSON.stringify({
        decision: 'block',
        reason: `Blocked: ${reason}\nCommand: ${command}`,
      }),
    );
    process.exit(2);
  }
}

process.exit(0);
