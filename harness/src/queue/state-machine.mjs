// Pipeline state machine — single source of truth for queue transitions,
// status presentation, and next-action hints. Consumed by hooks and the CLI.
//
// Stage definitions come from harness.config.json#pipeline.stages and drive
// the transitions at runtime; DEFAULT_STAGES below is the fallback when the
// config is missing or invalid. Note: the agent prompt files write status
// strings literally, so custom stages require matching prompt edits.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = resolve(moduleDir, '..', '..');
const REPO_ROOT = resolve(HARNESS_ROOT, '..');
const CONFIG_PATH = resolve(HARNESS_ROOT, 'harness.config.json');

// `readyStatus` is the queue status at which the stage should be invoked,
// `activeStatus` the status while it runs (set by the advance hook), and
// `completedStatus` the status the stage writes when done. The first
// stage has no activeStatus: /implement invokes it directly.
export const DEFAULT_STAGES = Object.freeze([
  { id: 'spec-reader', readyStatus: 'STARTING', completedStatus: 'READY_FOR_ARCH' },
  { id: 'architect-review', readyStatus: 'READY_FOR_ARCH', activeStatus: 'IN_ARCH_REVIEW', completedStatus: 'READY_FOR_IMPL' },
  { id: 'implementer', readyStatus: 'READY_FOR_IMPL', activeStatus: 'IN_IMPLEMENTATION', completedStatus: 'READY_FOR_TESTS' },
  { id: 'test-writer', readyStatus: 'READY_FOR_TESTS', activeStatus: 'IN_TEST_WRITING', completedStatus: 'READY_FOR_REVIEW' },
  { id: 'code-reviewer', readyStatus: 'READY_FOR_REVIEW', activeStatus: 'IN_CODE_REVIEW', completedStatus: 'COMPLETE' },
]);

// Hand-tuned labels for the default statuses; derived labels cover custom
// stages. Static entries win so the default pipeline keeps its wording.
const KNOWN_STATUS_DISPLAY = Object.freeze({
  STARTING: { icon: '>>', label: 'Pipeline starting' },
  READY_FOR_ARCH: { icon: '[arch]', label: 'Ready for architect review' },
  READY_FOR_IMPL: { icon: '[impl]', label: 'Ready for implementation' },
  READY_FOR_TESTS: { icon: '[test]', label: 'Ready for tests' },
  READY_FOR_REVIEW: { icon: '[review]', label: 'Ready for code review' },
  IN_ARCH_REVIEW: { icon: '[arch~]', label: 'Architect review in progress' },
  IN_IMPLEMENTATION: { icon: '[impl~]', label: 'Implementation in progress' },
  IN_TEST_WRITING: { icon: '[test~]', label: 'Test writing in progress' },
  IN_CODE_REVIEW: { icon: '[review~]', label: 'Code review in progress' },
  COMPLETE: { icon: '[done]', label: 'Pipeline complete' },
  BLOCKED: { icon: '[blocked]', label: 'Blocked by open questions' },
  NEEDS_REVISION: { icon: '[revise]', label: 'Plan revision required' },
  NEEDS_CHANGES: { icon: '[changes]', label: 'Code changes required' },
});

function isValidStage(stage) {
  return (
    stage !== null &&
    typeof stage === 'object' &&
    typeof stage.id === 'string' && stage.id !== '' &&
    typeof stage.readyStatus === 'string' && stage.readyStatus !== '' &&
    typeof stage.completedStatus === 'string' && stage.completedStatus !== ''
  );
}

function activeStatusFor(stage) {
  if (typeof stage.activeStatus === 'string' && stage.activeStatus !== '') return stage.activeStatus;
  // Configs written before activeStatus existed: keep the historical
  // status names for the default stage ids.
  const known = DEFAULT_STAGES.find((defaultStage) => defaultStage.id === stage.id);
  if (known?.activeStatus) return known.activeStatus;
  return `IN_${stage.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

// Derive every runtime map from an ordered stage list. Invalid or missing
// stage config falls back to DEFAULT_STAGES rather than breaking hooks.
export function buildPipeline(stages) {
  const usable = Array.isArray(stages) && stages.length > 0 && stages.every(isValidStage);
  const resolved = usable ? stages : DEFAULT_STAGES;

  const transitions = {};
  const stageCompleting = {};
  const nextAction = {};
  const statusDisplay = {};
  const continueStatuses = new Set(['NEEDS_REVISION', 'NEEDS_CHANGES']);

  resolved.forEach((stage, index) => {
    continueStatuses.add(stage.readyStatus);
    nextAction[stage.readyStatus] = `Invoke the ${stage.id} subagent`;
    statusDisplay[stage.readyStatus] = { icon: `[${stage.id}]`, label: `Ready for ${stage.id}` };

    if (index === 0) return;
    const active = activeStatusFor(stage);
    continueStatuses.add(active);
    // The advance hook flips readyStatus to activeStatus before the stage
    // is invoked, so activeStatus is what the main agent sees when it
    // needs to start the stage.
    nextAction[active] = `Invoke the ${stage.id} subagent if it is not already running`;
    statusDisplay[active] = { icon: `[${stage.id}~]`, label: `${stage.id} in progress` };
    transitions[stage.readyStatus] = { nextStage: stage.id, nextStatus: active };
    stageCompleting[stage.readyStatus] = resolved[index - 1].id;
  });

  nextAction.COMPLETE = 'Feature complete. Ready for next spec.';
  nextAction.BLOCKED = 'Review open questions in the current plan file';
  nextAction.NEEDS_REVISION = `Invoke the ${resolved[0].id} subagent to address open issues`;
  nextAction.NEEDS_CHANGES = 'Invoke the implementer subagent to fix review issues';
  Object.assign(statusDisplay, KNOWN_STATUS_DISPLAY);

  return Object.freeze({
    stages: resolved,
    transitions: Object.freeze(transitions),
    stageCompleting: Object.freeze(stageCompleting),
    nextAction: Object.freeze(nextAction),
    statusDisplay: Object.freeze(statusDisplay),
    continueStatuses,
  });
}

export const DEFAULT_PIPELINE = buildPipeline(DEFAULT_STAGES);

// Legacy aliases for the default pipeline's maps. Prefer passing a
// pipeline from loadHarness()/buildPipeline() so config-defined stages
// are honored.
export const TRANSITIONS = DEFAULT_PIPELINE.transitions;
export const STAGE_COMPLETING = DEFAULT_PIPELINE.stageCompleting;
export const NEXT_ACTION = DEFAULT_PIPELINE.nextAction;
export const STATUS_DISPLAY = DEFAULT_PIPELINE.statusDisplay;

// Runtime entry point for hooks: reads harness.config.json once and
// resolves both the configured pipeline and the queue path, so config
// edits to pipeline.stages and paths.queue actually take effect.
// HARNESS_QUEUE_PATH still overrides everything (used by tests).
export function loadHarness() {
  let config = null;
  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      config = null;
    }
  }
  const configuredQueue =
    typeof config?.paths?.queue === 'string' && config.paths.queue !== ''
      ? resolve(REPO_ROOT, config.paths.queue)
      : resolve(HARNESS_ROOT, 'queue', 'agent-queue.json');
  return {
    config,
    pipeline: buildPipeline(config?.pipeline?.stages),
    queuePath: process.env.HARNESS_QUEUE_PATH ?? configuredQueue,
  };
}

const DEFAULT_QUEUE_PATH = 'harness/queue/agent-queue.json';

function resolveQueuePath(queuePath) {
  const candidate = queuePath ?? process.env.HARNESS_QUEUE_PATH ?? DEFAULT_QUEUE_PATH;
  return resolve(process.cwd(), candidate);
}

// Result-style read that distinguishes a missing queue from a corrupted one,
// so callers like `harness queue reset` can recover a malformed file instead
// of treating it as empty.
//   { kind: 'missing' }                       — file does not exist
//   { kind: 'empty' }                         — file exists but is blank
//   { kind: 'ok', queue }                     — parsed successfully
//   { kind: 'malformed', error, path }        — exists but is not valid JSON
export function readQueueState(queuePath) {
  const absolute = resolveQueuePath(queuePath);
  if (!existsSync(absolute)) return { kind: 'missing', path: absolute };
  let raw;
  try {
    raw = readFileSync(absolute, 'utf8').trim();
  } catch (error) {
    return { kind: 'malformed', error: error.message, path: absolute };
  }
  if (!raw) return { kind: 'empty', path: absolute };
  try {
    const queue = JSON.parse(raw);
    if (queue === null || typeof queue !== 'object' || Array.isArray(queue)) {
      return { kind: 'malformed', error: 'queue root must be a JSON object', path: absolute };
    }
    return { kind: 'ok', queue, path: absolute };
  } catch (error) {
    return { kind: 'malformed', error: error.message, path: absolute };
  }
}

export function readQueue(queuePath) {
  const state = readQueueState(queuePath);
  return state.kind === 'ok' ? state.queue : null;
}

export function writeQueue(queue, queuePath) {
  const absolute = resolveQueuePath(queuePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(queue, null, 2)}\n`);
}

export function advance(queue, pipeline = DEFAULT_PIPELINE) {
  const transition = pipeline.transitions[queue?.status];
  if (!transition) return null;
  return {
    ...queue,
    currentStage: transition.nextStage,
    status: transition.nextStatus,
    lastAdvancedAt: new Date().toISOString(),
  };
}

export function describe(queue, pipeline = DEFAULT_PIPELINE) {
  if (!queue || !queue.status) return null;
  const display = pipeline.statusDisplay[queue.status] ?? { icon: '[?]', label: queue.status };
  const nextAction = pipeline.nextAction[queue.status] ?? 'Check queue manually';
  return {
    icon: display.icon,
    label: display.label,
    spec: queue.currentSpec ?? '<unknown>',
    stage: queue.currentStage ?? '<unknown>',
    status: queue.status,
    nextAction,
  };
}
