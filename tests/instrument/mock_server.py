"""A tiny stand-in for both the LLM providers and Openlayer, so snippets can run for real without any keys or network.

Records every request it receives. Used by check_python.py and check_typescript_runtime.mjs.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Recorder:
    def __init__(self):
        self.requests = []
        self.lock = threading.Lock()

    def add(self, entry):
        with self.lock:
            self.requests.append(entry)

    def reset(self):
        with self.lock:
            self.requests.clear()

    def snapshot(self):
        with self.lock:
            return list(self.requests)


def _usage_openai():
    return {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}


def _openai_reply(body):
    """First call of a tool-using conversation returns a tool call; every other call returns text."""
    tools = body.get("tools") or []
    messages = body.get("messages") or []
    has_tool_result = any(m.get("role") == "tool" for m in messages)
    base = {"id": "chatcmpl-test", "object": "chat.completion", "created": 1, "model": body.get("model", "gpt-4o-mini")}
    if tools and not has_tool_result:
        fn = tools[0].get("function", {})
        props = list((fn.get("parameters") or {}).get("properties", {}).keys())
        args = {props[0]: "A100"} if props else {}
        base["choices"] = [{
            "index": 0, "finish_reason": "tool_calls",
            "message": {"role": "assistant", "content": None, "tool_calls": [
                {"id": "call_1", "type": "function", "function": {"name": fn.get("name", "tool"), "arguments": json.dumps(args)}}
            ]},
        }]
    else:
        text = "A100"
        # Direct agent snippets ask "Reply with only the order id": any text works.
        base["choices"] = [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": text}}]
    base["usage"] = _usage_openai()
    return base


def make_server(recorder):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):  # keep test output clean
            pass

        def _send(self, status, payload, ctype="application/json"):
            data = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            recorder.add({"method": "GET", "path": self.path, "headers": dict(self.headers), "body": b""})
            self._send(200, {"ok": True})

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n else b""
            if self.headers.get("Content-Encoding") == "gzip":
                import gzip
                raw = gzip.decompress(raw)
            path = self.path.split("?")[0]
            recorder.add({"method": "POST", "path": path, "headers": dict(self.headers), "body": raw})
            try:
                body = json.loads(raw) if raw and "json" in (self.headers.get("Content-Type") or "") else {}
            except Exception:
                body = {}

            if path.endswith("/chat/completions"):
                return self._send(200, _openai_reply(body))
            if path.endswith("/v1/messages") or path.endswith("/messages"):
                return self._send(200, {
                    "id": "msg_test", "type": "message", "role": "assistant", "model": body.get("model", "claude"),
                    "content": [{"type": "text", "text": "A100"}], "stop_reason": "end_turn", "stop_sequence": None,
                    "usage": {"input_tokens": 11, "output_tokens": 7},
                })
            if ":generateContent" in path:
                return self._send(200, {
                    "candidates": [{"content": {"role": "model", "parts": [{"text": "A100"}]}, "finishReason": "STOP", "index": 0}],
                    "usageMetadata": {"promptTokenCount": 11, "candidatesTokenCount": 7, "totalTokenCount": 18},
                    "modelVersion": "gemini-test",
                })
            if path.endswith("/data-stream"):
                return self._send(200, {"success": True})
            if path.endswith("/v1/traces"):
                return self._send(200, b"", "application/x-protobuf")
            return self._send(200, {})

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    srv.daemon_threads = True
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv
