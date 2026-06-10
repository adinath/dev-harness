import { describe as suite, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { shellQuote, globToRegex } from '../hooks/lib.mjs';

suite('shellQuote', () => {
  test('quotes plain paths', () => {
    assert.equal(shellQuote('/tmp/a.ts'), "'/tmp/a.ts'");
  });

  test('neutralizes single quotes', () => {
    assert.equal(shellQuote("a'b"), `'a'\\''b'`);
  });

  test('command substitution in a filename does not execute', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quote-test-'));
    const marker = join(dir, 'pwned');
    const hostile = 'file`touch ' + marker + '`$(touch ' + marker + ').ts';
    const out = execSync(`echo ${shellQuote(hostile)}`, { stdio: 'pipe' }).toString();
    assert.equal(existsSync(marker), false);
    assert.equal(out.trim(), hostile);
    rmSync(dir, { recursive: true, force: true });
  });

  test('dollar expansion is inert', () => {
    const out = execSync(`echo ${shellQuote('$HOME and ${PATH}')}`, { stdio: 'pipe' }).toString();
    assert.equal(out.trim(), '$HOME and ${PATH}');
  });
});

suite('globToRegex', () => {
  test('* does not cross directory separators', () => {
    const re = globToRegex('src/*.ts');
    assert.ok(re.test('src/a.ts'));
    assert.ok(!re.test('src/sub/a.ts'));
  });

  test('**/ spans directories', () => {
    const re = globToRegex('**/*.test.mjs');
    assert.ok(re.test('a.test.mjs'));
    assert.ok(re.test('deep/nested/a.test.mjs'));
    assert.ok(!re.test('a.mjs'));
  });

  test('brace expansion', () => {
    const re = globToRegex('src/**/*.{ts,tsx}');
    assert.ok(re.test('src/a.ts'));
    assert.ok(re.test('src/x/y/b.tsx'));
    assert.ok(!re.test('src/a.js'));
  });

  test('? matches a single non-separator character', () => {
    const re = globToRegex('a?.md');
    assert.ok(re.test('ab.md'));
    assert.ok(!re.test('a/.md'));
    assert.ok(!re.test('abc.md'));
  });

  test('regex metacharacters in globs are literal', () => {
    const re = globToRegex('a+b.(x).md');
    assert.ok(re.test('a+b.(x).md'));
    assert.ok(!re.test('aab.(x).md'));
  });
});
