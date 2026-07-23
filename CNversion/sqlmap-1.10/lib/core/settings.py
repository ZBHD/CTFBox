#!/usr/bin/env python

"""
Copyright (c) 2006-2026 sqlmap developers (https://sqlmap.org)
See the file 'LICENSE' for copying permission
"""

import codecs
import os
import random
import re
import string
import sys
import time

from lib.core.enums import DBMS
from lib.core.enums import DBMS_DIRECTORY_NAME
from lib.core.enums import OS
from thirdparty import six

# sqlmap 版本（<主要>.<次要>.<月份>.<每月提交>）
VERSION = "1.10"
TYPE = "dev" if VERSION.count('.') > 2 and VERSION.split('.')[-1] != '0' else "stable"
TYPE_COLORS = {"dev": 33, "stable": 90, "pip": 34}
VERSION_STRING = "sqlmap/%s#%s" % ('.'.join(VERSION.split('.')[:-1]) if VERSION.count('.') > 2 and VERSION.split('.')[-1] == '0' else VERSION, TYPE)
DESCRIPTION = '自动 SQL 注入和数据库接管工具'
SITE = "https://sqlmap.org"
DEFAULT_USER_AGENT = "%s (%s)" % (VERSION_STRING, SITE)
DEV_EMAIL_ADDRESS = "dev@sqlmap.org"
ISSUES_PAGE = "https://github.com/sqlmapproject/sqlmap/issues/new"
GIT_REPOSITORY = "https://github.com/sqlmapproject/sqlmap.git"
GIT_PAGE = "https://github.com/sqlmapproject/sqlmap"
WIKI_PAGE = "https://github.com/sqlmapproject/sqlmap/wiki/"
ZIPBALL_PAGE = "https://github.com/sqlmapproject/sqlmap/zipball/master"

# 彩色标识信息
BANNER = """\033[01;33m\
        ___
       __H__
 ___ ___[.]_____ ___ ___  \033[01;37m{\033[01;%dm%s\033[01;37m}\033[01;33m
|_ -| . [.]     | .'| . |
|___|_  [.]_|_|_|__,|  _|
      |_|V...       |_|   \033[0m\033[4;37m%s\033[0m\n
""" % (TYPE_COLORS.get(TYPE, 31), VERSION_STRING.split('/')[-1], SITE)

# 从 kb.matchRatio 到结果 True 的比率的最小距离
DIFF_TOLERANCE = 0.05
CONSTANT_RATIO = 0.9

# 用于 WAF/IPS 保护目标的启发式检查的比率
IPS_WAF_CHECK_RATIO = 0.5

# WAF/IPS 受保护目标的启发式检查中使用的超时
IPS_WAF_CHECK_TIMEOUT = 10

# 检查 live-cookies 文件是否存在时使用的超时
LIVE_COOKIES_TIMEOUT = 120

# 稳定页面情况下匹配率的下限值和上限值
LOWER_RATIO_BOUND = 0.02
UPPER_RATIO_BOUND = 0.98

# 用于填充愚蠢的推送更新
DUMMY_JUNK = "Aich8ooT"

# 当参数值包含 html 编码字符时特殊情况的标记
PARAMETER_AMP_MARKER = "__PARAMETER_AMP__"
PARAMETER_SEMICOLON_MARKER = "__PARAMETER_SEMICOLON__"
BOUNDARY_BACKSLASH_MARKER = "__BOUNDARY_BACKSLASH__"
PARAMETER_PERCENTAGE_MARKER = "__PARAMETER_PERCENTAGE__"
PARTIAL_VALUE_MARKER = "__PARTIAL_VALUE__"
PARTIAL_HEX_VALUE_MARKER = "__PARTIAL_HEX_VALUE__"
URI_QUESTION_MARKER = "__URI_QUESTION__"
ASTERISK_MARKER = "__ASTERISK__"
REPLACEMENT_MARKER = "__REPLACEMENT__"
BOUNDED_BASE64_MARKER = "__BOUNDED_BASE64__"
BOUNDED_INJECTION_MARKER = "__BOUNDED_INJECTION__"
SAFE_VARIABLE_MARKER = "__SAFE_VARIABLE__"
SAFE_HEX_MARKER = "__SAFE_HEX__"
DOLLAR_MARKER = "__DOLLAR__"

RANDOM_INTEGER_MARKER = "[RANDINT]"
RANDOM_STRING_MARKER = "[RANDSTR]"
SLEEP_TIME_MARKER = "[SLEEPTIME]"
INFERENCE_MARKER = "[INFERENCE]"
SINGLE_QUOTE_MARKER = "[SINGLE_QUOTE]"
GENERIC_SQL_COMMENT_MARKER = "[GENERIC_SQL_COMMENT]"

PAYLOAD_DELIMITER = "__PAYLOAD_DELIMITER__"
CHAR_INFERENCE_MARK = "%c"
PRINTABLE_CHAR_REGEX = r"[^\x00-\x1f\x7f-\xff]"

# 用于提取表名称的正则表达式（对于（例如）MsAccess 有用）
SELECT_FROM_TABLE_REGEX = r"\bSELECT\b.+?\bFROM\s+(?P<result>([\w.]|`[^`<>]+`)+)"

# 用于识别文本内容类型的正则表达式
TEXT_CONTENT_TYPE_REGEX = r"(?i)(text|form|message|xml|javascript|ecmascript|json)"

# 用于识别通用权限消息的正则表达式
PERMISSION_DENIED_REGEX = r"\b(?P<result>(command|permission|access|user)\s*(was|is|has been)?\s*(denied|forbidden|unauthorized|rejected|not allowed))"

# 用于识别通用保护机制的正则表达式
GENERIC_PROTECTION_REGEX = r"(?i)\b(rejected|blocked|protection|incident|denied|detected|dangerous|firewall)\b"

# 用于检测 fuzz(y) UNION 测试中错误的正则表达式
FUZZ_UNION_ERROR_REGEX = r"(?i)data\s?type|mismatch|comparable|compatible|conversion|convert|failed|error|unexpected"

# 启动 fuzz(y) UNION 测试的上限
FUZZ_UNION_MAX_COLUMNS = 10

# 用于识别通用最大连接消息的正则表达式
MAX_CONNECTIONS_REGEX = r"\bmax.{1,100}\bconnection"

# 在询问用户是否要继续之前的最大连续连接错误数
MAX_CONSECUTIVE_CONNECTION_ERRORS = 15

# 处理预连接候选之前的超时（因为 Web 服务器很可能会重置它）
PRECONNECT_CANDIDATE_TIMEOUT = 10

# 已知会导致预连接机制出现问题的服务器（由于缺乏多线程支持）
PRECONNECT_INCOMPATIBLE_SERVERS = ("SimpleHTTP", "BaseHTTP")

# 在有限数量的响应内识别 WAF/IPS（注意：用于优化目的）
IDENTYWAF_PARSE_LIMIT = 10

# “Murphy”（测试）模式下的最长睡眠时间
MAX_MURPHY_SLEEP_TIME = 3

# 用于从 Google 搜索中提取结果的正则表达式
GOOGLE_REGEX = r"webcache\.googleusercontent\.com/search\?q=cache:[^:]+:([^+]+)\+&amp;cd=|url\?\w+=((?![^>]+webcache\.googleusercontent\.com)http[^>]+)&(sa=U|rct=j)"

# Google 搜索同意 cookie
GOOGLE_CONSENT_COOKIE = "CONSENT=YES+shp.gws-%s-0-RC1.%s+FX+740" % (time.strftime("%Y%m%d"), "".join(random.sample(string.ascii_lowercase, 2)))

# 用于从 DuckDuckGo 搜索中提取结果的正则表达式
DUCKDUCKGO_REGEX = r'<a class="result__url" href="(htt[^"]+)'

# 用于从 Bing 搜索中提取结果的正则表达式
BING_REGEX = r'<h2><a href="([^"]+)" h='

# 用于搜索的虚拟User-Agent（如果默认返回不同的结果）
DUMMY_SEARCH_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0"

# 用于从“文本”标签中提取内容的正则表达式
TEXT_TAG_REGEX = r"(?si)<(abbr|acronym|b|blockquote|br|center|cite|code|dt|em|font|h[1-6]|i|li|p|pre|q|strong|sub|sup|td|th|title|tt|u)(?!\w).*?>(?P<result>[^<]+)"

# 用于识别IP地址的正则表达式
IP_ADDRESS_REGEX = r"\b(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\b"

# 用于识别通用“您的 ip 已被阻止”消息的正则表达式
BLOCKED_IP_REGEX = r"(?i)(\A|\b)ip\b.*\b(banned|blocked|block\s?list|firewall)"

# MySQL GROUP_CONCAT 技术中使用的转储字符
CONCAT_ROW_DELIMITER = ','
CONCAT_VALUE_DELIMITER = '|'

# 用于基于时间的查询延迟检查的系数（必须 >= 7）
TIME_STDEV_COEFF = 7

# 甚至可以被视为延迟的最短响应时间（不是完整的要求）
MIN_VALID_DELAYED_RESPONSE = 0.5

# 标准偏差之后应显示有关连接滞后的警告消息
WARN_TIME_STDEV = 0.5

# 可用联合注入响应的最小长度（快速防御 substr 字段）
UNION_MIN_RESPONSE_CHARS = 10

# 用于基于联合的列数检查的系数（必须 >= 7）
UNION_STDEV_COEFF = 7

# 延迟调整候选人的队列长度
TIME_DELAY_CANDIDATES = 3

# HTTP Accept 请求头的默认值
HTTP_ACCEPT_HEADER_VALUE = "*/*"

# HTTP Accept-Encoding 请求头的默认值
HTTP_ACCEPT_ENCODING_HEADER_VALUE = "gzip,deflate"

# 通过后门运行命令的默认超时
BACKDOOR_RUN_CMD_TIMEOUT = 5

# 程序结束时等待线程完成的秒数
THREAD_FINALIZATION_TIMEOUT = 1

# 对于每个值，inject.py/getValue() 中使用的最大技术数量
MAX_TECHNIQUES_PER_VALUE = 2

# 如果缺少部分联合转储，缓冲数组必须在达到一定大小后刷新
MAX_BUFFERED_PARTIAL_UNION_LENGTH = 1024

# @cachedmethod 装饰器中使用的缓存的最大大小
MAX_CACHE_ITEMS = 1024

# 用于在 DBMS 中命名元数据库的后缀，无需显式数据库名称
METADB_SUFFIX = "_masterdb"

# 异常期间重试pushValue的次数（例如键盘中断）
PUSH_VALUE_EXCEPTION_RETRY_COUNT = 3

# 基于标准偏差的时间比较所需的最小时间响应集
MIN_TIME_RESPONSES = 30

# 基于标准偏差的时间比较期间使用的最大时间响应集
MAX_TIME_RESPONSES = 200

# 根据标准差查找有效并集列数所需的最小比较比集
MIN_UNION_RESPONSES = 5

# 在末尾出现这些空白之后，推理应该停止（以防万一）
INFERENCE_BLANK_BREAK = 5

# 当推理无法检索正确的字符值时，请使用此替换字符
INFERENCE_UNKNOWN_CHAR = '?'

# 推理中用于“更大”运算的字符
INFERENCE_GREATER_CHAR = ">"

# 推理中用于“大于或等于”运算的字符
INFERENCE_GREATER_EQUALS_CHAR = ">="

# 推理中用于操作“等于”的字符
INFERENCE_EQUALS_CHAR = "="

# 推理中用于“不等于”运算的字符
INFERENCE_NOT_EQUALS_CHAR = "!="

# 用于表示未知 DBMS 的字符串
UNKNOWN_DBMS = "Unknown"

# 用于表示未知 DBMS 版本的字符串
UNKNOWN_DBMS_VERSION = "Unknown"

# 动态去除引擎中使用的动态边界长度
DYNAMICITY_BOUNDARY_LENGTH = 20

# 字典攻击中使用的虚拟用户前缀
DUMMY_USER_PREFIX = "__dummy__"

# 参考号：http://en.wikipedia.org/wiki/ISO/IEC_8859-1
DEFAULT_PAGE_ENCODING = "iso-8859-1"

try:
    codecs.lookup(DEFAULT_PAGE_ENCODING)
except LookupError:
    DEFAULT_PAGE_ENCODING = "utf8"

# 程序管道输入的标记
STDIN_PIPE_DASH = '-'

# 虚拟运行中使用的 URL
DUMMY_URL = "http://foo/bar?id=1"

# 初始 websocket（拉取）测试期间使用的超时
WEBSOCKET_INITIAL_TIMEOUT = 3

# 导入的操作系统相关模块的名称。目前已注册以下名称：'posix'、'nt'、'mac'、'os2'、'ce'、'java'、'riscos'
PLATFORM = os.name
PYVERSION = sys.version.split()[0]
IS_WIN = PLATFORM == "nt"

# 检查是否在终端中运行
IS_TTY = hasattr(sys.stdout, "fileno") and os.isatty(sys.stdout.fileno())

# DBMS系统数据库
MSSQL_SYSTEM_DBS = ("Northwind", "master", "model", "msdb", "pubs", "tempdb", "Resource", "ReportServer", "ReportServerTempDB", "distribution", "mssqlsystemresource")
MYSQL_SYSTEM_DBS = ("information_schema", "mysql", "performance_schema", "sys", "ndbinfo")
PGSQL_SYSTEM_DBS = ("postgres", "template0", "template1", "information_schema", "pg_catalog", "pg_toast", "pgagent")
ORACLE_SYSTEM_DBS = ("ADAMS", "ANONYMOUS", "APEX_030200", "APEX_PUBLIC_USER", "APPQOSSYS", "AURORA$ORB$UNAUTHENTICATED", "AWR_STAGE", "BI", "BLAKE", "CLARK", "CSMIG", "CTXSYS", "DBSNMP", "DEMO", "DIP", "DMSYS", "DSSYS", "EXFSYS", "FLOWS_%", "FLOWS_FILES", "HR", "IX", "JONES", "LBACSYS", "MDDATA", "MDSYS", "MGMT_VIEW", "OC", "OE", "OLAPSYS", "ORACLE_OCM", "ORDDATA", "ORDPLUGINS", "ORDSYS", "OUTLN", "OWBSYS", "PAPER", "PERFSTAT", "PM", "SCOTT", "SH", "SI_INFORMTN_SCHEMA", "SPATIAL_CSW_ADMIN_USR", "SPATIAL_WFS_ADMIN_USR", "SYS", "SYSMAN", "SYSTEM", "TRACESVR", "TSMSYS", "WK_TEST", "WKPROXY", "WKSYS", "WMSYS", "XDB", "XS$NULL")
SQLITE_SYSTEM_DBS = ("sqlite_master", "sqlite_temp_master")
ACCESS_SYSTEM_DBS = ("MSysAccessObjects", "MSysACEs", "MSysObjects", "MSysQueries", "MSysRelationships", "MSysAccessStorage", "MSysAccessXML", "MSysModules", "MSysModules2", "MSysNavPaneGroupCategories", "MSysNavPaneGroups", "MSysNavPaneGroupToObjects", "MSysNavPaneObjectIDs")
FIREBIRD_SYSTEM_DBS = ("RDB$BACKUP_HISTORY", "RDB$CHARACTER_SETS", "RDB$CHECK_CONSTRAINTS", "RDB$COLLATIONS", "RDB$DATABASE", "RDB$DEPENDENCIES", "RDB$EXCEPTIONS", "RDB$FIELDS", "RDB$FIELD_DIMENSIONS", " RDB$FILES", "RDB$FILTERS", "RDB$FORMATS", "RDB$FUNCTIONS", "RDB$FUNCTION_ARGUMENTS", "RDB$GENERATORS", "RDB$INDEX_SEGMENTS", "RDB$INDICES", "RDB$LOG_FILES", "RDB$PAGES", "RDB$PROCEDURES", "RDB$PROCEDURE_PARAMETERS", "RDB$REF_CONSTRAINTS", "RDB$RELATIONS", "RDB$RELATION_CONSTRAINTS", "RDB$RELATION_FIELDS", "RDB$ROLES", "RDB$SECURITY_CLASSES", "RDB$TRANSACTIONS", "RDB$TRIGGERS", "RDB$TRIGGER_MESSAGES", "RDB$TYPES", "RDB$USER_PRIVILEGES", "RDB$VIEW_RELATIONS")
MAXDB_SYSTEM_DBS = ("SYSINFO", "DOMAIN")
SYBASE_SYSTEM_DBS = ("master", "model", "sybsystemdb", "sybsystemprocs", "tempdb")
DB2_SYSTEM_DBS = ("NULLID", "SQLJ", "SYSCAT", "SYSFUN", "SYSIBM", "SYSIBMADM", "SYSIBMINTERNAL", "SYSIBMTS", "SYSPROC", "SYSPUBLIC", "SYSSTAT", "SYSTOOLS", "SYSDEBUG", "SYSINST")
HSQLDB_SYSTEM_DBS = ("INFORMATION_SCHEMA", "SYSTEM_LOB")
H2_SYSTEM_DBS = ("INFORMATION_SCHEMA",) + ("IGNITE", "ignite-sys-cache")
INFORMIX_SYSTEM_DBS = ("sysmaster", "sysutils", "sysuser", "sysadmin")
MONETDB_SYSTEM_DBS = ("tmp", "json", "profiler")
DERBY_SYSTEM_DBS = ("NULLID", "SQLJ", "SYS", "SYSCAT", "SYSCS_DIAG", "SYSCS_UTIL", "SYSFUN", "SYSIBM", "SYSPROC", "SYSSTAT")
VERTICA_SYSTEM_DBS = ("v_catalog", "v_internal", "v_monitor",)
MCKOI_SYSTEM_DBS = ("",)
PRESTO_SYSTEM_DBS = ("information_schema",)
ALTIBASE_SYSTEM_DBS = ("SYSTEM_",)
MIMERSQL_SYSTEM_DBS = ("information_schema", "SYSTEM",)
CRATEDB_SYSTEM_DBS = ("information_schema", "pg_catalog", "sys")
CLICKHOUSE_SYSTEM_DBS = ("information_schema", "INFORMATION_SCHEMA", "system")
CUBRID_SYSTEM_DBS = ("DBA",)
CACHE_SYSTEM_DBS = ("%Dictionary", "INFORMATION_SCHEMA", "%SYS")
EXTREMEDB_SYSTEM_DBS = ("",)
FRONTBASE_SYSTEM_DBS = ("DEFINITION_SCHEMA", "INFORMATION_SCHEMA")
RAIMA_SYSTEM_DBS = ("",)
VIRTUOSO_SYSTEM_DBS = ("",)

# 注意：(<常规>) + (<分叉>)
MSSQL_ALIASES = ("microsoft sql server", "mssqlserver", "mssql", "ms")
MYSQL_ALIASES = ("mysql", "my") + ("mariadb", "maria", "memsql", "tidb", "percona", "drizzle", "doris", "starrocks")
PGSQL_ALIASES = ("postgresql", "postgres", "pgsql", "psql", "pg") + ("cockroach", "cockroachdb", "amazon redshift", "redshift", "greenplum", "yellowbrick", "enterprisedb", "yugabyte", "yugabytedb", "opengauss")
ORACLE_ALIASES = ("oracle", "orcl", "ora", "or")
SQLITE_ALIASES = ("sqlite", "sqlite3")
ACCESS_ALIASES = ("microsoft access", "msaccess", "access", "jet")
FIREBIRD_ALIASES = ("firebird", "mozilla firebird", "interbase", "ibase", "fb")
MAXDB_ALIASES = ("max", "maxdb", "sap maxdb", "sap db")
SYBASE_ALIASES = ("sybase", "sybase sql server")
DB2_ALIASES = ("db2", "ibm db2", "ibmdb2")
HSQLDB_ALIASES = ("hsql", "hsqldb", "hs", "hypersql")
H2_ALIASES = ("h2",) + ("ignite", "apache ignite")
INFORMIX_ALIASES = ("informix", "ibm informix", "ibminformix")
MONETDB_ALIASES = ("monet", "monetdb",)
DERBY_ALIASES = ("derby", "apache derby",)
VERTICA_ALIASES = ("vertica",)
MCKOI_ALIASES = ("mckoi",)
PRESTO_ALIASES = ("presto",)
ALTIBASE_ALIASES = ("altibase",)
MIMERSQL_ALIASES = ("mimersql", "mimer")
CRATEDB_ALIASES = ("cratedb", "crate")
CUBRID_ALIASES = ("cubrid",)
CLICKHOUSE_ALIASES = ("clickhouse",)
CACHE_ALIASES = ("intersystems cache", "cachedb", "cache", "iris")
EXTREMEDB_ALIASES = ("extremedb", "extreme")
FRONTBASE_ALIASES = ("frontbase",)
RAIMA_ALIASES = ("raima database manager", "raima", "raimadb", "raimadm", "rdm", "rds", "velocis")
VIRTUOSO_ALIASES = ("virtuoso", "openlink virtuoso")

DBMS_DIRECTORY_DICT = dict((getattr(DBMS, _), getattr(DBMS_DIRECTORY_NAME, _)) for _ in dir(DBMS) if not _.startswith("_"))

SUPPORTED_DBMS = set(MSSQL_ALIASES + MYSQL_ALIASES + PGSQL_ALIASES + ORACLE_ALIASES + SQLITE_ALIASES + ACCESS_ALIASES + FIREBIRD_ALIASES + MAXDB_ALIASES + SYBASE_ALIASES + DB2_ALIASES + HSQLDB_ALIASES + H2_ALIASES + INFORMIX_ALIASES + MONETDB_ALIASES + DERBY_ALIASES + VERTICA_ALIASES + MCKOI_ALIASES + PRESTO_ALIASES + ALTIBASE_ALIASES + MIMERSQL_ALIASES + CLICKHOUSE_ALIASES + CRATEDB_ALIASES + CUBRID_ALIASES + CACHE_ALIASES + EXTREMEDB_ALIASES + RAIMA_ALIASES + VIRTUOSO_ALIASES)
SUPPORTED_OS = ("linux", "windows")

DBMS_ALIASES = ((DBMS.MSSQL, MSSQL_ALIASES), (DBMS.MYSQL, MYSQL_ALIASES), (DBMS.PGSQL, PGSQL_ALIASES), (DBMS.ORACLE, ORACLE_ALIASES), (DBMS.SQLITE, SQLITE_ALIASES), (DBMS.ACCESS, ACCESS_ALIASES), (DBMS.FIREBIRD, FIREBIRD_ALIASES), (DBMS.MAXDB, MAXDB_ALIASES), (DBMS.SYBASE, SYBASE_ALIASES), (DBMS.DB2, DB2_ALIASES), (DBMS.HSQLDB, HSQLDB_ALIASES), (DBMS.H2, H2_ALIASES), (DBMS.INFORMIX, INFORMIX_ALIASES), (DBMS.MONETDB, MONETDB_ALIASES), (DBMS.DERBY, DERBY_ALIASES), (DBMS.VERTICA, VERTICA_ALIASES), (DBMS.MCKOI, MCKOI_ALIASES), (DBMS.PRESTO, PRESTO_ALIASES), (DBMS.ALTIBASE, ALTIBASE_ALIASES), (DBMS.MIMERSQL, MIMERSQL_ALIASES), (DBMS.CLICKHOUSE, CLICKHOUSE_ALIASES), (DBMS.CRATEDB, CRATEDB_ALIASES), (DBMS.CUBRID, CUBRID_ALIASES), (DBMS.CACHE, CACHE_ALIASES), (DBMS.EXTREMEDB, EXTREMEDB_ALIASES), (DBMS.FRONTBASE, FRONTBASE_ALIASES), (DBMS.RAIMA, RAIMA_ALIASES), (DBMS.VIRTUOSO, VIRTUOSO_ALIASES))

USER_AGENT_ALIASES = ("ua", "useragent", "user-agent")
REFERER_ALIASES = ("ref", "referer", "referrer")
HOST_ALIASES = ("host",)

# 具有大写标识符的 DBMS
UPPER_CASE_DBMSES = set((DBMS.ORACLE, DBMS.DB2, DBMS.FIREBIRD, DBMS.MAXDB, DBMS.H2, DBMS.HSQLDB, DBMS.DERBY, DBMS.ALTIBASE))

# 使用的默认模式（无法枚举时）
H2_DEFAULT_SCHEMA = HSQLDB_DEFAULT_SCHEMA = "PUBLIC"
VERTICA_DEFAULT_SCHEMA = "public"
MCKOI_DEFAULT_SCHEMA = "APP"
CACHE_DEFAULT_SCHEMA = "SQLUser"

# OFFSET 机制从 1 开始的 DBMS
PLUS_ONE_DBMSES = set((DBMS.ORACLE, DBMS.DB2, DBMS.ALTIBASE, DBMS.MSSQL, DBMS.CACHE))

# 不能用于在 Windows 操作系统上命名文件的名称
WINDOWS_RESERVED_NAMES = ("CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9")

# 基本帮助 (-h) 输出中显示的项目
BASIC_HELP_ITEMS = (
    "url",
    "googleDork",
    "data",
    "cookie",
    "randomAgent",
    "proxy",
    "testParameter",
    "dbms",
    "level",
    "risk",
    "technique",
    "getAll",
    "getBanner",
    "getCurrentUser",
    "getCurrentDb",
    "getPasswordHashes",
    "getDbs",
    "getTables",
    "getColumns",
    "getSchema",
    "dumpTable",
    "dumpAll",
    "db",
    "tbl",
    "col",
    "osShell",
    "osPwn",
    "batch",
    "checkTor",
    "flushSession",
    "tor",
    "sqlmapShell",
    "wizard",
)

# 用于 shell 脚本内值替换的标签
SHELL_WRITABLE_DIR_TAG = "%WRITABLE_DIR%"
SHELL_RUNCMD_EXE_TAG = "%RUNCMD_EXE%"

# NULL 值的字符串表示
NULL = "NULL"

# 空白 ('') 值的字符串表示形式
BLANK = "<blank>"

# 当前数据库的字符串表示
CURRENT_DB = "CD"

# 当前用户的字符串表示
CURRENT_USER = "CU"

# 用于存储会话数据的 SQLite 文件的名称
SESSION_SQLITE_FILE = "session.sqlite"

# 用于查找错误消息中的文件路径的正则表达式
FILE_PATH_REGEXES = (r"<b>(?P<result>[^<>]+?)</b> on line \d+", r"\bin (?P<result>[^<>'\"]+?)['\"]? on line \d+", r"(?:[>(\[\s])(?P<result>[A-Za-z]:[\\/][\w. \\/-]*)", r"(?:[>(\[\s])(?P<result>/\w[/\w.~-]+)", r"\bhref=['\"]file://(?P<result>/[^'\"]+)", r"\bin <b>(?P<result>[^<]+): line \d+")

# 用于解析错误消息的正则表达式（--parse-errors）
ERROR_PARSING_REGEXES = (
    r"\[Microsoft\]\[ODBC SQL Server Driver\]\[SQL Server\](?P<result>[^<]+)",
    r"<b>[^<]{0,100}(fatal|error|warning|exception)[^<]*</b>:?\s*(?P<result>[^<]+)",
    r"(?m)^\s{0,100}(fatal|error|warning|exception):?\s*(?P<result>[^\n]+?)$",
    r"(sql|dbc)[^>'\"]{0,32}(fatal|error|warning|exception)(</b>)?:\s*(?P<result>[^<>]+)",
    r"(?P<result>[^\n>]{0,100}SQL Syntax[^\n<]+)",
    r"(?s)<li>Error Type:<br>(?P<result>.+?)</li>",
    r"CDbCommand (?P<result>[^<>\n]*SQL[^<>\n]+)",
    r"Code: \d+. DB::Exception: (?P<result>[^<>\n]*)",
    r"error '[0-9a-f]{8}'((<[^>]+>)|\s)+(?P<result>[^<>]+)",
    r"\[[^\n\]]{1,100}(ODBC|JDBC)[^\n\]]+\](\[[^\]]+\])?(?P<result>[^\n]+(in query expression|\(SQL| at /[^ ]+pdo)[^\n<]+)",
    r"(?P<result>query error: SELECT[^<>]+)"
)

# 用于从元 html 请求头解析字符集信息的正则表达式
META_CHARSET_REGEX = r'(?si)<head>.*<meta[^>]+charset="?(?P<result>[^"> ]+).*</head>'

# 用于解析元 html 请求头中的刷新信息的正则表达式
META_REFRESH_REGEX = r'(?i)<meta http-equiv="?refresh"?[^>]+content="?[^">]+;\s*(url=)?["\']?(?P<result>[^\'">]+)'

# 用于解析Javascript重定向请求的正则表达式
JAVASCRIPT_HREF_REGEX = r'<script>\s*(\w+\.)?location\.href\s*=\s*["\'](?P<result>[^"\']+)'

# 用于解析测试表单数据中的空字段的正则表达式
EMPTY_FORM_FIELDS_REGEX = r'(&|\A)(?P<result>[^=]+=)(?=&|\Z)'

# 参考号：http://www.cs.ru.nl/bachelorscripties/2010/Martin_Devillers___0437999___Analyzing_password_strength.pdf
COMMON_PASSWORD_SUFFIXES = ("1", "123", "2", "12", "3", "13", "7", "11", "5", "22", "23", "01", "4", "07", "21", "14", "10", "06", "08", "8", "15", "69", "16", "6", "18")

# 参考号：http://www.the-interweb.com/serendipity/index.php?/archives/94-A-brief-analysis-of-40,000-leaked-MySpace-passwords.html
COMMON_PASSWORD_SUFFIXES += ("!", ".", "*", "!!", "?", ";", "..", "!!!", ",", "@")

# WebScarab 日志文件中的请求之间使用的拆分器
WEBSCARAB_SPLITTER = "### Conversation"

# BURP 日志文件中的请求之间使用的拆分器
BURP_REQUEST_REGEX = r"={10,}\s+([A-Z]{3,} .+?)\s+(={10,}|\Z)"

# 用于解析 XML Burp 保存的历史项的正则表达式
BURP_XML_HISTORY_REGEX = r'<port>(\d+)</port>.*?<request base64="true"><!\[CDATA\[([^]]+)'

# 用于 Unicode 数据的编码
UNICODE_ENCODING = "utf8"

# 参考号：http://www.w3.org/Protocols/HTTP/Object_Headers.html#uri
URI_HTTP_HEADER = "URI"

# 可注入的 Uri 格式（例如 www.site.com/id82）
URI_INJECTABLE_REGEX = r"//[^/]*/([^\.*?]+)\Z"

# 正则表达式用于屏蔽敏感数据
SENSITIVE_DATA_REGEX = r"(\s|=)(?P<result>[^\s=]*\b%s\b[^\s]*)\s"

# 在匿名（未处理的异常）报告中显式屏蔽的选项（以及内部携带 <hostname> 的任何内容）
SENSITIVE_OPTIONS = ("hostname", "answers", "data", "dnsDomain", "googleDork", "authCred", "proxyCred", "tbl", "db", "col", "user", "cookie", "proxy", "fileRead", "fileWrite", "fileDest", "testParameter", "authCred", "sqlQuery", "requestFile", "csrfToken", "csrfData", "csrfUrl", "testParameter")

# 最大线程数（避免连接问题和/或 DoS）
MAX_NUMBER_OF_THREADS = 10

# 统计集的最小值和最大值之间的最小范围
MIN_STATISTICAL_RANGE = 0.01

# 比较比率的最小值
MIN_RATIO = 0.0

# 比较比的最大值
MAX_RATIO = 1.0

# 自动选择的最小句子长度--string（匹配率高的情况）
CANDIDATE_SENTENCE_MIN_LENGTH = 10

# 用于在提供的数据内标记可注射位置的字符
CUSTOM_INJECTION_MARK_CHAR = '*'

# 可在选项 --ignore-code 中使用的通配符值
IGNORE_CODE_WILDCARD = '*'

# 声明注入位置的其他方式
INJECT_HERE_REGEX = r"(?i)%INJECT[_ ]?HERE%"

# 用于通过基于错误的载荷检索数据的最小块长度
MIN_ERROR_CHUNK_LENGTH = 8

# 用于通过基于错误的载荷检索数据的最大块长度
MAX_ERROR_CHUNK_LENGTH = 1024

# 如果注入的语句包含以下任何 SQL 关键字，请勿转义
EXCLUDE_UNESCAPE = ("WAITFOR DELAY '", " INTO DUMPFILE ", " INTO OUTFILE ", "CREATE ", "BULK ", "EXEC ", "RECONFIGURE ", "DECLARE ", "'%s'" % CHAR_INFERENCE_MARK)

# 用于替换反射值的标记
REFLECTED_VALUE_MARKER = "__REFLECTED_VALUE__"

# 用于替换边框非字母字符的正则表达式
REFLECTED_BORDER_REGEX = r"[^A-Za-z]+"

# 用于替换非字母字符的正则表达式
REFLECTED_REPLACEMENT_REGEX = r"[^\n]{1,168}"

# 每次反射值替换所花费的最长时间（以秒为单位）
REFLECTED_REPLACEMENT_TIMEOUT = 3

# 反射正则表达式中字母数字部分的最大数量（出于速度目的）
REFLECTED_MAX_REGEX_PARTS = 10

# 如果 URL 编码值太长，可用作故障安全值的字符
URLENCODE_FAILSAFE_CHARS = "()|,"

# 余格页乘法使用的因子
YUGE_FACTOR = 1000

# URL 编码值的最大长度，超过此长度后故障安全程序将失效
URLENCODE_CHAR_LIMIT = 2000

# Microsoft SQL Server DBMS 的默认架构
DEFAULT_MSSQL_SCHEMA = "dbo"

# 显示每个 mod 项目数的哈希攻击信息
HASH_MOD_ITEM_DISPLAY = 11

# 显示（破解的）空密码的标记
HASH_EMPTY_PASSWORD_MARKER = "<empty>"

# 最大整数值
MAX_INT = sys.maxsize

# 替换转储表文件名中的不安全字符
UNSAFE_DUMP_FILEPATH_REPLACEMENT = '_'

# 多目标运行模式下需要恢复的选项
RESTORE_MERGED_OPTIONS = ("col", "db", "dbms", "os", "dnsDomain", "privEsc", "tbl", "regexp", "string", "textOnly", "threads", "timeSec", "tmpPath", "uChar", "user")

# 检测阶段需要忽略的参数（大写）
IGNORE_PARAMETERS = ("__VIEWSTATE", "__VIEWSTATEENCRYPTED", "__VIEWSTATEGENERATOR", "__EVENTARGUMENT", "__EVENTTARGET", "__EVENTVALIDATION", "ASPSESSIONID", "ASP.NET_SESSIONID", "JSESSIONID", "CFID", "CFTOKEN")

# 用于识别 ASP.NET 控件参数的正则表达式
ASP_NET_CONTROL_REGEX = r"(?i)\Actl\d+\$"

# Google 分析 cookie 名称的正则表达式
GOOGLE_ANALYTICS_COOKIE_REGEX = r"(?i)\A(_ga|_gid|_gat|_gcl_au|__utm[abcz])"

# 配置覆盖环境变量的前缀
SQLMAP_ENVIRONMENT_PREFIX = "SQLMAP_"

# 可用于设置代理地址的常规操作系统环境变量
PROXY_ENVIRONMENT_VARIABLES = ("all_proxy", "ALL_PROXY", "http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY")

# 关闭恢复控制台信息以避免潜在的速度减慢
TURN_OFF_RESUME_INFO_LIMIT = 20

# 多目标模式下使用的结果文件的 Strftime 格式
RESULTS_FILE_FORMAT = "results-%m%d%Y_%I%M%p.csv"

# 包含 Python 支持的编解码器列表的官方网页
CODECS_LIST_PAGE = "http://docs.python.org/library/codecs.html#standard-encodings"

# 用于区分标量和多行命令的简单正则表达式（非唯一条件）
SQL_SCALAR_REGEX = r"\A(SELECT(?!\s+DISTINCT\(?))?\s*\w*\("

# 配置保存期间要忽略的选项/开关值
IGNORE_SAVE_OPTIONS = ("saveConfig",)

# 本地主机的 IP 地址
LOCALHOST = "127.0.0.1"

# Tor 使用的默认 SOCKS 端口
DEFAULT_TOR_SOCKS_PORTS = (9050, 9150)

# Tor 使用的默认 HTTP 端口
DEFAULT_TOR_HTTP_PORTS = (8123, 8118)

# 低于该百分比的比较引擎可能会出现问题
LOW_TEXT_PERCENT = 20

# isDBMSVersionAtLeast()版本比较修正案例中使用的辅助值
VERSION_COMPARISON_CORRECTION = 0.0001

# These MySQL keywords can't go (alone) into versioned comment form (/*!...*/)
# 参考号：http://dev.mysql.com/doc/refman/5.1/en/function-resolution.html
IGNORE_SPACE_AFFECTED_KEYWORDS = ("CAST", "COUNT", "EXTRACT", "GROUP_CONCAT", "MAX", "MID", "MIN", "SESSION_USER", "SUBSTR", "SUBSTRING", "SUM", "SYSTEM_USER", "TRIM")

# getValue() 中的关键字应为大写
GET_VALUE_UPPERCASE_KEYWORDS = ("SELECT", "FROM", "WHERE", "DISTINCT", "COUNT")

LEGAL_DISCLAIMER = "Usage of sqlmap for attacking targets without prior mutual consent is illegal. It is the end user's responsibility to obey all applicable local, state and federal laws. Developers assume no liability and are not responsible for any misuse or damage caused by this program"

# 达到此未命中次数后，反射消除机制将关闭（出于加速原因）
REFLECTIVE_MISS_THRESHOLD = 20

# 用于提取 HTML 标题的正则表达式
HTML_TITLE_REGEX = r"(?i)<title>(?P<result>[^<]+)</title>"

# WordPress哈希破解例程中用于Base64转换的表
ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

# 命令行解析中要忽略的选项/开关（例如从 Firefox 传递的选项/开关）
IGNORED_OPTIONS = ("--compressed",)

# 用于快速区分用户是否提供了受污染的参数值的字符
DUMMY_SQL_INJECTION_CHARS = ";()'"

# 对虚拟用户进行简单检查
DUMMY_USER_INJECTION = r"(?i)[^\w](AND|OR)\s+[^\s]+[=><]|\bUNION\b.+\bSELECT\b|\bSELECT\b.+\bFROM\b|\b(CONCAT|information_schema|SLEEP|DELAY|FLOOR\(RAND)\b"

# 爬虫跳过的扩展
CRAWL_EXCLUDE_EXTENSIONS = frozenset(("3ds", "3g2", "3gp", "7z", "DS_Store", "a", "aac", "accdb", "access", "adp", "ai", "aif", "aiff", "apk", "ar", "asf", "au", "avi", "bak", "bin", "bin", "bk", "bkp", "bmp", "btif", "bz2", "c", "cab", "caf", "cfg", "cgm", "cmx", "com", "conf", "config", "cpio", "cpp", "cr2", "cue", "dat", "db", "dbf", "deb", "debug", "djvu", "dll", "dmg", "dmp", "dng", "doc", "docx", "dot", "dotx", "dra", "dsk", "dts", "dtshd", "dvb", "dwg", "dxf", "dylib", "ear", "ecelp4800", "ecelp7470", "ecelp9600", "egg", "elf", "env", "eol", "eot", "epub", "error", "exe", "f4v", "fbs", "fh", "fla", "flac", "fli", "flv", "fpx", "fst", "fvt", "g3", "gif", "go", "gz", "h", "h261", "h263", "h264", "ico", "ief", "img", "ini", "ipa", "iso", "jar", "java", "jpeg", "jpg", "jpgv", "jpm", "js", "jxr", "ktx", "lock", "log", "lvp", "lz", "lzma", "lzo", "m3u", "m4a", "m4v", "mar", "mdb", "mdi", "mid", "mj2", "mka", "mkv", "mmr", "mng", "mov", "movie", "mp3", "mp4", "mp4a", "mpeg", "mpg", "mpga", "msi", "mxu", "nef", "npx", "nrg", "o", "oga", "ogg", "ogv", "old", "otf", "ova", "ovf", "pbm", "pcx", "pdf", "pea", "pgm", "php", "pic", "pid", "pkg", "png", "pnm", "ppm", "pps", "ppt", "pptx", "ps", "psd", "py", "pya", "pyc", "pyo", "pyv", "qt", "rar", "ras", "raw", "rb", "rgb", "rip", "rlc", "rs", "run", "rz", "s3m", "s7z", "scm", "scpt", "service", "sgi", "shar", "sil", "smv", "so", "sock", "socket", "sqlite", "sqlitedb", "sub", "svc", "swf", "swo", "swp", "sys", "tar", "tbz2", "temp", "tga", "tgz", "tif", "tiff", "tlz", "tmp", "toast", "torrent", "ts", "ts", "ttf", "uvh", "uvi", "uvm", "uvp", "uvs", "uvu", "vbox", "vdi", "vhd", "vhdx", "viv", "vmdk", "vmx", "vob", "vxd", "war", "wav", "wax", "wbmp", "wdp", "weba", "webm", "webp", "whl", "wm", "wma", "wmv", "wmx", "woff", "woff2", "wvx", "xbm", "xif", "xls", "xlsx", "xlt", "xm", "xpi", "xpm", "xwd", "xz", "yaml", "yml", "z", "zip", "zipx"))

# 包含自定义注入标记字符“*”的 HTTP 请求头中常见的模式
PROBLEMATIC_CUSTOM_INJECTION_PATTERNS = r"(;q=[^;']+)|(\*/\*)"

# 用于公共表存在检查的模板
BRUTE_TABLE_EXISTS_TEMPLATE = "EXISTS(SELECT %d FROM %s)"

# 用于公共列存在检查的模板
BRUTE_COLUMN_EXISTS_TEMPLATE = "EXISTS(SELECT %s FROM %s)"

# shellcodeexec 中的数据将用随机字符串填充
SHELLCODEEXEC_RANDOM_STRING_MARKER = b"XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

# 上次更新后开始抱怨旧版本的时期
LAST_UPDATE_NAGGING_DAYS = 180

# 解析错误消息时的最小非写入字符（例如 ['"-:/]）比率
MIN_ERROR_PARSING_NON_WRITING_RATIO = 0.05

# 使用交换机 --check-internet 时检查互联网连接的通用地址（注意：https 版本不适用于 Python < 2.7.9）
CHECK_INTERNET_ADDRESS = "http://www.google.com/generate_204"

# 用于响应 CHECK_INTERNET_ADDRESS 的 HTTP 代码
CHECK_INTERNET_CODE = 204

# 用于检查 WAF/IPS 是否存在的载荷（越虚拟越好）
IPS_WAF_CHECK_PAYLOAD = "AND 1=1 UNION ALL SELECT 1,NULL,'<script>alert(\"XSS\")</script>',table_name FROM information_schema.tables WHERE 2>1--/**/; EXEC xp_cmdshell('cat ../../../etc/passwd')#"

# 用于引发特定 WAF/IPS 行为的向量
WAF_ATTACK_VECTORS = (
    "",  # NIL
    "search=<script>alert(1)</script>",
    "file=../../../../etc/passwd",
    "q=<invalid>foobar",
    "id=1 %s" % IPS_WAF_CHECK_PAYLOAD
)

# 用于字典攻击阶段的状态表示
ROTATING_CHARS = ('\\', '|', '|', '/', '-')

# BigArray 对象使用的近似块长度（以字节为单位）（仅最后一个块和缓存的块保存在内存中）
BIGARRAY_CHUNK_SIZE = 32 * 1024 * 1024

# 用于将 BigArray 块存储到磁盘的压缩级别 (0-9)
BIGARRAY_COMPRESS_LEVEL = 4

# 最大socket预连接数
SOCKET_PRE_CONNECT_QUEUE_SIZE = 3

# 仅控制台显示最后 n 个表行
TRIM_STDOUT_DUMP_SIZE = 256

# 参考号：http://stackoverflow.com/a/3168436
# 参考号：https://web.archive.org/web/20150407141500/https://support.microsoft.com/en-us/kb/899149
DUMP_FILE_BUFFER_SIZE = 1024

# 仅前几次解析响应请求头
PARSE_HEADERS_LIMIT = 3

# ORDER BY 技术中使用的步骤，用于在 UNION 查询注入中查找正确的列数
ORDER_BY_STEP = 10

# ORDER BY 技术中使用的最大值，用于在 UNION 查询注入中查找正确的列数
ORDER_BY_MAX = 1000

# 推理中字符重新验证的最大次数（根据需要）
MAX_REVALIDATION_STEPS = 5

# 可用于在提供的命令行中分割参数值的字符（例如在 --tamper 中）
PARAMETER_SPLITTING_REGEX = r"[,|;]"

# 用于在特殊情况下存储原始参数值的属性（例如POST）
UNENCODED_ORIGINAL_VALUE = "original"

# 包含用户名的常见列名称（在某些情况下用于哈希破解）
COMMON_USER_COLUMNS = frozenset(("login", "user", "uname", "username", "user_name", "user_login", "account", "account_name", "auth_user", "benutzername", "benutzer", "utilisateur", "usager", "consommateur", "utente", "utilizzatore", "utilizator", "utilizador", "usufrutuario", "korisnik", "uporabnik", "usuario", "consumidor", "client", "customer", "cuser"))

# GET/POST 值中的默认分隔符
DEFAULT_GET_POST_DELIMITER = '&'

# Cookie 值中的默认分隔符
DEFAULT_COOKIE_DELIMITER = ';'

# 当与 --load-cookies 一起提供时，用于强制 cookie 过期的 Unix 时间戳
FORCE_COOKIE_EXPIRATION_TIME = "9999999999"

# Github OAuth 令牌用于为未处理的异常创建自动问题
GITHUB_REPORT_OAUTH_TOKEN = "wxqc7vTeW8ohIcX+1wK55Mnql2Ex9cP+2s1dqTr/mjlZJVfLnq24fMAi08v5vRvOmuhVZQdOT/lhIRovWvIJrdECD1ud8VMPWpxY+NmjHoEx+VLK1/vCAUBwJe"

# 刷新 HashDB 缓存项目的阈值数量
HASHDB_FLUSH_THRESHOLD_ITEMS = 200

# 刷新 HashDB 阈值“脏”时间
HASHDB_FLUSH_THRESHOLD_TIME = 5

# 不成功的 HashDB 刷新尝试的重试次数
HASHDB_FLUSH_RETRIES = 3

# 不成功的 HashDB 检索尝试的重试次数
HASHDB_RETRIEVE_RETRIES = 3

# HashDB 结束事务尝试失败的重试次数
HASHDB_END_TRANSACTION_RETRIES = 3

# 用于强制弃用旧 HashDB 值的唯一里程碑值（例如，更改哈希/pickle 机制时）
HASHDB_MILESTONE_VALUE = "GpqxbkWTfz"  # python -c 'import random, string; print "".join(random.sample(string.ascii_letters, 10))'

# Pickle 协议用于在 HashDB 中存储序列化数据（https://docs.python.org/3/library/pickle.html#data-stream-format)
PICKLE_PROTOCOL = 2

# 警告用户由于完整 UNION 查询注入中的大页面转储可能导致的延迟
LARGE_OUTPUT_THRESHOLD = 1024 ** 2

# 在巨大的表上，如果每行检索都需要 ORDER BY，则会出现相当大的速度减慢（在使用错误注入的表转储中最明显）
SLOW_ORDER_COUNT_THRESHOLD = 10000

# 如果在第一个给定行数中没有找到任何内容，则放弃哈希识别
HASH_RECOGNITION_QUIT_THRESHOLD = 1000

# 用于（RAW）二进制列值的自动十六进制转换和哈希破解的正则表达式
HASH_BINARY_COLUMNS_REGEX = r"(?i)pass|psw|hash"

# 重定向到任何单个 URL 的最大数量 - 由于 cookie 引入的状态，因此需要此设置
MAX_SINGLE_URL_REDIRECTIONS = 4

# 最大重定向总数（无论 URL 是什么）- 假设我们处于循环之前
MAX_TOTAL_REDIRECTIONS = 10

# 页面稳定性检查中使用的最大（故意）延迟
MAX_STABILITY_DELAY = 0.5

# 参考号：http://www.tcpipguide.com/free/t_DNSLabelsNamesandSyntaxRules.htm
MAX_DNS_LABEL = 63

# DNS技术中名称解析请求的前缀和后缀字符串使用的字母（不包括不与内部内容混合的十六进制字符）
DNS_BOUNDARIES_ALPHABET = re.sub(r"[a-fA-F]", "", string.ascii_letters)

# 用于启发式检查的字母表
HEURISTIC_CHECK_ALPHABET = ('"', '\'', ')', '(', ',', '.')

# 轻微的艺术触感
BANNER = re.sub(r"\[.\]", lambda _: "[\033[01;41m%s\033[01;49m]" % random.sample(HEURISTIC_CHECK_ALPHABET, 1)[0], BANNER)

# 用于测试参数值的虚拟非 SQLi（例如 XSS）启发式检查的字符串
DUMMY_NON_SQLI_CHECK_APPENDIX = "<'\">"

# 用于识别文件包含错误的正则表达式
FI_ERROR_REGEX = r"(?i)[^\n]{0,100}(no such file|failed (to )?open)[^\n]{0,100}"

# 非 SQLI 启发式检查中使用的前缀和后缀的长度
NON_SQLI_CHECK_PREFIX_SUFFIX_LENGTH = 6

# 连接读取大小（部分处理大型响应以避免 MemoryError 崩溃 - 例如完整 UNION 注入中的大型表转储）
MAX_CONNECTION_READ_SIZE = 10 * 1024 * 1024

# 最大响应总页面大小（如果较大则修剪）
MAX_CONNECTION_TOTAL_SIZE = 100 * 1024 * 1024

# 用于防止 MemoryError 异常（在 difflib.SequenceMatcher 中使用大序列时引起）
MAX_DIFFLIB_SEQUENCE_LENGTH = 10 * 1024 * 1024

# 启发式检查中使用的页面大小阈值（例如 getHeuristicCharEncoding()、identYwaf、htmlParser 等）
HEURISTIC_PAGE_SIZE_THRESHOLD = 64 * 1024

# 二分算法中条目的最大（多线程）长度
MAX_BISECTION_LENGTH = 50 * 1024 * 1024

# 用于修剪大连接读取中不必要的内容的标记
LARGE_READ_TRIM_MARKER = "__TRIMMED_CONTENT__"

# 通用 SQL 注释形成
GENERIC_SQL_COMMENT = "-- [RANDSTR]"

# 开启时间自动调整机制阈值
VALID_TIME_CHARS_RUN_THRESHOLD = 100

# 仅当表足够大时才检查空列
CHECK_ZERO_COLUMNS_THRESHOLD = 10

# SQLite 转储格式时检查列类型的阈值
CHECK_SQLITE_TYPE_THRESHOLD = 100

# 将包含这些“模式”的所有记录器消息加粗
BOLD_PATTERNS = ("' injectable", "provided empty", "leftover chars", "might be injectable", "' is vulnerable", "is not injectable", "does not seem to be", "test failed", "test passed", "live test final result", "test shows that", "the back-end DBMS is", "created Github", "blocked by the target server", "protection is involved", "CAPTCHA", "specific response", "NULL connection is supported", "PASSED", "FAILED", "for more than", "connection to ", "will be trimmed")

# 用于搜索粗体模式的正则表达式
BOLD_PATTERNS_REGEX = '|'.join(BOLD_PATTERNS)

# 用于随机化电子邮件类似参数值的 TLD
RANDOMIZATION_TLDS = ("com", "net", "ru", "org", "de", "uk", "br", "jp", "cn", "fr", "it", "pl", "tv", "edu", "in", "ir", "es", "me", "info", "gr", "gov", "ca", "co", "se", "cz", "to", "vn", "nl", "cc", "az", "hu", "ua", "be", "no", "biz", "io", "ch", "ro", "sk", "eu", "us", "tw", "pt", "fi", "at", "lt", "kz", "cl", "hr", "pk", "lv", "la", "pe", "au")

# 通用 www 根目录名称
GENERIC_DOC_ROOT_DIRECTORY_NAMES = ("htdocs", "httpdocs", "public", "public_html", "wwwroot", "www", "site")

# 包含开关/选项名称的帮助部分的最大长度
MAX_HELP_OPTION_LENGTH = 18

# 最大连接重试次数（以防止递归问题）
MAX_CONNECT_RETRIES = 100

# 用于检测格式错误的字符串
FORMAT_EXCEPTION_STRINGS = ("Type mismatch", "Error converting", "Please enter a", "Conversion failed", "String or binary data would be truncated", "Failed to convert", "unable to interpret text value", "Input string was not in a correct format", "System.FormatException", "java.lang.NumberFormatException", "ValueError: invalid literal", "TypeMismatchException", "CF_SQL_INTEGER", "CF_SQL_NUMERIC", " for CFSQLTYPE ", "cfqueryparam cfsqltype", "InvalidParamTypeException", "Invalid parameter type", "Attribute validation error for tag", "is not of type numeric", "<cfif Not IsNumeric(", "invalid input syntax for integer", "invalid input syntax for type", "invalid number", "character to number conversion error", "unable to interpret text value", "String was not recognized as a valid", "Convert.ToInt", "cannot be converted to a ", "InvalidDataException", "Arguments are of the wrong type", "Invalid conversion")

# 用于提取 ASP.NET 视图状态值的正则表达式
VIEWSTATE_REGEX = r'(?i)(?P<name>__VIEWSTATE[^"]*)[^>]+value="(?P<result>[^"]+)'

# 用于提取 ASP.NET 事件验证值的正则表达式
EVENTVALIDATION_REGEX = r'(?i)(?P<name>__EVENTVALIDATION[^"]*)[^>]+value="(?P<result>[^"]+)'

# 在有限输出的完整联合测试中生成的行数（不得太大以防止载荷长度问题）
LIMITED_ROWS_TEST_NUMBER = 15

# 用于瓶子服务器的默认适配器
RESTAPI_DEFAULT_ADAPTER = "wsgiref"

# 默认 REST-JSON API 服务器监听地址
RESTAPI_DEFAULT_ADDRESS = "127.0.0.1"

# 默认 REST-JSON API 服务器监听端口
RESTAPI_DEFAULT_PORT = 8775

# REST-JSON API 服务器不支持的选项
RESTAPI_UNSUPPORTED_OPTIONS = ("sqlShell", "wizard")

# 使用“补充私人使用区域-A”
INVALID_UNICODE_PRIVATE_AREA = False

# 用于表示无效 unicode 字符的格式
INVALID_UNICODE_CHAR_FORMAT = r"\x%02x"

# httpx 库支持的最低版本（对于 --http2）
MIN_HTTPX_VERSION = "0.28"

# XML POST 数据的正则表达式
XML_RECOGNITION_REGEX = r"(?s)\A\s*<[^>]+>(.+>)?\s*\Z"

# 用于检测 JSON POST 数据的正则表达式
JSON_RECOGNITION_REGEX = r'(?s)\A(\s*\[)*\s*\{.*"[^"]+"\s*:\s*("[^"]*"|\d+|true|false|null|\[).*\}\s*(\]\s*)*\Z'

# 用于检测类似 JSON 的 POST 数据的正则表达式
JSON_LIKE_RECOGNITION_REGEX = r"(?s)\A(\s*\[)*\s*\{.*('[^']+'|\"[^\"]+\"|\w+)\s*:\s*('[^']+'|\"[^\"]+\"|\d+).*\}\s*(\]\s*)*\Z"

# 用于检测多部分 POST 数据的正则表达式
MULTIPART_RECOGNITION_REGEX = r"(?i)Content-Disposition:[^;]+;\s*name="

# 用于检测类似数组的 POST 数据的正则表达式
ARRAY_LIKE_RECOGNITION_REGEX = r"(\A|%s)(\w+)\[\d*\]=.+%s\2\[\d*\]=" % (DEFAULT_GET_POST_DELIMITER, DEFAULT_GET_POST_DELIMITER)

# 默认 POST 数据内容类型
DEFAULT_CONTENT_TYPE = "application/x-www-form-urlencoded; charset=utf-8"

# 原始文本 POST 数据内容类型
PLAIN_TEXT_CONTENT_TYPE = "text/plain; charset=utf-8"

# 检查 Suhosin 补丁（类似）保护机制是否存在时使用的长度
SUHOSIN_MAX_VALUE_LENGTH = 512

# 在考虑转储到磁盘之前（二进制）条目的最小大小
MIN_BINARY_DISK_DUMP_SIZE = 100

# 载荷 xml 文件的文件名（按加载顺序）
PAYLOAD_XML_FILES = ("boolean_blind.xml", "error_based.xml", "inline_query.xml", "stacked_queries.xml", "time_blind.xml", "union_query.xml")

# 用于提取表单标签的正则表达式
FORM_SEARCH_REGEX = r"(?si)<form(?!.+<form).+?</form>"

# 历史文件中保存的最大行数
MAX_HISTORY_LENGTH = 1000

# 编码内容（十六进制、base64...）检查所需的最小字段条目长度
MIN_ENCODED_LEN_CHECK = 5

# Metasploit 远程会话必须初始化的超时（以秒为单位）
METASPLOIT_SESSION_TIMEOUT = 180

# 参考号：http://www.postgresql.org/docs/9.0/static/catalog-pg-largeobject.html
LOBLKSIZE = 2048

# 用于标记特殊变量的前缀（例如关键字、具有特殊字符等）
EVALCODE_ENCODED_PREFIX = "EVAL_"

# 参考号：https://en.wikipedia.org/wiki/Zip_(file_format)
ZIP_HEADER = b"\x50\x4b\x03\x04"

# 参考号：http://www.cookiecentral.com/faq/#3.5
NETSCAPE_FORMAT_HEADER_COOKIES = "# Netscape HTTP Cookie File."

# 用于自动识别携带反CSRF令牌的参数的中缀
CSRF_TOKEN_PARAMETER_INFIXES = ("csrf", "xsrf", "token", "nonce")

# 暴力搜索 Web 服务器文档根目录时使用的前缀
BRUTE_DOC_ROOT_PREFIXES = {
    OS.LINUX: ("/var/www", "/usr/local/apache", "/usr/local/apache2", "/usr/local/www/apache22", "/usr/local/www/apache24", "/usr/local/httpd", "/var/www/nginx-default", "/srv/www", "/var/www/%TARGET%", "/var/www/vhosts/%TARGET%", "/var/www/virtual/%TARGET%", "/var/www/clients/vhosts/%TARGET%", "/var/www/clients/virtual/%TARGET%", "/Library/WebServer/Documents", "/opt/homebrew/var/www"),
    OS.WINDOWS: ("/xampp", "/Program Files/xampp", "/wamp", "/Program Files/wampp", "/Apache/Apache", "/apache", "/Program Files/Apache Group/Apache", "/Program Files/Apache Group/Apache2", "/Program Files/Apache Group/Apache2.2", "/Program Files/Apache Group/Apache2.4", "/Inetpub/wwwroot", "/Inetpub/wwwroot/%TARGET%", "/Inetpub/vhosts/%TARGET%")
}

# 用于暴力搜索 Web 服务器文档根目录的后缀
BRUTE_DOC_ROOT_SUFFIXES = ("", "html", "htdocs", "httpdocs", "php", "public", "src", "site", "build", "web", "www", "data", "sites/all", "www/build")

# 用于在使用强力 Web 服务器文档根目录中标记目标名称的字符串
BRUTE_DOC_ROOT_TARGET_MARK = "%TARGET%"

# 在 kb.chars 中用作边界的字符（最好是不太常见的字母）
KB_CHARS_BOUNDARY_CHAR = 'q'

# kb.chars 中使用频率较低的字母
KB_CHARS_LOW_FREQUENCY_ALPHABET = "zqxjkvbp"

# 可打印字节
PRINTABLE_BYTES = set(bytes(string.printable, "ascii") if six.PY3 else string.printable)

# 用于分割 HTTP 分块传输编码请求的 SQL 关键字（开关 --chunk）
HTTP_CHUNKED_SPLIT_KEYWORDS = ("SELECT", "UPDATE", "INSERT", "FROM", "LOAD_FILE", "UNION", "information_schema", "sysdatabases", "msysaccessobjects", "msysqueries", "sysmodules")

# HTML 转储格式中使用的 CSS 样式
HTML_DUMP_CSS_STYLE = """<style>
table{
    margin:10;
    background-color:#FFFFFF;
    font-family:verdana;
    font-size:12px;
    align:center;
}
thead{
    font-weight:bold;
    background-color:#4F81BD;
    color:#FFFFFF;
}
tr:nth-child(even) {
    background-color: #D3DFEE
}
td{
    font-size:12px;
}
th{
    font-size:12px;
    cursor:pointer;
}
</style>"""

# 留下从此处更改值的（脏）可能性（例如“export SQLMAP__MAX_NUMBER_OF_THREADS=20”）
for key, value in os.environ.items():
    if key.upper().startswith("%s_" % SQLMAP_ENVIRONMENT_PREFIX):
        _ = key[len(SQLMAP_ENVIRONMENT_PREFIX) + 1:].upper()
        if _ in globals():
            original = globals()[_]
            if isinstance(original, int):
                try:
                    globals()[_] = int(value)
                except ValueError:
                    pass
            elif isinstance(original, bool):
                globals()[_] = value.lower() in ('1', 'true')
            elif isinstance(original, (list, tuple)):
                globals()[_] = [__.strip() for __ in _.split(',')]
            else:
                globals()[_] = value
