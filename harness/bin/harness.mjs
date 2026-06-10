#!/usr/bin/env node
// harness — tool-agnostic developer harness CLI.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { buildPipeline, describe, readQueueState, writeQueue } from '../src/queue/state-machine.mjs';
import { syncClaude } from '../src/sync/claude.mjs';
import { syncCursor } from '../src/sync/cursor.mjs';
import { syncCopilot } from '../src/sync/copilot.mjs';
import { syncAgentsMd } from '../src/sync/agents-md.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(here, '..');
const REPO_ROOT = resolve(HARNESS_ROOT, '..');
const CONFIG_PATH = join(HARNESS_ROOT, 'harness.config.json');

const KNOWN_TARGETS = Object.freeze({
  claude: syncClaude,
  cursor: syncCursor,
  copilot: syncCopilot,
  'agents-md': syncAgentsMd,
});

const HELP = `harness — developer harness CLI

Usage:
  harness init                   Create harness.config.json from defaults
  harness sync [--target NAME]   Regenerate one or all tool configs
  harness status                 Print the current pipeline queue
  harness queue reset            Clear queue/agent-queue.json (asks first)
  harness help                   Show this help

Targets: ${Object.keys(KNOWN_TARGETS).join(', ')}
`;

async function main() {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      stdout.write(HELP);
      return 0;
    case 'init':
      return cmdInit();
    case 'sync':
      return cmdSync(rest);
    case 'status':
      return cmdStatus();
    case 'queue':
      return cmdQueue(rest);
    default:
      stdout.write(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found at ${CONFIG_PATH}. Run \`harness init\`.`);
  }
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${error.message}`);
  }
}

function parseSyncArgs(args) {
  const targets = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--target' || arg === '-t') {
      const value = args[i + 1];
      if (!value) throw new Error('--target requires a value');
      targets.push(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { targets };
}

const CONFIG_TEMPLATE_PATH = join(HARNESS_ROOT, 'templates', 'harness.config.template.json');

async function cmdInit() {
  if (existsSync(CONFIG_PATH)) {
    stdout.write(`harness.config.json already exists at ${CONFIG_PATH}\n`);
    return 0;
  }
  if (!existsSync(CONFIG_TEMPLATE_PATH)) {
    stdout.write(`Config template missing at ${CONFIG_TEMPLATE_PATH}; cannot create harness.config.json.\n`);
    return 1;
  }
  writeFileSync(CONFIG_PATH, readFileSync(CONFIG_TEMPLATE_PATH, 'utf8'));
  stdout.write(`Created ${CONFIG_PATH} from defaults.\n`);
  stdout.write('Edit project.name and project.description, then run `harness sync`.\n');
  return 0;
}

function cmdSync(args) {
  const { targets: requestedTargets } = parseSyncArgs(args);
  const config = loadConfig();
  const configuredTargets = Array.isArray(config.targets) ? config.targets : [];
  const targets = requestedTargets.length > 0 ? requestedTargets : configuredTargets;

  if (targets.length === 0) {
    stdout.write('No targets configured. Set `targets` in harness.config.json or pass --target.\n');
    return 1;
  }

  const context = {
    harnessRoot: HARNESS_ROOT,
    repoRoot: REPO_ROOT,
    config,
  };

  let failures = 0;
  for (const target of targets) {
    const runner = KNOWN_TARGETS[target];
    if (!runner) {
      stdout.write(`Skipping unknown target: ${target}\n`);
      failures += 1;
      continue;
    }
    stdout.write(`Syncing ${target}...\n`);
    try {
      const summary = runner(context);
      for (const line of summary?.messages ?? []) {
        stdout.write(`  ${line}\n`);
      }
    } catch (error) {
      stdout.write(`  ERROR: ${error.message}\n`);
      failures += 1;
    }
  }

  if (failures > 0) {
    stdout.write(`\nSync completed with ${failures} failure(s).\n`);
    return 1;
  }
  stdout.write('\nSync complete.\n');
  return 0;
}

function cmdStatus() {
  const config = loadConfig();
  const queuePath = resolveFromRepo(config?.paths?.queue ?? 'harness/queue/agent-queue.json');
  const state = readQueueState(queuePath);
  if (state.kind === 'malformed') {
    stdout.write(`Queue file is corrupted: ${state.error}\n`);
    stdout.write(`File: ${state.path}\n`);
    stdout.write('Run `harness queue reset` to clear it.\n');
    return 1;
  }
  const view = describe(state.kind === 'ok' ? state.queue : null, buildPipeline(config?.pipeline?.stages));
  if (!view) {
    stdout.write('No active implementation in progress. Use `/implement <spec-name>` to start.\n');
    return 0;
  }
  stdout.write(`\n${view.icon} Pipeline status: ${view.label}\n`);
  stdout.write(`   Spec:   ${view.spec}\n`);
  stdout.write(`   Stage:  ${view.stage}\n`);
  stdout.write(`   Status: ${view.status}\n`);
  stdout.write(`   Next:   ${view.nextAction}\n\n`);
  return 0;
}

async function cmdQueue(args) {
  const [sub] = args;
  if (sub !== 'reset') {
    stdout.write(`Unknown queue subcommand: ${sub ?? '<missing>'}\nUsage: harness queue reset\n`);
    return 1;
  }
  const config = loadConfig();
  const queuePath = resolveFromRepo(config?.paths?.queue ?? 'harness/queue/agent-queue.json');
  const state = readQueueState(queuePath);

  if (state.kind === 'missing' || state.kind === 'empty' || (state.kind === 'ok' && Object.keys(state.queue).length === 0)) {
    stdout.write('Queue is already empty.\n');
    return 0;
  }

  if (state.kind === 'malformed') {
    stdout.write(`Queue file is corrupted: ${state.error}\n`);
    stdout.write(`File: ${state.path}\n`);
  } else {
    stdout.write('Current queue contents:\n');
    stdout.write(`${JSON.stringify(state.queue, null, 2)}\n`);
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question('Clear this queue? Type "yes" to confirm: ');
  await rl.close();

  if (answer.trim().toLowerCase() !== 'yes') {
    stdout.write('Cancelled. Queue unchanged.\n');
    return 0;
  }

  writeQueue({}, queuePath);
  stdout.write('Queue cleared.\n');
  return 0;
}

function resolveFromRepo(relativePath) {
  if (!relativePath) return null;
  return resolve(REPO_ROOT, relativePath);
}

// Only run the CLI when executed directly, so importing this module
// (e.g. from tests) doesn't trigger a command. realpathSync resolves the
// symlink npm creates for globally installed bins; import.meta.main would
// be simpler but needs Node 24+.
function isExecutedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((error) => {
      stdout.write(`harness: ${error.message}\n`);
      process.exit(1);
    });
}
