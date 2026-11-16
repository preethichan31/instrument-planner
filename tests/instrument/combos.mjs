// The matrix of choices every test walks. Keep in sync with the planner's questions.
export function allStates(P) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const clean = P.sanitize(s);
    const key = JSON.stringify(clean);
    if (!seen.has(key)) { seen.add(key); out.push(clean); }
  };
  const wheres = [{ where: 'cloud' }, { where: 'onprem', host: 'ol.acme.com' }];
  const runs = ['yes', 'no'];
  for (const pattern of ['rag', 'agent', 'single']) {
    for (const lang of P.LANGS.map((l) => l.id)) {
      for (const [fw, f] of Object.entries(P.FRAMEWORKS)) {
        for (const prov of f.langs[lang] || []) {
          for (const w of wheres) for (const run of runs) add({ how: 'own', pattern, lang, fw, prov, run, ...w });
        }
      }
    }
    for (const via of P.OTEL_VIA.map((v) => v.id)) for (const w of wheres) add({ how: 'otel', pattern, otelVia: via, ...w });
    for (const vendor of Object.keys(P.VENDORS)) for (const w of wheres) for (const run of runs) add({ how: 'vendor', pattern, vendor, run, ...w });
    for (const gateway of Object.keys(P.GATEWAYS)) for (const w of wheres) add({ how: 'gateway', pattern, gateway, ...w });
    for (const table of Object.keys(P.TABLES)) for (const w of wheres) add({ how: 'table', pattern, table, ...w });
  }
  for (const mlTask of P.ML_TASKS.map((t) => t.id)) {
    for (const how of ['own', 'table']) for (const w of wheres) for (const run of runs) add({ pattern: 'ml', how, mlTask, run, ...w });
  }
  // Wherever `openlayer init` applies, the same choices must also work by hand (the default route is `init`).
  for (const s of [...out]) if (P.routeApplies(s)) add({ ...s, route: 'hand' });
  // A few with every toggle on.
  for (const s of [...out.slice(0, 40)]) add({ ...s, pii: true, worries: P.WORRIES.map((w) => w.id), alert: 'email' });
  return out;
}

// Snippets that are actually executed against mock servers (Python) – one per distinct code path.
export function runnableStates(P) {
  const o = [];
  // Executed with the by-hand env block: that is the one a person fills in. With `openlayer init` the CLI writes the same
  // variables itself (plans.test.mjs checks the names match), and the snippet under test is identical on both routes.
  const hand = (s) => P.sanitize({ ...s, route: 'hand' });
  const own = (pattern, fw, prov, lang = 'python') => o.push(hand({ how: 'own', pattern, fw, prov, lang }));
  for (const pattern of ['single', 'rag', 'agent']) {
    own(pattern, 'direct', 'openai');
    own(pattern, 'langchain', 'openai');
    own(pattern, 'openai-agents', 'openai');
    own(pattern, 'semantic-kernel', 'openai');
  }
  for (const prov of ['azure', 'anthropic', 'gemini']) { own('single', 'direct', prov); own('rag', 'direct', prov); }
  own('single', 'langchain', 'anthropic');
  own('single', 'langchain', 'azure');
  // Semantic Kernel + Azure is syntax- and import-checked only: SK refuses a non-https endpoint, so it cannot reach the local mock.
  own('single', 'claude-agent-sdk', 'anthropic');
  o.push(hand({ how: 'gateway', gateway: 'portkey', pattern: 'single' }));
  o.push(hand({ how: 'gateway', gateway: 'litellm', pattern: 'single' }));
  o.push(hand({ how: 'own', pattern: 'ml', mlTask: 'classification' }));
  o.push(hand({ how: 'own', pattern: 'ml', mlTask: 'regression' }));
  o.push(hand({ how: 'own', pattern: 'single', where: 'onprem', host: 'ol.acme.com' }));
  return o;
}
