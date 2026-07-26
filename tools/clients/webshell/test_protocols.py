"""协议编解码测试：冰蝎 / 蚁剑 / ctfbox。

无 PHP 运行时的验证策略：载荷首行嵌入 `/*CTFBOX_BH|op|b64...*/`（冰蝎）或
`/*CTFBOX_AS|...*/`（蚁剑）机读标签。测试解释器解析该标签，在内存假文件系统上
仿真载荷行为，产出载荷本应 echo 的原始输出 $o，再按各协议线格式回包，喂回
parse_response。由此端到端验证：请求编解码、AES、参数嵌入/转义、结果解析。
（注意：这验证线格式与客户端逻辑，不验证 PHP 本身——那需要真实解释器/靶机。）
"""

from __future__ import annotations

import base64
import hashlib
import json
import re

import pytest

from crypto import aes_ecb_decrypt, aes_ecb_encrypt
from protocols import Operation, get_protocol
from protocols.antsword import MARKER_END as AS_END
from protocols.antsword import MARKER_START as AS_START


# ---------------------------------------------------------------------------
# 内存假文件系统 + 标签解释器（仿真目标 shell 执行载荷）
# ---------------------------------------------------------------------------

def fresh_fs() -> dict[str, bytes]:
    return {
        "/var/www/index.php": b"<?php echo 1;",
        "/etc/passwd": b"root:x:0:0:root:/root:/bin/bash\n",
    }


_TAG = re.compile(r"/\*CTFBOX_(?:BH|AS)\|([^*]*)\*/")


def interpret(payload_source: str, fs: dict[str, bytes]) -> str:
    """解析载荷标签并仿真执行，返回载荷本应 echo 的原始输出（$o）。"""
    match = _TAG.search(payload_source)
    if not match:
        raise AssertionError("载荷缺少机读标签")
    parts = match.group(1).split("|")
    op = parts[0]
    b64 = parts[1:]

    def dec_str(i: int) -> str:
        return base64.b64decode(b64[i]).decode("utf-8")

    if op == Operation.SYSINFO:
        return json.dumps({"os": "Linux", "user": "www-data", "cwd": "/var/www"})
    if op == Operation.EXEC:
        return f"executed:{dec_str(0)}"
    if op == Operation.LIST:
        path = dec_str(0).rstrip("/") or "/"
        lines = []
        for key, value in fs.items():
            parent = key.rsplit("/", 1)[0] or "/"
            if parent == path:
                lines.append(f"{key.rsplit('/', 1)[1]}\tfile\t{len(value)}")
        return "".join(line + "\n" for line in lines)
    if op == Operation.READ:
        data = fs.get(dec_str(0), b"")
        return base64.b64encode(data).decode("ascii")
    if op == Operation.WRITE:
        path = dec_str(0)
        content = base64.b64decode(b64[1])  # 第二段本就是 base64 内容
        fs[path] = content
        return str(len(content))
    if op == Operation.DELETE:
        path = dec_str(0)
        existed = path in fs
        fs.pop(path, None)
        return "1" if existed else "0"
    raise AssertionError(f"解释器不支持操作：{op}")


# ---------------------------------------------------------------------------
# 冰蝎：请求 = base64(AES-ECB(载荷))；响应 = base64(AES-ECB(输出))
# ---------------------------------------------------------------------------

def behinder_roundtrip(proto, op: str, params: dict, fs: dict[str, bytes]) -> dict:
    body, headers = proto.build_request(op, params)
    assert headers["Content-Type"] == "application/octet-stream"
    source = aes_ecb_decrypt(proto.key, base64.b64decode(body)).decode("utf-8")
    output = interpret(source, fs)
    response = base64.b64encode(aes_ecb_encrypt(proto.key, output.encode("utf-8")))
    return proto.parse_response(op, response)


def make_behinder(password: str = "rebeyond"):
    return get_protocol("behinder", target="http://h/s.php", password=password, payload_type="php")


def test_behinder_key_derivation():
    proto = make_behinder("rebeyond")
    assert proto.key == hashlib.md5(b"rebeyond").hexdigest()[:16].encode()
    assert proto.key == b"e45e329feb5d925b"


def test_behinder_sysinfo():
    fs = fresh_fs()
    info = behinder_roundtrip(make_behinder(), Operation.SYSINFO, {}, fs)
    assert info["user"] == "www-data"
    assert info["cwd"] == "/var/www"


def test_behinder_exec():
    fs = fresh_fs()
    data = behinder_roundtrip(make_behinder(), Operation.EXEC, {"cmd": "id;whoami"}, fs)
    assert data["output"] == "executed:id;whoami"


def test_behinder_list():
    fs = fresh_fs()
    data = behinder_roundtrip(make_behinder(), Operation.LIST, {"path": "/var/www"}, fs)
    names = {entry["name"] for entry in data["entries"]}
    assert "index.php" in names


def test_behinder_read():
    fs = fresh_fs()
    data = behinder_roundtrip(make_behinder(), Operation.READ, {"path": "/etc/passwd"}, fs)
    assert base64.b64decode(data["content"]).startswith(b"root:x:0:0")


def test_behinder_write_then_delete():
    fs = fresh_fs()
    content = base64.b64encode(b"payload-bytes").decode()
    written = behinder_roundtrip(
        make_behinder(), Operation.WRITE, {"path": "/tmp/a", "content": content}, fs
    )
    assert written["written"] == len(b"payload-bytes")
    assert fs["/tmp/a"] == b"payload-bytes"
    deleted = behinder_roundtrip(make_behinder(), Operation.DELETE, {"path": "/tmp/a"}, fs)
    assert deleted["deleted"] is True
    assert "/tmp/a" not in fs


def test_behinder_wrong_key_fails():
    fs = fresh_fs()
    body, _ = make_behinder("rebeyond").build_request(Operation.SYSINFO, {})
    source = aes_ecb_decrypt(make_behinder("rebeyond").key, base64.b64decode(body)).decode()
    output = interpret(source, fs)
    # 用正确密钥加密响应，却用错误密钥的会话去解析 → 应抛协议错误
    response = base64.b64encode(aes_ecb_encrypt(make_behinder("rebeyond").key, output.encode()))
    from protocols.base import ProtocolError

    wrong = make_behinder("wrongpass")
    with pytest.raises(ProtocolError):
        wrong.parse_response(Operation.SYSINFO, response)


# ---------------------------------------------------------------------------
# 蚁剑：请求 = urlencode(pass=代码)；响应 = START + 输出 + END
# ---------------------------------------------------------------------------

def antsword_roundtrip(proto, op: str, params: dict, fs: dict[str, bytes]) -> dict:
    import urllib.parse

    body, headers = proto.build_request(op, params)
    assert headers["Content-Type"] == "application/x-www-form-urlencoded"
    fields = urllib.parse.parse_qs(body.decode("utf-8"))
    code = fields[proto.password][0]
    if proto.encoder == "base64":
        blob = re.search(r'base64_decode\("([^"]+)"\)', code).group(1)
        code = base64.b64decode(blob).decode("utf-8")
    output = interpret(code, fs)
    response = f"junk{AS_START}{output}{AS_END}trailer".encode("utf-8")
    return proto.parse_response(op, response)


def make_antsword(encoder: str = "raw", password: str = "ant"):
    return get_protocol(
        "antsword", target="http://h/s.php", password=password, payload_type="php", encoder=encoder
    )


@pytest.mark.parametrize("encoder", ["raw", "base64"])
def test_antsword_exec(encoder):
    fs = fresh_fs()
    data = antsword_roundtrip(make_antsword(encoder), Operation.EXEC, {"cmd": "uname -a"}, fs)
    assert data["output"] == "executed:uname -a"


def test_antsword_sysinfo_and_list():
    fs = fresh_fs()
    info = antsword_roundtrip(make_antsword(), Operation.SYSINFO, {}, fs)
    assert info["os"] == "Linux"
    data = antsword_roundtrip(make_antsword(), Operation.LIST, {"path": "/var/www"}, fs)
    assert any(entry["name"] == "index.php" for entry in data["entries"])


def test_antsword_read_write_delete():
    fs = fresh_fs()
    read = antsword_roundtrip(make_antsword(), Operation.READ, {"path": "/etc/passwd"}, fs)
    assert base64.b64decode(read["content"]).startswith(b"root:x:0:0")
    content = base64.b64encode(b"hello-world").decode()
    written = antsword_roundtrip(
        make_antsword(), Operation.WRITE, {"path": "/tmp/w", "content": content}, fs
    )
    assert written["written"] == len(b"hello-world")
    deleted = antsword_roundtrip(make_antsword(), Operation.DELETE, {"path": "/tmp/w"}, fs)
    assert deleted["deleted"] is True


def test_antsword_missing_marker_errors():
    from protocols.base import ProtocolError

    with pytest.raises(ProtocolError):
        make_antsword().parse_response(Operation.EXEC, b"no markers here")


# ---------------------------------------------------------------------------
# JSP：两个协议按各自的线格式走，语义与 PHP 一致（同一标签解释器）
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("op,params,check", [
    (Operation.SYSINFO, {}, lambda r: r["user"] == "www-data"),
    (Operation.EXEC, {"cmd": "id"}, lambda r: r["output"] == "executed:id"),
    (Operation.LIST, {"path": "/var/www"}, lambda r: any(e["name"] == "index.php" for e in r["entries"])),
    (Operation.DELETE, {"path": "/etc/passwd"}, lambda r: r["deleted"] is True),
])
def test_behinder_jsp_operations(op, params, check):
    fs = fresh_fs()
    proto = get_protocol("behinder", target="http://h/s.jsp", password="rebeyond", payload_type="jsp")
    assert check(behinder_roundtrip(proto, op, params, fs))


@pytest.mark.parametrize("op,params,check", [
    (Operation.SYSINFO, {}, lambda r: r["os"] == "Linux"),
    (Operation.EXEC, {"cmd": "whoami"}, lambda r: r["output"] == "executed:whoami"),
    (Operation.LIST, {"path": "/var/www"}, lambda r: any(e["name"] == "index.php" for e in r["entries"])),
    (Operation.READ, {"path": "/etc/passwd"}, lambda r: base64.b64decode(r["content"]).startswith(b"root:")),
])
def test_antsword_jsp_operations(op, params, check):
    fs = fresh_fs()
    proto = get_protocol("antsword", target="http://h/s.jsp", password="ant", payload_type="jsp")
    assert check(antsword_roundtrip(proto, op, params, fs))


# ---------------------------------------------------------------------------
# ASPX：C# 源码字符串，同一标签解释器
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("op,params,check", [
    (Operation.EXEC, {"cmd": "dir C:\\"}, lambda r: r["output"] == "executed:dir C:\\"),
    (Operation.READ, {"path": "/etc/passwd"}, lambda r: base64.b64decode(r["content"]).startswith(b"root:")),
    (Operation.LIST, {"path": "/var/www"}, lambda r: any(e["name"] == "index.php" for e in r["entries"])),
])
def test_behinder_aspx_operations(op, params, check):
    fs = fresh_fs()
    proto = get_protocol("behinder", target="http://h/s.aspx", password="rebeyond", payload_type="aspx")
    assert check(behinder_roundtrip(proto, op, params, fs))


@pytest.mark.parametrize("op,params,check", [
    (Operation.EXEC, {"cmd": "whoami"}, lambda r: r["output"] == "executed:whoami"),
    (Operation.WRITE, {"path": "/tmp/a", "content": base64.b64encode(b"hi").decode()},
     lambda r: r["written"] == 2),
    (Operation.DELETE, {"path": "/etc/passwd"}, lambda r: r["deleted"] is True),
])
def test_antsword_aspx_operations(op, params, check):
    fs = fresh_fs()
    proto = get_protocol("antsword", target="http://h/s.aspx", password="ant", payload_type="aspx")
    assert check(antsword_roundtrip(proto, op, params, fs))


def test_antsword_asp_operations():
    fs = fresh_fs()
    proto = get_protocol("antsword", target="http://h/s.asp", password="ant", payload_type="asp")
    exec_r = antsword_roundtrip(proto, Operation.EXEC, {"cmd": "ver"}, fs)
    assert exec_r["output"] == "executed:ver"
    list_r = antsword_roundtrip(proto, Operation.LIST, {"path": "/var/www"}, fs)
    assert any(e["name"] == "index.php" for e in list_r["entries"])
    del_r = antsword_roundtrip(proto, Operation.DELETE, {"path": "/etc/passwd"}, fs)
    assert del_r["deleted"] is True


# ---------------------------------------------------------------------------
# 注册表
# ---------------------------------------------------------------------------

def test_registry_lists_all():
    from protocols import available

    assert set(available()) >= {"ctfbox", "behinder", "antsword"}


def test_unknown_protocol_rejected():
    from protocols.base import ProtocolError

    with pytest.raises(ProtocolError):
        get_protocol("cknife", target="x", password="y")
