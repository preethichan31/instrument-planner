// Runs the TypeScript snippets for real (via tsx) against a local mock LLM + mock Openlayer, and checks traces arrive.
// Needs:  npm install --prefix tests/instrument/ts
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const P = require('../../public/instrument/snippets.js');
const tsDir = join(here, 'ts');
const tsx = join(tsDir, 'node_modules/.bin/tsx');
const KEY = 'test-key-123';
const PIPE = 'pipe-123';

function startMock() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let raw = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') raw = zlib.gunzipSync(raw);
      let body = {};
      try { body = JSON.parse(raw.toString() || '{}'); } catch { /* not json */ }
      const path = req.url.split('?')[0];
      seen.push({ path, headers: req.headers, body });
      const send = (obj) => { const b = JSON.stringify(obj); res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) }); res.end(b); };
      if (path.endsWith('/chat/completions')) {
        const tools = body.tools || [];
        const hasToolResult = (body.messages || []).some((m) => m.role === 'tool');
        const base = { id: 'c1', object: 'chat.completion', created: 1, model: body.model || 'gpt-4o-mini', usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } };
        if (tools.length && !hasToolResult) {
          const props = Object.keys(tools[0].function.parameters?.properties || {});
          return send({ ...base, choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: tools[0].function.name, arguments: JSON.stringify(props[0] ? { [props[0]]: 'A100' } : {}) } }] } }] });
        }
        return send({ ...base, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'A100' } }] });
      }
      if (path.includes(':generateContent')) {
        return send({ candidates: [{ content: { role: 'model', parts: [{ text: 'A100' }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 } });
      }
      return send({ success: true });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

const RUNTIME_PRELUDE = {
  rag: "const searchIndex = { async search(_q: string, _o: { topK: number }) { return ['Refunds take 5 business days.', 'Orders ship in 2 days.']; } };\n",
  agent: "const ordersApi = { async get(id: string) { return { order_id: id, status: 'shipped' }; } };\n",
  single: '',
};

const CASES = [
  { fw: 'direct', prov: 'openai', pattern: 'single' },
  { fw: 'direct', prov: 'openai', pattern: 'rag', names: ['retrieve'] },
  { fw: 'direct', prov: 'openai', pattern: 'agent', names: ['lookupOrder'] },
  { fw: 'direct', prov: 'gemini', pattern: 'single' },
  { fw: 'langchain', prov: 'openai', pattern: 'single' },
  { fw: 'direct', prov: 'openai', pattern: 'single', where: 'onprem', host: 'ol.acme.com' },
];

// Async on purpose: the mock server lives in this process, so it must keep serving while the child runs.
function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, opts);
    let stdout = '', stderr = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 120000);
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

function names(obj, out = []) {
  if (Array.isArray(obj)) obj.forEach((v) => names(v, out));
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { if (k === 'name' && typeof v === 'string') out.push(v); names(v, out); }
  return out;
}

test('typescript: snippets execute and deliver traces', { skip: !existsSync(tsx) && 'run: npm install --prefix tests/instrument/ts' }, async () => {
  const { server, seen, base } = await startMock();
  const dir = join(tsDir, 'run');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const failures = [];
  try {
    for (const c of CASES) {
      const s = P.sanitize({ how: 'own', lang: 'typescript', ...c });
      const plan = P.buildPlan(s);
      const id = `${c.fw}-${c.prov}-${c.pattern}${c.where ? '-onprem' : ''}`;
      seen.length = 0;
      const t = plan.test;
      const driverArg = c.pattern === 'agent' ? 'Where is order A100?' : 'What is the refund policy?';
      const file = join(dir, `${id}.mts`);
      writeFileSync(file, `${RUNTIME_PRELUDE[c.pattern]}\n${t.code}\nconst __r = await ${t.entry}(${JSON.stringify(driverArg)});\nconsole.log('RESULT', JSON.stringify(__r));\nawait new Promise((r) => setTimeout(r, 1500));\n`);
      const env = {
        PATH: process.env.PATH, HOME: process.env.HOME, NO_PROXY: '127.0.0.1',
        OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: base + '/llm/v1', GOOGLE_AI_API_KEY: 'g-test', GOOGLE_GEMINI_BASE_URL: base + '/llm',
        OPENLAYER_API_KEY: KEY, OPENLAYER_INFERENCE_PIPELINE_ID: PIPE,
        // Cloud snippets: the SDK's default host is swapped for the mock. On-prem: the planner's own OPENLAYER_BASE_URL line is used.
        OPENLAYER_BASE_URL: base + '/v1',
      };
      if (c.where === 'onprem') {
        const line = (plan.change.envText.match(/^OPENLAYER_BASE_URL=(.*)$/m) || [])[1];
        assert.ok(line && line.endsWith('/v1'), 'on-prem env block must set OPENLAYER_BASE_URL ending in /v1');
      }
      const r = await run(tsx, [file], { cwd: tsDir, env });
      const posts = seen.filter((x) => x.path.endsWith(`/inference-pipelines/${PIPE}/data-stream`));
      const problems = [];
      if (r.status !== 0) problems.push(`exit ${r.status}: ${(r.stderr || '').slice(-800)}`);
      else if (!posts.length) problems.push(`no data-stream POST (saw ${seen.map((x) => x.path).join(', ')}) ${r.stderr.slice(-400)}`);
      else {
        const got = names(posts[0].body);
        if (posts[0].headers.authorization !== `Bearer ${KEY}`) problems.push('Authorization header was ' + posts[0].headers.authorization);
        for (const want of c.names || []) if (!got.some((n) => n.toLowerCase().includes(want.toLowerCase()))) problems.push(`expected a step like ${want}; got ${got}`);
        console.log(`   ✔ ${id}  steps: ${got.join(', ')}`);
      }
      if (problems.length) { console.log(`   ✖ ${id}`); failures.push(`${id}: ${problems.join('; ')}`); }
    }
  } finally {
    server.close();
  }
  assert.deepEqual(failures, []);
});
