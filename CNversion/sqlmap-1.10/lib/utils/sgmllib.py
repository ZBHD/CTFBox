"""A parser for SGML, using the derived class as a static DTD."""

# 注意：Python3 中缺失

# XXX 这只支持 HTML 使用的 SGML 功能。

# XXX 应该有办法区分 PCDATA（已解析
# 字符数据——正常情况），RCDATA（可替换字符
# 数据——只有字符和实体引用以及结束标记是特殊的）
# 和 CDATA（字符数据——只有结束标记是特殊的）。  RCDATA 是
# 根本不支持。

from __future__ import print_function

try:
    import _markupbase as markupbase
except:
    import markupbase

import re

__all__ = ["SGMLParser", "SGMLParseError"]

# 用于解析的正则表达式

interesting = re.compile('[&<]')
incomplete = re.compile('&([a-zA-Z][a-zA-Z0-9]*|#[0-9]*)?|'
                        '<([a-zA-Z][^<>]*|'
                        '/([a-zA-Z][^<>]*)?|'
                        '![^<>]*)?')

entityref = re.compile('&([a-zA-Z][-.a-zA-Z0-9]*)[^a-zA-Z0-9]')
charref = re.compile('&#([0-9]+)[^0-9]')

starttagopen = re.compile('<[>a-zA-Z]')
shorttagopen = re.compile('<[a-zA-Z][-.a-zA-Z0-9]*/')
shorttag = re.compile('<([a-zA-Z][-.a-zA-Z0-9]*)/([^/]*)/')
piclose = re.compile('>')
endbracket = re.compile('[<>]')
tagfind = re.compile('[a-zA-Z][-_.a-zA-Z0-9]*')
attrfind = re.compile(
    r'\s*([a-zA-Z_][-:.a-zA-Z_0-9]*)(\s*=\s*'
    r'(\'[^\']*\'|"[^"]*"|[][\-a-zA-Z0-9./,:;+*%?!&$\(\)_#=~\'"@]*))?')


class SGMLParseError(RuntimeError):
    """Exception raised for all parse errors."""
    pass


# SGML 解析器基类——查找标签并调用处理函数。
# 用法： p = SGMLParser(); p.feed(数据); ...; p.close()。
# dtd 是通过派生一个定义方法的类来定义的
# 使用特殊名称来处理标签：start_foo 和 end_foo 来处理
# 分别是 <foo> 和 </foo>，或者 do_foo 自行处理 <foo>。
# （为此目的，标签被转换为小写。）数据
# 标签之间通过调用 self.handle_data() 传递给解析器
# 以一些数据作为参数（数据可以任意分割
# 块）。  实体引用通过调用传递
# self.handle_entityref() 以实体引用作为参数。

class SGMLParser(markupbase.ParserBase):
    # 实体的定义——派生类可以覆盖
    entity_or_charref = re.compile('&(?:'
                                   '([a-zA-Z][-.a-zA-Z0-9]*)|#([0-9]+)'
                                   ')(;?)')

    def __init__(self, verbose=0):
        """Initialize and reset this instance."""
        self.verbose = verbose
        self.reset()

    def reset(self):
        """Reset this instance. Loses all unprocessed data."""
        self.__starttag_text = None
        self.rawdata = ''
        self.stack = []
        self.lasttag = '???'
        self.nomoretags = 0
        self.literal = 0
        markupbase.ParserBase.reset(self)

    def setnomoretags(self):
        """Enter literal mode (CDATA) till EOF.

        Intended for derived classes only.
        """
        self.nomoretags = self.literal = 1

    def setliteral(self, *args):
        """Enter literal mode (CDATA).

        Intended for derived classes only.
        """
        self.literal = 1

    def feed(self, data):
        """Feed some data to the parser.

        Call this as often as you want, with as little or as much text
        as you want (may include '\n').  (This just saves the text,
        all the processing is done by goahead().)
        """

        self.rawdata = self.rawdata + data
        self.goahead(0)

    def close(self):
        """Handle the remaining data."""
        self.goahead(1)

    def error(self, message):
        raise SGMLParseError(message)

    # 内部——尽可能合理地处理数据。  可能会离开状态
    # 以及后续调用要处理的数据。  如果“结束”是
    # true，强制处理所有数据，就像后面跟着 EOF 标记一样。
    def goahead(self, end):
        rawdata = self.rawdata
        i = 0
        n = len(rawdata)
        while i < n:
            if self.nomoretags:
                self.handle_data(rawdata[i:n])
                i = n
                break
            match = interesting.search(rawdata, i)
            if match:
                j = match.start()
            else:
                j = n
            if i < j:
                self.handle_data(rawdata[i:j])
            i = j
            if i == n:
                break
            if rawdata[i] == '<':
                if starttagopen.match(rawdata, i):
                    if self.literal:
                        self.handle_data(rawdata[i])
                        i = i + 1
                        continue
                    k = self.parse_starttag(i)
                    if k < 0:
                        break
                    i = k
                    continue
                if rawdata.startswith("</", i):
                    k = self.parse_endtag(i)
                    if k < 0:
                        break
                    i = k
                    self.literal = 0
                    continue
                if self.literal:
                    if n > (i + 1):
                        self.handle_data("<")
                        i = i + 1
                    else:
                        # incomplete
                        break
                    continue
                if rawdata.startswith("<!--", i):
                        # Strictly speaking, a comment is --.*--
                        # 在声明标签 <!...> 内。
                        # 这个应该被删除，
                        # 注释仅在 parse_declaration 中处理。
                    k = self.parse_comment(i)
                    if k < 0:
                        break
                    i = k
                    continue
                if rawdata.startswith("<?", i):
                    k = self.parse_pi(i)
                    if k < 0:
                        break
                    i = i + k
                    continue
                if rawdata.startswith("<!", i):
                    # 这是某种声明；在“HTML 作为
                    # 已部署”，这应该只是文档类型
                    # 声明（“<！DOCTYPE html...>”）。
                    k = self.parse_declaration(i)
                    if k < 0:
                        break
                    i = k
                    continue
            elif rawdata[i] == '&':
                if self.literal:
                    self.handle_data(rawdata[i])
                    i = i + 1
                    continue
                match = charref.match(rawdata, i)
                if match:
                    name = match.group(1)
                    self.handle_charref(name)
                    i = match.end(0)
                    if rawdata[i - 1] != ';':
                        i = i - 1
                    continue
                match = entityref.match(rawdata, i)
                if match:
                    name = match.group(1)
                    self.handle_entityref(name)
                    i = match.end(0)
                    if rawdata[i - 1] != ';':
                        i = i - 1
                    continue
            else:
                self.error('neither < nor & ??')
            # 仅当匹配不完整时我们才会到达这里，但是
            # 没有别的
            match = incomplete.match(rawdata, i)
            if not match:
                self.handle_data(rawdata[i])
                i = i + 1
                continue
            j = match.end(0)
            if j == n:
                break  # 确实不完整
            self.handle_data(rawdata[i:j])
            i = j
        # 结束同时
        if end and i < n:
            self.handle_data(rawdata[i:n])
            i = n
        self.rawdata = rawdata[i:]
        # XXX if end：检查堆栈是否为空

    # DOCTYPE 扫描仪的扩展：
    _decl_otherchars = '='

    # 内部——解析处理instr，返回长度，如果没有终止则返回-1
    def parse_pi(self, i):
        rawdata = self.rawdata
        if rawdata[i:i + 2] != '<?':
            self.error('unexpected call to parse_pi()')
        match = piclose.search(rawdata, i + 2)
        if not match:
            return -1
        j = match.start(0)
        self.handle_pi(rawdata[i + 2: j])
        j = match.end(0)
        return j - i

    def get_starttag_text(self):
        return self.__starttag_text

    # 内部——处理开始标记，返回长度或-1（如果未终止）
    def parse_starttag(self, i):
        self.__starttag_text = None
        start_pos = i
        rawdata = self.rawdata
        if shorttagopen.match(rawdata, i):
            # SGML 简写：<tag/data/ == <tag>data</tag>
            # XXX 数据可以包含 &...（实体或字符引用）吗？
            # XXX 数据可以包含 < 或 > （标记字符）吗？
            # XXX 第一个 / 之前可以有空格吗？
            match = shorttag.match(rawdata, i)
            if not match:
                return -1
            tag, data = match.group(1, 2)
            self.__starttag_text = '<%s/' % tag
            tag = tag.lower()
            k = match.end(0)
            self.finish_shorttag(tag, data)
            self.__starttag_text = rawdata[start_pos:match.end(1) + 1]
            return k
        # XXX 以下内容应跳过匹配的引号（' 或 "）
        # 作为退出的捷径，这还不错，但不应该
        # 用于定位开始标记的实际结束位置，因为
        # < 或 > 字符可以嵌入到属性值中。
        match = endbracket.search(rawdata, i + 1)
        if not match:
            return -1
        j = match.start(0)
        # 现在将 i + 1 和 j 之间的数据解析为标签和属性
        attrs = []
        if rawdata[i:i + 2] == '<>':
            # SGML 简写：<> == <最后看到的打开标记>
            k = j
            tag = self.lasttag
        else:
            match = tagfind.match(rawdata, i + 1)
            if not match:
                self.error('unexpected call to parse_starttag')
            k = match.end(0)
            tag = rawdata[i + 1:k].lower()
            self.lasttag = tag
        while k < j:
            match = attrfind.match(rawdata, k)
            if not match:
                break
            attrname, rest, attrvalue = match.group(1, 2, 3)
            if not rest:
                attrvalue = attrname
            else:
                if (attrvalue[:1] == "'" == attrvalue[-1:] or
                   attrvalue[:1] == '"' == attrvalue[-1:]):
                    # 剥离报价
                    attrvalue = attrvalue[1:-1]
                attrvalue = self.entity_or_charref.sub(
                    self._convert_ref, attrvalue)
            attrs.append((attrname.lower(), attrvalue))
            k = match.end(0)
        if rawdata[j] == '>':
            j = j + 1
        self.__starttag_text = rawdata[start_pos:j]
        self.finish_starttag(tag, attrs)
        return j

    # 内部——转换实体或字符引用
    def _convert_ref(self, match):
        if match.group(2):
            return self.convert_charref(match.group(2)) or \
                '&#%s%s' % match.groups()[1:]
        elif match.group(3):
            return self.convert_entityref(match.group(1)) or \
                '&%s;' % match.group(1)
        else:
            return '&%s' % match.group(1)

    # 内部——解析结束标记
    def parse_endtag(self, i):
        rawdata = self.rawdata
        match = endbracket.search(rawdata, i + 1)
        if not match:
            return -1
        j = match.start(0)
        tag = rawdata[i + 2:j].strip().lower()
        if rawdata[j] == '>':
            j = j + 1
        self.finish_endtag(tag)
        return j

    # 内部——完成<tag/data/的解析（同<tag>data</tag>）
    def finish_shorttag(self, tag, data):
        self.finish_starttag(tag, [])
        self.handle_data(data)
        self.finish_endtag(tag)

    # 内部——完成开始标记的处理
    # 返回 -1 表示未知标签，0 表示仅开放标签，1 表示平衡标签
    def finish_starttag(self, tag, attrs):
        try:
            method = getattr(self, 'start_' + tag)
        except AttributeError:
            try:
                method = getattr(self, 'do_' + tag)
            except AttributeError:
                self.unknown_starttag(tag, attrs)
                return -1
            else:
                self.handle_starttag(tag, method, attrs)
                return 0
        else:
            self.stack.append(tag)
            self.handle_starttag(tag, method, attrs)
            return 1

    # 内部——完成结束标签的处理
    def finish_endtag(self, tag):
        if not tag:
            found = len(self.stack) - 1
            if found < 0:
                self.unknown_endtag(tag)
                return
        else:
            if tag not in self.stack:
                try:
                    method = getattr(self, 'end_' + tag)
                except AttributeError:
                    self.unknown_endtag(tag)
                else:
                    self.report_unbalanced(tag)
                return
            found = len(self.stack)
            for i in range(found):
                if self.stack[i] == tag:
                    found = i
        while len(self.stack) > found:
            tag = self.stack[-1]
            try:
                method = getattr(self, 'end_' + tag)
            except AttributeError:
                method = None
            if method:
                self.handle_endtag(tag, method)
            else:
                self.unknown_endtag(tag)
            del self.stack[-1]

    # 可重写——处理开始标签
    def handle_starttag(self, tag, method, attrs):
        method(attrs)

    # 可重写——句柄结束标记
    def handle_endtag(self, tag, method):
        method()

    # 示例——报告不平衡的 </...> 标记。
    def report_unbalanced(self, tag):
        if self.verbose:
            print('*** Unbalanced </' + tag + '>')
            print('*** Stack:', self.stack)

    def convert_charref(self, name):
        """Convert character reference, may be overridden."""
        try:
            n = int(name)
        except ValueError:
            return
        if not 0 <= n <= 127:
            return
        return self.convert_codepoint(n)

    def convert_codepoint(self, codepoint):
        return chr(codepoint)

    def handle_charref(self, name):
        """Handle character reference, no need to override."""
        replacement = self.convert_charref(name)
        if replacement is None:
            self.unknown_charref(name)
        else:
            self.handle_data(replacement)

    # 实体的定义——派生类可以覆盖
    entitydefs = \
        {'lt': '<', 'gt': '>', 'amp': '&', 'quot': '"', 'apos': '\''}

    def convert_entityref(self, name):
        """Convert entity references.

        As an alternative to overriding this method; one can tailor the
        results by setting up the self.entitydefs mapping appropriately.
        """
        table = self.entitydefs
        if name in table:
            return table[name]
        else:
            return

    def handle_entityref(self, name):
        """Handle entity references, no need to override."""
        replacement = self.convert_entityref(name)
        if replacement is None:
            self.unknown_entityref(name)
        else:
            self.handle_data(replacement)

    # 示例——处理数据，应该被覆盖
    def handle_data(self, data):
        pass

    # 示例——处理注释，可以被覆盖
    def handle_comment(self, data):
        pass

    # 示例——句柄声明，可以被覆盖
    def handle_decl(self, decl):
        pass

    # 示例——句柄处理指令，可以被覆盖
    def handle_pi(self, data):
        pass

    # 被覆盖——未知对象的处理程序
    def unknown_starttag(self, tag, attrs):
        pass

    def unknown_endtag(self, tag):
        pass

    def unknown_charref(self, ref):
        pass

    def unknown_entityref(self, ref):
        pass


class TestSGMLParser(SGMLParser):

    def __init__(self, verbose=0):
        self.testdata = ""
        SGMLParser.__init__(self, verbose)

    def handle_data(self, data):
        self.testdata = self.testdata + data
        if len(repr(self.testdata)) >= 70:
            self.flush()

    def flush(self):
        data = self.testdata
        if data:
            self.testdata = ""
            print('data:', repr(data))

    def handle_comment(self, data):
        self.flush()
        r = repr(data)
        if len(r) > 68:
            r = r[:32] + '...' + r[-32:]
        print('comment:', r)

    def unknown_starttag(self, tag, attrs):
        self.flush()
        if not attrs:
            print('开始标记：<' + tag + '>')
        else:
            print('开始标记：<' + tag, end=' ')
            for name, value in attrs:
                print(name + '=' + '"' + value + '"', end=' ')
            print('>')

    def unknown_endtag(self, tag):
        self.flush()
        print('结束标记：</' + tag + '>')

    def unknown_entityref(self, ref):
        self.flush()
        print('*** 未知实体参考：&' + ref + ';')

    def unknown_charref(self, ref):
        self.flush()
        print('*** 未知字符参考：&#' + ref + ';')

    def unknown_decl(self, data):
        self.flush()
        print('*** 未知声明：[' + data + ']')

    def close(self):
        SGMLParser.close(self)
        self.flush()


def test(args=None):
    import sys

    if args is None:
        args = sys.argv[1:]

    if args and args[0] == '-s':
        args = args[1:]
        klass = SGMLParser
    else:
        klass = TestSGMLParser

    if args:
        file = args[0]
    else:
        file = 'test.html'

    if file == '-':
        f = sys.stdin
    else:
        try:
            f = open(file, 'r')
        except IOError as msg:
            print(file, ":", msg)
            sys.exit(1)

    data = f.read()
    if f is not sys.stdin:
        f.close()

    x = klass()
    for c in data:
        x.feed(c)
    x.close()


if __name__ == '__main__':
    test()
