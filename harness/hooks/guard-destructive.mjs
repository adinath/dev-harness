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
  // Matches the force flag anywhere in the push command (also after the
  // remote), combined short flags like -uf, but not --force-with-lease,
  // which is the safer variant and stays allowed.
  { pattern: '\\bgit\\s+push\\b[^|;&]*\\s(?:--force(?![-\\w])|-[a-zA-Z]*f\\b)', flags: '', reason: 'Force push requires explicit human approval (--force-with-lease is allowed)' },
  { pattern: '\\bgit\\s+reset\\b[^|;&]*--hard\\b', flags: '', reason: 'Hard reset requires explicit human approval' },
  { pattern: ':\\(\\)\\{.*\\|:&\\}', flags: '', reason: 'Fork bomb pattern detected' },
];

function loadConfig() {
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function extraPatterns(config) {
  const extras = config?.hooks?.guard?.extraPatterns;
  return Array.isArray(extras) ? extras.map(normalizeRule).filter(Boolean) : [];
}

// A branch name token: stops at whitespace, refspec colons, quotes, and
// shell separators, so `release/*` cannot match across argument edges.
const BRANCH_GLOB_STAR = '[^\\s:;|&\'"`]*';
const BRANCH_END = '(?=[\\s;|&\'"`)]|$)';

function branchGlobToRegex(glob) {
  return glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replaceAll('*', BRANCH_GLOB_STAR);
}

// cursor.protectedBranches: block pushes to (including deletes via
// `:branch` / `--delete branch` refspecs) and force-resets of matching
// branches. A bare `git push` with no ref cannot be checked here.
function protectedBranchRules(config) {
  const branches = config?.cursor?.protectedBranches;
  if (!Array.isArray(branches)) return [];
  const rules = [];
  for (const glob of branches) {
    if (typeof glob !== 'string' || glob === '') continue;
    const branch = branchGlobToRegex(glob);
    rules.push({
      pattern: `\\bgit\\s+push\\b[^|;&]*[\\s:'"\`]${branch}${BRANCH_END}`,
      reason: `Pushing to protected branch "${glob}" requires explicit human approval`,
    });
    rules.push({
      pattern: `\\bgit\\s+branch\\s+(?:-f|--force)\\s+${branch}${BRANCH_END}`,
      reason: `Force-resetting protected branch "${glob}" requires explicit human approval`,
    });
  }
  return rules;
}

// Entries may be a bare regex string or a { pattern, flags?, reason? } object.
// Anything else is dropped: an invalid entry must never widen the guard
// (new RegExp(undefined) compiles to an empty pattern that matches everything).
function normalizeRule(entry) {
  if (typeof entry === 'string') return { pattern: entry };
  if (entry && typeof entry === 'object' && typeof entry.pattern === 'string') return entry;
  return null;
}

function compile(rule) {
  if (typeof rule.pattern !== 'string' || rule.pattern === '') return null;
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
// Claude/Copilot nest the command under tool_input; Cursor's
// beforeShellExecution sends `command` at the top level.
const command = toolInput.command ?? toolInput.cmd ?? input?.command ?? '';

// Cursor's hook protocol differs from Claude Code's: it reads a
// {"permission": "allow" | "deny"} JSON object from stdout (exit 0),
// whereas Claude Code blocks on exit 2 with the reason on stderr.
const isCursorProtocol =
  input?.tool_input === undefined &&
  (input?.hook_event_name === 'beforeShellExecution' || typeof input?.command === 'string');

function allow() {
  if (isCursorProtocol) process.stdout.write(JSON.stringify({ permission: 'allow' }));
  process.exit(0);
}

function deny(reason) {
  const message = `Blocked: ${reason}\nCommand: ${command}`;
  if (isCursorProtocol) {
    process.stdout.write(
      JSON.stringify({ permission: 'deny', userMessage: `Blocked: ${reason}`, agentMessage: message }),
    );
    process.exit(0);
  }
  process.stderr.write(JSON.stringify({ decision: 'block', reason: message }));
  process.exit(2);
}

if (!command) allow();

const config = loadConfig();
const rules = [...BUILTIN_PATTERNS, ...extraPatterns(config), ...protectedBranchRules(config)]
  .map(compile)
  .filter(Boolean);

for (const { regex, reason } of rules) {
  if (regex.test(command)) deny(reason);
}

allow();
