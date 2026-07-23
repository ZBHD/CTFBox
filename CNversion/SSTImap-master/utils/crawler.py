"""
Copyright (c) 2006-2022 sqlmap developers (https://sqlmap.org/)
See the file 'LICENSE' for copying permission
"""

import re
import time
import urllib
import urllib3
import html
import requests

from utils.loggers import log
from utils.random_agent import get_agent

CRAWL_EXCLUDE_EXTENSIONS = (
    "3ds", "3g2", "3gp", "7z", "DS_Store", "a", "aac", "adp", "ai", "aif", "aiff", "apk", "ar", "asf", "au", "avi", "bak",
    "bin", "bk", "bmp", "btif", "bz2", "cab", "caf", "cgm", "cmx", "cpio", "cr2", "css", "dat", "deb", "djvu", "dll", "dmg",
    "dmp", "dng", "doc", "docx", "dot", "dotx", "dra", "dsk", "dts", "dtshd", "dvb", "dwg", "dxf", "ear", "ecelp4800",
    "ecelp7470", "ecelp9600", "egg", "eol", "eot", "epub", "exe", "f4v", "fbs", "fh", "fla", "flac", "fli", "flv", "fpx",
    "fst", "fvt", "g3", "gif", "gz", "h261", "h263", "h264", "ico", "ief", "image", "img", "ipa", "iso", "jar", "jpeg",
    "jpg", "jpgv", "jpm", "js", "jxr", "ktx", "lvp", "lz", "lzma", "lzo", "m3u", "m4a", "m4v", "mar", "mdi", "mid", "mj2",
    "mka", "mkv", "mmr", "mng", "mov", "movie", "mp3", "mp4", "mp4a", "mpeg", "mpg", "mpga", "mxu", "nef", "npx", "o",
    "oga", "ogg", "ogv", "otf", "pbm", "pcx", "pdf", "pea", "pgm", "pic", "png", "pnm", "ppm", "pps", "ppt", "pptx", "ps",
    "psd", "pya", "pyc", "pyo", "pyv", "qt", "rar", "ras", "raw", "rgb", "rip", "rlc", "rz", "s3m", "s7z", "scm", "scpt",
    "sgi", "shar", "sil", "smv", "so", "sql", "sub", "svg", "swf", "tar", "tbz2", "tga", "tgz", "tif", "tiff", "tlz", "ts",
    "ttf", "uvh", "uvi", "uvm", "uvp", "uvs", "uvu", "viv", "vob", "war", "wav", "wax", "wbmp", "wdp", "weba", "webm",
    "webp", "whl", "wm", "wma", "wmv", "wmx", "woff", "woff2", "wvx", "xbm", "xif", "xls", "xlsx", "xlt", "xm", "xpi",
    "xpm", "xwd", "xz", "z", "zip", "zipx"
)


def crawl(targets, args):
    log.log(23, '起始页面爬虫...')
    if not args.get('verify_ssl'):
        urllib3.disable_warnings()
    if args.get('crawl_exclude'):
        try:
            pattern = re.compile(args.get('crawl_exclude'))
        except Exception:
            log.log(22, f'无效回复：“{args.get("crawl_exclude")}"')
            return

    def crawlThread(curr_depth, current):
        if current in visited:
            return
        elif args.get('crawl_exclude') and pattern.search(current):
            log.log(26, f"Skipping: {current}")
            return
        else:
            visited.add(current)
        content = None
        if current:
            if args.get('random_agent'):
                user_agent = get_agent()
            else:
                user_agent = args.get('user_agent')
            if args['delay']:
                time.sleep(args['delay'])
            try:
                response = requests.request(method='GET', url=current, headers={'User-Agent': user_agent}, verify=args.get('verify_ssl'),
                                            proxies={'http': args.get('proxy'), 'https': args.get('proxy')})
                content = response.text
            except requests.exceptions.ConnectionError as e:
                if e and e.args[0] and e.args[0].args[0] == 'Connection aborted.':
                    log.log(25, '错误：连接中止，状态行错误。')
                    return
                elif e and e.args[0] and 'Max retries exceeded' in e.args[0].args[0]:
                    log.log(25, '错误：超出连接的最大重试次数。')
                    return
                else:
                    raise
            except requests.exceptions.InvalidSchema:
                log.log(25, f'具有不受支持的场景的 URL： {current}')
                return
        if content:
            # 重定向历史记录可以公开新的 URL 和 GET 参数以进行测试
            if response.history:
                for url in ([h.url for h in response.history[1:]] + [response.url]):
                    host = urllib.parse.urlparse(url).netloc.split(":")[0]
                    if url in visited or url in worker[curr_depth] or url in worker[curr_depth + 1]:
                        continue
                    elif args.get('crawl_exclude') and pattern.search(url):
                        log.log(26, f"Skipping: {url}")
                        visited.add(url)  # 下次默默跳过
                        continue
                    elif args.get('crawl_domains').upper() == "N" and host != target_host:
                        log.log(26, f"Skipping: {url}")
                        visited.add(url)  # 下次默默跳过
                        continue
                    elif args.get('crawl_domains').upper() != "Y" and not (host == target_host or
                                                                           host.endswith(f".{target_host}")):
                        log.log(26, f"Skipping: {url}")
                        visited.add(url)  # 下次默默跳过
                        continue
                    else:
                        worker[curr_depth + 1].add(url)
                        log.log(24, f"找到的网址： {url}")
            try:
                match = re.search(r"(?si)<html[^>]*>(.+)</html>", content)
                if match:
                    content = "<html>%s</html>" % match.group(1)
                tags = []
                tags += re.finditer(r'(?i)\s(href|src)=["\'](?P<href>[^>"\']+)', content)
                tags += re.finditer(r'(?i)window\.open\(["\'](?P<href>[^)"\']+)["\']', content)
                for tag in tags:
                    href = tag.get("href") if hasattr(tag, "get") else tag.group("href")
                    if href:
                        url = urllib.parse.urljoin(current, html.unescape(href)).split("#")[0].split(" ")[0]
                        try:
                            if re.search(r"\A[^?]+\.(?P<result>\w+)(\?|\Z)", url).group("result").lower() in CRAWL_EXCLUDE_EXTENSIONS:
                                continue
                        except AttributeError:      # 对于无扩展名的 url
                            pass 
                        if url:
                            host = urllib.parse.urlparse(url).netloc.split(":")[0]
                            if url in visited or url in worker[curr_depth] or url in worker[curr_depth + 1]:
                                continue
                            elif args.get('crawl_exclude') and pattern.search(url):
                                log.log(26, f"Skipping: {url}")
                                visited.add(url)  # 下次默默跳过
                                continue
                            elif args.get('crawl_domains').upper() == "N" and host != target_host:
                                log.log(26, f"Skipping: {url}")
                                visited.add(url)  # 下次默默跳过
                                continue
                            elif args.get('crawl_domains').upper() != "Y" and not (host == target_host or
                                                                                   host.endswith(f".{target_host}")):
                                log.log(26, f"Skipping: {url}")
                                visited.add(url)  # 下次默默跳过
                                continue
                            else:
                                worker[curr_depth + 1].add(url)
                                log.log(24, f"找到的网址： {url}")
            except UnicodeEncodeError:  # 对于非 HTML 文件
                pass
            except ValueError:          # 对于无效链接
                pass
            except AssertionError:      # 对于无效的 HTML
                pass
    if not targets:
        return set()
    visited = set()
    worker = [set(targets)]
    results = set()
    try:
        for depth in range(args.get('crawl_depth')):
            results.update(worker[depth])
            worker.append(set())
            for url in worker[depth]:
                if depth == 0:
                    target_host = urllib.parse.urlparse(url).netloc.split(":")[0]
                crawlThread(depth, url)
        results.update(worker[args.get('crawl_depth')])
        if not results:
            log.log(23, '找不到可用的链接（带有 GET 参数）')
        return results
    except KeyboardInterrupt:
        log.log(26, '用户在抓取过程中中止。 SSTImap 将使用部分列表')
        return results


def find_page_forms(url, args, retVal):
    from mechanize._form import parse_forms
    from html5lib import parse
    if not args.get('verify_ssl'):
        urllib3.disable_warnings()
    if args.get("empty_forms") or "?" in url:
        target = (url, "GET", "")
        if target not in retVal:
            retVal.add(target)
            log.log(24, f'找到的表单：GET {url} ""')
    if args.get('random_agent'):
        user_agent = get_agent()
    else:
        user_agent = args.get('user_agent')
    if args['delay']:
        time.sleep(args['delay'])
    try:
        request = requests.request(method='GET', url=url, headers={'User-Agent': user_agent}, verify=args.get('verify_ssl'),
                                   proxies={'http': args.get('proxy'), 'https': args.get('proxy')})
        raw = request.content
        content = request.text
    except requests.exceptions.ConnectionError as e:
        if e and e.args[0] and e.args[0].args[0] == 'Connection aborted.':
            log.log(25, '错误：连接中止，状态行错误。')
            return retVal
        elif e and e.args[0] and 'Max retries exceeded' in e.args[0].args[0]:
            log.log(25, '错误：超出连接的最大重试次数。')
            return retVal
        else:
            raise
    forms = None
    if raw:
        try:
            parsed = parse(raw, namespaceHTMLElements=False)
            forms, global_form = parse_forms(parsed, request.url)
        except Exception as e:
            raise e  # TODO：找出这两个函数可能引发的错误类型
    for form in forms or []:
        try:
            request = form.click()
            if request.type == 'http' or request.type == 'https':
                url = urllib.parse.unquote_plus(request.get_full_url())
                method = request.get_method()
                data = request.data
                if data:
                    data = urllib.parse.unquote(request.data)
                    data = data.lstrip("&=").rstrip('&')
                elif not data and method and method.upper() == "POST":
                    log.log(25, '无效的 POST 表单，检测到空白数据')
                    continue
                target = (url, method, data)
                if target not in retVal:
                    retVal.add(target)
                    log.log(24, f'找到的表格： {method} {url} "{data if data else ""}"')
        except (ValueError, TypeError) as ex:
            log.log(25, f"处理页面表单时出现问题（\'{repr(ex)}')")
    try:
        for match in re.finditer(r"\.post\(['\"]([^'\"]*)['\"],\s*\{([^}]*)\}", content):
            url = urllib.parse.urljoin(url, html.unescape(match.group(1)))
            data = ""
            for name, value in re.findall(r"['\"]?(\w+)['\"]?\s*:\s*(['\"][^'\"]+)?", match.group(2)):
                data += f"{name}={value}&"
            data = data.rstrip('&')
            target = (url, "POST", data)
            if target not in retVal:
                retVal.add(target)
                log.log(24, f'找到的表单：POST {url} "{data if data else ""}"')
        for match in re.finditer(r"(?s)(\w+)\.open\(['\"]POST['\"],\s*['\"]([^'\"]+)['\"]\).*?\1\.send\(([^)]+)\)", content):
            url = urllib.parse.urljoin(url, html.unescape(match.group(2)))
            data = match.group(3)
            data = re.sub(r"\s*\+\s*[^\s'\"]+|[^\s'\"]+\s*\+\s*", "", data)
            data = data.strip("['\"]")
            target = (url, "POST", data)
            if target not in retVal:
                retVal.add(target)
                log.log(24, f'找到的表单：POST {url} "{data if data else ""}"')
    except UnicodeDecodeError:
        pass
    return retVal


def find_forms(urls, args):
    forms = set()
    log.log(23, '开始表单检测...')
    try:
        for url in urls:
            find_page_forms(url, args, forms)
    except ImportError:
        log.log(25, '表单检测需要安装“mechanize”和“html5lib”')
    return forms
