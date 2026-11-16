// Structural tests for the Instrumentation Planner's data file (public/instrument/snippets.js).
// Fast, offline. Run: npm run test:instrument   (or: node --test tests/instrument/plans.test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { allStates } from './combos.mjs';

const require = createRequire(import.meta.url);
const P = require('../../public/instrument/snippets.js');

const states = allStates(P);

test('every reachable combination builds a complete plan', () => {
  assert.ok(states.length >= 100, 'expected a large matrix, got ' + states.length);
  for (const s of states) {
    const plan = P.buildPlan(s);
    const id = JSON.stringify(s);
    for (const k of ['headline', 'change', 'scene', 'safety', 'verify', 'card', 'changeSummary']) {
      assert.ok(plan[k], `${k} missing for ${id}`);
    }
    assert.ok(plan.safety.left.length && plan.safety.right.length, 'safety columns empty for ' + id);
    assert.ok(plan.verify.length >= 3, 'verify steps for ' + id);
    assert.ok(plan.scene.chain.length >= 1, 'scene chain for ' + id);
  }
});

test('Step 4 (the CI gate) never appears anywhere', () => {
  for (const s of states) {
    const text = JSON.stringify(P.buildPlan(s)).toLowerCase();
    assert.ok(!/ci gate|ci\/cd gate|step 4|block(s)? the merge|pull request check/.test(text), 'CI gate text for ' + JSON.stringify(s));
  }
});

test('diff lines are well-formed and the badge matches the diff', () => {
  for (const s of states) {
    const plan = P.buildPlan(s);
    const c = plan.change;
    if (c.kind !== 'diff') continue;
    const added = c.lines.filter((l) => l.t === '+' && l.s.trim() !== '').length;
    const removed = c.lines.filter((l) => l.t === '-').length;
    assert.equal(c.added, added, 'added count ' + JSON.stringify(s));
    assert.equal(c.removed, removed, 'removed count ' + JSON.stringify(s));
    assert.ok(added > 0, 'a code change must add lines: ' + JSON.stringify(s));
    const code = P.afterCode(c.lines);
    assert.ok(!/\t/.test(code), 'tabs in snippet ' + JSON.stringify(s));
    if (plan.route === 'init') {
      assert.ok(plan.changeSummary.includes('about ' + added + ' line'), 'badge ' + plan.changeSummary);
      assert.match(plan.changeSummary, /^1 command/);
    } else {
      assert.ok(plan.changeSummary.includes('+' + added), 'badge ' + plan.changeSummary);
      assert.match(plan.changeSummary, /env var/);
    }
    assert.ok(plan.changeSummary.length <= 35, 'badge must fit the diagram box: ' + plan.changeSummary);
  }
});

test('default RAG path: openlayer init leads; by hand still matches the brief (+6 lines, 2 env vars)', () => {
  assert.equal(P.buildPlan({}).route, 'init');
  assert.equal(P.buildPlan({}).changeSummary, '1 command · about 6 lines added');
  assert.equal(P.buildPlan({ route: 'hand' }).changeSummary, '+6 lines · 2 env vars');
});

test('openlayer init is offered only where a coding agent can write the change', () => {
  for (const s of states) {
    const plan = P.buildPlan(s);
    const id = JSON.stringify(s);
    const sdkCode = plan.change.kind === 'diff' && !!plan.test && !plan.test.otel;
    assert.equal(!!plan.route, sdkCode, 'route offered on the wrong path: ' + id);
    assert.equal(!!plan.routes, sdkCode, 'tabs on the wrong path: ' + id);
    assert.equal(!!plan.change.wizard, plan.route === 'init', 'wizard block: ' + id);
    if (!plan.route) assert.ok(!/route=/.test(P.toQuery(s)), 'route in the link where it does not apply: ' + id);
  }
  assert.equal(P.buildPlan({ how: 'otel' }).route, null);
  assert.equal(P.buildPlan({ fw: 'semantic-kernel' }).route, null);
  assert.equal(P.buildPlan({ how: 'vendor' }).route, null);
  assert.equal(P.buildPlan({ how: 'gateway', gateway: 'openlayer-gateway' }).route, null);
  assert.equal(P.buildPlan({ how: 'gateway', gateway: 'portkey' }).route, 'init');
  assert.equal(P.buildPlan({ pattern: 'ml' }).route, 'init');
  assert.equal(P.sanitize({ route: 'nope' }).route, 'init');
  assert.equal(P.fromQuery('?route=hand').route, 'hand');
  assert.equal(P.toQuery({ route: 'hand' }), 'route=hand');
});

test('both routes show the same tested snippet; only the delivery differs', () => {
  for (const s of states) {
    if (!P.routeApplies(s)) continue;
    const init = P.buildPlan({ ...s, route: 'init' });
    const hand = P.buildPlan({ ...s, route: 'hand' });
    const id = JSON.stringify(s);
    assert.deepEqual(init.change.lines, hand.change.lines, 'reference diff differs from the by-hand diff: ' + id);
    assert.deepEqual(init.test, hand.test, 'tested code differs: ' + id);
    assert.equal(init.change.install, hand.change.install);
    assert.equal(init.change.envFile, '.env.openlayer');
    assert.equal(hand.change.envFile, '.env');
    const keys = (t) => t.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]);
    assert.deepEqual(keys(init.change.envText), keys(hand.change.envText), 'the wizard file and the by-hand .env must set the same variables: ' + id);
    const w = init.change.wizard;
    assert.equal(w.run, 'cd my-ai-app\nopenlayer init');
    assert.ok(w.installs.length >= 5 && w.installs.every((i) => i.id && i.label && /downloads\.openlayer\.com\/cli\/install\//.test(i.cmd)));
    const picks = JSON.stringify(w.picks);
    for (const k of ['monitoring', 'builtin', 'own', 'manual']) assert.ok(picks.includes(P.CLI.labels[k]), `wizard picks must name "${P.CLI.labels[k]}": ${id}`);
    assert.ok(picks.includes(s.where === 'onprem' ? P.CLI.labels.onprem : P.CLI.labels.saas), 'sign-in pick: ' + id);
    if (s.where === 'onprem') assert.ok(picks.includes('https://ol.acme.com`'), 'on-prem pick shows the host without /v1: ' + id);
    assert.match(JSON.stringify(init.verify), /openlayer init/);
    assert.match(JSON.stringify(init.safety), /Who edits the code/);
    assert.ok(!/Who edits the code/.test(JSON.stringify(hand.safety)));
    assert.match(init.card, /openlayer init/);
    assert.match(hand.card, /By hand/);
  }
});

test('wizard wording matches the openlayer-cli source (skipped when that repo is not checked out next to this one)', (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const cli = path.resolve(path.dirname(require('node:url').fileURLToPath(import.meta.url)), '../../../openlayer-cli/pkg');
  if (!fs.existsSync(path.join(cli, 'wizard'))) return t.skip('openlayer-cli not found at ' + cli);
  const read = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const src = read(path.join(cli, 'wizard')) + read(path.join(cli, 'config'));
  for (const [k, label] of Object.entries(P.CLI.labels)) assert.ok(src.includes('"' + label), `CLI no longer prints ${k}: "${label}"`);
  assert.ok(src.includes('"' + P.CLI.envFile + '"'), 'env file name changed in the CLI');
  for (const agent of P.CLI.agents.split(/, | or /)) assert.ok(new RegExp(agent.replace(' CLI', ''), 'i').test(read(path.join(cli, 'wizard', 'agent'))), 'agent no longer supported: ' + agent);
});

test('env block: 2 vars on cloud, 3 on-prem, no real secrets, on-prem URL ends in /v1', () => {
  for (const s of states) {
    const plan = P.buildPlan(s);
    if (plan.change.kind === 'checklist') continue;
    const env = plan.change.envText || '';
    if (!env) continue;
    assert.ok(!/sk-[A-Za-z0-9]{10,}/.test(env), 'looks like a real key');
    const lines = env.split('\n').filter((l) => /^[A-Z_]+=/.test(l));
    if (s.how === 'otel' && s.otelVia === 'collector') {
      // The Collector takes the address in its YAML, not from OPENLAYER_BASE_URL.
      const endpoint = plan.change.lines.find((l) => /endpoint:/.test(l.s)).s;
      assert.match(endpoint, s.where === 'onprem' ? /https:\/\/ol\.acme\.com\/v1\/otel$/ : /https:\/\/api\.openlayer\.com\/v1\/otel$/, 'collector endpoint: ' + JSON.stringify(s));
      continue;
    }
    if (plan.change.kind === 'diff' || plan.change.kind === 'env') {
      const wantsBase = s.where === 'onprem' && /OPENLAYER_BASE_URL/.test(env);
      if (s.where === 'onprem' && !/OTEL_/.test(env)) {
        assert.ok(wantsBase, 'on-prem needs OPENLAYER_BASE_URL: ' + JSON.stringify(s));
        const base = lines.find((l) => l.startsWith('OPENLAYER_BASE_URL='));
        assert.match(base, /\/v1$/, 'base url must end in /v1');
      }
      if (s.where === 'cloud') assert.ok(!/OPENLAYER_BASE_URL/.test(env), 'no base url on cloud');
    }
  }
});

test('normalizeBaseUrl: adds /v1, strips duplicates, keeps scheme, rejects junk', () => {
  const n = P.normalizeBaseUrl;
  assert.equal(n('ol.acme.com').url, 'https://ol.acme.com/v1');
  assert.equal(n('https://ol.acme.com/').url, 'https://ol.acme.com/v1');
  assert.equal(n('https://ol.acme.com/v1').url, 'https://ol.acme.com/v1');
  assert.equal(n('https://ol.acme.com/v1/').url, 'https://ol.acme.com/v1');
  assert.equal(n('  http://10.0.0.5:9000  ').url, 'http://10.0.0.5:9000/v1');
  assert.equal(n('https://ol.acme.com/api/').url, 'https://ol.acme.com/api/v1');
  assert.equal(n('ol.acme.com').host, 'ol.acme.com');
  for (const bad of ['', '   ', 'ftp://x.com', 'has space.com', 'javascript:alert(1)']) assert.equal(n(bad).ok, false, 'should reject: ' + JSON.stringify(bad));
  assert.match(n('ol.acme.com').hint, /\/v1/);
});

test('sanitize forces valid combinations', () => {
  const s = P.sanitize;
  assert.equal(s({ lang: 'typescript', fw: 'openai-agents' }).fw, 'direct');
  assert.equal(s({ lang: 'typescript', fw: 'semantic-kernel' }).fw, 'direct');
  assert.equal(s({ lang: 'typescript', fw: 'direct', prov: 'azure' }).prov, 'openai');
  assert.equal(s({ fw: 'langchain', prov: 'gemini' }).prov, 'openai');
  assert.equal(s({ fw: 'claude-agent-sdk', prov: 'openai' }).prov, 'anthropic');
  assert.equal(s({ lang: 'java' }).lang, 'python');
  assert.equal(s({ lang: 'go' }).lang, 'python');
  assert.equal(s({ lang: 'ruby' }).lang, 'python');
  assert.equal(s({ fw: 'llamaindex' }).fw, 'direct', 'LlamaIndex is not offered');
  assert.equal(s({ pattern: 'ml', lang: 'typescript' }).lang, 'python');
  assert.equal(s({ pattern: 'ml', how: 'vendor' }).how, 'own');
  assert.deepEqual(s({ pattern: 'ml', worries: ['hallucination', 'drift'] }).worries.includes('hallucination'), false);
  assert.equal(s({ how: 'nope', pattern: 'nope', where: 'nope' }).where, 'cloud');
  assert.equal(s({ how: 'nope' }).how, 'own');
});

test('only Python and TypeScript are offered', () => {
  assert.deepEqual(P.LANGS.map((l) => l.id), ['python', 'typescript']);
});

test('share link round-trips every state and strips defaults', () => {
  assert.equal(P.toQuery({}), '');
  for (const s of states) {
    const clean = P.sanitize(s);
    const q = P.toQuery(clean);
    const back = P.fromQuery('?' + q);
    // Choices that do not apply to the chosen path are intentionally dropped; compare what the plan shows.
    assert.deepEqual(P.buildPlan(back).card, P.buildPlan(clean).card, 'round trip changed the card: ' + q);
    for (const k of new URLSearchParams(q).keys()) assert.ok(!/key|token|secret|password/i.test(k), 'secret-like parameter in URL: ' + k);
    assert.ok(!/sk-[A-Za-z0-9]{10,}|Bearer /.test(q), 'secrets must never be in the URL');
  }
  assert.equal(P.fromQuery('?pat=bogus&lang=cobol&fw=zzz').pattern, 'rag');
});

test('use case card text names the key choices', () => {
  const plan = P.buildPlan({ name: 'Support bot', pattern: 'rag', where: 'onprem', host: 'ol.acme.com', worries: ['hallucination'], pii: true, run: 'no' });
  assert.match(plan.card, /Support bot/);
  assert.match(plan.card, /ol\.acme\.com\/v1/);
  assert.match(plan.card, /hallucination/i);
});

test('Plan B (no session access) promises delayed traces; Plan A verifies live', () => {
  const a = P.buildPlan({ run: 'yes' });
  const b = P.buildPlan({ run: 'no' });
  assert.ok(!/next dev deploy/i.test(JSON.stringify(a.verify)));
  assert.match(JSON.stringify(b.verify), /next dev deploy/i);
});

test('every snippet that uses the SDK imports only documented paths', () => {
  const allowed = [
    /^openlayer\.lib(\.tracing|\.integrations(\.(langchain_callback|openai_agents))?)?$/,
    /^openlayer(\.types\.inference_pipelines)?$/,
    /^openlayer\/lib\/(integrations\/(openAiTracer|googleGenAiTracer|langchainCallback|claudeAgentSdk)|tracing\/tracer)$/,
  ];
  for (const s of states) {
    const plan = P.buildPlan(s);
    if (!plan.test) continue;
    const code = plan.test.code;
    const mods = [...code.matchAll(/from ['"]?(openlayer[\w./]*)['"]?\s+import|import .* from ['"](openlayer[^'"]*)['"]|^import (openlayer[\w.]*)/gm)].map((m) => m[1] || m[2] || m[3]);
    for (const m of mods) assert.ok(allowed.some((r) => r.test(m)), `undocumented import ${m} in ${JSON.stringify(s)}`);
  }
});

test('every option the page offers is accepted by sanitize (page <-> data contract)', () => {
  // index.html iterates these lists: arrays with .id, or objects keyed by id. A mismatch silently ignores clicks.
  const arrays = { pattern: P.PATTERNS, how: P.HOWS, lang: P.LANGS, mlTask: P.ML_TASKS, otelVia: P.OTEL_VIA, alert: P.ALERTS, route: P.ROUTES };
  for (const [key, list] of Object.entries(arrays)) {
    assert.ok(Array.isArray(list), `${key} list must be an array of {id,label}`);
    for (const item of list) {
      assert.ok(item.id && item.label, `${key} item needs id and label`);
      const state = { pattern: key === 'mlTask' ? 'ml' : 'rag', [key]: item.id };
      assert.equal(P.sanitize(state)[key], item.id, `${key}=${item.id} was rejected`);
    }
  }
  const objects = { vendor: P.VENDORS, gateway: P.GATEWAYS, table: P.TABLES };
  for (const [key, obj] of Object.entries(objects)) {
    assert.ok(!Array.isArray(obj), `${key} list must be an object keyed by id`);
    for (const [id, v] of Object.entries(obj)) {
      assert.ok(v.label, `${key}.${id} needs a label`);
      assert.equal(P.sanitize({ [key]: id })[key], id, `${key}=${id} was rejected`);
    }
  }
  for (const [fw, f] of Object.entries(P.FRAMEWORKS)) {
    assert.ok(f.label);
    for (const [lang, provs] of Object.entries(f.langs)) {
      for (const prov of provs) {
        assert.ok(P.PROVIDERS[prov] && P.PROVIDERS[prov].label, `provider ${prov} needs a label`);
        const s = P.sanitize({ lang, fw, prov });
        assert.deepEqual([s.lang, s.fw, s.prov], [lang, fw, prov], `${lang}/${fw}/${prov} was rejected`);
      }
    }
  }
  for (const w of P.WORRIES) assert.ok(w.id && w.label && w.checks.length, 'worry needs id, label and checks');
});
