// Pipeline state machine — single source of truth for queue transitions,
// status presentation, and next-action hints. Consumed by hooks and the CLI.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const READY_FOR_ARCH = 'READY_FOR_ARCH';
const READY_FOR_IMPL = 'READY_FOR_IMPL';
const READY_FOR_TESTS = 'READY_FOR_TESTS';
const READY_FOR_REVIEW = 'READY_FOR_REVIEW';

const IN_ARCH_REVIEW = 'IN_ARCH_REVIEW';
const IN_IMPLEMENTATION = 'IN_IMPLEMENTATION';
const IN_TEST_WRITING = 'IN_TEST_WRITING';
const IN_CODE_REVIEW = 'IN_CODE_REVIEW';

const STAGE_SPEC_READER = 'spec-reader';
const STAGE_ARCHITECT = 'architect-review';
const STAGE_IMPLEMENTER = 'implementer';
const STAGE_TEST_WRITER = 'test-writer';
const STAGE_CODE_REVIEWER = 'code-reviewer';

export const TRANSITIONS = Object.freeze({
  [READY_FOR_ARCH]: { nextStage: STAGE_ARCHITECT, nextStatus: IN_ARCH_REVIEW },
  [READY_FOR_IMPL]: { nextStage: STAGE_IMPLEMENTER, nextStatus: IN_IMPLEMENTATION },
  [READY_FOR_TESTS]: { nextStage: STAGE_TEST_WRITER, nextStatus: IN_TEST_WRITING },
  [READY_FOR_REVIEW]: { nextStage: STAGE_CODE_REVIEWER, nextStatus: IN_CODE_REVIEW },
});

export const STATUS_DISPLAY = Object.freeze({
  STARTING: { icon: '>>', label: 'Pipeline starting' },
  [READY_FOR_ARCH]: { icon: '[arch]', label: 'Ready for architect review' },
  [READY_FOR_IMPL]: { icon: '[impl]', label: 'Ready for implementation' },
  [READY_FOR_TESTS]: { icon: '[test]', label: 'Ready for tests' },
  [READY_FOR_REVIEW]: { icon: '[review]', label: 'Ready for code review' },
  [IN_ARCH_REVIEW]: { icon: '[arch~]', label: 'Architect review in progress' },
  [IN_IMPLEMENTATION]: { icon: '[impl~]', label: 'Implementation in progress' },
  [IN_TEST_WRITING]: { icon: '[test~]', label: 'Test writing in progress' },
  [IN_CODE_REVIEW]: { icon: '[review~]', label: 'Code review in progress' },
  COMPLETE: { icon: '[done]', label: 'Pipeline complete' },
  BLOCKED: { icon: '[blocked]', label: 'Blocked by open questions' },
  NEEDS_REVISION: { icon: '[revise]', label: 'Plan revision required' },
  NEEDS_CHANGES: { icon: '[changes]', label: 'Code changes required' },
});

export const NEXT_ACTION = Object.freeze({
  STARTING: 'Invoke the spec-reader subagent',
  [READY_FOR_ARCH]: 'Invoke the architect-review subagent',
  [READY_FOR_IMPL]: 'Invoke the implementer subagent',
  [READY_FOR_TESTS]: 'Invoke the test-writer subagent',
  [READY_FOR_REVIEW]: 'Invoke the code-reviewer subagent',
  COMPLETE: 'Feature complete. Ready for next spec.',
  BLOCKED: 'Review open questions in the current plan file',
  NEEDS_REVISION: 'Invoke the spec-reader subagent to address open issues',
  NEEDS_CHANGES: 'Invoke the implementer subagent to fix review issues',
});

const DEFAULT_QUEUE_PATH = 'harness/queue/agent-queue.json';

function resolveQueuePath(queuePath) {
  const candidate = queuePath ?? process.env.HARNESS_QUEUE_PATH ?? DEFAULT_QUEUE_PATH;
  return resolve(process.cwd(), candidate);
}

export function readQueue(queuePath) {
  const absolute = resolveQueuePath(queuePath);
  if (!existsSync(absolute)) return null;
  try {
    const raw = readFileSync(absolute, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeQueue(queue, queuePath) {
  const absolute = resolveQueuePath(queuePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(queue, null, 2)}\n`);
}

export function advance(queue) {
  const transition = TRANSITIONS[queue?.status];
  if (!transition) return null;
  return {
    ...queue,
    currentStage: transition.nextStage,
    status: transition.nextStatus,
    lastAdvancedAt: new Date().toISOString(),
  };
}

export function describe(queue) {
  if (!queue || !queue.status) return null;
  const display = STATUS_DISPLAY[queue.status] ?? { icon: '[?]', label: queue.status };
  const nextAction = NEXT_ACTION[queue.status] ?? 'Check queue manually';
  return {
    icon: display.icon,
    label: display.label,
    spec: queue.currentSpec ?? '<unknown>',
    stage: queue.currentStage ?? '<unknown>',
    status: queue.status,
    nextAction,
  };
}
