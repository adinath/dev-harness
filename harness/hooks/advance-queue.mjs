#!/usr/bin/env bun
// SubagentStop / stop hook — advances the queue to the next stage when
// the previous stage's "READY_FOR_*" status is observed.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { advance, describe, readQueue, writeQueue, TRANSITIONS } from '../src/queue/state-machine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultQueuePath = resolve(here, '..', 'queue', 'agent-queue.json');
const queuePath = process.env.HARNESS_QUEUE_PATH ?? defaultQueuePath;

try {
  const queue = readQueue(queuePath);
  if (!queue) process.exit(0);

  if (!TRANSITIONS[queue.status]) {
    process.exit(0);
  }

  const next = advance(queue);
  writeQueue(next, queuePath);

  const view = describe(next);
  if (view) {
    process.stdout.write(`\n${view.icon} Pipeline advanced -> ${view.stage}\n`);
    process.stdout.write(`   Spec:   ${view.spec}\n`);
    process.stdout.write(`   Status: ${view.status}\n\n`);
  }
} catch {
  // Queue unreadable or malformed — silently skip; never block agent flow.
}

process.exit(0);
