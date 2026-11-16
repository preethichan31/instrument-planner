/*
 * Instrumentation Planner: content + snippet data.
 *
 * OWNER:   FDE team (Preethi). Update this file whenever an Openlayer SDK, integration doc or
 *          the on-prem SDK guidance changes. Snippets are the product here: one wrong snippet
 *          costs more trust than the tool earns.
 * SOURCES: openlayer-docs/monitoring/{instrument,context,pii-redaction,publishing-tabular-predictions}.mdx
 *          openlayer-docs/integrations/*.mdx (per-framework pages)
 *          openlayer-python/src/openlayer/lib, openlayer-ts/src/lib, and their examples/
 *          openlayer-onpremise/README.md  ("Pointing the SDKs at your deployment")
 *          openlayer-docs/api-reference/cli/{overview,commands/init}.mdx and openlayer-cli/pkg/wizard
 *          (the `openlayer init` route: install commands, the wizard's option labels, .env.openlayer)
 *          openlayer-skills/skills/openlayer (what the wizard's coding agent is told to do)
 *          Do NOT generate from fde-hub/sources/public-docs: its sync strips "BASE_URL" out of
 *          OPENLAYER_BASE_URL.
 * TESTS:   tests/instrument  (npm run test:instrument). Every snippet is rendered, syntax-checked,
 *          import-checked, and (Python) executed against a mock Openlayer + mock LLM server.
 *
 * No DOM access in this file. It is loaded as a plain <script> in the browser (window.OLPlanner)
 * and require()d by the Node tests, so every combination can be built and checked headlessly.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OLPlanner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SDK_VERSIONS = { python: '0.36', typescript: '0.33' };
  const CLOUD_HOST = 'api.openlayer.com';
  const CLOUD_BASE = 'https://api.openlayer.com/v1';
  const DOCS = 'https://www.openlayer.com/docs';

  // ───────────────────────── Option catalogs ─────────────────────────
  const PATTERNS = [
    { id: 'rag', label: 'RAG', sub: 'Retrieves documents, then answers', icon: '📚' },
    { id: 'agent', label: 'Agent with tools', sub: 'Decides and calls tools', icon: '🛠️' },
    { id: 'single', label: 'Single LLM call', sub: 'One prompt in, one answer out', icon: '💬' },
    { id: 'ml', label: 'Classic ML', sub: 'Tabular model, no LLM', icon: '📈' },
  ];
  const HOWS = [
    { id: 'own', label: 'Own code', sub: 'You call the SDK or a framework', icon: '👩‍💻' },
    { id: 'otel', label: 'OpenTelemetry', sub: 'You already emit OTel traces', icon: '🔭' },
    { id: 'vendor', label: 'Vendor product', sub: 'Copilot, Agentforce, Dialogflow…', icon: '🏢' },
    { id: 'gateway', label: 'LLM gateway', sub: 'Traffic goes through a gateway', icon: '🚪' },
    { id: 'table', label: 'Logs in a table', sub: 'BigQuery, Snowflake, Databricks', icon: '🗄️' },
  ];
  const LANGS = [
    { id: 'python', label: 'Python', icon: '🐍' },
    { id: 'typescript', label: 'TypeScript', icon: '🟦' },
  ];
  const PROVIDERS = {
    openai: { label: 'OpenAI', host: 'api.openai.com', model: 'gpt-4o-mini', modelLabel: 'OpenAI Chat Completion' },
    azure: { label: 'Azure OpenAI', host: '*.openai.azure.com', model: 'gpt-4o-mini', modelLabel: 'Azure OpenAI Chat Completion' },
    anthropic: { label: 'Anthropic', host: 'api.anthropic.com', model: 'claude-haiku-4-5', modelLabel: 'Anthropic Message' },
    gemini: { label: 'Google Gemini', host: 'generativelanguage.googleapis.com', model: 'gemini-2.5-flash', modelLabel: 'Gemini generate_content' },
  };
  // framework → language → providers it supports. The matrix is the source of truth for which options
  // appear: a combination that has no documented Openlayer integration is simply not offered.
  const FRAMEWORKS = {
    direct: { label: 'Direct SDK', sub: 'Provider client, no framework', langs: { python: ['openai', 'azure', 'anthropic', 'gemini'], typescript: ['openai', 'gemini'] } },
    langchain: { label: 'LangChain / LangGraph', sub: 'Callback handler', langs: { python: ['openai', 'azure', 'anthropic'], typescript: ['openai', 'anthropic'] } },
    'openai-agents': { label: 'OpenAI Agents SDK', sub: 'Tracing processor', langs: { python: ['openai'] } },
    'semantic-kernel': { label: 'Semantic Kernel', sub: 'OpenTelemetry via OpenLIT', langs: { python: ['openai', 'azure'] } },
    'claude-agent-sdk': { label: 'Claude Agent SDK', sub: 'Drop-in tracing', langs: { python: ['anthropic'], typescript: ['anthropic'] } },
  };
  const VENDORS = {
    'copilot-studio': { label: 'Copilot Studio', icon: '🪁' },
    'm365-copilot': { label: 'Microsoft 365 Copilot', icon: '🟦' },
    agentforce: { label: 'Salesforce Agentforce', icon: '☁️' },
    'dialogflow-cx': { label: 'Dialogflow CX', icon: '🗣️' },
    'claude-code': { label: 'Claude Code', icon: '⌨️' },
  };
  const GATEWAYS = {
    'openlayer-gateway': { label: 'Openlayer Gateway', icon: '🚪' },
    portkey: { label: 'Portkey', icon: '🔑' },
    litellm: { label: 'LiteLLM', icon: '🧩' },
  };
  const TABLES = {
    bigquery: { label: 'BigQuery', icon: '🟦' },
    snowflake: { label: 'Snowflake', icon: '❄️' },
    databricks: { label: 'Databricks', icon: '🧱' },
  };
  const OTEL_VIA = [
    { id: 'sdk', label: 'App exports directly' },
    { id: 'collector', label: 'Via an OTel Collector' },
  ];
  const ML_TASKS = [
    { id: 'classification', label: 'Classification' },
    { id: 'regression', label: 'Regression' },
  ];
  // How the code change gets made. `openlayer init` (the Openlayer CLI wizard) is the recommended route and the default;
  // "By hand" is the fallback. The wizard's own three choices (built-in agent / own agent / manual) are not a planner
  // question: the card explains which one to pick.
  const ROUTES = [
    { id: 'init', label: 'With `openlayer init`', tag: 'Recommended' },
    { id: 'hand', label: 'By hand', tag: '' },
  ];
  // Everything quoted from the CLI lives here. `labels` are the exact strings the wizard prints, and
  // tests/instrument/plans.test.mjs checks them against the openlayer-cli source when that repo is next to this one.
  const CLI = {
    minVersion: '1.13.0',
    docs: DOCS + '/api-reference/cli/commands/init',
    envFile: '.env.openlayer',
    agents: 'Claude Code, Codex, Copilot CLI or Gemini CLI',
    run: 'cd my-ai-app\nopenlayer init',
    installs: [
      { id: 'mac-arm', label: 'Mac (Apple silicon)', cmd: 'curl -o- "https://downloads.openlayer.com/cli/install/osx_arm64.sh" | sh' },
      { id: 'mac-intel', label: 'Mac (Intel)', cmd: 'curl -o- "https://downloads.openlayer.com/cli/install/osx_64.sh" | sh' },
      { id: 'linux-arm', label: 'Linux (Arm)', cmd: 'curl -o- "https://downloads.openlayer.com/cli/install/linux_arm64.sh" | sh' },
      { id: 'linux-x86', label: 'Linux (x86)', cmd: 'curl -o- "https://downloads.openlayer.com/cli/install/linux_64.sh" | sh' },
      { id: 'windows', label: 'Windows (x86)', cmd: 'powershell.exe -NoProfile -InputFormat None -ExecutionPolicy AllSigned -Command "[System.Net.ServicePointManager]::SecurityProtocol = 3072; iex ((New-Object System.Net.WebClient).DownloadString(\'https://downloads.openlayer.com/cli/install/windows_64.ps1\'))"' },
    ],
    labels: {
      saas: 'Openlayer SaaS', onprem: 'Self-hosted / on-prem', browser: 'Browser (recommended)',
      monitoring: 'Monitoring mode',
      builtin: 'Use built-in coding agent (recommended)', own: 'Use my own coding agent (copy a prompt)', manual: 'Set up manually (docs)',
      received: 'Traces received in Openlayer!', debug: 'Something went wrong — debug it with', skip: 'Skip verification',
      llm: 'LLM', classification: 'Tabular Classification', regression: 'Tabular Regression',
    },
  };
  // The wizard hands the edit to a coding agent that follows the Openlayer skill. The skill covers the SDK integrations
  // and tabular ML but has no OpenTelemetry guidance, so OTel paths stay by hand. No-code paths have nothing to automate.
  const routeApplies = (s) => (s.how === 'own' && s.fw !== 'semantic-kernel') || (s.how === 'gateway' && s.gateway !== 'openlayer-gateway');

  const ALERTS = [
    { id: 'slack', label: 'Slack', where: 'Workspace settings → Notifications (one shared channel)' },
    { id: 'email', label: 'Email', where: 'Account settings → Notifications (per person)' },
    { id: 'webhook', label: 'Webhook', where: 'Workspace settings → Webhooks' },
    { id: 'inapp', label: 'In-app only', where: 'Always on, nothing to set up' },
  ];

  const TEST_URL = (slug) => DOCS + '/tests/catalog/' + slug;
  // worries → starter checks. `ml: true` worries only appear for Classic ML, `llm: true` for LLM patterns.
  const WORRIES = [
    { id: 'hallucination', label: 'Made-up answers', llm: true, checks: [
      { name: 'Hallucination', slug: 'hallucination', why: 'Flags answers that state things the input and context do not support.' },
      { name: 'Faithfulness', slug: 'faithfulness', rag: true, why: 'Scores whether the answer sticks to the retrieved documents.' },
      { name: 'Context relevancy', slug: 'context-relevancy', rag: true, why: 'Checks the retriever returned documents that matter for the question.' }] },
    { id: 'pii', label: 'Personal data leaking', llm: true, checks: [
      { name: 'Contains PII', slug: 'contains-p-i-i', why: 'Counts traces whose input or output contains personal data.' }] },
    { id: 'injection', label: 'Prompt injection', llm: true, checks: [
      { name: 'Has prompt injection', slug: 'has-prompt-injection-count', why: 'Counts requests that try to override your instructions.' }] },
    { id: 'harm', label: 'Harmful or off-brand output', llm: true, checks: [
      { name: 'Harmfulness', slug: 'harmfulness', why: 'Scores toxic or unsafe answers.' },
      { name: 'Recommends competitor', slug: 'recommends-competitor', why: 'Catches answers that point users to a competitor.' }] },
    { id: 'cost', label: 'Cost spikes', llm: true, checks: [
      { name: 'Mean cost', slug: 'mean-cost', why: 'Alerts when the average cost per request creeps up.' },
      { name: 'Max cost', slug: 'max-cost', why: 'Catches a single runaway request.' }] },
    { id: 'latency', label: 'Slow responses', llm: true, checks: [
      { name: '95th latency percentile', slug: 'p95-latency', why: 'Tracks what your slowest 1 in 20 users experience.' }] },
    { id: 'stuck', label: 'Users getting stuck', llm: true, checks: [
      { name: 'Session goal achievement', slug: 'session-goal-achievement', why: 'Did the conversation get the user what they came for?', needs: 'Needs session IDs on your traces.' },
      { name: 'Session conversation completeness', slug: 'session-conversation-completeness', why: 'Were all of the user\'s questions answered?', needs: 'Needs session IDs on your traces.' }] },
    { id: 'drift', label: 'Data drift', ml: true, checks: [
      { name: 'Feature drift', slug: 'feature-drift-count', why: 'Counts features whose live distribution moved away from your baseline.', needs: 'Needs a reference dataset.' }] },
    { id: 'missing', label: 'Missing values', ml: true, checks: [
      { name: 'Features missing values', slug: 'features-missing-values', why: 'Counts features arriving with gaps.' }] },
    { id: 'stale', label: 'Stale data', ml: true, checks: [
      { name: 'Freshness', slug: 'freshness', why: 'Alerts when new rows stop arriving.' }] },
    { id: 'accuracy', label: 'Accuracy dropping', ml: true, checks: [
      { name: 'Accuracy', slug: 'accuracy', why: 'Tracks accuracy as ground truth arrives.', needs: 'Needs ground-truth labels, sent later.' }] },
  ];

  const DEFAULTS = {
    name: '', pattern: 'rag', how: 'own', lang: 'python', fw: 'direct', prov: 'openai',
    vendor: 'copilot-studio', gateway: 'openlayer-gateway', table: 'bigquery', otelVia: 'sdk', mlTask: 'classification',
    where: 'cloud', host: '', run: 'yes', worries: [], pii: false, alert: 'slack', route: 'init',
  };
  const WORRY_IDS = WORRIES.map((w) => w.id);

  // ───────────────────────── Helpers ─────────────────────────
  const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
  const pickId = (list, v, d) => (list.some((x) => x.id === v) ? v : d);

  /**
   * Turns whatever a person types into the API root the SDKs need: scheme + host (+ port/path) + "/v1".
   * "/v1" is the known stumbling point (the CLI stores the URL without it, the SDKs need it).
   */
  function normalizeBaseUrl(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: false, empty: true, url: '', origin: '', host: '', hint: '' };
    let scheme = 'https://';
    const m = s.match(/^(https?):\/\//i);
    if (m) { scheme = m[1].toLowerCase() + '://'; s = s.slice(m[0].length); }
    // ftp:// is caught here, and so is javascript:alert(1). A host:port such as ol.acme.com:9000 is not a scheme.
    else if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/:]+:\d+(?:\/|$)/.test(s)) return { ok: false, url: '', origin: '', host: '', hint: 'Use an http:// or https:// address.' };
    s = s.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/+$/, '');
    if (!s || /\s/.test(s) || /^\//.test(s)) return { ok: false, url: '', origin: '', host: '', hint: 'That does not look like a host name.' };
    const hadV1 = /\/v1\/?$/i.test(String(raw).trim().replace(/[?#].*$/, ''));
    let hint = hadV1 ? '' : '/v1 added: the SDKs need it.';
    if (scheme === 'http://') hint = (hint ? hint + ' ' : '') + 'Plain http: the default Nginx port is 9000, e.g. http://host:9000.';
    return { ok: true, url: scheme + s + '/v1', origin: scheme + s, host: s, hint };
  }

  function sanitize(input) {
    const s = Object.assign({}, DEFAULTS, input || {});
    s.name = String(s.name || '').slice(0, 80);
    s.pattern = pickId(PATTERNS, s.pattern, DEFAULTS.pattern);
    s.how = pickId(HOWS, s.how, DEFAULTS.how);
    if (s.pattern === 'ml' && !['own', 'table'].includes(s.how)) s.how = 'own';
    s.vendor = has(VENDORS, s.vendor) ? s.vendor : DEFAULTS.vendor;
    s.gateway = has(GATEWAYS, s.gateway) ? s.gateway : DEFAULTS.gateway;
    s.table = has(TABLES, s.table) ? s.table : DEFAULTS.table;
    s.otelVia = pickId(OTEL_VIA, s.otelVia, DEFAULTS.otelVia);
    s.mlTask = pickId(ML_TASKS, s.mlTask, DEFAULTS.mlTask);
    s.where = s.where === 'onprem' ? 'onprem' : 'cloud';
    s.host = String(s.host || '').slice(0, 200);
    s.run = s.run === 'no' ? 'no' : 'yes';
    s.pii = s.pii === true || s.pii === '1' || s.pii === 1;
    s.alert = pickId(ALERTS, s.alert, DEFAULTS.alert);
    // Kept as a preference even on paths where it does not apply, so switching paths and back does not reset it.
    s.route = pickId(ROUTES, s.route, DEFAULTS.route);
    const ws = Array.isArray(s.worries) ? s.worries : String(s.worries || '').split(',');
    const allowed = new Set(WORRIES.filter((w) => (s.pattern === 'ml' ? w.ml : w.llm)).map((w) => w.id));
    s.worries = WORRY_IDS.filter((id) => ws.includes(id) && allowed.has(id));
    // Own code: language → framework → provider must be a documented combination.
    s.lang = pickId(LANGS, s.lang, DEFAULTS.lang);
    if (s.pattern === 'ml') { s.lang = 'python'; s.fw = 'ml'; s.prov = ''; }
    else {
      if (!has(FRAMEWORKS, s.fw) || !FRAMEWORKS[s.fw].langs[s.lang]) s.fw = 'direct';
      const provs = FRAMEWORKS[s.fw].langs[s.lang];
      if (!provs.includes(s.prov)) s.prov = provs[0];
    }
    return s;
  }

  // Diff text: every line starts with '+' (added), '-' (removed) or ' ' (unchanged). Blank line = unchanged blank.
  function parseDiff(text) {
    return text.split('\n').map((line) => {
      if (line === '') return { t: ' ', s: '' };
      const c = line[0];
      if (c === '+' || c === '-' || c === ' ') return { t: c, s: line.slice(1) };
      throw new Error('Bad diff line (must start with + - or space): ' + JSON.stringify(line));
    });
  }
  const afterCode = (lines) => lines.filter((l) => l.t !== '-').map((l) => l.s).join('\n') + '\n';
  const beforeCode = (lines) => lines.filter((l) => l.t !== '+').map((l) => l.s).join('\n') + '\n';
  const countLines = (lines) => ({ added: lines.filter((l) => l.t === '+' && l.s.trim() !== '').length, removed: lines.filter((l) => l.t === '-').length });
  const join = (...parts) => parts.filter((p) => p !== null && p !== undefined).join('\n');

  // ───────────────────────── Python snippets ─────────────────────────
  const PY = {
    direct: {
      imports: { openai: ' import openai', azure: ' import openai', anthropic: ' import anthropic', gemini: ' import os\n from google import genai' },
      client: {
        openai: ' client = openai.OpenAI()',
        azure: ' client = openai.AzureOpenAI()  # reads AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, OPENAI_API_VERSION',
        anthropic: ' client = anthropic.Anthropic()',
        gemini: ' client = genai.Client(api_key=os.environ["GOOGLE_AI_API_KEY"])',
      },
      ask: (prov, name, arg) => {
        const head = ` def ${name}(${arg}: str) -> str:`;
        if (prov === 'openai' || prov === 'azure') {
          return join(head,
            '     response = client.chat.completions.create(',
            `         model="${prov === 'azure' ? '<your-deployment-name>' : 'gpt-4o-mini'}",`,
            `         messages=[{"role": "user", "content": ${arg}}],`,
            '     )',
            '     return response.choices[0].message.content');
        }
        if (prov === 'anthropic') {
          return join(head,
            '     message = client.messages.create(',
            '         model="claude-haiku-4-5",',
            '         max_tokens=1024,',
            `         messages=[{"role": "user", "content": ${arg}}],`,
            '     )',
            '     return message.content[0].text');
        }
        return join(head,
          '     response = client.models.generate_content(',
          '         model="gemini-2.5-flash",',
          `         contents=${arg},`,
          '     )',
          '     return response.text');
      },
    },
  };

  function pyDirect(prov, pattern) {
    const d = PY.direct;
    const imp = pattern === 'rag' ? 'init, trace' : pattern === 'agent' ? 'init, trace' : 'init';
    const head = join(
      d.imports[prov],
      `+from openlayer.lib import ${imp}`,
      pattern === 'rag' ? '+from openlayer.lib.tracing import log_context' : null,
      ' ',
      '+init()  # traces LLM clients created after this call',
      d.client[prov],
      ' ',
      ' ');
    let body;
    if (pattern === 'single') body = d.ask(prov, 'answer', 'question');
    else if (pattern === 'rag') {
      body = join(d.ask(prov, 'ask_llm', 'prompt'), ' ', ' ',
        '+@trace()',
        ' def retrieve(question: str) -> list:',
        '     # your existing vector-store lookup',
        '     return search_index.search(question, top_k=4)',
        ' ', ' ',
        '+@trace()',
        ' def answer(question: str) -> str:',
        '     docs = retrieve(question)',
        '+    log_context(docs)  # lets context-based checks see what was retrieved',
        '     prompt = "Answer using only this context:\\n" + "\\n".join(docs) + "\\n\\nQuestion: " + question',
        '     return ask_llm(prompt)');
    } else {
      body = join(d.ask(prov, 'ask_llm', 'prompt'), ' ', ' ',
        '+@trace()',
        ' def lookup_order(order_id: str) -> dict:',
        '     # your existing tool: an API or database call',
        '     return orders_api.get(order_id)',
        ' ', ' ',
        '+@trace()',
        ' def run_agent(question: str) -> str:',
        '     order_id = ask_llm("Reply with only the order id mentioned here: " + question)',
        '     order = lookup_order(order_id.strip())',
        '     return ask_llm("Order data: " + str(order) + "\\nAnswer the customer: " + question)');
    }
    const lines = parseDiff(join(head, body));
    return {
      lines, file: 'app.py', lang: 'python',
      install: 'pip install openlayer' + (prov === 'gemini' ? ' google-genai' : ''),
      entry: pattern === 'agent' ? 'run_agent' : 'answer',
      prelude: pyPrelude(pattern),
      source: 'openlayer-docs/monitoring/instrument.mdx · integrations/' + (prov === 'anthropic' ? 'anthropic' : prov === 'gemini' ? 'google-gemini' : 'openai') + '.mdx',
    };
  }

  function pyPrelude(pattern) {
    // Test-only stand-ins for "your existing" retrieval and tool code (not shown in the UI).
    if (pattern === 'rag') return 'class _Idx:\n    def search(self, q, top_k=4):\n        return ["Refunds take 5 business days.", "Orders ship in 2 days.", "Returns need a receipt.", "Support is open 9-5."][:top_k]\nsearch_index = _Idx()\n';
    if (pattern === 'agent') return 'class _Orders:\n    def get(self, order_id):\n        return {"order_id": order_id, "status": "shipped"}\norders_api = _Orders()\n';
    return '';
  }

  const LC_PY = {
    openai: { imp: ' from langchain_openai import ChatOpenAI', make: ' llm = ChatOpenAI(model="gpt-4o-mini")', pip: 'langchain-openai' },
    azure: { imp: ' from langchain_openai import AzureChatOpenAI', make: ' llm = AzureChatOpenAI(azure_deployment="<your-deployment-name>")  # reads AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, OPENAI_API_VERSION', pip: 'langchain-openai' },
    anthropic: { imp: ' from langchain_anthropic import ChatAnthropic', make: ' llm = ChatAnthropic(model="claude-haiku-4-5")', pip: 'langchain-anthropic' },
  };

  function pyLangchain(prov, pattern) {
    const m = LC_PY[prov];
    const handler = join('+from openlayer.lib.integrations import langchain_callback', ' ', '+openlayer_handler = langchain_callback.OpenlayerHandler()');
    let text;
    if (pattern === 'single') {
      text = join(m.imp, handler, m.make, ' ', ' ',
        ' def answer(question: str) -> str:',
        '-    return llm.invoke(question).content',
        '+    return llm.invoke(question, config={"callbacks": [openlayer_handler]}).content');
    } else if (pattern === 'rag') {
      text = join(m.imp,
        ' from langchain_core.output_parsers import StrOutputParser',
        ' from langchain_core.prompts import ChatPromptTemplate',
        ' from langchain_core.runnables import RunnablePassthrough',
        handler, m.make,
        ' retriever = vectorstore.as_retriever(search_kwargs={"k": 4})  # your existing retriever',
        ' prompt = ChatPromptTemplate.from_template(',
        '     "Answer using only this context:\\n{context}\\n\\nQuestion: {question}"',
        ' )',
        ' ', ' ',
        ' def format_docs(docs) -> str:',
        '     return "\\n\\n".join(doc.page_content for doc in docs)',
        ' ', ' ',
        ' chain = (',
        '     {"context": retriever | format_docs, "question": RunnablePassthrough()}',
        '     | prompt',
        '     | llm',
        '     | StrOutputParser()',
        ' )',
        ' ', ' ',
        ' def answer(question: str) -> str:',
        '-    return chain.invoke(question)',
        '+    return chain.invoke(question, config={"callbacks": [openlayer_handler]})');
    } else {
      text = join(m.imp,
        ' from langchain_core.tools import tool',
        ' from langgraph.prebuilt import create_react_agent',
        handler, m.make, ' ', ' ',
        ' @tool',
        ' def lookup_order(order_id: str) -> str:',
        '     """Look up an order by its id."""',
        '     return str(orders_api.get(order_id))  # your existing tool',
        ' ', ' ',
        ' agent = create_react_agent(llm, [lookup_order])',
        ' ', ' ',
        ' def answer(question: str) -> str:',
        '-    result = agent.invoke({"messages": [("user", question)]})',
        '+    result = agent.invoke(',
        '+        {"messages": [("user", question)]},',
        '+        config={"callbacks": [openlayer_handler]},',
        '+    )',
        '     return result["messages"][-1].content');
    }
    return {
      lines: parseDiff(text), file: 'app.py', lang: 'python',
      install: 'pip install openlayer ' + m.pip + (pattern === 'agent' ? ' langgraph' : ''),
      entry: 'answer', prelude: pattern === 'rag' ? lcPrelude() : pyPrelude(pattern),
      source: 'openlayer-docs/integrations/langchain.mdx · langgraph.mdx',
    };
  }
  function lcPrelude() {
    return 'from langchain_core.embeddings import DeterministicFakeEmbedding\nfrom langchain_core.vectorstores import InMemoryVectorStore\nvectorstore = InMemoryVectorStore.from_texts(["Refunds take 5 business days.", "Orders ship in 2 days.", "Returns need a receipt.", "Support is open 9-5."], DeterministicFakeEmbedding(size=8))\n';
  }

  function pyOpenAIAgents(pattern) {
    const tool = pattern === 'rag'
      ? join(' @function_tool', ' def search_docs(query: str) -> str:', '     """Search the knowledge base."""', '     return "\\n".join(search_index.search(query, top_k=4))  # your existing retrieval')
      : pattern === 'agent'
        ? join(' @function_tool', ' def lookup_order(order_id: str) -> str:', '     """Look up an order by its id."""', '     return str(orders_api.get(order_id))  # your existing tool')
        : null;
    const toolName = pattern === 'rag' ? 'search_docs' : 'lookup_order';
    const text = join(
      ' import asyncio',
      ' ',
      ' from agents import Agent, Runner' + (tool ? ', function_tool' : ''),
      '+from agents import set_trace_processors',
      '+from openlayer.lib.integrations.openai_agents import OpenlayerTracerProcessor',
      ' ',
      '+set_trace_processors([OpenlayerTracerProcessor()])',
      ' ', ' ',
      tool, tool ? ' ' : null, tool ? ' ' : null,
      ` agent = Agent(name="Support agent", instructions="Help customers. Be brief.",${tool ? ` tools=[${toolName}]` : ''})`.replace(',)', ')'),
      ' ', ' ',
      ' async def answer(question: str) -> str:',
      '     result = await Runner.run(agent, question)',
      '     return result.final_output');
    return {
      lines: parseDiff(text), file: 'app.py', lang: 'python', install: 'pip install openlayer openai-agents',
      entry: 'answer', async: true, prelude: pyPrelude(pattern === 'rag' ? 'rag' : pattern),
      source: 'openlayer-docs/integrations/openai-agents-sdk.mdx',
      notes: [{ kind: 'warn', text: '`set_trace_processors` **replaces** the Agents SDK\'s default exporter, so traces stop going to the OpenAI dashboard. To keep both, call `add_trace_processor(OpenlayerTracerProcessor())` instead.' }],
    };
  }

  function pySemanticKernel(prov, pattern) {
    const az = prov === 'azure';
    const imp = az ? ' from semantic_kernel.connectors.ai.open_ai import AzureChatCompletion' : ' from semantic_kernel.connectors.ai.open_ai import OpenAIChatCompletion';
    const svc = az
      ? ' kernel.add_service(AzureChatCompletion(deployment_name="<your-deployment-name>"))  # reads AZURE_OPENAI_* settings'
      : ' kernel.add_service(OpenAIChatCompletion(ai_model_id="gpt-4o-mini"))';
    const plugin = pattern === 'rag'
      ? join(' ', ' ', ' class Docs:', '     @kernel_function(name="search", description="Search the knowledge base")', '     def search(self, query: str) -> str:', '         return "\\n".join(search_index.search(query, top_k=4))  # your existing retrieval', ' ', ' ', ' kernel.add_plugin(Docs(), plugin_name="docs")')
      : pattern === 'agent'
        ? join(' ', ' ', ' class Orders:', '     @kernel_function(name="lookup", description="Look up an order by its id")', '     def lookup(self, order_id: str) -> str:', '         return str(orders_api.get(order_id))  # your existing tool', ' ', ' ', ' kernel.add_plugin(Orders(), plugin_name="orders")')
        : null;
    let answer;
    if (pattern === 'rag') answer = join(' async def answer(question: str) -> str:', '     context = await kernel.invoke(plugin_name="docs", function_name="search", query=question)', '     result = await kernel.invoke_prompt(prompt="Answer using only this context:\\n" + str(context) + "\\n\\nQuestion: " + question)', '     return str(result)');
    else if (pattern === 'agent') answer = join(' async def answer(question: str) -> str:', '     order_id = await kernel.invoke_prompt(prompt="Reply with only the order id mentioned here: " + question)', '     order = await kernel.invoke(plugin_name="orders", function_name="lookup", order_id=str(order_id).strip())', '     result = await kernel.invoke_prompt(prompt="Order data: " + str(order) + "\\nAnswer the customer: " + question)', '     return str(result)');
    else answer = join(' async def answer(question: str) -> str:', '     result = await kernel.invoke_prompt(prompt="Answer briefly: " + question)', '     return str(result)');
    const text = join(
      ' import asyncio', ' ', '+import openlit',
      ' from semantic_kernel import Kernel',
      plugin ? ' from semantic_kernel.functions import kernel_function' : null,
      imp, ' ',
      '+openlit.init()  # exports Semantic Kernel\'s OpenTelemetry spans using the OTEL_* env vars',
      ' kernel = Kernel()', svc, plugin, ' ', ' ', answer);
    return {
      lines: parseDiff(text), file: 'app.py', lang: 'python', install: 'pip install openlit semantic-kernel',
      entry: 'answer', async: true, prelude: pyPrelude(pattern), otel: true,
      source: 'openlayer-docs/integrations/semantic-kernel.mdx · openlit.mdx',
      notes: [{ kind: 'info', text: 'OpenLIT batches spans in the background by default. The docs\' notebook example passes `disable_batch=True` so spans flush immediately. Use it only when debugging a short script: it makes each export block.' }],
    };
  }

  function pyClaudeAgent() {
    const text = join(
      ' import asyncio', ' ',
      '+from openlayer.lib import trace_claude_agent_sdk', ' ',
      '+trace_claude_agent_sdk()  # call once at startup, before `from claude_agent_sdk import query`', ' ',
      ' from claude_agent_sdk import ClaudeAgentOptions, query', ' ', ' ',
      ' async def answer(question: str) -> str:',
      '     result = ""',
      '     async for message in query(',
      '         prompt=question,',
      '         options=ClaudeAgentOptions(model="claude-haiku-4-5", allowed_tools=["Read", "Grep"]),',
      '     ):',
      '         if hasattr(message, "result"):',
      '             result = message.result',
      '     return result');
    return { lines: parseDiff(text), file: 'app.py', lang: 'python', install: 'pip install openlayer claude-agent-sdk', entry: 'answer', async: true, prelude: '', source: 'openlayer-docs/integrations/claude-agent-sdk.mdx (Path 1)' };
  }

  function pyPortkey() {
    const text = join(
      ' import os', ' ', ' from portkey_ai import Portkey', '+from openlayer.lib import init', ' ',
      '+init()  # traces Portkey clients created after this call',
      ' portkey = Portkey(api_key=os.environ["PORTKEY_API_KEY"])', ' ', ' ',
      ' def answer(question: str) -> str:',
      '     response = portkey.chat.completions.create(',
      '         model="@YOUR_PROVIDER_SLUG/MODEL_NAME",',
      '         messages=[{"role": "user", "content": question}],',
      '         max_tokens=512,',
      '     )',
      '     return response.choices[0].message.content');
    return { lines: parseDiff(text), file: 'app.py', lang: 'python', install: 'pip install openlayer portkey-ai', entry: 'answer', prelude: '', source: 'openlayer-docs/integrations/portkey.mdx' };
  }

  function pyLiteLLM() {
    const text = join(
      ' import litellm', '+from openlayer.lib import init', ' ',
      '+init()  # traces litellm calls', ' ', ' ',
      ' def answer(question: str) -> str:',
      '     response = litellm.completion(',
      '         model="gpt-4o-mini",',
      '         messages=[{"role": "user", "content": question}],',
      '     )',
      '     return response.choices[0].message.content');
    return { lines: parseDiff(text), file: 'app.py', lang: 'python', install: 'pip install openlayer litellm', entry: 'answer', prelude: '', source: 'openlayer-docs/integrations/litellm.mdx',
      notes: [{ kind: 'info', text: 'This traces the **LiteLLM Python library** inside your app. It does not cover a standalone LiteLLM proxy server.' }] };
  }

  function pyML(task) {
    const cls = task === 'classification';
    const cfg = cls
      ? join(
        '+config = data_stream_params.ConfigTabularClassificationData(',
        '+    class_names=["Retained", "Exited"],',
        '+    feature_names=FEATURES,',
        '+    categorical_feature_names=["Geography", "Gender"],  # use [] if you have none',
        '+    predictions_column_name="predictions",',
        '+    prediction_scores_column_name="prediction_scores",',
        '+    inference_id_column_name="inference_id",  # lets you add ground truth later',
        '+)')
      : join(
        '+config = data_stream_params.ConfigTabularRegressionData(',
        '+    feature_names=FEATURES,',
        '+    predictions_column_name="predictions",',
        '+    inference_id_column_name="inference_id",  # lets you add ground truth later',
        '+)');
    const predict = cls
      ? join(
        ' def predict(features: dict) -> int:',
        '     scores = model.predict_proba([[features[name] for name in FEATURES]])[0]',
        '     prediction = int(scores.argmax())',
        '+    publisher.submit(',
        '+        publish,',
        '+        {**features, "predictions": prediction, "prediction_scores": [float(s) for s in scores], "inference_id": str(uuid.uuid4())},',
        '+    )',
        '     return prediction')
      : join(
        ' def predict(features: dict) -> float:',
        '     prediction = float(model.predict([[features[name] for name in FEATURES]])[0])',
        '+    publisher.submit(publish, {**features, "predictions": prediction, "inference_id": str(uuid.uuid4())})',
        '     return prediction');
    const text = join(
      ' import os',
      '+import uuid',
      '+from concurrent.futures import ThreadPoolExecutor',
      ' ',
      '+from openlayer import Openlayer',
      '+from openlayer.types.inference_pipelines import data_stream_params',
      ' ',
      ' FEATURES = ["CreditScore", "Geography", "Gender", "Age", "Balance"]  # your model\'s inputs',
      ' ',
      '+client = Openlayer()  # reads OPENLAYER_API_KEY (and OPENLAYER_BASE_URL on-prem)',
      '+publisher = ThreadPoolExecutor(max_workers=1)  # keeps publishing off the request path',
      cfg,
      '+',
      '+',
      '+def publish(row: dict) -> None:',
      '+    try:',
      '+        client.inference_pipelines.data.stream(',
      '+            inference_pipeline_id=os.environ["OPENLAYER_INFERENCE_PIPELINE_ID"],',
      '+            rows=[row],',
      '+            config=config,',
      '+        )',
      '+    except Exception as exc:  # monitoring must never break scoring',
      '+        print(f"openlayer publish failed: {exc}")',
      ' ', ' ',
      predict);
    return {
      lines: parseDiff(text), file: 'predict.py', lang: 'python', install: 'pip install openlayer', entry: 'predict', ml: true,
      prelude: 'class _Model:\n    def predict_proba(self, rows):\n        import numpy as np\n        return np.array([[0.15, 0.85] for _ in rows])\n    def predict(self, rows):\n        return [42.0 for _ in rows]\nmodel = _Model()\n',
      source: 'openlayer-docs/monitoring/publishing-tabular-predictions.mdx (Option A)',
      notes: [{ kind: 'info', text: 'Edit `FEATURES`, `class_names` and the categorical list to match your model. For classification the server needs `class_names`, `feature_names` **and** `categorical_feature_names` together.' },
        { kind: 'info', text: 'Prefer a scheduled scoring job? Upload a whole DataFrame instead with `data.upload_batch_inferences(...)` (see the docs).' }],
    };
  }

  // ───────────────────────── TypeScript snippets ─────────────────────────
  const TS_LLM = {
    openai: {
      imp: " import OpenAI from 'openai';", trace: "+import { traceOpenAI } from 'openlayer/lib/integrations/openAiTracer';",
      client: ['-const client = new OpenAI();', '+const client = traceOpenAI(new OpenAI() as any);'],
      ask: (arg) => join(' const response = await client.chat.completions.create({', "   model: 'gpt-4o-mini',", `   messages: [{ role: 'user', content: ${arg} }],`, ' });', " return response.choices[0]?.message?.content ?? '';"),
      pkgs: 'openlayer openai',
    },
    gemini: {
      imp: " import { GoogleGenAI } from '@google/genai';", trace: "+import { traceGoogleGenAI } from 'openlayer/lib/integrations/googleGenAiTracer';",
      client: ["-const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY ?? '' });", "+const client = traceGoogleGenAI(new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY ?? '' }));"],
      ask: (arg) => join(' const response = await client.models.generateContent({', "   model: 'gemini-2.5-flash',", `   contents: ${arg},`, ' });', " return response.text ?? '';"),
      pkgs: 'openlayer @google/genai',
    },
  };
  const indent = (s, n) => s.split('\n').map((l) => (l[0] === ' ' ? ' '.repeat(n) + l : l)).join('\n');

  function tsDirect(prov, pattern) {
    const m = TS_LLM[prov];
    const wrap = pattern !== 'single';
    const head = join(m.imp, m.trace, wrap ? "+import trace from 'openlayer/lib/tracing/tracer';" : null, ' ', m.client[0], m.client[1], ' ');
    let body;
    if (pattern === 'single') {
      body = join(' export async function answer(question: string): Promise<string> {', indent(m.ask('question'), 1), ' }');
    } else if (pattern === 'rag') {
      body = join(
        '-async function retrieve(question: string): Promise<string[]> {',
        '+const retrieve = trace(async function retrieve(question: string): Promise<string[]> {',
        '   // your existing vector-store lookup',
        '   return searchIndex.search(question, { topK: 4 });',
        '-}',
        '+});', ' ',
        '-export async function answer(question: string): Promise<string> {',
        '+export const answer = trace(async function answer(question: string): Promise<string> {',
        '   const docs = await retrieve(question);',
        "   const prompt = 'Answer using only this context:\\n' + docs.join('\\n') + '\\n\\nQuestion: ' + question;",
        indent(m.ask('prompt'), 1),
        '-}',
        '+});');
    } else {
      body = join(
        '-async function lookupOrder(orderId: string): Promise<object> {',
        '+const lookupOrder = trace(async function lookupOrder(orderId: string): Promise<object> {',
        '   // your existing tool: an API or database call',
        '   return ordersApi.get(orderId);',
        '-}',
        '+});', ' ',
        ' async function askLlm(prompt: string): Promise<string> {', indent(m.ask('prompt'), 1), ' }', ' ',
        '-export async function runAgent(question: string): Promise<string> {',
        "+export const runAgent = trace(async function runAgent(question: string): Promise<string> {",
        "   const orderId = await askLlm('Reply with only the order id mentioned here: ' + question);",
        '   const order = await lookupOrder(orderId.trim());',
        "   return askLlm('Order data: ' + JSON.stringify(order) + '\\nAnswer the customer: ' + question);",
        '-}',
        '+});');
    }
    return {
      lines: parseDiff(join(head, body)), file: 'app.ts', lang: 'typescript', install: 'npm install ' + m.pkgs,
      entry: pattern === 'agent' ? 'runAgent' : 'answer',
      prelude: pattern === 'rag' ? 'declare const searchIndex: { search(q: string, o: { topK: number }): Promise<string[]> };\n' : pattern === 'agent' ? 'declare const ordersApi: { get(id: string): Promise<object> };\n' : '',
      source: 'openlayer-ts/examples/openai-tracing.ts · multi-step-tracing.ts · docs integrations/google-gemini.mdx',
      notes: pattern === 'rag' ? [{ kind: 'info', text: 'Context-based RAG checks (such as Context relevancy) need the retrieved documents logged as context. That helper is documented for Python only, so in TypeScript use the LangChain handler or expect those checks to be unavailable.' }] : [],
    };
  }

  const TS_LC = {
    openai: { imp: " import { ChatOpenAI } from '@langchain/openai';", make: " const llm = new ChatOpenAI({ model: 'gpt-4o-mini' });", pkg: '@langchain/openai' },
    anthropic: { imp: " import { ChatAnthropic } from '@langchain/anthropic';", make: " const llm = new ChatAnthropic({ model: 'claude-haiku-4-5' });", pkg: '@langchain/anthropic' },
  };
  function tsLangchain(prov, pattern) {
    const m = TS_LC[prov];
    const handler = join("+import { OpenlayerHandler } from 'openlayer/lib/integrations/langchainCallback';", ' ', '+const handler = new OpenlayerHandler();');
    let text;
    if (pattern === 'single') {
      text = join(m.imp, handler, m.make, ' ',
        ' export async function answer(question: string): Promise<string> {',
        '-  const res = await llm.invoke(question);',
        '+  const res = await llm.invoke(question, { callbacks: [handler] });',
        '   return String(res.content);', ' }');
    } else if (pattern === 'rag') {
      text = join(m.imp,
        " import { StringOutputParser } from '@langchain/core/output_parsers';",
        " import { ChatPromptTemplate } from '@langchain/core/prompts';",
        " import { RunnablePassthrough, RunnableSequence } from '@langchain/core/runnables';",
        handler, m.make,
        ' const retriever = vectorStore.asRetriever({ k: 4 }); // your existing retriever',
        " const prompt = ChatPromptTemplate.fromTemplate('Answer using only this context:\\n{context}\\n\\nQuestion: {question}');",
        ' ',
        " const formatDocs = (docs: { pageContent: string }[]) => docs.map((d) => d.pageContent).join('\\n\\n');",
        ' ',
        ' const chain = RunnableSequence.from([',
        '   { context: retriever.pipe(formatDocs), question: new RunnablePassthrough() },',
        '   prompt,', '   llm,', '   new StringOutputParser(),', ' ]);', ' ',
        ' export async function answer(question: string): Promise<string> {',
        '-  return chain.invoke(question);',
        '+  return chain.invoke(question, { callbacks: [handler] });', ' }');
    } else {
      text = join(m.imp,
        " import { tool } from '@langchain/core/tools';",
        " import { createReactAgent } from '@langchain/langgraph/prebuilt';",
        " import { z } from 'zod';",
        handler, m.make, ' ',
        ' const lookupOrder = tool(async ({ orderId }) => JSON.stringify(await ordersApi.get(orderId)), { // your existing tool',
        " name: 'lookup_order',", " description: 'Look up an order by its id.',", ' schema: z.object({ orderId: z.string() }),', ' });', ' ',
        ' const agent = createReactAgent({ llm, tools: [lookupOrder] });', ' ',
        ' export async function answer(question: string): Promise<string> {',
        "-  const result = await agent.invoke({ messages: [{ role: 'user', content: question }] });",
        "+  const result = await agent.invoke({ messages: [{ role: 'user', content: question }] }, { callbacks: [handler] });",
        '   return String(result.messages[result.messages.length - 1].content);', ' }');
    }
    return {
      lines: parseDiff(text), file: 'app.ts', lang: 'typescript', install: 'npm install openlayer ' + m.pkg + (pattern === 'agent' ? ' @langchain/langgraph' : ''),
      entry: 'answer',
      prelude: pattern === 'rag' ? 'declare const vectorStore: { asRetriever(o: { k: number }): import("@langchain/core/retrievers").BaseRetriever };\n' : pattern === 'agent' ? 'declare const ordersApi: { get(id: string): Promise<object> };\n' : '',
      source: 'openlayer-ts/examples/langchain-callback-handler.ts · langgraph-openlayer.ts',
    };
  }

  function tsClaudeAgent() {
    const text = join(
      "-import { query } from '@anthropic-ai/claude-agent-sdk';",
      "+import { query } from 'openlayer/lib/integrations/claudeAgentSdk';", ' ',
      ' export async function answer(question: string): Promise<string> {',
      "   let result = '';",
      '   for await (const message of query({',
      '     prompt: question,',
      "     options: { model: 'claude-haiku-4-5', allowedTools: ['Read', 'Grep'] },",
      '   })) {',
      "     if ('result' in message) result = String(message.result);",
      '   }', '   return result;', ' }');
    return { lines: parseDiff(text), file: 'app.ts', lang: 'typescript', install: 'npm install openlayer @anthropic-ai/claude-agent-sdk', entry: 'answer', prelude: '', source: 'openlayer-docs/integrations/claude-agent-sdk.mdx (Path 1)' };
  }

  // ───────────────────────── Environment blocks ─────────────────────────
  function openlayerEnv(s, base) {
    const lines = [
      '# Create a dedicated API key for this app so it can be rotated or revoked on its own',
      'OPENLAYER_API_KEY=<your Openlayer API key>',
      '# The inference pipeline (in your monitoring-mode project) that should receive the traces',
      'OPENLAYER_INFERENCE_PIPELINE_ID=<your inference pipeline ID>',
    ];
    let n = 2;
    if (s.where === 'onprem') {
      lines.push('# On-prem: your API root, which MUST end in /v1', 'OPENLAYER_BASE_URL=' + (base.ok ? base.url : 'https://<your-openlayer-host>/v1'));
      n = 3;
    }
    return { text: lines.join('\n'), count: n };
  }
  // What `openlayer init` writes to .env.openlayer (openlayer-cli/pkg/wizard/files.go, WriteEnvFile). Shown, not typed.
  function wizardEnv(s, base) {
    const lines = [
      '# Written by `openlayer init`, and gitignored. You do not create this file.',
      'OPENLAYER_API_KEY=<the key you signed in with>',
      'OPENLAYER_INFERENCE_PIPELINE_ID=<the pipeline the wizard created or you picked>',
    ];
    let n = 2;
    if (s.where === 'onprem') {
      lines.push('OPENLAYER_BASE_URL=' + (base.ok ? base.url : 'https://<your-openlayer-host>/v1'));
      n = 3;
    }
    return { text: lines.join('\n'), count: n };
  }

  // ───────────────────────── The `openlayer init` route ─────────────────────────
  function wizardFor(s, base, code) {
    const L = CLI.labels;
    const onprem = s.where === 'onprem';
    const type = s.pattern === 'ml' ? (s.mlTask === 'regression' ? L.regression : L.classification) : L.llm;
    const picks = [
      { t: 'Sign in', d: onprem
        ? 'Choose **' + L.onprem + '** and enter ' + (base.ok ? '`' + base.origin + '`' : 'the address people use to open Openlayer') + '. The wizard adds the `/v1` your app needs.'
        : 'Choose **' + L.saas + '**, then **' + L.browser + '**.' },
      { t: 'Project', d: 'Link an existing project or create a new one. For a new one, pick the type **' + type + '**.' },
      { t: 'What to set up', d: 'Choose **' + L.monitoring + '**. The wizard then creates the inference pipeline, or lets you pick an existing one.' },
      { t: 'How to add Openlayer', d: 'Choose **' + L.builtin + '**, then **Confirm**. The wizard offers it when it finds ' + CLI.agents + ' on the machine.' },
      { t: 'Not offered?', d: 'Choose **' + L.own + '** and paste the prompt into your agent, such as Cursor.' },
      { t: 'No coding agent allowed?', d: 'Choose **' + L.manual + '** and add the lines from the **By hand** tab yourself. The wizard still creates the project, the pipeline and `' + CLI.envFile + '`.' },
    ];
    const usesInit = code.lines.some((l) => l.t === '+' && /\binit\(\)/.test(l.s));
    const notes = [{ kind: 'info', text: 'The agent\'s edit can differ in detail from this reference and still be correct' + (usesInit ? ', for example by wrapping the client with a tracer where the reference calls `init()`' : '') + '. Expect one extra piece: code that loads `' + CLI.envFile + '`, because the wizard keeps the key out of your code. What matters is that one request produces the example shown below.' }];
    if (s.how === 'own' && (s.fw === 'openai-agents' || s.fw === 'claude-agent-sdk')) {
      notes.push({ kind: 'warn', text: 'The Openlayer skill the agent follows does not name the **' + FRAMEWORKS[s.fw].label + '** integration. Check that the agent used it, as the reference does.' });
    }
    return { minVersion: CLI.minVersion, docs: CLI.docs, installs: CLI.installs, run: CLI.run, picks, notes };
  }

  function otlpEndpoint(s, base) {
    return s.where === 'onprem' ? (base.ok ? base.url : 'https://<your-openlayer-host>/v1') + '/otel' : CLOUD_BASE + '/otel';
  }
  function otelEnv(s, base) {
    const lines = [
      '# Send OpenTelemetry traces to Openlayer',
      'OTEL_EXPORTER_OTLP_ENDPOINT=' + otlpEndpoint(s, base),
      'OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <your Openlayer API key>, x-bt-parent=pipeline_id:<your inference pipeline ID>"',
    ];
    return { text: lines.join('\n'), count: 2 };
  }

  // ───────────────────────── No-code paths (Openlayer pulls, or managed config) ─────────────────────────
  function vendorPlan(s, base) {
    const onprem = s.where === 'onprem';
    const origin = onprem && base.ok ? base.origin : onprem ? 'https://<your-openlayer-host>' : 'https://app.openlayer.com';
    const common = { added: 0, removed: 0 };
    switch (s.vendor) {
      case 'copilot-studio': return {
        title: 'Microsoft Copilot Studio', noCode: true, mode: 'pull', storeTitle: 'Dataverse', storeSub: 'ConversationTranscript table', api: 'your Dataverse environment',
        change: { kind: 'checklist', heading: 'What you set up (nothing in the bot itself)', items: [
          { t: 'Turn on enhanced transcripts', d: 'Copilot Studio → agent **Settings → Advanced → Enhance Transcripts** → on. Without it you still get conversations, but no node-level steps or timing.' },
          { t: 'Register an Entra (Azure AD) app', d: 'Create a client secret and add the **Dataverse `user_impersonation`** application permission, then grant admin consent. Note the Tenant ID, Client ID, secret and your Dataverse environment URL (like `https://yourorg.crm.dynamics.com`).' },
          { t: 'Create a read-only security role', d: 'Power Platform admin center → your environment → **Security roles** → new role with **Read at Organization level** on the **Bot** and **Conversation Transcript** tables.' },
          { t: 'Add an application user', d: 'Environment → **Application users** → new app user for the Entra app, with that security role.' },
          { t: 'Connect it in Openlayer', d: 'Openlayer **Settings → Integrations → Microsoft Copilot Studio** → enter the four values → Connect → Discover agents → Enable the ones to monitor.' },
        ], ...common },
        trace: [{ d: 0, k: 'agent', n: 'Conversation', m: 'one session', s: '2.4 s' }, { d: 1, k: 'chain', n: 'Plan step', m: 'topic and node details', s: '' }, { d: 2, k: 'retriever', n: 'Knowledge search', m: '3 citations', s: '0.6 s' }, { d: 2, k: 'llm', n: 'Generative answer', m: 'model, tokens', s: '1.3 s' }],
        delay: 'Copilot Studio writes a transcript only **after the session ends** (up to ~30 minutes later), and Openlayer then syncs every 60 minutes by default. Use **Sync now** to pull immediately.',
        revoke: 'Disconnect the integration in Openlayer, then delete the Entra app or its application user.',
        reach: 'the Dataverse API', data: 'conversation transcripts: user messages, answers, plan steps, tool calls, citations, latency and token usage',
      };
      case 'm365-copilot': return {
        title: 'Microsoft 365 Copilot', noCode: true, mode: 'pull', storeTitle: 'Microsoft Graph', storeSub: 'Copilot interaction export', api: 'Microsoft Graph (graph.microsoft.com)',
        change: { kind: 'checklist', heading: 'What you set up (nothing in Microsoft 365)', items: [
          { t: 'Check licensing', d: 'Users need Microsoft 365 Copilot including the **Graph-grounded chat** service plan. A tenant with no one on that plan connects, then imports nothing.' },
          { t: 'Register a dedicated Entra app', d: 'Do **not** reuse the Copilot Studio app. Create a client secret and add two **application** permissions: **`AiEnterpriseInteraction.Read.All`** and **`User.Read.All`**, then grant admin consent.' },
          { t: 'Connect it in Openlayer', d: 'Openlayer **Settings → Integrations → Microsoft 365 Copilot** (workspace admin) → Tenant ID, Client ID, secret, Microsoft cloud → Connect.' },
          { t: 'Turn on the surfaces you want', d: 'Chat, Web, Teams, Word, Excel and Cowork all start **disabled**. Enabling one creates a project for it. Outlook, Loop and PowerPoint are not covered.' },
        ], ...common },
        trace: [{ d: 0, k: 'agent', n: 'Copilot interaction', m: 'prompt and response', s: '' }, { d: 1, k: 'llm', n: 'Copilot answer', m: 'surface: Teams / Chat / Word…', s: '' }],
        delay: 'Openlayer pulls on a schedule (every **60 minutes** by default, between 15 minutes and 24 hours). The first sync reads the last 7 days unless you choose otherwise.',
        revoke: 'Disconnect the integration in Openlayer, then delete the Entra app registration.',
        reach: 'Microsoft Graph', data: 'Copilot prompts and responses for licensed users on the surfaces you enable',
      };
      case 'agentforce': return {
        title: 'Salesforce Agentforce', noCode: true, mode: 'pull', storeTitle: 'Salesforce Data 360', storeSub: 'Agent Analytics conversations', api: 'your Salesforce org and Data 360',
        change: { kind: 'checklist', heading: 'What you set up (nothing in Agentforce itself)', items: [
          { t: 'Turn on Agent Analytics', d: 'Setup → **Einstein Feedback and Monitoring** → **Agent Analytics** on. It needs Data 360 already provisioned in the org.' },
          { t: 'Create a Connected App named Openlayer', d: 'Setup → App Manager → New Connected App → **Enable OAuth Settings**, with scopes **`api`**, **`cdp_api`** and **`refresh_token`**.' },
          { t: 'Set the callback URL', d: 'Use `' + origin + '/integrations/agentforce/callback`' + (onprem ? '. This is your own Openlayer host, as on-prem requires.' : '.'), code: origin + '/integrations/agentforce/callback' },
          { t: 'Copy the Consumer Key and Secret', d: 'Setup → Manage Consumer Details. Salesforce shows the secret once.' },
          { t: 'Connect it in Openlayer', d: 'Openlayer **Settings → Integrations → Salesforce Agentforce** → Enable → authorize with OAuth → pick the agents to monitor.' },
        ], ...common },
        trace: [{ d: 0, k: 'agent', n: 'Agent session', m: 'sessions, requests, steps', s: '' }, { d: 1, k: 'llm', n: 'LLM call', m: 'model, provider, tokens', s: '' }, { d: 1, k: 'tool', n: 'Action', m: 'tool input and output', s: '' }],
        delay: 'Openlayer periodically syncs conversations from Data 360, so traces appear after a sync, not instantly.',
        revoke: 'Disconnect the integration in Openlayer, then delete or disable the Connected App in Salesforce.',
        reach: 'your Salesforce org', data: 'agent conversations from Data 360: sessions, requests, steps, model names, token counts and user IDs',
      };
      case 'dialogflow-cx': return {
        title: 'Dialogflow CX', noCode: true, mode: 'pull', storeTitle: 'BigQuery dataset', storeSub: 'Cloud Logging sink from Dialogflow', api: 'your BigQuery dataset',
        change: { kind: 'config', heading: 'What you set up (nothing in the agent)', file: 'in your GCP project', lang: 'bash',
          intro: 'First, in the Dialogflow CX console: agent **Settings → General → Logging settings**, enable **Cloud Logging** and **conversation history** (without the second, message text is stripped). Then create the dataset and log sink:',
          lines: parseDiff(join(
            '+# 1. Dataset that will receive Dialogflow logs (pick US or EU for residency)',
            '+bq --location=US mk -d PROJECT_ID:DATASET',
            '+',
            '+# 2. Log sink into that dataset (partitioned tables keep queries cheap)',
            '+gcloud logging sinks create openlayer-dialogflow-sink \\',
            '+  bigquery.googleapis.com/projects/PROJECT_ID/datasets/DATASET \\',
            '+  --log-filter=\'logName:"dialogflow-runtime.googleapis.com/requests"\' \\',
            '+  --use-partitioned-tables',
            '+',
            '+# 3. Let the sink write to the dataset',
            '+SINK_SA=$(gcloud logging sinks describe openlayer-dialogflow-sink \\',
            '+  --format="value(writerIdentity)")',
            '+bq add-iam-policy-binding \\',
            '+  --member="$SINK_SA" \\',
            '+  --role=roles/bigquery.dataEditor \\',
            '+  PROJECT_ID:DATASET')),
          after: 'Then give Openlayer a **read-only** service account on that one dataset and connect it in **Settings → Integrations → Dialogflow CX** with the table name `dialogflow_runtime_googleapis_com_requests`. The table only appears after the first matching log arrives, so send the agent a message first.' },
        trace: [{ d: 0, k: 'agent', n: 'Conversation turn', m: 'one request', s: '' }, { d: 1, k: 'retriever', n: 'RAG retrieval', m: 'context documents', s: '' }, { d: 1, k: 'llm', n: 'LLM call', m: 'model, prompt, tokens', s: '' }, { d: 1, k: 'tool', n: 'Tool invocation', m: 'inputs and outputs', s: '' }],
        delay: 'Openlayer syncs every **15 minutes**. The log table is only created when the first matching log arrives, so send the agent a message first and allow 1–2 minutes.',
        revoke: 'Disconnect the integration in Openlayer, delete the log sink, and remove the service account\'s access to the dataset.',
        reach: 'BigQuery', data: 'Dialogflow runtime logs: messages, LLM calls, retrievals, tool invocations and token counts',
      };
      default: { // claude-code
        const traces = otlpEndpoint(s, base) + '/v1/traces';
        return {
          title: 'Claude Code', noCode: true, mode: 'push', storeTitle: 'Anthropic API', storeSub: 'Claude Code sessions', api: '', developers: true,
          change: { kind: 'config', heading: 'Your change: one managed-settings block', file: 'Claude managed settings (admin console or managed-settings.json)', lang: 'json',
            intro: 'Deliver this once through Claude **managed settings** so it applies to every developer and individual users can\'t redirect or turn it off. Needs Claude Code **v2.1.251 or later**.',
            lines: parseDiff(join(
              '+{',
              '+  "env": {',
              '+    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",',
              '+    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA": "1",',
              '+    "OTEL_TRACES_EXPORTER": "otlp",',
              '+    "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL": "http/protobuf",',
              '+    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": "' + traces + '",',
              '+    "OTEL_EXPORTER_OTLP_TRACES_HEADERS": "Authorization=Bearer <your Openlayer API key>,x-bt-parent=pipeline_id:<your inference pipeline ID>",',
              '+    "OTEL_LOG_USER_PROMPTS": "1",',
              '+    "OTEL_LOG_TOOL_DETAILS": "1",',
              '+    "OTEL_LOG_TOOL_CONTENT": "1"',
              '+  }',
              '+}')),
            after: 'The three `OTEL_LOG_*` values send prompts and tool content. Without them Openlayer has nothing to test, so review privacy before you deploy them, and set them to `0` only if policy rules out sending content. Managed settings sit in plain text on developer machines, so use a **dedicated, revocable API key**.' },
          trace: [{ d: 0, k: 'agent', n: 'claude_code.interaction', m: 'one prompt', s: '' }, { d: 1, k: 'llm', n: 'claude_code.llm_request', m: 'model, tokens', s: '' }, { d: 1, k: 'tool', n: 'claude_code.tool', m: 'tool name and result', s: '' }],
          delay: 'Spans are exported by Claude Code itself as developers work. Claude\'s own replies appear only with detailed tracing turned on.',
          revoke: 'Remove the block from managed settings and revoke the API key.',
          reach: '', data: 'each prompt, model request and tool call from developers\' Claude Code sessions',
        };
      }
    }
  }

  function gatewayPlan(s, base) {
    if (s.gateway === 'openlayer-gateway') {
      const onprem = s.where === 'onprem';
      return {
        title: 'Openlayer Gateway', noCode: true, mode: 'gateway',
        change: { kind: 'checklist', heading: 'What you set up (no code in your apps)', items: [
          { t: 'Connect an Openlayer workspace to the gateway', d: 'In the gateway portal: **Settings → Observability** → connect a workspace with an **Openlayer API key**. The gateway verifies the key and stores it encrypted.' },
          ...(onprem ? [{ t: 'Set the Base URL to your own Openlayer', d: 'Enter ' + (base.ok ? '`' + base.origin + '`' : 'your Openlayer address') + '. The gateway form wants the address **without** `/v1` (it adds it). The SDKs are the opposite.' }] : [{ t: 'Leave the Base URL blank', d: 'Blank means Openlayer\'s public API.' }]),
          { t: 'Add a destination', d: 'Choose **whose traffic** (a group, a user, one API key, all traffic, or unclaimed) and **where it lands** (workspace → project → data source). Destinations fan out: every matching one gets a copy.' },
          { t: 'Optional: send an `X-Request-ID` header', d: 'The gateway uses it as the trace ID, so you can line traces up with your own logs.' },
        ] },
        trace: [{ d: 0, k: 'agent', n: 'Gateway request', m: 'model and provider that served it', s: '' }, { d: 1, k: 'llm', n: 'Chat completion', m: 'input, output, tokens, cost', s: '1.4 s' }, { d: 1, k: 'tool', n: 'Guardrail', m: 'only if a rule fired', s: '' }],
        delay: 'The gateway sends each trace in the background right after the response goes out.',
        revoke: 'Mute the destination (it keeps its data source) or disconnect the workspace in the gateway portal, which discards the stored key.',
        data: 'model and provider, input messages, output text, tokens, latency, cost, status and any guardrail violations',
      };
    }
    const p = s.gateway === 'portkey' ? pyPortkey() : pyLiteLLM();
    return { title: GATEWAYS[s.gateway].label, noCode: false, mode: 'sdk', code: p,
      trace: [{ d: 0, k: 'llm', n: s.gateway === 'portkey' ? 'Portkey chat completion' : 'LiteLLM completion', m: 'model, input, output', s: '1.3 s' }],
      data: 'prompts, model outputs, tokens, latency and cost for each call' };
  }

  function tablePlan(s) {
    const t = s.table;
    const common = { noCode: true, mode: 'pull' };
    if (t === 'bigquery') return Object.assign({ title: 'BigQuery', storeTitle: 'BigQuery table', storeSub: 'logs your app already writes', api: 'BigQuery',
      change: { kind: 'config', heading: 'What you set up (nothing in your app)', file: 'in your GCP project', lang: 'bash',
        intro: 'Create a dedicated, **read-only** service account for Openlayer:',
        lines: parseDiff(join(
          '+export PROJECT_ID="your-project-id"',
          '+',
          '+gcloud iam service-accounts create openlayer-bigquery \\',
          '+  --project=$PROJECT_ID \\',
          '+  --description="BigQuery access for Openlayer" \\',
          '+  --display-name="Openlayer BigQuery Access"',
          '+',
          '+for ROLE in roles/bigquery.jobUser roles/bigquery.dataViewer roles/bigquery.metadataViewer; do',
          '+  gcloud projects add-iam-policy-binding $PROJECT_ID \\',
          '+    --member="serviceAccount:openlayer-bigquery@$PROJECT_ID.iam.gserviceaccount.com" \\',
          '+    --role="$ROLE"',
          '+done')),
        after: 'Then, in Openlayer: **Monitoring → Data sources → Create a data source → BigQuery**. Prefer **Service Account Impersonation**: no key is exchanged, you only let Openlayer\'s service account mint tokens for yours. Finally pick the project, dataset and table, and (optionally) the timestamp and unique-ID columns.' },
      delay: 'Openlayer reads the table on a schedule and runs tests where the data lives. It does not copy the table.',
      revoke: 'Disconnect the data source in Openlayer and delete the service account or remove its roles.',
      reach: 'BigQuery', data: 'the columns of the table you select' }, common);
    if (t === 'snowflake') return Object.assign({ title: 'Snowflake', storeTitle: 'Snowflake table', storeSub: 'logs your app already writes', api: 'Snowflake',
      change: { kind: 'config', heading: 'What you set up (nothing in your app)', file: 'in Snowflake (run as an admin)', lang: 'sql',
        intro: 'Create a warehouse for Openlayer, then a dedicated service user with **key-pair** authentication. Copy the public key from the Openlayer data-source form:',
        lines: parseDiff(join(
          '+set role_name = \'OPENLAYER_FILE_IMPORTER_ROLE\';',
          '+set user_name = \'OPENLAYER_FILE_IMPORTER\';',
          '+set warehouse_name = \'[YOUR_WAREHOUSE_NAME_HERE]\';',
          '+set database_name = \'[YOUR_DATABASE_NAME_HERE]\';',
          '+set schema_name = \'[YOUR_SCHEMA_NAME_HERE]\';',
          '+set table_name = \'[YOUR_TABLE_NAME_HERE]\';',
          '+',
          '+use role securityadmin;',
          '+create role if not exists identifier($role_name);',
          '+create user if not exists identifier($user_name);',
          '+alter user identifier($user_name) set default_role = $role_name;',
          '+alter user identifier($user_name) set default_warehouse = $warehouse_name;',
          '+alter user identifier($user_name) set type = \'SERVICE\';',
          '+grant role identifier($role_name) to user identifier($user_name);',
          '+ALTER USER identifier($user_name) SET RSA_PUBLIC_KEY=\'[OPENLAYER_PUBLIC_KEY_HERE]\';',
          '+',
          '+grant USAGE on warehouse identifier($warehouse_name) to role identifier($role_name);',
          '+grant USAGE on database identifier($database_name) to role identifier($role_name);',
          '+grant USAGE on schema identifier($database_name).identifier($schema_name) to role identifier($role_name);',
          '+grant SELECT on table identifier($database_name).identifier($schema_name).identifier($table_name) to role identifier($role_name);')),
        after: 'Then connect it in Openlayer: **Monitoring → Data sources → Create a data source → Snowflake** (user, role, account identifier, warehouse), and choose the table.' },
      delay: 'Openlayer reads the table on a schedule and runs tests where the data lives. It does not copy the table.',
      revoke: 'Disconnect the data source in Openlayer and drop the service user and role.',
      reach: 'Snowflake', data: 'the columns of the table you select' }, common);
    return Object.assign({ title: 'Databricks', storeTitle: 'Databricks table', storeSub: 'logs your app already writes', api: 'Databricks',
      change: { kind: 'checklist', heading: 'What you set up (nothing in your app)', items: [
        { t: 'Generate a personal access token', d: 'Databricks → **User Settings → Developer → Access Tokens → Generate new token**. Use an account that can only read the table you want monitored.' },
        { t: 'Collect connection details', d: 'Workspace hostname (like `https://dbc-….cloud.databricks.com`), port (usually `443`) and the SQL warehouse path `/sql/1.0/warehouses/<warehouse-id>`.' },
        { t: 'Connect it in Openlayer', d: 'Openlayer **Data sources → Databricks → Connect** → hostname, port, warehouse path, token, a name.' },
        { t: 'Pick the table and columns', d: 'Choose catalog, schema and table, then the **timestamp** and **unique ID** columns (recommended).' },
      ] },
      delay: 'Openlayer reads the table on a schedule and runs tests where the data lives. It does not copy the table.',
      revoke: 'Disconnect the data source in Openlayer and revoke the personal access token.',
      reach: 'Databricks', data: 'the columns of the table you select' }, common);
  }

  // ───────────────────────── Trace preview ─────────────────────────
  const row = (d, k, n, m, s) => ({ d, k, n, m, s });
  function llmRow(d, s, tokens) {
    const p = PROVIDERS[s.prov] || PROVIDERS.openai;
    return row(d, 'llm', p.modelLabel, p.model + ' · ' + (tokens || '612 → 118 tokens') + ' · ~$0.0004', '1.5 s');
  }
  function sdkTrace(s) {
    if (s.pattern === 'ml') return null;
    const fw = s.how === 'own' ? s.fw : 'direct';
    const root = s.pattern === 'agent' ? 'run_agent' : 'answer';
    if (fw === 'langchain') {
      if (s.pattern === 'rag') return [row(0, 'chain', 'RunnableSequence', 'chat turn', '1.9 s'), row(1, 'retriever', 'VectorStoreRetriever', '4 documents', '0.2 s'), row(1, 'chain', 'ChatPromptTemplate', '', ''), llmRow(1, s)];
      if (s.pattern === 'agent') return [row(0, 'agent', 'LangGraph agent', 'chat turn', '3.1 s'), llmRow(1, s, '240 → 32 tokens'), row(1, 'tool', 'lookup_order', 'tool input and output', '0.1 s'), llmRow(1, s, '310 → 64 tokens')];
      return [row(0, 'chain', 'Chat turn', '', '1.5 s'), llmRow(1, s, '48 → 96 tokens')];
    }
    if (fw === 'openai-agents') {
      const t = s.pattern === 'rag' ? 'search_docs' : 'lookup_order';
      if (s.pattern === 'single') return [row(0, 'agent', 'Agent workflow', 'conversation', '1.6 s'), row(1, 'agent', 'Support agent', '', ''), llmRow(2, s, '48 → 96 tokens')];
      return [row(0, 'agent', 'Agent workflow', 'conversation', '3.2 s'), row(1, 'agent', 'Support agent', '', ''), llmRow(2, s, '240 → 32 tokens'), row(2, 'tool', t, s.pattern === 'rag' ? '4 documents' : 'tool input and output', '0.2 s'), llmRow(2, s, '410 → 88 tokens')];
    }
    if (fw === 'semantic-kernel') {
      const base = [row(0, 'chain', 'Semantic Kernel invocation', 'chat turn', '1.9 s')];
      if (s.pattern === 'rag') base.push(row(1, 'retriever', 'docs.search', 'function call', '0.2 s'));
      if (s.pattern === 'agent') base.push(row(1, 'tool', 'orders.lookup', 'function call', '0.1 s'));
      base.push(llmRow(1, s));
      return base;
    }
    if (fw === 'claude-agent-sdk') return [row(0, 'agent', 'Claude Agent query', 'one prompt', '6.2 s'), llmRow(1, s, '1.2k → 210 tokens'), row(1, 'tool', 'Read', 'tool input and output', '0.1 s'), llmRow(1, s, '1.9k → 320 tokens')];
    if (s.pattern === 'rag') return [row(0, 'chain', root, 'chat turn', '1.8 s'), row(1, 'retriever', 'retrieve', '4 documents', '0.2 s'), llmRow(1, s)];
    if (s.pattern === 'agent') return [row(0, 'agent', root, 'chat turn', '3.0 s'), llmRow(1, s, '60 → 8 tokens'), row(1, 'tool', 'lookup_order', 'tool input and output', '0.1 s'), llmRow(1, s, '240 → 90 tokens')];
    return [row(0, 'llm', 'answer', 'chat turn', '1.5 s'), llmRow(1, s, '48 → 96 tokens')];
  }
  function mlPreview(s) {
    const cls = s.mlTask === 'classification';
    return { table: true, cols: cls ? ['CreditScore', 'Geography', 'Age', 'Balance', 'predictions', 'prediction_scores', 'inference_id'] : ['CreditScore', 'Geography', 'Age', 'Balance', 'predictions', 'inference_id'],
      rows: cls ? [['600', 'France', '40', '100000', '1', '[0.15, 0.85]', 'a1b2c3'], ['710', 'Spain', '29', '23000', '0', '[0.91, 0.09]', 'd4e5f6']] : [['600', 'France', '40', '100000', '42.0', 'a1b2c3'], ['710', 'Spain', '29', '23000', '57.5', 'd4e5f6']] };
  }

  // ───────────────────────── Safety summary, verify, checks ─────────────────────────
  function safetyFor(s, ctx) {
    const host = ctx.host;
    const onprem = s.where === 'onprem';
    const L = []; const R = [];
    const ml = s.pattern === 'ml';
    const addRedaction = () => {
      if (ml) R.push({ h: 'Redaction', p: s.pii ? 'PII redaction is for **LLM projects**. For tabular data, publish only the columns you need.' : 'PII redaction applies to LLM projects. For tabular data, publish only the columns you need.' });
      else if (s.pii) R.push({ h: 'Redaction: on', p: 'Openlayer redacts personal data from trace data **before it is stored** (Project settings → General → Privacy). The data still reaches ' + host + ' first, so redaction limits what is **kept**, not what is sent.', badge: 'ON' });
      else R.push({ h: 'Redaction: off', p: 'Traces are stored as sent. You can turn on PII redaction at any time in **Project settings → General → Privacy**; it applies before storage.', badge: 'OFF' });
    };
    const lives = onprem ? 'Everything stays in **your own infrastructure**: traces go to your Openlayer deployment at ' + host + '.' : 'Stored in **Openlayer Cloud** (SOC 2 Type II).';
    const mode = ctx.mode;
    if (mode === 'pull') {
      L.push({ h: 'Access', p: 'Openlayer connects to ' + ctx.api + ' with **read-only credentials you create**. Nothing is installed in your app or tenant, and no traffic is rerouted.' });
      L.push({ h: 'Inbound', p: '**None** to your app. The only connection is Openlayer calling ' + ctx.api + (onprem ? '. Your Openlayer host needs **outbound HTTPS** to it.' : '.') });
      L.push({ h: 'Impact on users', p: 'Openlayer reads on a schedule. If Openlayer is down or the credential is revoked, your system carries on unchanged.' });
      R.push({ h: 'What is read', p: cap(ctx.data) + '.' });
      addRedaction();
      R.push({ h: 'Where the data lives', p: lives });
      R.push({ h: 'How to undo it', p: ctx.revoke });
    } else {
      L.push({ h: 'Outbound', p: ctx.pushFrom + ' makes **outbound HTTPS only**, to **' + host + '**' + (/^http:/.test(ctx.baseOrigin || '') ? ' (plain HTTP: confirm your network policy allows it)' : ' on :443') + '. Your LLM calls still go straight to your provider; Openlayer is **not in the request path**.' });
      L.push({ h: 'Inbound', p: '**None.** Nothing calls into ' + (ctx.inboundWho || 'your app') + ', no ports are opened, and no agent or sidecar is installed.' });
      L.push({ h: 'Impact on users', p: ctx.nonBlocking });
      if (ctx.route === 'init') L.push({ h: 'Who edits the code', p: '`openlayer init` runs a coding agent **already on the developer\'s machine** (' + CLI.agents + ') and asks before it edits anything. The agent is told not to run your app and not to commit, so the change reaches users only through your normal review.' });
      R.push({ h: 'What leaves your environment', p: cap(ctx.data) + '.' });
      addRedaction();
      R.push({ h: 'Where the data lives', p: lives });
      R.push({ h: 'Credentials', p: ctx.route === 'init'
        ? 'One Openlayer API key. The wizard saves the key you signed in with to `' + CLI.envFile + '`, which is gitignored. For deployed environments, create a **dedicated key** so it can be rotated or revoked on its own.'
        : 'One Openlayer API key' + (ctx.mode === 'push-managed' ? ' in the managed settings' : ' as an environment variable') + '. Create a **dedicated key** so it can be rotated or revoked on its own.' });
      R.push({ h: 'How to undo it', p: ctx.undo });
    }
    return { left: L, right: R };
  }
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  function verifyFor(s, ctx) {
    const A = s.run === 'yes';
    const steps = [];
    const lookFor = ctx.trace && ctx.trace.length ? ' You should see ' + (ctx.trace.length > 1 ? 'a trace with these steps: ' + ctx.trace.map((r) => r.n).join(' → ') + '.' : 'one trace.') : '';
    if (ctx.mode === 'pull') {
      if (A) {
        steps.push({ t: 'Create the access', d: 'Work through "' + ctx.change.heading + '" above. Most of it is admin consoles, so have the right person in the call.' });
        steps.push({ t: 'Connect it in Openlayer and sync', d: 'Connect, then trigger a sync if the integration has **Sync now**.' });
      } else {
        steps.push({ t: 'Hand the checklist to the admin', d: 'Send this page\'s link. The access is created by whoever owns the ' + ctx.title + ' admin console. Nothing is needed from the app team.' });
        steps.push({ t: 'Connect it in Openlayer afterwards', d: 'Once the access exists, connect it in Openlayer and start a sync.' });
      }
      steps.push({ t: 'Open the Data page and check', d: ctx.delay + (ctx.trace.length > 1 ? ' Expect a trace shaped like the preview above.' : '') });
    } else if (ctx.route === 'init') {
      const L = CLI.labels;
      const runOne = ctx.runText || (s.pattern === 'ml' ? 'Call `predict(...)` once.' : 'Send one real question through the app, the same way a user would.');
      const deployVars = 'set the values from `' + CLI.envFile + '` in ' + (A ? 'each deployed' : 'the dev') + ' environment (the file is gitignored, so it does not travel with the code)';
      if (A) {
        steps.push({ t: 'Run `openlayer init` in the app\'s repository', d: 'Start from a clean Git working tree so the agent\'s edit is easy to see. Follow the picks in "Your change" above.' });
        steps.push({ t: 'Review the edit', d: 'Run `git diff` and compare it with the tested reference above. Nothing is committed for you. If the wizard says the agent could not finish, add the missing lines from the **By hand** tab.' });
        steps.push({ t: 'Run one request when the wizard asks', d: runOne + ' The wizard waits, then prints **' + L.received + '**' });
        steps.push({ t: 'Open the Data page and check', d: 'In your Openlayer project, open **Data**.' + lookFor + ' Nothing there? In the wizard, choose **' + L.debug + ' …**, or check that the app loads `' + CLI.envFile + '`.' });
        steps.push({ t: 'Commit, then set up the deployed environment', d: 'Commit the edit through your normal review, and ' + deployVars + '.' });
      } else {
        steps.push({ t: 'Send this page to the app owner', d: 'They run `openlayer init` in the app\'s repository and follow the picks in "Your change" above. It runs on a developer machine with the code checked out, not on a server.' });
        steps.push({ t: 'Skip the live check if the app cannot run locally', d: 'When the wizard waits for traces, they choose **' + L.skip + '**.' });
        steps.push({ t: 'It ships with your next dev deploy', d: 'They commit the edit through your normal review and ' + deployVars + '. **Traces arrive at your next dev deploy.**' });
        steps.push({ t: 'After the deploy, check once', d: 'Send one request, then open the project\'s **Data** page.' + lookFor });
      }
    } else {
      if (A) {
        steps.push({ t: 'Apply the change in a dev environment', d: ctx.mode === 'push-managed' ? 'Put the block in managed settings (or a local managed-settings file to try it on one machine first).' : ctx.noCode ? 'Work through the checklist above.' : 'Add the lines from the diff, set the environment variables, and restart the app.' });
        steps.push({ t: 'Run one request', d: ctx.mode === 'push-managed' ? 'Open Claude Code and send one prompt.' : s.pattern === 'ml' ? 'Call `predict(...)` once.' : 'Send one real question through the app, the same way a user would.' });
        steps.push({ t: 'Open the Data page and check', d: 'In your Openlayer project, open **Data**.' + lookFor + (s.where === 'onprem' ? ' Nothing there? The first thing to check is that `OPENLAYER_BASE_URL` ends in `/v1`.' : ' Nothing there? Check the API key and pipeline ID.') });
      } else {
        steps.push({ t: 'Send the change to the app owner', d: 'Send this page\'s link: the diff and the env vars are exactly what they need. Nothing needs to be installed on a server.' });
        steps.push({ t: 'It ships with your next dev deploy', d: '**Traces arrive at your next dev deploy.** Nothing shows up in Openlayer until that deploy runs.' });
        steps.push({ t: 'After the deploy, check once', d: 'Send one request, then open the project\'s **Data** page.' + lookFor });
      }
    }
    if (s.pii && s.pattern !== 'ml') steps.push({ t: 'Turn on PII redaction', d: 'Project **Settings → General → Privacy → PII redaction**, then choose the entity types. Set **Languages** to match your traces first.' });
    const al = ALERTS.find((a) => a.id === s.alert);
    steps.push({ t: 'Route alerts to ' + al.label, d: al.where + '. Tests that fail will notify you there.' });
    return steps;
  }

  function checksFor(s) {
    const out = [];
    const rag = s.pattern === 'rag';
    for (const w of WORRIES) {
      if (!s.worries.includes(w.id)) continue;
      for (const c of w.checks) {
        if (c.rag && !rag) continue;
        out.push({ worry: w.label, name: c.name, why: c.why, needs: c.needs || '', url: TEST_URL(c.slug) });
      }
    }
    return out;
  }

  function cardText(s, plan, link) {
    const al = ALERTS.find((a) => a.id === s.alert);
    const lines = [
      '# Use case card' + (s.name ? ': ' + s.name : ''),
      '',
      '- **Pattern:** ' + PATTERNS.find((p) => p.id === s.pattern).label,
      '- **How it is built:** ' + plan.headline,
      '- **Where Openlayer runs:** ' + (s.where === 'onprem' ? 'On-prem' + (plan.base.ok ? ' (' + plan.base.url + ')' : '') : 'Openlayer Cloud'),
      '- **Can run it in the session:** ' + (s.run === 'yes' ? 'Yes' : 'No, will ship with the next dev deploy'),
      '- **What worries you:** ' + (s.worries.length ? s.worries.map((id) => WORRIES.find((w) => w.id === id).label).join(', ') : 'nothing ticked yet'),
      '- **Starter checks:** ' + (plan.checks.length ? plan.checks.map((c) => c.name).join(', ') : 'none yet'),
      '- **PII redaction:** ' + (s.pattern === 'ml' ? 'n/a (tabular)' : s.pii ? 'On' : 'Off'),
      '- **Alerts:** ' + al.label,
      '- **Your change:** ' + plan.changeSummary,
    ];
    if (plan.route) lines.push('- **How the change is made:** ' + (plan.route === 'init' ? '`openlayer init` (a coding agent writes it, you review it)' : 'By hand'));
    if (link) lines.push('', 'Planner link: ' + link);
    return lines.join('\n');
  }

  // ───────────────────────── Completed questionnaire (the Word export) ─────────────────────────
  // Mirrors the client questionnaire in fde-hub/notes/playbooks/use-case-integration-questionnaire.md (same sections and
  // numbers) so the export can stand in for it before the session. Each row is:
  //   'answered'  taken from a planner choice
  //   'partial'   the planner covers part of it; `todo` says what is still missing
  //   'confirm'   the planner does not ask it; `todo` says what to ask
  //   'na'        does not apply to the chosen path
  // Questions 5.2 and 5.3 (CI) are left out on purpose: the planner does not show the CI gate.
  // Returns plain data only. public/instrument/docx.js turns it into a .docx file.
  // The Word export follows the client questionnaire ("Before your next integration session"):
  // the use case, how it is built, the work machine, running it, and what to check.
  // It is Monitoring mode only. The code-and-pipeline section of that form (development mode) is left out.
  function questionnaire(input, opts) {
    const o = opts || {};
    const s = sanitize(input);
    const plan = buildPlan(s);
    const ml = s.pattern === 'ml';
    const sdk = !!plan.test; // a code change that installs a package
    const connector = !sdk && s.how !== 'otel'; // vendor, table, Openlayer Gateway: nothing changes in the app
    // A developer machine is involved only when someone installs or edits something there.
    const machine = s.how === 'own' || s.how === 'otel' || (s.how === 'gateway' && s.gateway !== 'openlayer-gateway');
    const runsCode = machine && !connector; // 4.1 and 4.2: can the use case be run, and can it call its LLM
    const alert = ALERTS.find((a) => a.id === s.alert);
    const name = s.name.trim();
    const blank = (ref, q, todo, fallback) => ({ ref, q, a: '', choices: null, status: 'confirm', todo, fallback: fallback || '' });
    const boxes = (ref, q, options, todo, fallback) => ({ ref, q, a: '', choices: options.map((label) => ({ label, on: false })), status: 'confirm', todo, fallback: fallback || '' });
    const ticked = (ref, q, options, onIds, todo) => {
      const on = new Set(onIds);
      const choices = options.map((o) => ({ label: o.label, on: on.has(o.id) }));
      return { ref, q, a: options.filter((o) => on.has(o.id)).map((o) => o.label).join(', '), choices, status: todo ? 'partial' : 'answered', todo: todo || '', fallback: '' };
    };
    const textRow = (ref, q, a, todo) => ({ ref, q, a, choices: null, status: todo ? 'partial' : 'answered', todo: todo || '', fallback: '' });
    const na = (ref, q, why) => ({ ref, q, a: why, choices: null, status: 'na', todo: '', fallback: '' });

    const where = s.where === 'onprem' ? 'On-prem' + (plan.base.ok ? ' · ' + plan.base.url : '') : 'Openlayer Cloud';
    const delivery = plan.route === 'init' ? 'With `openlayer init` (a coding agent writes the change)'
      : plan.route === 'hand' ? 'By hand (the developer adds the lines)' : 'Nothing to change in the application';
    const session = connector ? 'Access is set up ' + (s.run === 'yes' ? 'in the session' : 'after the session')
      : s.run === 'yes' ? 'Can be run in the session' : 'Ships with the next dev deploy';

    const typeOptions = [
      { id: 'rag', label: 'Chatbot or Q&A over documents (RAG)' },
      { id: 'agent', label: 'Agent that calls tools' },
      { id: 'single', label: 'Single LLM call (summarize, classify, extract)' },
      { id: 'ml', label: 'Classic ML (tabular model, no LLM)' },
    ];
    const builtOptions = [
      { id: 'own', label: 'Our own code' },
      { id: 'otel', label: 'OpenTelemetry (the app already emits traces)' },
      { id: 'vendor', label: "A vendor's agent builder or product" },
      { id: 'gateway', label: 'Models served through a gateway' },
      { id: 'table', label: 'Logs in a table' + (s.how === 'table' ? ': ' + TABLES[s.table].label : '') },
    ];
    const yn = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }, { id: 'unsure', label: 'Not sure' }];
    const risks = [
      { id: 'hallucination', label: 'Wrong or made-up answers' },
      { id: 'grounding', label: 'Answers not backed by your documents' },
      { id: 'pii', label: 'Personal data in answers' },
      { id: 'injection', label: 'Prompt injection or misuse' },
      { id: 'harm', label: 'Tone or brand' },
      { id: 'latency', label: 'Speed' },
      { id: 'cost', label: 'Cost' },
    ];
    const riskOn = s.worries.filter((id) => risks.some((r) => r.id === id));
    if (s.pattern === 'rag' && s.worries.includes('hallucination')) riskOn.push('grounding');
    const otherRisks = s.worries.filter((id) => !risks.some((r) => r.id === id)).map((id) => WORRIES.find((w) => w.id === id).label);

    const useCase = [
      name ? textRow('1.1', "What's the use case called, and what does it do? (one or two sentences)", name, 'What the use case does, in one or two sentences')
        : blank('1.1', "What's the use case called, and what does it do? (one or two sentences)", 'The use case name, and what it does in one or two sentences'),
      blank('1.2', 'Who owns it?', 'Name and team of the owner'),
      boxes('1.3', 'What stage is it at?', ['Prototype', 'In testing', 'Live in production', 'Other'], 'Stage: prototype, in testing, or live in production'),
      boxes('1.4', 'Where does it run today?', ["A developer's machine", 'Dev', 'Staging', 'Production', 'Other'], 'The environments it runs in today'),
      boxes('1.5', 'Who uses it?', ['Customers', 'Employees', 'Both', 'Other'], 'Who uses the output'),
      ticked('1.6', 'What type is it?', typeOptions, [s.pattern]),
    ];

    const built = [
      ticked('2.1', 'How is it built?', builtOptions, [s.how]),
      machine && s.how !== 'table' ? boxes('2.2', 'Apart from LLM providers, does the use case need to access other external systems? (for example RAG systems, vector databases, search services or other databases)', ['No', 'Yes (name the systems)', 'Not sure'], 'The external systems the app calls, and whether anything stops Openlayer from reaching them')
        : na('2.2', 'Apart from LLM providers, does the use case need to access other external systems?', 'No application code calls external systems on this path'),
    ];
    const blocks = [{ title: '', note: '', rows: built }];
    if (s.how === 'vendor') {
      const vendors = Object.keys(VENDORS).map((id) => ({ id, label: VENDORS[id].label }));
      blocks.push({ title: "A vendor's agent builder or product", note: 'Only because 2.1 is a vendor product.', rows: [
        ticked('2.3', 'Which product, exactly?', vendors, [s.vendor], 'Edition or plan, and whether export is enabled'),
        blank('2.4', 'Who administers it on your side?', 'Name and email of the administrator'),
        boxes('2.5', 'Is the feature we need generally available, or a preview that must be switched on?', ['Generally available', 'Preview', 'Not sure'], 'Whether the feature is generally available or a preview'),
      ] });
    }
    if (s.how === 'gateway') {
      blocks.push({ title: 'Models served through a gateway', note: 'Only because 2.1 is a gateway. The gateway here is ' + GATEWAYS[s.gateway].label + '.', rows: [
        textRow('2.6', 'Which gateway, and which models does it serve?', GATEWAYS[s.gateway].label, 'Which models it serves'),
        boxes('2.7', 'Do all calls go through the gateway, or can some bypass it?', ['All', 'Some bypass', 'Not sure'], 'Whether every call goes through the gateway'),
        blank('2.8', 'Which projects and environments should the first tests cover? (Start with one.)', 'The first project and environment to cover'),
      ] });
    }

    const cliFallback = 'We send the tool and its checksum ahead of time, so it can be approved before the session.';
    const machineRows = machine ? [
      plan.route ? boxes('3.1', 'Can you install a command-line tool on your work machine? (the Openlayer CLI: ' + CLI.docs + ')', ['Yes', 'Only through an internal software portal or mirror', 'No', 'Not sure'], 'Whether the developer can install the Openlayer CLI', cliFallback)
        : na('3.1', 'Can you install a command-line tool on your work machine?', 'The CLI is not used on this path'),
      plan.route ? boxes('3.2', 'Can your machine reach downloads.openlayer.com (on or off VPN)?', ['Yes', 'No', 'Not sure'], 'Whether the machine can reach downloads.openlayer.com', cliFallback)
        : na('3.2', 'Can your machine reach downloads.openlayer.com?', 'The CLI is not used on this path'),
      boxes('3.3', 'Can you open your Openlayer workspace in a browser and sign in?', ['Yes', 'No', 'Not sure'], 'That the developer can sign in to Openlayer', "We'll sort out access with your platform team before the session."),
      plan.change.install ? boxes('3.4', 'Can you install Python or npm packages? Needed: ' + plan.change.install, ['Yes', 'Only through an internal mirror', 'No', 'Not sure'], 'How packages are installed: the public internet or an internal mirror', "We'll check the Openlayer package is available in your mirror.")
        : na('3.4', 'Can you install Python or npm packages?', 'No package to install on this path'),
      boxes('3.5', 'Which operating system do you use?', ['macOS', 'Windows', 'Linux', 'Other'], 'The operating system on the work machine'),
      plan.route === 'init' ? Object.assign(boxes('3.6', 'Are you allowed to use an AI coding assistant on this code (Claude Code, GitHub Copilot, Codex)?', ['Yes', 'No', 'Not sure'], 'That an AI coding assistant is allowed on this repository', "No problem. We'll add Openlayer to the code by hand, step by step."), { status: 'partial', a: 'Planner route: `openlayer init`, which uses a coding agent' })
        : plan.route === 'hand' ? Object.assign(boxes('3.6', 'Are you allowed to use an AI coding assistant on this code (Claude Code, GitHub Copilot, Codex)?', ['Yes', 'No', 'Not sure'], 'Nothing further if a coding assistant is simply not wanted', "No problem. We'll add Openlayer to the code by hand, step by step."), { status: 'partial', a: 'Planner route: by hand, so the session does not depend on a coding agent' })
          : na('3.6', 'Are you allowed to use an AI coding assistant on this code?', 'No coding agent on this path'),
    ] : [];

    const runRows = runsCode ? [
      ticked('4.1', 'Can you run it on your machine or in a dev environment you control?', yn, [s.run === 'yes' ? 'yes' : 'no']),
      ml ? na('4.2', 'When it runs there, can it call its LLM, and do you have the credentials to do so?', 'This use case has no LLM')
        : boxes('4.2', 'When it runs there, can it call its LLM, and do you have the credentials to do so?', ['Yes', 'No', 'Not sure'], 'That the environment has working LLM credentials, and who can issue them', "We'll use a made-up dataset and a test commit so we can still walk through the flow."),
    ] : [];
    // 4.1's "No" has a prepared fallback; a "Yes" does not need one.
    if (runRows[0] && s.run === 'no') runRows[0].fallback = 'We add Openlayer and test the wiring. Real traces start flowing when it is next deployed to dev or staging.';

    const riskRow = s.worries.length
      ? ticked('5.1', 'Which risks matter most for this use case? (tick up to 3)', risks.concat(otherRisks.map((label) => ({ id: 'other-' + label, label: 'Other: ' + label }))), riskOn.concat(otherRisks.map((label) => 'other-' + label)))
      : boxes('5.1', 'Which risks matter most for this use case? (tick up to 3)', risks.map((r) => r.label), 'The top risks to monitor first (nothing was ticked in the planner)');
    if (s.pii) riskRow.note = 'PII redaction: wanted';
    const checkRows = [
      riskRow,
      blank('5.2', 'What would a bad answer cost you?', 'What a bad answer or action would cost'),
      s.alert === 'inapp' ? textRow('5.3', 'Where should a failing check notify you?', 'In the Openlayer app')
        : textRow('5.3', 'Where should a failing check notify you?', alert.label, 'The exact ' + (s.alert === 'slack' ? 'Slack channel' : s.alert === 'email' ? 'email address' : 'webhook URL')),
    ];

    const sections = [
      { title: '1. The new AI use case', note: '', fallback: false, blocks: [{ title: '', note: '', rows: useCase }] },
      { title: "2. How it's built", note: 'The ticked option is how the use case is built, and it decides the Openlayer integration.', fallback: false, blocks },
      { title: '3. Your work machine', note: machine ? 'A "No" is fine. It tells us which workaround to bring.' : 'Skipped. This path has nothing to install on a work machine.', fallback: true, blocks: machineRows.length ? [{ title: '', note: '', rows: machineRows }] : [] },
      { title: '4. Running the use case', note: runsCode ? '' : 'Skipped. Nothing runs on a developer machine on this path; the session plan is in the summary above.', fallback: true, blocks: runRows.length ? [{ title: '', note: '', rows: runRows }] : [] },
      { title: '5. What you want to check', note: 'These are the live checks for Monitoring mode.', fallback: false, blocks: [{ title: '', note: '', rows: checkRows }] },
    ];
    const rows = sections.reduce((all, sec) => all.concat(sec.blocks.reduce((a, b) => a.concat(b.rows), [])), []);
    const counts = { answered: 0, partial: 0, confirm: 0, na: 0 };
    for (const r of rows) counts[r.status] += 1;

    const ready = [{ t: 'You can sign in to your Openlayer workspace in a browser.', applies: 'Everyone' }];
    if (plan.route) ready.push({ t: 'Openlayer CLI installed. `openlayer --version` prints a version.', applies: 'Own code, where the CLI is used' });
    if (s.how === 'own' || (s.how === 'gateway' && s.gateway !== 'openlayer-gateway')) ready.push({ t: 'The code is cloned on your machine, on a new branch.', applies: 'Own code' });
    if (runsCode && s.run !== 'no') ready.push({ t: 'The use case runs and can call its LLM.', applies: ml ? 'Own code' : 'Own code (skip if 4.1 is No)' });
    if (s.how === 'vendor' || s.how === 'gateway') ready.push({ t: 'The access we need to your vendor product or gateway data is requested, or already granted.', applies: 'Vendor product or gateway' });

    const c = plan.change;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'use-case';
    return {
      title: 'Before your next integration session' + (name ? ': ' + name : ''),
      filename: 'openlayer-questionnaire-' + slug + '.docx',
      date: o.date || '', link: o.link || '',
      intro: [
        'Filled in from the Openlayer Instrumentation Planner' + (o.date ? ' on ' + o.date : '') + '. Ticked boxes are what was chosen there. An empty box was not asked, so it is still open for the session.',
        'This session covers two things: the use case, and its Openlayer integration. The integration is Monitoring mode, live traces from the running use case into Openlayer.',
        'Please do not add passwords, keys or tokens. Names of systems and owners are enough. Sections marked skipped do not apply to this use case.',
      ],
      counts,
      summary: [
        ['Use case', name || 'Not named yet'],
        ['Openlayer mode', 'Monitoring mode'],
        ['Integration path', plan.headline],
        ['How the change is made', delivery],
        ['Where Openlayer runs', where],
        ['Session', session],
      ],
      sections,
      confirm: rows.filter((r) => r.todo).map((r) => ({ ref: r.ref, q: r.q, todo: r.todo })),
      ready,
      change: {
        heading: c.heading || 'Your change',
        route: plan.route,
        intro: plan.route === 'init' ? 'Monitoring mode for this use case, with `openlayer init`. A coding agent writes the change and the developer reviews it against the tested reference below.'
          : plan.route === 'hand' ? 'Monitoring mode for this use case, added by hand. The developer adds the lines below.' : c.intro || '',
        wizard: c.wizard ? { run: c.wizard.run, minVersion: c.wizard.minVersion, docs: c.wizard.docs, picks: c.wizard.picks } : null,
        install: c.install || '', file: c.file || '', lines: c.lines || [],
        envFile: c.envText ? (c.envFile || '') : '', envText: c.envText || '',
        items: c.kind === 'checklist' ? c.items : [],
        after: c.after || '',
        notes: (c.notes || []).map((n) => n.text),
      },
      trace: plan.trace || [],
      checks: plan.checks,
      verifyTitle: s.run === 'yes' ? 'Check it works' : 'Hand-off checklist',
      verify: plan.verify,
    };
  }

  // ───────────────────────── The plan ─────────────────────────
  function buildPlan(input) {
    const s = sanitize(input);
    const base = s.where === 'onprem' ? normalizeBaseUrl(s.host) : { ok: true, url: CLOUD_BASE, origin: 'https://' + CLOUD_HOST, host: CLOUD_HOST };
    const host = s.where === 'onprem' ? (base.ok ? base.host : '<your-openlayer-host>') : CLOUD_HOST;
    // `route` is null on paths where `openlayer init` does not apply (OpenTelemetry and the no-code paths).
    const route = routeApplies(s) ? s.route : null;
    const plan = { state: s, base, host, onprem: s.where === 'onprem', notes: [], kind: '', headline: '', change: null, scene: null, trace: [], traceTable: null, safety: null, verify: [], checks: checksFor(s), test: null, changeSummary: '', route, routes: route ? ROUTES : null };

    const finishCode = (code, kind) => {
      const counts = countLines(code.lines);
      const env = kind === 'otel' ? otelEnv(s, base) : route === 'init' ? wizardEnv(s, base) : openlayerEnv(s, base);
      plan.change = { kind: 'diff', heading: 'Your change', file: code.file, lang: code.lang, lines: code.lines, added: counts.added, removed: counts.removed, envText: env.text, envCount: env.count, envFile: route === 'init' ? CLI.envFile : '.env', install: code.install, notes: (code.notes || []).slice(), source: code.source, wizard: null };
      // The snippet under test is the same on both routes: with `openlayer init` it is the reference the agent's edit is reviewed against.
      plan.test = { lang: code.lang, code: afterCode(code.lines), prelude: code.prelude || '', entry: code.entry, async: !!code.async, otel: !!code.otel, ml: !!code.ml, ts: code.lang === 'typescript' };
      plan.changeSummary = '+' + counts.added + (counts.removed ? ' −' + counts.removed : '') + ' lines · ' + env.count + ' env vars';
      if (route === 'init') {
        const w = wizardFor(s, base, code);
        plan.change.wizard = w;
        plan.change.notes = w.notes.concat(plan.change.notes);
        plan.change.envHint = 'The wizard fills these in. `' + CLI.envFile + '` is gitignored and holds the key you signed in with, so each deployed environment needs the same variables set, with a dedicated API key.';
        plan.changeSummary = '1 command · about ' + counts.added + ' line' + (counts.added === 1 ? '' : 's') + ' added';
      } else if (route === 'hand') {
        plan.change.notes.push({ kind: 'info', text: 'Short of a project or a pipeline ID? `openlayer init` can create the project, the pipeline and `' + CLI.envFile + '` without touching your code: choose **' + CLI.labels.manual + '** when it asks how to add Openlayer.' });
      }
    };
    const nonBlockingFor = (code) => code.lang === 'typescript'
      ? 'Traces are uploaded **asynchronously**: the request does not wait for the upload. Failures are logged and never thrown into your code path.'
      : code.ml ? 'Publishing runs on a **single background worker** (see the snippet) and swallows errors, so a slow or unreachable Openlayer never delays or fails a prediction.'
        : code.otel ? 'Spans are exported in **batches** by the OpenTelemetry SDK, off the request path.'
          : 'Traces are published from a **background thread** with a bounded queue (100 traces). If Openlayer is slow or unreachable, extra traces are **dropped and logged**: a user request is never delayed or failed.';
    const undoFor = (code, n, kind) => {
      if (kind === 'otel') return 'Remove the added lines and unset the two `OTEL_*` variables.';
      const remove = route === 'init' ? 'Revert the agent\'s edit in Git' : 'Remove the ' + n + ' added lines (the diff shows all of them)';
      return remove + ' and unset the Openlayer environment variables.' + (code.ml || code.otel ? '' : ' To stop sending **without a code change**, set `OPENLAYER_DISABLE_PUBLISH=true` and restart.');
    };

    const sdkSafety = (code, kind, extra) => {
      const ctx = { host, baseOrigin: base.origin, mode: 'push', route, pushFrom: 'Your app', data: s.pattern === 'ml' ? 'the feature values, predictions and scores you publish' : 'prompts, model outputs, retrieved documents, tool inputs and outputs, plus model, tokens, latency and cost for each step',
        nonBlocking: nonBlockingFor(code), undo: undoFor(code, plan.change.added, kind) };
      return Object.assign(ctx, extra || {});
    };

    if (s.how === 'own') {
      let code;
      if (s.pattern === 'ml') code = pyML(s.mlTask);
      else if (s.lang === 'python') code = s.fw === 'direct' ? pyDirect(s.prov, s.pattern) : s.fw === 'langchain' ? pyLangchain(s.prov, s.pattern) : s.fw === 'openai-agents' ? pyOpenAIAgents(s.pattern) : s.fw === 'semantic-kernel' ? pySemanticKernel(s.prov, s.pattern) : pyClaudeAgent();
      else code = s.fw === 'direct' ? tsDirect(s.prov, s.pattern) : s.fw === 'langchain' ? tsLangchain(s.prov, s.pattern) : tsClaudeAgent();
      const isOtel = !!code.otel;
      plan.kind = isOtel ? 'otel-app' : s.pattern === 'ml' ? 'ml' : 'sdk';
      const lang = LANGS.find((l) => l.id === s.lang).label;
      plan.headline = s.pattern === 'ml' ? 'Own code: Python · ' + s.mlTask + ' model' : 'Own code: ' + lang + ' · ' + FRAMEWORKS[s.fw].label + (FRAMEWORKS[s.fw].langs[s.lang].length > 1 ? ' · ' + PROVIDERS[s.prov].label : '');
      finishCode(code, isOtel ? 'otel' : 'sdk');
      if (isOtel) plan.change.notes.push({ kind: 'info', text: 'This path is set up by hand. `openlayer init` is not offered here because the skill its coding agent follows does not cover OpenTelemetry.' });
      if (s.lang === 'typescript' && s.where === 'onprem') plan.change.notes.push({ kind: 'warn', text: 'The TypeScript SDK reads `OPENLAYER_BASE_URL` **when it is imported**. If you load a `.env` file, load `dotenv` **before** importing the SDK, or traces go to Openlayer Cloud with no error.' });
      // Only where the snippet already calls init(): on the other frameworks init() would add auto-instrumentation on top of their own integration.
      if (s.lang === 'python' && s.where === 'onprem' && s.fw === 'direct' && s.pattern !== 'ml') plan.change.notes.push({ kind: 'info', text: 'You can also set the base URL in code, which wins over the environment: `init(base_url="' + (base.ok ? base.url : 'https://<your-openlayer-host>/v1') + '")`.' });
      plan.trace = sdkTrace(s) || [];
      if (s.pattern === 'ml') plan.traceTable = mlPreview(s);
      const ctx = sdkSafety(code, isOtel ? 'otel' : 'sdk');
      plan.scene = scene(s, plan, { app: { pill: 'Openlayer SDK', sub: s.pattern === 'ml' ? 'Python · +' + plan.change.added + ' lines' : lang + ' · ' + FRAMEWORKS[s.fw].label, sub2: plan.changeSummary }, push: { from: 'app', label: isOtel ? 'OTLP/HTTPS :443 · batched' : s.lang === 'python' ? 'HTTPS :443 · background thread' : 'HTTPS :443 · async' } });
      plan.safety = safetyFor(s, ctx);
      plan.verify = verifyFor(s, Object.assign({}, ctx, { trace: plan.trace, noCode: false }));
    } else if (s.how === 'otel') {
      plan.kind = 'otel';
      plan.headline = 'OpenTelemetry: ' + (s.otelVia === 'collector' ? 'via a Collector' : 'exported by your app');
      const ep = otlpEndpoint(s, base);
      if (s.otelVia === 'collector') {
        const lines = parseDiff(join(
          ' exporters:',
          '+  otlphttp/openlayer:',
          '+    endpoint: ' + ep,
          '+    headers:',
          '+      Authorization: "Bearer ${env:OPENLAYER_API_KEY}"',
          '+      x-bt-parent: "pipeline_id:${env:OPENLAYER_PIPELINE_ID}"',
          ' ',
          ' service:',
          '   pipelines:',
          '     traces:',
          '-      exporters: [otlphttp/existing]',
          '+      exporters: [otlphttp/existing, otlphttp/openlayer]'));
        const counts = countLines(lines);
        plan.change = { kind: 'diff', heading: 'Your change', file: 'otel-collector-config.yaml', lang: 'yaml', lines, added: counts.added, removed: counts.removed,
          envText: ['# Set these where the Collector runs', 'OPENLAYER_API_KEY=<your Openlayer API key>', 'OPENLAYER_PIPELINE_ID=<your inference pipeline ID>'].join('\n'), envCount: 2, install: '', source: 'openlayer-docs/integrations/opentelemetry.mdx',
          notes: [{ kind: 'info', text: 'Give the exporter the **base** URL. It appends `/v1/traces` itself. Leave `compression` unset: the exporter uses gzip by default and Openlayer accepts it.' }] };
        plan.changeSummary = '+' + counts.added + ' −' + counts.removed + ' lines · 2 env vars';
      } else {
        const env = otelEnv(s, base);
        plan.change = { kind: 'env', heading: 'Your change', file: '.env', lang: 'bash', lines: [], added: 0, removed: 0, envText: env.text, envCount: 2, install: '', source: 'openlayer-docs/integrations/opentelemetry.mdx',
          notes: [{ kind: 'info', text: 'Some SDKs take a signal-specific setting instead, such as `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`. Those need the **full** path: `' + ep + '/v1/traces`. Openlayer expects OTLP in protobuf over HTTPS (gzip or deflate is fine).' }] };
        plan.changeSummary = 'no code · 2 env vars';
      }
      if (plan.onprem) plan.change.notes.push({ kind: 'info', text: 'On-prem, the OTLP endpoint is your API root plus `/otel`. Confirm OTLP ingestion is enabled on your deployment with your Openlayer contact.' });
      plan.change.notes.push({ kind: 'info', text: 'To group traces into sessions and users, set the `openlayer.session.id` and `openlayer.user.id` span attributes.' });
      plan.trace = (s.pattern === 'rag' ? [row(0, 'chain', 'your root span', 'chat turn', '1.9 s'), row(1, 'retriever', 'retrieval span', '4 documents', '0.2 s'), llmRow(1, { prov: 'openai' })] : s.pattern === 'agent' ? [row(0, 'agent', 'your root span', 'chat turn', '3.1 s'), llmRow(1, { prov: 'openai' }, '240 → 32 tokens'), row(1, 'tool', 'tool span', 'tool input and output', '0.1 s'), llmRow(1, { prov: 'openai' }, '310 → 64 tokens')] : [row(0, 'chain', 'your root span', 'chat turn', '1.5 s'), llmRow(1, { prov: 'openai' })]);
      const ctx = { host, baseOrigin: base.origin, mode: 'push', pushFrom: s.otelVia === 'collector' ? 'Your Collector' : 'Your app', inboundWho: s.otelVia === 'collector' ? 'your Collector or app' : 'your app', data: 'the spans your OpenTelemetry instrumentation emits: prompts, outputs, tool calls, tokens, latency and any attributes you set',
        nonBlocking: 'Spans are exported in **batches** by the OpenTelemetry exporter, off the request path.', undo: s.otelVia === 'collector' ? 'Remove the `otlphttp/openlayer` exporter and its entry in the pipeline.' : 'Unset the two `OTEL_*` variables.' };
      plan.scene = scene(s, plan, { app: { pill: 'no code change', sub: 'Already emits OpenTelemetry', sub2: plan.changeSummary }, push: { from: s.otelVia === 'collector' ? 'collector' : 'app', label: 'OTLP/HTTPS :443 · batched' }, collector: s.otelVia === 'collector' });
      plan.safety = safetyFor(s, ctx);
      plan.verify = verifyFor(s, Object.assign({}, ctx, { trace: plan.trace, noCode: true }));
    } else if (s.how === 'vendor') {
      const v = vendorPlan(s, base);
      plan.kind = v.mode === 'push' ? 'vendor-push' : 'vendor-pull';
      plan.headline = 'Vendor product: ' + v.title;
      plan.change = Object.assign({ heading: v.change.heading, file: v.change.file, lang: v.change.lang, added: v.change.lines ? countLines(v.change.lines).added : 0, removed: 0, envText: '', envCount: 0, install: '', notes: [] }, v.change);
      plan.change.heading = v.change.heading;
      plan.trace = v.trace;
      plan.changeSummary = v.noCode ? 'no code change · ' + (v.change.kind === 'checklist' ? v.change.items.length + ' setup steps' : 'one config block') : '';
      const ctx = { host, baseOrigin: base.origin, mode: v.mode === 'push' ? 'push-managed' : 'pull', title: v.title, api: v.api, data: v.data, revoke: v.revoke, delay: v.delay, change: v.change, trace: v.trace, noCode: true,
        pushFrom: 'Each developer\'s Claude Code', inboundWho: 'developers\' machines', nonBlocking: 'Spans are exported by Claude Code\'s own OpenTelemetry exporter; developer sessions do not route through Openlayer.', undo: v.revoke };
      plan.scene = scene(s, plan, { vendor: v });
      plan.safety = safetyFor(s, ctx);
      plan.verify = verifyFor(s, ctx);
      plan.delay = v.delay;
    } else if (s.how === 'gateway') {
      const g = gatewayPlan(s, base);
      if (g.mode === 'sdk') {
        plan.kind = 'sdk'; plan.headline = 'LLM gateway: ' + g.title + ' · Python';
        finishCode(g.code, 'sdk');
        plan.trace = g.trace;
        const ctx = sdkSafety(g.code, 'sdk', { data: g.data });
        plan.scene = scene(s, plan, { gateway: { title: g.title, sub: s.gateway === 'portkey' ? 'Portkey gateway' : 'LiteLLM library in your app' }, app: { pill: 'Openlayer SDK', sub: 'Python', sub2: plan.changeSummary }, push: { from: 'app', label: 'HTTPS :443 · background thread' } });
        plan.safety = safetyFor(s, ctx);
        plan.verify = verifyFor(s, Object.assign({}, ctx, { trace: plan.trace, noCode: false }));
      } else {
        plan.kind = 'gateway'; plan.headline = 'LLM gateway: Openlayer Gateway';
        plan.change = Object.assign({ file: '', lang: '', added: 0, removed: 0, envText: '', envCount: 0, install: '', notes: [] }, g.change);
        plan.trace = g.trace; plan.changeSummary = 'no code change · ' + g.change.items.length + ' setup steps';
        const ctx = { host, baseOrigin: base.origin, mode: 'push', pushFrom: 'The gateway', inboundWho: 'your apps', data: g.data, nonBlocking: 'Tracing is **fire-and-forget**: the gateway sends each trace in the background after the response has gone out, so it never slows a request and never fails one if Openlayer is unreachable.', undo: g.revoke, delay: g.delay, change: g.change, noCode: true, trace: g.trace, title: 'gateway' };
        plan.scene = scene(s, plan, { gateway: { title: 'Openlayer Gateway', sub: 'Already in your traffic path' }, app: { pill: 'no code change', sub: 'Already behind the gateway', sub2: '' }, push: { from: 'gateway', label: 'HTTPS :443 · fire-and-forget' } });
        plan.safety = safetyFor(s, ctx);
        plan.verify = verifyFor(s, ctx);
      }
    } else { // table
      const t = tablePlan(s);
      plan.kind = 'table'; plan.headline = 'Logs in a table: ' + t.title;
      plan.change = Object.assign({ heading: t.change.heading, added: t.change.lines ? countLines(t.change.lines).added : 0, removed: 0, envText: '', envCount: 0, install: '', notes: [] }, t.change);
      plan.trace = s.pattern === 'ml' ? [] : [row(0, 'chain', 'Row from your table', 'one logged request', ''), row(1, 'llm', 'Input and output columns', 'mapped to a trace', '')];
      if (s.pattern === 'ml') plan.traceTable = mlPreview(s);
      plan.changeSummary = 'no code change · ' + (t.change.kind === 'checklist' ? t.change.items.length + ' setup steps' : 'one access script');
      const ctx = { host, baseOrigin: base.origin, mode: 'pull', title: t.title + ' table', api: t.api, data: t.data, revoke: t.revoke, delay: t.delay, change: t.change, trace: plan.trace, noCode: true };
      plan.scene = scene(s, plan, { table: t });
      plan.safety = safetyFor(s, ctx);
      plan.verify = verifyFor(s, ctx);
      plan.delay = t.delay;
    }
    plan.card = cardText(s, plan, '');
    return plan;
  }

  // ───────────────────────── Diagram scene (positions are computed in the view) ─────────────────────────
  function scene(s, plan, o) {
    const ml = s.pattern === 'ml';
    const alert = ALERTS.find((a) => a.id === s.alert);
    const sc = { users: 'Users', chain: [], side: [], push: null, pull: null, openlayer: { mode: s.where, host: plan.host }, alert: alert.label, redaction: s.pii && !ml };
    const llmItem = () => ({ id: 'llm', tone: 'llm', title: ml ? 'Your model' : (PROVIDERS[s.prov] ? PROVIDERS[s.prov].label : 'Your LLM'), sub: ml ? 'scikit-learn, XGBoost, …' : (PROVIDERS[s.prov] ? PROVIDERS[s.prov].host : 'your provider'), sub2: ml ? 'scores each request' : 'calls unchanged' });
    const sides = () => {
      const out = [];
      if (s.pattern === 'rag') out.push({ id: 'ret', tone: 'ret', title: 'Retriever', sub: 'vector store / search', sub2: '4 documents per question' });
      if (s.pattern === 'agent') out.push({ id: 'tools', tone: 'tool', title: 'Tools', sub: 'APIs, databases', sub2: 'called by the agent' });
      return out;
    };
    if (o.vendor) {
      const v = o.vendor;
      if (v.developers) {
        sc.users = 'Developers';
        sc.chain = [{ id: 'app', tone: 'vendor', title: 'Claude Code', sub: 'on each developer machine', sub2: 'config via managed settings', pill: 'no code change' }, { id: 'llm', tone: 'llm', title: 'Anthropic', sub: 'api.anthropic.com', sub2: 'calls unchanged' }];
        sc.push = { from: 'app', label: 'OTLP/HTTPS :443 · from Claude Code' };
      } else {
        sc.chain = [{ id: 'app', tone: 'vendor', title: v.title, sub: 'your agent or copilot', sub2: 'runs inside the vendor', pill: 'no code change' }, { id: 'store', tone: 'store', title: v.storeTitle, sub: v.storeSub, sub2: 'already in your tenant' }];
        sc.pull = { to: 'store', label: 'read-only pull · scheduled' };
      }
    } else if (o.table) {
      const t = o.table;
      sc.chain = [{ id: 'app', tone: 'app', title: 'Your app', sub: ml ? 'serves the model' : 'already logs to a table', sub2: '', pill: 'no code change' }, llmItem()];
      sc.side = [{ id: 'store', tone: 'store', title: t.storeTitle, sub: t.storeSub, sub2: '', under: 'app' }];
      sc.sideLinks = [{ from: 'app', to: 'store', label: 'already writes logs' }];
      sc.pull = { to: 'store', label: 'read-only pull · no copy' };
    } else if (o.gateway) {
      sc.chain = [{ id: 'app', tone: 'app', title: 'Your app', sub: o.app.sub, sub2: o.app.sub2, pill: o.app.pill }, { id: 'gw', tone: 'gw', title: o.gateway.title, sub: o.gateway.sub, sub2: '' }, llmItem()];
      sc.side = sides().map((x) => Object.assign(x, { under: 'llm' }));
      sc.push = o.push;
    } else if (o.collector) {
      sc.chain = [{ id: 'app', tone: 'app', title: 'Your app', sub: o.app.sub, sub2: '', pill: o.app.pill }, llmItem()];
      sc.side = sides().map((x) => Object.assign(x, { under: 'llm' }));
      sc.push = { from: 'collector', label: o.push.label };
      sc.collector = true;
    } else {
      sc.chain = [{ id: 'app', tone: 'app', title: ml ? 'Your model service' : 'Your app', sub: o.app.sub, sub2: o.app.sub2, pill: o.app.pill }, llmItem()];
      sc.side = sides().map((x) => Object.assign(x, { under: 'llm' }));
      sc.push = o.push;
    }
    return sc;
  }

  // ───────────────────────── Share link (all choices live in the URL; nothing secret is ever stored) ─────────────────────────
  const QUERY_KEYS = { name: 'n', pattern: 'pat', how: 'how', lang: 'lang', fw: 'fw', prov: 'prov', vendor: 'vendor', gateway: 'gw', table: 'tbl', otelVia: 'via', mlTask: 'mlt', where: 'where', host: 'host', run: 'run', worries: 'w', pii: 'pii', alert: 'alert', route: 'route' };
  function toQuery(state) {
    const s = sanitize(state);
    const d = sanitize({});
    const p = new URLSearchParams();
    for (const [k, q] of Object.entries(QUERY_KEYS)) {
      let v = s[k];
      if (k === 'worries') { if (v.length) p.set(q, v.join(',')); continue; }
      if (k === 'pii') { if (v) p.set(q, '1'); continue; }
      if (k === 'host' && s.where !== 'onprem') continue;
      // Leave out choices that do not apply to the chosen path, so links stay short.
      if (['lang', 'fw', 'prov'].includes(k) && (s.how !== 'own' || s.pattern === 'ml')) continue;
      if (k === 'vendor' && s.how !== 'vendor') continue;
      if (k === 'gateway' && s.how !== 'gateway') continue;
      if (k === 'table' && s.how !== 'table') continue;
      if (k === 'otelVia' && s.how !== 'otel') continue;
      if (k === 'mlTask' && s.pattern !== 'ml') continue;
      if (k === 'route' && !routeApplies(s)) continue;
      if (v === '' || v === d[k]) continue;
      p.set(q, v);
    }
    return p.toString();
  }
  function fromQuery(search) {
    const p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const raw = {};
    for (const [k, q] of Object.entries(QUERY_KEYS)) if (p.has(q)) raw[k] = p.get(q);
    if (raw.worries !== undefined) raw.worries = raw.worries.split(',').filter(Boolean);
    if (raw.pii !== undefined) raw.pii = raw.pii === '1';
    return sanitize(raw);
  }

  return {
    toQuery, fromQuery,
    SDK_VERSIONS, CLOUD_HOST, CLOUD_BASE, DOCS, DEFAULTS, PATTERNS, HOWS, LANGS, PROVIDERS, FRAMEWORKS, VENDORS, GATEWAYS, TABLES, OTEL_VIA, ML_TASKS, ALERTS, WORRIES, ROUTES, CLI,
    routeApplies: (state) => routeApplies(sanitize(state)),
    normalizeBaseUrl, sanitize, buildPlan, questionnaire, parseDiff, afterCode, beforeCode, countLines, cardText,
  };
});
