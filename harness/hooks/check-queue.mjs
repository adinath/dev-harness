#!/usr/bin/env node
// Stop hook — drives the pipeline forward. Plain stdout from a Stop hook
// is only visible in the transcript, never to the model, so when the
// queue is mid-pipeline this hook emits the documented
// {"decision": "block", "reason": ...} JSON, which feeds the next action
// back to the main agent and makes it continue.
//
// Loop guard: each status value gets at most one nudge (recorded as
// `lastStopNudgeStatus` in the queue). If the agent stops again without
// the status having changed, the stop is allowed — the pipeline needs
// human attention, not another nudge.

import { describe, loadHarness, readQueue, writeQueue } from '../src/queue/state-machine.mjs';

// pipeline.continueStatuses holds the statuses where the pipeline expects
// the main agent to act next. COMPLETE and BLOCKED are terminal for the
// agent: stopping is correct.
const { pipeline, queuePath } = loadHarness();

function printStatus(view) {
  process.stdout.write(`\n${view.icon} Pipeline status: ${view.label}\n`);
  process.stdout.write(`   Spec:   ${view.spec}\n`);
  process.stdout.write(`   Stage:  ${view.stage}\n`);
  process.stdout.write(`   Status: ${view.status}\n`);
  process.stdout.write(`   Next:   ${view.nextAction}\n\n`);
}

try {
  const queue = readQueue(queuePath);
  const view = describe(queue, pipeline);
  if (!view) process.exit(0);

  const shouldNudge =
    pipeline.continueStatuses.has(queue.status) && queue.lastStopNudgeStatus !== queue.status;

  if (!shouldNudge) {
    printStatus(view);
    process.exit(0);
  }

  writeQueue({ ...queue, lastStopNudgeStatus: queue.status }, queuePath);
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        `The agent pipeline for spec "${view.spec}" is still running ` +
        `(status: ${view.status} — ${view.label}). ${view.nextAction}. ` +
        'If that stage already ran and failed, report the failure to the user instead.',
    }),
  );
} catch {
  // Queue unreadable or malformed — never block agent flow.
}

process.exit(0);
