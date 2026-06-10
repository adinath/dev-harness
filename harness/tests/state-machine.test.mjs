import { describe as suite, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_STAGES,
  DEFAULT_PIPELINE,
  TRANSITIONS,
  STAGE_COMPLETING,
  NEXT_ACTION,
  buildPipeline,
  advance,
  describe,
  readQueue,
  readQueueState,
  writeQueue,
} from '../src/queue/state-machine.mjs';

suite('buildPipeline', () => {
  test('default stages produce the historical transitions', () => {
    assert.deepEqual(TRANSITIONS, {
      READY_FOR_ARCH: { nextStage: 'architect-review', nextStatus: 'IN_ARCH_REVIEW' },
      READY_FOR_IMPL: { nextStage: 'implementer', nextStatus: 'IN_IMPLEMENTATION' },
      READY_FOR_TESTS: { nextStage: 'test-writer', nextStatus: 'IN_TEST_WRITING' },
      READY_FOR_REVIEW: { nextStage: 'code-reviewer', nextStatus: 'IN_CODE_REVIEW' },
    });
    assert.deepEqual(STAGE_COMPLETING, {
      READY_FOR_ARCH: 'spec-reader',
      READY_FOR_IMPL: 'architect-review',
      READY_FOR_TESTS: 'implementer',
      READY_FOR_REVIEW: 'test-writer',
    });
  });

  test('default next actions cover ready, active, and terminal statuses', () => {
    assert.equal(NEXT_ACTION.STARTING, 'Invoke the spec-reader subagent');
    assert.equal(NEXT_ACTION.READY_FOR_IMPL, 'Invoke the implementer subagent');
    assert.equal(NEXT_ACTION.IN_IMPLEMENTATION, 'Invoke the implementer subagent if it is not already running');
    assert.equal(NEXT_ACTION.COMPLETE, 'Feature complete. Ready for next spec.');
    assert.equal(NEXT_ACTION.NEEDS_REVISION, 'Invoke the spec-reader subagent to address open issues');
  });

  test('custom stages drive transitions and derive IN_<ID> active statuses', () => {
    const pipeline = buildPipeline([
      { id: 'alpha', readyStatus: 'STARTING', completedStatus: 'ALPHA_DONE' },
      { id: 'beta-stage', readyStatus: 'ALPHA_DONE', completedStatus: 'COMPLETE' },
    ]);
    assert.deepEqual(pipeline.transitions, {
      ALPHA_DONE: { nextStage: 'beta-stage', nextStatus: 'IN_BETA_STAGE' },
    });
    assert.deepEqual(pipeline.stageCompleting, { ALPHA_DONE: 'alpha' });
    assert.equal(pipeline.nextAction.STARTING, 'Invoke the alpha subagent');
    assert.equal(pipeline.nextAction.NEEDS_REVISION, 'Invoke the alpha subagent to address open issues');
    assert.ok(pipeline.continueStatuses.has('IN_BETA_STAGE'));
    assert.ok(!pipeline.continueStatuses.has('COMPLETE'));
  });

  test('explicit activeStatus wins over derivation', () => {
    const pipeline = buildPipeline([
      { id: 'a', readyStatus: 'STARTING', completedStatus: 'X' },
      { id: 'b', readyStatus: 'X', activeStatus: 'CRUNCHING', completedStatus: 'COMPLETE' },
    ]);
    assert.equal(pipeline.transitions.X.nextStatus, 'CRUNCHING');
  });

  test('default stage ids keep historical active statuses when config omits activeStatus', () => {
    const pipeline = buildPipeline([
      { id: 'spec-reader', readyStatus: 'STARTING', completedStatus: 'READY_FOR_ARCH' },
      { id: 'architect-review', readyStatus: 'READY_FOR_ARCH', completedStatus: 'COMPLETE' },
    ]);
    assert.equal(pipeline.transitions.READY_FOR_ARCH.nextStatus, 'IN_ARCH_REVIEW');
  });

  test('invalid or empty stage config falls back to defaults', () => {
    for (const bad of [null, undefined, [], 'nope', [{ id: 'x' }], [{ id: '', readyStatus: 'A', completedStatus: 'B' }]]) {
      assert.equal(buildPipeline(bad).stages, DEFAULT_STAGES);
    }
  });
});

suite('advance', () => {
  test('moves to the next stage and stamps lastAdvancedAt', () => {
    const next = advance({ currentSpec: 's', status: 'READY_FOR_TESTS' });
    assert.equal(next.currentStage, 'test-writer');
    assert.equal(next.status, 'IN_TEST_WRITING');
    assert.equal(next.currentSpec, 's');
    assert.ok(!Number.isNaN(Date.parse(next.lastAdvancedAt)));
  });

  test('returns null for non-transition statuses', () => {
    assert.equal(advance({ status: 'IN_TEST_WRITING' }), null);
    assert.equal(advance({ status: 'COMPLETE' }), null);
    assert.equal(advance({}), null);
    assert.equal(advance(null), null);
  });

  test('honors a custom pipeline', () => {
    const pipeline = buildPipeline([
      { id: 'a', readyStatus: 'STARTING', completedStatus: 'X' },
      { id: 'b', readyStatus: 'X', completedStatus: 'COMPLETE' },
    ]);
    assert.equal(advance({ status: 'X' }, pipeline).currentStage, 'b');
    assert.equal(advance({ status: 'READY_FOR_TESTS' }, pipeline), null);
  });
});

suite('describe', () => {
  test('returns null without a status', () => {
    assert.equal(describe(null), null);
    assert.equal(describe({}), null);
  });

  test('maps known statuses and falls back for unknown ones', () => {
    const view = describe({ status: 'IN_IMPLEMENTATION', currentSpec: 'f', currentStage: 'implementer' });
    assert.equal(view.label, 'Implementation in progress');
    assert.equal(view.nextAction, 'Invoke the implementer subagent if it is not already running');

    const unknown = describe({ status: 'WAT' });
    assert.equal(unknown.icon, '[?]');
    assert.equal(unknown.label, 'WAT');
    assert.equal(unknown.nextAction, 'Check queue manually');
    assert.equal(unknown.spec, '<unknown>');
  });
});

suite('readQueueState / readQueue / writeQueue', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'queue-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('distinguishes missing, empty, ok, and malformed', () => {
    const path = join(dir, 'q.json');
    assert.equal(readQueueState(path).kind, 'missing');

    writeFileSync(path, '');
    assert.equal(readQueueState(path).kind, 'empty');

    writeFileSync(path, '{broken');
    const malformed = readQueueState(path);
    assert.equal(malformed.kind, 'malformed');
    assert.ok(malformed.error);

    writeFileSync(path, '"a string"');
    assert.equal(readQueueState(path).kind, 'malformed');
    writeFileSync(path, '[1,2]');
    assert.equal(readQueueState(path).kind, 'malformed');

    writeFileSync(path, '{"status":"STARTING"}');
    const ok = readQueueState(path);
    assert.equal(ok.kind, 'ok');
    assert.equal(ok.queue.status, 'STARTING');
  });

  test('readQueue returns the queue or null', () => {
    const path = join(dir, 'q.json');
    assert.equal(readQueue(path), null);
    writeFileSync(path, '{"status":"COMPLETE"}');
    assert.equal(readQueue(path).status, 'COMPLETE');
    writeFileSync(path, 'oops');
    assert.equal(readQueue(path), null);
  });

  test('writeQueue round-trips and creates parent directories', () => {
    const path = join(dir, 'nested', 'deep', 'q.json');
    const queue = { currentSpec: 'demo', status: 'READY_FOR_ARCH', implementedFiles: ['a.ts'] };
    writeQueue(queue, path);
    assert.deepEqual(readQueue(path), queue);
    assert.ok(readFileSync(path, 'utf8').endsWith('\n'));
  });
});

suite('DEFAULT_PIPELINE', () => {
  test('continueStatuses contains every working status and no terminal ones', () => {
    const expected = [
      'STARTING',
      'READY_FOR_ARCH', 'READY_FOR_IMPL', 'READY_FOR_TESTS', 'READY_FOR_REVIEW',
      'IN_ARCH_REVIEW', 'IN_IMPLEMENTATION', 'IN_TEST_WRITING', 'IN_CODE_REVIEW',
      'NEEDS_REVISION', 'NEEDS_CHANGES',
    ];
    for (const status of expected) {
      assert.ok(DEFAULT_PIPELINE.continueStatuses.has(status), `missing ${status}`);
    }
    assert.ok(!DEFAULT_PIPELINE.continueStatuses.has('COMPLETE'));
    assert.ok(!DEFAULT_PIPELINE.continueStatuses.has('BLOCKED'));
  });
});
