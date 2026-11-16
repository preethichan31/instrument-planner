// TypeScript checks: every TypeScript snippet (before AND after) type-checks against the real published packages.
// Needs:  npm install --prefix tests/instrument/ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allStates } from './combos.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const P = require('../../public/instrument/snippets.js');
const tsDir = join(here, 'ts');
const tsc = join(tsDir, 'node_modules/.bin/tsc');

export function tsJobs() {
  const jobs = [];
  const seen = new Set();
  for (const s of allStates(P)) {
    const plan = P.buildPlan(s);
    if (!plan.test || plan.test.lang !== 'typescript') continue;
    const key = plan.test.code + plan.test.prelude;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = `${s.fw}-${s.prov}-${s.pattern}`;
    jobs.push({ id, after: plan.test.code, before: plan.change.kind === 'diff' ? P.beforeCode(plan.change.lines) : null, prelude: plan.test.prelude || '', state: s, plan });
  }
  return jobs;
}

test('typescript: every snippet type-checks against the real packages', { skip: !existsSync(tsc) && 'run: npm install --prefix tests/instrument/ts' }, () => {
  const jobs = tsJobs();
  assert.ok(jobs.length >= 8, 'expected TypeScript snippets, got ' + jobs.length);
  const out = join(tsDir, 'snippets');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const j of jobs) {
    // `export {}` makes each file a module, so the stand-in `declare const` lines in one file do not clash with another.
    writeFileSync(join(out, `${j.id}.after.ts`), `${j.prelude}\n${j.after}\nexport {};\n`);
    if (j.before) writeFileSync(join(out, `${j.id}.before.ts`), `${j.prelude}\n${j.before}\nexport {};\n`);
  }
  const r = spawnSync(tsc, ['-p', join(tsDir, 'tsconfig.json')], { encoding: 'utf8', cwd: tsDir, timeout: 10 * 60 * 1000 });
  console.log(`  type-checked ${jobs.length} TypeScript snippets (+ their "before" versions)`);
  assert.equal(r.status, 0, 'tsc errors:\n' + r.stdout.slice(0, 6000) + r.stderr.slice(0, 2000));
});
