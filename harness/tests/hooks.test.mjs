// Integration tests: each hook script is executed as a subprocess, the way
// Claude Code / Cursor / Copilot run it, with input piped to stdin.

import { describe as suite, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = resolve(here, '..', 'hooks');
const REPO_ROOT = resolve(here, '..', '..');

function runHook(script, input, env = {}) {
  const proc = spawnSync('node', [join(HOOKS_DIR, script)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  });
  return { code: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}

const guard = (command) => runHook('guard-destructive.mjs', { tool_input: { command } });

suite('guard-destructive: Claude protocol', () => {
  test('blocks with exit 2 and a JSON reason on stderr', () => {
    const { code, stderr } = guard('git push --force origin feature');
    assert.equal(code, 2);
    const payload = JSON.parse(stderr);
    assert.equal(payload.decision, 'block');
    assert.ok(payload.reason.includes('Force push'));
  });

  test('allows safe commands with exit 0', () => {
    const { code, stdout, stderr } = guard('git status');
    assert.equal(code, 0);
    assert.equal(stdout, '');
    assert.equal(stderr, '');
  });

  test('empty input allows', () => {
    assert.equal(runHook('guard-destructive.mjs', '').code, 0);
  });
});

suite('guard-destructive: Cursor protocol', () => {
  const cursorGuard = (command) =>
    runHook('guard-destructive.mjs', { hook_event_name: 'beforeShellExecution', command });

  test('denies via {"permission":"deny"} on stdout with exit 0', () => {
    const { code, stdout } = cursorGuard('git push --force origin feature');
    assert.equal(code, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.permission, 'deny');
    assert.ok(payload.agentMessage.includes('Force push'));
    assert.ok(payload.userMessage.includes('Blocked'));
  });

  test('allows via {"permission":"allow"}', () => {
    const { code, stdout } = cursorGuard('git status');
    assert.equal(code, 0);
    assert.equal(JSON.parse(stdout).permission, 'allow');
  });
});

suite('guard-destructive: pattern intent', () => {
  const blocked = [
    'git push origin -f', // flag after the remote
    'git push origin feature --force',
    'git push -uf origin feature', // combined short flags
    'git reset --hard origin/main',
    'git reset --hard HEAD~1',
    'git reset --quiet --hard',
    'git push origin main', // protected branch
    'git push origin HEAD:release/1.2',
    'git branch -f master abc',
    'rm -rf /',
    'psql -c "DROP TABLE users"',
  ];
  const allowed = [
    'git push --force-with-lease origin feature',
    'git push origin feature',
    'git reset --soft HEAD~1',
    'git reset HEAD~1',
    'git checkout main',
    'rm -rf ./build',
    'echo force of habit',
  ];

  for (const command of blocked) {
    test(`blocks: ${command}`, () => {
      assert.equal(guard(command).code, 2);
    });
  }
  for (const command of allowed) {
    test(`allows: ${command}`, () => {
      assert.equal(guard(command).code, 0);
    });
  }
});

suite('advance-queue', () => {
  let dir;
  let queuePath;
  const env = () => ({ HARNESS_QUEUE_PATH: queuePath });
  const queue = () => JSON.parse(readFileSync(queuePath, 'utf8'));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'advance-test-'));
    queuePath = join(dir, 'q.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('unrelated subagent does not advance', () => {
    writeFileSync(queuePath, '{"currentSpec":"s","status":"READY_FOR_IMPL"}');
    const { code } = runHook('advance-queue.mjs', { agent_type: 'Explore' }, env());
    assert.equal(code, 0);
    assert.equal(queue().status, 'READY_FOR_IMPL');
  });

  test('the completing agent advances the queue', () => {
    writeFileSync(queuePath, '{"currentSpec":"s","status":"READY_FOR_IMPL"}');
    runHook('advance-queue.mjs', { agent_type: 'architect-review' }, env());
    assert.equal(queue().status, 'IN_IMPLEMENTATION');
    assert.equal(queue().currentStage, 'implementer');
  });

  test('anonymous stop falls back to advancing', () => {
    writeFileSync(queuePath, '{"currentSpec":"s","status":"READY_FOR_TESTS"}');
    runHook('advance-queue.mjs', {}, env());
    assert.equal(queue().status, 'IN_TEST_WRITING');
  });

  test('non-transition statuses and corrupt queues are left alone', () => {
    writeFileSync(queuePath, '{"currentSpec":"s","status":"IN_IMPLEMENTATION"}');
    runHook('advance-queue.mjs', { agent_type: 'implementer' }, env());
    assert.equal(queue().status, 'IN_IMPLEMENTATION');

    writeFileSync(queuePath, '{broken');
    const { code } = runHook('advance-queue.mjs', { agent_type: 'implementer' }, env());
    assert.equal(code, 0);
    assert.equal(readFileSync(queuePath, 'utf8'), '{broken');
  });
});

suite('check-queue', () => {
  let dir;
  let queuePath;
  const env = () => ({ HARNESS_QUEUE_PATH: queuePath });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-test-'));
    queuePath = join(dir, 'q.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('nudges once per status with a decision:block payload', () => {
    writeFileSync(queuePath, '{"currentSpec":"s","status":"IN_IMPLEMENTATION"}');
    const first = runHook('check-queue.mjs', {}, env());
    assert.equal(first.code, 0);
    const payload = JSON.parse(first.stdout);
    assert.equal(payload.decision, 'block');
    assert.ok(payload.reason.includes('implementer subagent'));

    const second = runHook('check-queue.mjs', {}, env());
    assert.ok(!second.stdout.includes('"decision"'));
  });

  test('terminal statuses allow stopping', () => {
    writeFileSync(queuePath, '{"currentSpec":"s","status":"COMPLETE"}');
    const { stdout } = runHook('check-queue.mjs', {}, env());
    assert.ok(!stdout.includes('"decision"'));
    assert.ok(stdout.includes('Pipeline complete'));
  });

  test('missing or corrupt queue is silent', () => {
    const missing = runHook('check-queue.mjs', {}, env());
    assert.equal(missing.code, 0);
    assert.equal(missing.stdout, '');

    writeFileSync(queuePath, 'not json');
    const corrupt = runHook('check-queue.mjs', {}, env());
    assert.equal(corrupt.code, 0);
    assert.equal(corrupt.stdout, '');
  });
});

suite('lint-and-format', () => {
  test('exits 0 when no file paths are present', () => {
    assert.equal(runHook('lint-and-format.mjs', {}).code, 0);
    assert.equal(runHook('lint-and-format.mjs', 'garbage').code, 0);
  });

  test('exits 0 when no lint command matches the file', () => {
    const { code } = runHook('lint-and-format.mjs', {
      tool_input: { file_path: '/tmp/some-file.xyz' },
    });
    assert.equal(code, 0);
  });

  test('accepts Cursor-style top-level file_path input', () => {
    const { code } = runHook('lint-and-format.mjs', { file_path: '/tmp/some-file.xyz' });
    assert.equal(code, 0);
  });
});
