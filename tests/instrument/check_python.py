"""Python checks for the Instrumentation Planner's snippets.  Driven by python.test.mjs.

  1. SYNTAX    every "before" and "after" file parses.
  2. IMPORTS   every import in every snippet resolves against the real, installed packages.
  3. EXECUTE   a representative set of snippets runs as a real program against mock LLM + Openlayer servers,
               using the planner's own env block (placeholders filled in), and must deliver traces.

Reads a JSON job file, prints one JSON object per line: {"id", "check", "ok", "detail"}.
"""
import ast
import importlib
import json
import os
import re
import subprocess
import sys
import tempfile
import warnings

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mock_server import Recorder, make_server  # noqa: E402

jobs = json.load(open(sys.argv[1]))
only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None


def emit(id_, check, ok, detail=""):
    print(json.dumps({"id": id_, "check": check, "ok": bool(ok), "detail": str(detail)[:1500]}), flush=True)


# ───────────────────────── 1. syntax ─────────────────────────
for j in jobs["all"]:
    for label in ("code", "before"):
        if j.get(label) is None:
            continue
        try:
            ast.parse(j["prelude"] + "\n" + j[label])
            emit(j["id"], "syntax:" + label, True)
        except SyntaxError as e:
            emit(j["id"], "syntax:" + label, False, f"{e}\n{j[label]}")

# ───────────────────────── 2. imports ─────────────────────────
seen = {}
for j in jobs["all"]:
    tree = ast.parse(j["code"])
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                seen.setdefault((a.name, None), j["id"])
        elif isinstance(node, ast.ImportFrom) and node.module:
            for a in node.names:
                seen.setdefault((node.module, a.name), j["id"])
for (mod, name), first in sorted(seen.items(), key=lambda kv: (kv[0][0], kv[0][1] or "")):
    label = f"{mod}" + (f":{name}" if name else "")
    try:
        m = importlib.import_module(mod)
        if name and not hasattr(m, name):
            importlib.import_module(f"{mod}.{name}")
        emit("imports", "import:" + label, True)
    except Exception as e:  # noqa: BLE001
        emit(first, "import:" + label, False, f"{type(e).__name__}: {e}")

# ───────────────────────── 3. execute against mocks ─────────────────────────
rec = Recorder()
srv = make_server(rec)
base = f"http://127.0.0.1:{srv.server_address[1]}"
KEY, PIPE = "test-key-123", "pipe-123"


def parse_env(text):
    env = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line.strip())
        if not m:
            continue
        v = m.group(2).strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        v = v.replace("<your Openlayer API key>", KEY).replace("<your inference pipeline ID>", PIPE)
        # Point the planner's hosts (cloud or the example on-prem host) at the mock server.
        v = re.sub(r"https?://(api\.openlayer\.com|ol\.acme\.com)", base, v)
        env[m.group(1)] = v
    return env


def flatten(obj, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.append(("key", k))
            if k == "name" and isinstance(v, str):
                out.append(("name", v))
            flatten(v, out)
    elif isinstance(obj, list):
        for v in obj:
            flatten(v, out)
    return out


def decode_spans(body):
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
    req = ExportTraceServiceRequest()
    req.ParseFromString(body)
    spans = []
    for rs in req.resource_spans:
        for ss in rs.scope_spans:
            for sp in ss.spans:
                spans.append({"name": sp.name, "attrs": {a.key: a.value.string_value for a in sp.attributes}})
    return spans


def run_job(j):
    rec.reset()
    env = {k: v for k, v in os.environ.items() if not k.lower().endswith("_proxy") and not k.startswith(("OPENAI", "ANTHROPIC", "OTEL", "OPENLAYER"))}
    env.update(parse_env(j["envText"] or ""))
    env.update({
        "OPENAI_API_KEY": "sk-test", "OPENAI_BASE_URL": base + "/llm/v1", "OPENAI_API_BASE": base + "/llm/v1",
        "AZURE_OPENAI_API_KEY": "az-test", "AZURE_OPENAI_ENDPOINT": base + "/llm", "OPENAI_API_VERSION": "2024-06-01",
        "ANTHROPIC_API_KEY": "sk-ant-test", "ANTHROPIC_BASE_URL": base + "/llm",
        "GEMINI_API_KEY": "g-test", "GOOGLE_AI_API_KEY": "g-test", "GOOGLE_API_KEY": "g-test", "GOOGLE_GEMINI_BASE_URL": base + "/llm",
        "PORTKEY_API_KEY": "pk-test", "PORTKEY_BASE_URL": base + "/llm",
        "NO_PROXY": "127.0.0.1,localhost", "PYTHONWARNINGS": "ignore",
        "OPENLAYER_API_KEY": env.get("OPENLAYER_API_KEY", KEY), "OPENLAYER_INFERENCE_PIPELINE_ID": PIPE,
    })
    if "OPENLAYER_BASE_URL" not in env:
        env["OPENLAYER_BASE_URL"] = base + "/v1"  # cloud: the SDK default host is swapped for the mock
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(j, f)
    p = subprocess.run([sys.executable, os.path.join(HERE, "run_one.py"), f.name], env=env, capture_output=True, text=True, timeout=120)
    os.unlink(f.name)
    return p


for j in jobs["run"]:
    id_ = j["id"]
    if only and not any(o in id_ for o in only):
        continue
    try:
        p = run_job(j)
        if p.returncode != 0:
            emit(id_, "execute", False, f"exit {p.returncode}\n{p.stderr[-1400:]}")
            continue
        if j.get("claude"):
            emit(id_, "execute", "PATCHED" in p.stdout, p.stdout)
            continue
        reqs = rec.snapshot()
        paths = [r["path"] for r in reqs]
        if j["otel"]:
            posts = [r for r in reqs if r["path"].endswith("/v1/traces")]
            if not posts:
                emit(id_, "execute", False, f"no OTLP export. requests: {paths}\n{p.stderr[-800:]}")
                continue
            h = {k.lower(): v for k, v in posts[0]["headers"].items()}
            spans = [s for r in posts for s in decode_spans(r["body"])]
            problems = []
            if h.get("authorization") != f"Bearer {KEY}":
                problems.append(f"Authorization header was {h.get('authorization')!r}")
            if h.get("x-bt-parent") != f"pipeline_id:{PIPE}":
                problems.append(f"x-bt-parent header was {h.get('x-bt-parent')!r}")
            if not spans:
                problems.append("export had no spans")
            if not any(k.startswith("gen_ai") for s in spans for k in s["attrs"]):
                problems.append("no gen_ai.* attributes on any span")
            if not posts[0]["path"].startswith("/v1/otel/"):
                problems.append("export path " + posts[0]["path"])
            emit(id_, "execute", not problems, "; ".join(problems) or f"{len(spans)} spans: {[s['name'] for s in spans]}")
            continue
        posts = [r for r in reqs if r["path"].endswith(f"/inference-pipelines/{PIPE}/data-stream")]
        if not posts:
            emit(id_, "execute", False, f"no data-stream POST. requests: {paths}\nstdout: {p.stdout[-300:]}\nstderr: {p.stderr[-800:]}")
            continue
        h = {k.lower(): v for k, v in posts[0]["headers"].items()}
        body = json.loads(posts[0]["body"])
        names = [v for t, v in flatten(body, []) if t == "name"]
        keys = {v for t, v in flatten(body, []) if t == "key"}
        problems = []
        if h.get("authorization") != f"Bearer {KEY}":
            problems.append(f"Authorization was {h.get('authorization')!r}")
        if not body.get("rows"):
            problems.append("no rows in body")
        for want in j.get("expectNames", []):
            if not any(want.lower() in n.lower() for n in names):
                problems.append(f"expected a step named like {want!r}; got {names}")
        for want in j.get("expectKeys", []):
            if want not in keys:
                problems.append(f"expected key {want!r} in the posted row")
        if j.get("minSteps") and len(names) < j["minSteps"]:
            problems.append(f"expected >= {j['minSteps']} steps, got {names}")
        emit(id_, "execute", not problems, "; ".join(problems) or f"posted {len(posts)}x; steps: {names}")
    except Exception as e:  # noqa: BLE001
        emit(id_, "execute", False, f"{type(e).__name__}: {e}")

srv.shutdown()
