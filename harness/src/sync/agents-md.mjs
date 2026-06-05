// Sync target: root AGENTS.md.
//
// The AGENTS.md convention is recognised by multiple coding tools as the
// universal project-guidance file. This sync copies harness/AGENTS.md to the
// repo root with a generated banner.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { bannerFor } from './frontmatter.mjs';

export function syncAgentsMd(context) {
  const { harnessRoot, repoRoot } = context;
  const sourcePath = join(harnessRoot, 'AGENTS.md');
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing ${sourcePath}`);
  }
  const guidance = readFileSync(sourcePath, 'utf8');
  const banner = `${bannerFor('markdown', 'AGENTS.md')}\n\n`;
  const out = join(repoRoot, 'AGENTS.md');
  writeFileSync(out, `${banner}${guidance}`);
  return { messages: ['wrote AGENTS.md'] };
}
