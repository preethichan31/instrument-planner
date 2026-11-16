"""Runs ONE rendered snippet (prelude + code) as a real program and calls its entry point once.

Spawned by check_python.py with the environment pointing at the mock servers.
Usage: python run_one.py <job.json>
"""
import asyncio
import importlib.util
import json
import os
import sys
import tempfile

job = json.load(open(sys.argv[1]))
workdir = tempfile.mkdtemp()
src = os.path.join(workdir, "snippet_under_test.py")
with open(src, "w") as f:
    f.write(job["prelude"] + "\n" + job["code"])
sys.path.insert(0, workdir)
spec = importlib.util.spec_from_file_location("snippet_under_test", src)
mod = importlib.util.module_from_spec(spec)
sys.modules["snippet_under_test"] = mod
spec.loader.exec_module(mod)

if job.get("claude"):
    # The Claude Agent SDK needs the Claude Code CLI to run a query; here we only prove the patch took effect.
    q = getattr(mod, "query")
    assert getattr(q, "_openlayer_patched", False), f"query was imported before the patch / is not wrapped: {q!r}"
    print("PATCHED query")
    sys.exit(0)

entry = getattr(mod, job["entry"])
if job["ml"]:
    feats = {}
    for name in getattr(mod, "FEATURES"):
        feats[name] = "France" if name == "Geography" else "Female" if name == "Gender" else 1.0
    args = (feats,)
elif job["pattern"] == "agent":
    args = ("Where is order A100?",)
else:
    args = ("What is the refund policy?",)

result = entry(*args)
if asyncio.iscoroutine(result):
    result = asyncio.run(result)
print("RESULT", repr(result)[:200])
