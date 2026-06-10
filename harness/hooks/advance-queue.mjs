#!/usr/bin/env node
// SubagentStop hook — advances the queue to the next stage when the
// previous stage's "READY_FOR_*" status is observed AND the subagent
// that just stopped is the pipeline agent that produced that status.
// Without the agent check, any unrelated subagent (Explore, a one-off
// Task) stopping while the queue sits in READY_FOR_* would advance it.

import { readFileSync } from 'node:fs';
import { advance, describe, loadHarness, readQueue, writeQueue } from '../src/queue/state-machine.mjs';

const { pipeline, queuePath } = loadHarness();

function readHookInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

// Claude Code sends `agent_type`; check Cursor-style spellings too.
function stoppedAgentName(input) {
  const candidates = [input?.agent_type, input?.subagent_type, input?.agent_name, input?.agent?.name];
  return candidates.find((value) => typeof value === 'string' && value !== '') ?? null;
}

try {
  const queue = readQueue(queuePath);
  if (!queue) process.exit(0);

  if (!pipeline.transitions[queue.status]) {
    process.exit(0);
  }

  // Only the agent whose completion set this READY_FOR_* status may
  // advance the queue. If the host tool doesn't identify the stopping
  // agent, fall back to advancing (pre-existing behavior) rather than
  // stalling the pipeline.
  const stoppedAgent = stoppedAgentName(readHookInput());
  const expectedAgent = pipeline.stageCompleting[queue.status];
  if (stoppedAgent && expectedAgent && stoppedAgent !== expectedAgent) {
    process.exit(0);
  }

  const next = advance(queue, pipeline);
  writeQueue(next, queuePath);

  const view = describe(next, pipeline);
  if (view) {
    process.stdout.write(`\n${view.icon} Pipeline advanced -> ${view.stage}\n`);
    process.stdout.write(`   Spec:   ${view.spec}\n`);
    process.stdout.write(`   Status: ${view.status}\n\n`);
  }
} catch {
  // Queue unreadable or malformed — silently skip; never block agent flow.
}

process.exit(0);
