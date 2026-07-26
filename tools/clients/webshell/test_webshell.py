"""Webshell 引擎测试：本地 http.server 假 shell 端点，验证 NDJSON 往返。

假端点模拟真实 shell 的契约——解码 ARG_PARAM 参数里的动作 JSON，
在内存假文件系统上执行，并把 `{"ok":..,"data":..}` 结果包裹在 MARKER 之间回显。
引擎的请求构造与响应解析因此可以在无真实解释器的情况下端到端验证。
"""

from __future__ import annotations

import base64
import io
import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

import webshell


# 内存假文件系统：路径 -> bytes（文件），以 "/" 结尾视为目录标记。
FAKE_FS: dict[str, bytes] = {}


def reset_fs() -> None:
    FAKE_FS.clear()
    FAKE_FS["/var/www/index.php"] = b"<?php echo 1;"
    FAKE_FS["/etc/passwd"] = b"root:x:0:0:root:/root:/bin/bash\n"


def dispatch_action(args: dict) -> dict:
    action = args.get("action")
    if action == "sysinfo":
        return {"ok": True, "data": {"os": "linux", "user": "www-data", "cwd": "/var/www"}}
    if action == "exec":
        return {"ok": True, "data": {"output": f"executed:{args.get('cmd', '')}"}}
    if action == "list":
        path = args.get("path", "/").rstrip("/") or "/"
        entries = []
        for key, value in FAKE_FS.items():
            parent = key.rsplit("/", 1)[0] or "/"
            if parent == path:
                entries.append({"name": key.rsplit("/", 1)[1], "type": "file", "size": len(value)})
        return {"ok": True, "data": {"entries": entries}}
    if action == "read":
        path = args.get("path", "")
        if path not in FAKE_FS:
            return {"ok": False, "error": "文件不存在"}
        return {"ok": True, "data": {"content": base64.b64encode(FAKE_FS[path]).decode()}}
    if action == "write":
        path = args.get("path", "")
        blob = base64.b64decode(args.get("content", ""))
        FAKE_FS[path] = blob
        return {"ok": True, "data": {"written": len(blob)}}
    if action == "delete":
        path = args.get("path", "")
        FAKE_FS.pop(path, None)
        return {"ok": True, "data": {"deleted": True}}
    return {"ok": False, "error": f"未知动作：{action}"}


class FakeShellHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:  # 静音
        pass

    def do_POST(self) -> None:  # noqa: N802 http.server 约定
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        fields = urllib.parse.parse_qs(body)
        raw_args = fields.get(webshell.ARG_PARAM, [""])[0]
        try:
            decoded = base64.b64decode(raw_args).decode("utf-8")
            args = json.loads(decoded)
        except Exception:
            try:
                args = json.loads(raw_args)
            except Exception:
                args = {}
        result = dispatch_action(args)
        inner = json.dumps(result, ensure_ascii=False)
        payload = f"junk{webshell.MARKER_START}{inner}{webshell.MARKER_END}trailer"
        encoded = payload.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


@pytest.fixture()
def server():
    reset_fs()
    httpd = HTTPServer(("127.0.0.1", 0), FakeShellHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    host, port = httpd.server_address
    yield f"http://{host}:{port}/shell.php"
    httpd.shutdown()
    httpd.server_close()


def run_engine(lines: list[dict], monkeypatch) -> list[dict]:
    """把请求行喂给引擎的 stdin，捕获 stdout 的 NDJSON 事件。"""
    stdin = io.StringIO("\n".join(json.dumps(line) for line in lines) + "\n")
    stdout = io.StringIO()
    monkeypatch.setattr(webshell.sys, "stdin", stdin)
    monkeypatch.setattr(webshell.sys, "stdout", stdout)
    webshell.main()
    events = []
    for raw in stdout.getvalue().splitlines():
        if raw.strip():
            events.append(json.loads(raw))
    return events


def test_connect_exec_ls_read_roundtrip(server, monkeypatch):
    events = run_engine(
        [
            {"op": "connect", "target": server, "password": "pass", "payloadType": "php", "encoder": "base64"},
            {"op": "exec", "cmd": "id"},
            {"op": "ls", "path": "/var/www"},
            {"op": "read", "path": "/etc/passwd"},
            {"op": "disconnect"},
        ],
        monkeypatch,
    )

    kinds = [event["ev"] for event in events]
    assert kinds == ["connected", "exec", "listing", "file", "progress"]

    assert events[0]["info"]["user"] == "www-data"
    assert events[1]["output"] == "executed:id"
    assert any(entry["name"] == "index.php" for entry in events[2]["entries"])
    decoded = base64.b64decode(events[3]["content"]).decode()
    assert decoded.startswith("root:x:0:0")
    assert events[4]["stage"] == "disconnect"


def test_upload_then_delete(server, monkeypatch):
    content = base64.b64encode(b"payload-bytes").decode()
    events = run_engine(
        [
            {"op": "connect", "target": server, "password": "k", "payloadType": "php", "encoder": "raw"},
            {"op": "upload", "path": "/tmp/a.txt", "content": content},
            {"op": "delete", "path": "/tmp/a.txt"},
        ],
        monkeypatch,
    )

    upload_event = next(event for event in events if event.get("stage") == "upload")
    assert upload_event["written"] == len(b"payload-bytes")
    assert FAKE_FS.get("/tmp/a.txt") is None  # 已删除

    delete_event = next(event for event in events if event.get("stage") == "delete")
    assert delete_event["done"] is True


def test_raw_encoder_path(server, monkeypatch):
    events = run_engine(
        [
            {"op": "connect", "target": server, "password": "p", "encoder": "raw"},
            {"op": "exec", "cmd": "whoami"},
        ],
        monkeypatch,
    )
    assert events[0]["ev"] == "connected"
    assert events[1]["output"] == "executed:whoami"


def test_exec_before_connect_errors(monkeypatch):
    events = run_engine([{"op": "exec", "cmd": "id"}], monkeypatch)
    assert events[0]["ev"] == "error"
    assert "未连接" in events[0]["message"]


def test_bad_target_emits_error_without_crashing(monkeypatch):
    events = run_engine(
        [{"op": "connect", "target": "http://127.0.0.1:1/nope.php", "password": "x"}],
        monkeypatch,
    )
    assert events[0]["ev"] == "error"
    assert events[0]["op"] == "connect"


def test_malformed_json_line_reports_error(monkeypatch):
    stdin = io.StringIO('not json\n{"op":"disconnect"}\n')
    stdout = io.StringIO()
    monkeypatch.setattr(webshell.sys, "stdin", stdin)
    monkeypatch.setattr(webshell.sys, "stdout", stdout)
    webshell.main()
    events = [json.loads(raw) for raw in stdout.getvalue().splitlines() if raw.strip()]
    assert events[0]["ev"] == "error"
    assert "无效 JSON" in events[0]["message"]


def test_unsupported_payload_type_rejected(server, monkeypatch):
    events = run_engine(
        [{"op": "connect", "target": server, "payloadType": "python"}],
        monkeypatch,
    )
    assert events[0]["ev"] == "error"
    assert "载荷" in events[0]["message"]
