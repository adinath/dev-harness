#!/usr/bin/env bun
// Stop hook — prints the current pipeline status and the next action
// after every main-agent turn. Never blocks; failures are silent.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, readQueue } from '../src/queue/state-machine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultQueuePath = resolve(here, '..', 'queue', 'agent-queue.json');
const queuePath = process.env.HARNESS_QUEUE_PATH ?? defaultQueuePath;

try {
  const queue = readQueue(queuePath);
  const view = describe(queue);
  if (!view) process.exit(0);

  process.stdout.write(`\n${view.icon} Pipeline status: ${view.label}\n`);
  process.stdout.write(`   Spec:   ${view.spec}\n`);
  process.stdout.write(`   Stage:  ${view.stage}\n`);
  process.stdout.write(`   Status: ${view.status}\n`);
  process.stdout.write(`   Next:   ${view.nextAction}\n\n`);
} catch {
  // Silent
}

process.exit(0);
