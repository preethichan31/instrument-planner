// Python checks: syntax, import resolution against real installed SDKs, and real execution against mock servers.
// Needs the venv:  python3 -m venv tests/instrument/.venv && tests/instrument/.venv/bin/pip install -r tests/instrument/requirements.txt
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allStates, runnableStates } from './combos.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const P = require('../../public/instrument/snippets.js');
const py = join(here, '.venv/bin/python');

const idOf = (s) => {
  if (s.how === 'gateway') return `gateway:${s.gateway}`;
  if (s.pattern === 'ml') return `ml:${s.mlTask}${s.where === 'onprem' ? ':onprem' : ''}`;
  return `${s.lang}:${s.fw}:${s.prov}:${s.pattern}${s.where === 'onprem' ? ':onprem' : ''}`;
};

// Test-only shims so real client libraries talk to the mock server. None of this is shown to users.
function testPrelude(s) {
  if (s.fw === 'openai-agents') {
    return 'from agents import set_default_openai_api\nfrom agents.tracing import set_trace_processors\nset_default_openai_api("chat_completions")\nset_trace_processors([])  # keep the default OpenAI exporter off the network\n';
  }
  if (s.how === 'gateway' && s.gateway === 'portkey') {
    return 'import os, portkey_ai\n_orig = portkey_ai.Portkey.__init__\ndef _init(self, *a, **k):\n    k.setdefault("base_url", os.environ["PORTKEY_BASE_URL"] + "/v1")\n    _orig(self, *a, **k)\nportkey_ai.Portkey.__init__ = _init\n';
  }
  return '';
}

function render(s) {
  const plan = P.buildPlan(s);
  if (!plan.test || plan.test.lang !== 'python') return null;
  const c = plan.change;
  return {
    id: idOf(s),
    code: plan.test.code,
    before: c.kind === 'diff' ? P.beforeCode(c.lines) : null,
    prelude: testPrelude(s) + (plan.test.prelude || ''),
    entry: plan.test.entry,
    async: plan.test.async,
    otel: plan.test.otel,
    ml: plan.test.ml,
    pattern: s.pattern,
    envText: c.envText || '',
  };
}

function expectations(s, j) {
  if (s.pattern === 'ml') return { expectKeys: ['config'], minSteps: 0 };
  if (j.otel) return {};
  const direct = s.fw === 'direct' || s.how === 'gateway';
  const e = { minSteps: s.pattern === 'single' ? 1 : 2 };
  if (s.fw === 'claude-agent-sdk') return { claude: true };
  if (direct && s.pattern === 'rag' && s.how === 'own') { e.expectNames = ['retrieve']; e.expectKeys = ['context']; }
  if (direct && s.pattern === 'agent' && s.how === 'own') e.expectNames = ['lookup_order'];
  return e;
}

test('python: syntax, imports and execution', { skip: !existsSync(py) && 'Python venv not set up (see header of this file)' }, () => {
  const all = allStates(P).map(render).filter(Boolean);
  const seen = new Set();
  const uniqueAll = all.filter((j) => (seen.has(j.code + j.prelude) ? false : (seen.add(j.code + j.prelude), true)));
  const run = runnableStates(P).map((s) => {
    const j = render(s);
    return j && { ...j, ...expectations(s, j) };
  }).filter(Boolean);
  const dir = mkdtempSync(join(tmpdir(), 'instrument-'));
  const file = join(dir, 'jobs.json');
  writeFileSync(file, JSON.stringify({ all: uniqueAll, run }));
  const only = process.env.INSTRUMENT_ONLY ? [process.env.INSTRUMENT_ONLY] : [];
  const r = spawnSync(py, [join(here, 'check_python.py'), file, ...only], { encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const rows = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  const bad = rows.filter((x) => !x.ok);
  const executed = rows.filter((x) => x.check === 'execute');
  console.log(`  ${rows.length} python checks (${uniqueAll.length} distinct snippets parsed, ${executed.length} executed)`);
  for (const x of executed) console.log(`   ${x.ok ? '✔' : '✖'} ${x.id}  ${x.ok ? x.detail.slice(0, 110).replace(/\n/g, ' ') : ''}`);
  if (r.status !== 0 && !rows.length) assert.fail('checker crashed:\n' + r.stderr.slice(-2000));
  if (!only.length) assert.equal(executed.length, run.length, 'every runnable snippet must report a result');
  if (process.env.INSTRUMENT_VERBOSE) for (const x of bad) console.log(`\n--- ${x.id} [${x.check}]\n${x.detail}`);
  assert.deepEqual(bad.map((x) => `${x.id} [${x.check}]\n${x.detail}`), []);
});
