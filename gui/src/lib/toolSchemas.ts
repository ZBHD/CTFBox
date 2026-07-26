export type ParameterControl =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "result-select"
  | "file";

export interface ParameterOption {
  value: string;
  label: string;
}

export interface ParameterGroup {
  id: string;
  label: string;
  description: string;
}

export interface ParameterField {
  id: string;
  group: string;
  label: string;
  flag: string;
  control: ParameterControl;
  description?: string;
  placeholder?: string;
  options?: readonly ParameterOption[];
  quick?: boolean;
  resultKind?: "database" | "table" | "column";
  repeatable?: boolean;
  valueArity?: number;
  min?: number;
  max?: number;
}

export interface ToolParameterSchema {
  toolId: "sqlmap" | "sstimap" | "dirsearch" | "subfinder" | "nuclei";
  groups: readonly ParameterGroup[];
  fields: readonly ParameterField[];
}

const selectOptions = (...values: string[]): ParameterOption[] =>
  values.map((value) => ({ value, label: value }));

const SQLMAP_SCHEMA: ToolParameterSchema = {
  toolId: "sqlmap",
  groups: [
    { id: "target", label: "目标", description: "URL、请求文件和批量目标" },
    { id: "request", label: "请求", description: "HTTP 数据、身份信息和代理" },
    { id: "injection", label: "注入", description: "测试参数、数据库类型和 Tamper" },
    { id: "detection", label: "检测", description: "检测强度与页面判定条件" },
    { id: "techniques", label: "技术", description: "注入技术和时间参数" },
    { id: "enumeration", label: "枚举", description: "数据库对象与数据提取" },
    { id: "performance", label: "性能", description: "线程和请求优化" },
    { id: "general", label: "常规", description: "会话、交互和输出行为" },
  ],
  fields: [
    { id: "url", group: "target", label: "目标 URL", flag: "--url", control: "text", placeholder: "http://127.0.0.1/item?id=1", quick: true },
    { id: "requestFile", group: "target", label: "原始请求文件", flag: "-r", control: "file", description: "加载 Burp 或文本格式 HTTP 请求" },
    { id: "bulkFile", group: "target", label: "批量目标文件", flag: "-m", control: "file" },
    { id: "configFile", group: "target", label: "配置文件", flag: "-c", control: "file" },

    { id: "method", group: "request", label: "请求方法", flag: "--method", control: "select", options: selectOptions("GET", "POST", "PUT", "PATCH", "DELETE"), quick: true },
    { id: "data", group: "request", label: "请求数据", flag: "--data", control: "textarea", placeholder: "id=1&name=test", quick: true },
    { id: "cookie", group: "request", label: "Cookie", flag: "--cookie", control: "textarea", placeholder: "session=..." },
    { id: "headers", group: "request", label: "附加请求头", flag: "--headers", control: "textarea", placeholder: "X-Forwarded-For: 127.0.0.1" },
    { id: "userAgent", group: "request", label: "User-Agent", flag: "--user-agent", control: "text" },
    { id: "randomAgent", group: "request", label: "随机 User-Agent", flag: "--random-agent", control: "boolean" },
    { id: "proxy", group: "request", label: "代理", flag: "--proxy", control: "text", placeholder: "http://127.0.0.1:8080" },
    { id: "authType", group: "request", label: "认证类型", flag: "--auth-type", control: "select", options: selectOptions("Basic", "Digest", "NTLM", "PKI") },
    { id: "authCred", group: "request", label: "认证凭据", flag: "--auth-cred", control: "text", placeholder: "user:password" },
    { id: "delay", group: "request", label: "请求间隔（秒）", flag: "--delay", control: "number", min: 0 },
    { id: "timeout", group: "request", label: "超时（秒）", flag: "--timeout", control: "number", min: 1 },

    { id: "testParameter", group: "injection", label: "测试参数", flag: "-p", control: "text", placeholder: "id,name", quick: true },
    { id: "dbms", group: "injection", label: "后端数据库", flag: "--dbms", control: "select", options: selectOptions("MySQL", "PostgreSQL", "Microsoft SQL Server", "Oracle", "SQLite", "Microsoft Access") },
    { id: "tamper", group: "injection", label: "Tamper 脚本", flag: "--tamper", control: "text", placeholder: "space2comment,between", quick: true },
    { id: "prefix", group: "injection", label: "载荷前缀", flag: "--prefix", control: "text" },
    { id: "suffix", group: "injection", label: "载荷后缀", flag: "--suffix", control: "text" },
    { id: "skipStatic", group: "injection", label: "跳过静态参数", flag: "--skip-static", control: "boolean" },

    { id: "level", group: "detection", label: "检测等级", flag: "--level", control: "select", options: selectOptions("1", "2", "3", "4", "5"), quick: true },
    { id: "risk", group: "detection", label: "风险等级", flag: "--risk", control: "select", options: selectOptions("1", "2", "3"), quick: true },
    { id: "matchString", group: "detection", label: "成功匹配文本", flag: "--string", control: "text" },
    { id: "notString", group: "detection", label: "失败匹配文本", flag: "--not-string", control: "text" },
    { id: "regexp", group: "detection", label: "成功匹配正则", flag: "--regexp", control: "text" },
    { id: "code", group: "detection", label: "成功状态码", flag: "--code", control: "number", min: 100, max: 599 },
    { id: "smart", group: "detection", label: "仅测试动态参数", flag: "--smart", control: "boolean" },
    { id: "textOnly", group: "detection", label: "仅比较文本", flag: "--text-only", control: "boolean" },

    { id: "technique", group: "techniques", label: "注入技术", flag: "--technique", control: "multiselect", options: [
      { value: "B", label: "布尔盲注" }, { value: "E", label: "报错" }, { value: "U", label: "联合查询" },
      { value: "S", label: "堆叠查询" }, { value: "T", label: "时间盲注" }, { value: "Q", label: "内联查询" },
    ], quick: true },
    { id: "timeSec", group: "techniques", label: "时间盲注延迟", flag: "--time-sec", control: "number", min: 1 },
    { id: "unionCols", group: "techniques", label: "联合查询列范围", flag: "--union-cols", control: "text", placeholder: "1-10" },
    { id: "secondUrl", group: "techniques", label: "二阶响应 URL", flag: "--second-url", control: "text" },

    { id: "banner", group: "enumeration", label: "数据库版本", flag: "--banner", control: "boolean" },
    { id: "currentUser", group: "enumeration", label: "当前用户", flag: "--current-user", control: "boolean" },
    { id: "currentDb", group: "enumeration", label: "当前数据库", flag: "--current-db", control: "boolean" },
    { id: "users", group: "enumeration", label: "数据库用户", flag: "--users", control: "boolean" },
    { id: "passwords", group: "enumeration", label: "密码哈希", flag: "--passwords", control: "boolean" },
    { id: "dbs", group: "enumeration", label: "枚举数据库", flag: "--dbs", control: "boolean", quick: true },
    { id: "tables", group: "enumeration", label: "枚举数据表", flag: "--tables", control: "boolean", quick: true },
    { id: "columns", group: "enumeration", label: "枚举字段列", flag: "--columns", control: "boolean", quick: true },
    { id: "schema", group: "enumeration", label: "完整结构", flag: "--schema", control: "boolean" },
    { id: "database", group: "enumeration", label: "数据库", flag: "-D", control: "result-select", resultKind: "database", placeholder: "选择或输入数据库" },
    { id: "table", group: "enumeration", label: "数据表", flag: "-T", control: "result-select", resultKind: "table", placeholder: "选择或输入数据表" },
    { id: "column", group: "enumeration", label: "字段列", flag: "-C", control: "result-select", resultKind: "column", placeholder: "选择或输入字段" },
    { id: "dump", group: "enumeration", label: "导出数据", flag: "--dump", control: "boolean", quick: true },
    { id: "dumpAll", group: "enumeration", label: "导出全部数据库", flag: "--dump-all", control: "boolean" },
    { id: "search", group: "enumeration", label: "搜索对象", flag: "--search", control: "boolean" },
    { id: "where", group: "enumeration", label: "筛选条件", flag: "--where", control: "text", placeholder: "id > 10" },
    { id: "start", group: "enumeration", label: "起始行", flag: "--start", control: "number", min: 1 },
    { id: "stop", group: "enumeration", label: "结束行", flag: "--stop", control: "number", min: 1 },
    { id: "sqlQuery", group: "enumeration", label: "SQL 查询", flag: "--sql-query", control: "textarea" },

    { id: "optimize", group: "performance", label: "启用全部优化", flag: "-o", control: "boolean" },
    { id: "threads", group: "performance", label: "并发线程", flag: "--threads", control: "number", min: 1, max: 10, quick: true },
    { id: "keepAlive", group: "performance", label: "HTTP Keep-Alive", flag: "--keep-alive", control: "boolean" },
    { id: "predictOutput", group: "performance", label: "预测常用输出", flag: "--predict-output", control: "boolean" },

    { id: "batch", group: "general", label: "自动确认", flag: "--batch", control: "boolean", quick: true },
    { id: "flushSession", group: "general", label: "清除当前会话", flag: "--flush-session", control: "boolean" },
    { id: "freshQueries", group: "general", label: "忽略缓存结果", flag: "--fresh-queries", control: "boolean" },
    { id: "verbose", group: "general", label: "输出详细度", flag: "-v", control: "select", options: selectOptions("0", "1", "2", "3", "4", "5", "6") },
  ],
};

const SSTIMAP_SCHEMA: ToolParameterSchema = {
  toolId: "sstimap",
  groups: [
    { id: "target", label: "目标", description: "单个目标、交互模式和批量输入" },
    { id: "request", label: "请求", description: "注入点、请求数据和网络选项" },
    { id: "crawler", label: "爬虫", description: "页面、表单和域名发现" },
    { id: "detection", label: "检测", description: "模板引擎和检测技术" },
    { id: "payload", label: "载荷", description: "模板、语言、系统和文件操作" },
    { id: "general", label: "常规", description: "模块、配置和输出行为" },
  ],
  fields: [
    { id: "url", group: "target", label: "目标 URL", flag: "-u", control: "text", placeholder: "http://127.0.0.1/page?name=*", quick: true },
    { id: "interactive", group: "target", label: "交互模式", flag: "-i", control: "boolean" },
    { id: "loadUrls", group: "target", label: "批量 URL", flag: "--load-urls", control: "file" },
    { id: "loadForms", group: "target", label: "批量表单", flag: "--load-forms", control: "file" },

    { id: "method", group: "request", label: "请求方法", flag: "-m", control: "select", options: selectOptions("GET", "POST", "PUT", "PATCH", "DELETE"), quick: true },
    { id: "data", group: "request", label: "请求数据", flag: "-d", control: "textarea", placeholder: "name=*", quick: true, repeatable: true },
    { id: "injectionPoints", group: "request", label: "注入点", flag: "-P", control: "multiselect", options: [
      { value: "Q", label: "查询参数" }, { value: "B", label: "请求体" }, { value: "H", label: "请求头" }, { value: "C", label: "Cookie" },
    ], quick: true },
    { id: "marker", group: "request", label: "注入标记", flag: "-M", control: "text", placeholder: "*" },
    { id: "dataType", group: "request", label: "数据类型", flag: "--data-type", control: "select", options: selectOptions("auto", "form", "json", "xml") },
    { id: "header", group: "request", label: "请求头", flag: "-H", control: "textarea", repeatable: true, placeholder: "Header: Value" },
    { id: "cookie", group: "request", label: "Cookie", flag: "-C", control: "textarea", repeatable: true },
    { id: "userAgent", group: "request", label: "User-Agent", flag: "-a", control: "text" },
    { id: "randomAgent", group: "request", label: "随机 User-Agent", flag: "-A", control: "boolean" },
    { id: "delay", group: "request", label: "请求间隔（秒）", flag: "--delay", control: "number", min: 0 },
    { id: "proxy", group: "request", label: "代理", flag: "-p", control: "text", placeholder: "http://127.0.0.1:8080" },
    { id: "verifySsl", group: "request", label: "验证 SSL 证书", flag: "--verify-ssl", control: "boolean" },
    { id: "logResponse", group: "request", label: "记录 HTTP 响应", flag: "--log-response", control: "boolean" },

    { id: "crawlDepth", group: "crawler", label: "爬取深度", flag: "-c", control: "number", min: 0, max: 10 },
    { id: "forms", group: "crawler", label: "扫描表单", flag: "-f", control: "boolean" },
    { id: "emptyForms", group: "crawler", label: "空页面视为 GET 表单", flag: "--empty-forms", control: "boolean" },
    { id: "crawlExclude", group: "crawler", label: "排除 URL 正则", flag: "--crawl-exclude", control: "text" },
    { id: "crawlDomains", group: "crawler", label: "跨域范围", flag: "--crawl-domains", control: "select", options: [
      { value: "N", label: "仅当前域名" }, { value: "S", label: "包含子域名" }, { value: "Y", label: "允许其他域名" },
    ] },

    { id: "level", group: "detection", label: "转义等级", flag: "-l", control: "select", options: selectOptions("1", "2", "3", "4", "5"), quick: true },
    { id: "forceLevel", group: "detection", label: "强制 LEVEL / CLEVEL", flag: "-L", control: "text", placeholder: "1 1", valueArity: 2 },
    { id: "engine", group: "detection", label: "模板引擎", flag: "-e", control: "text", placeholder: "jinja2 或 *", quick: true },
    { id: "technique", group: "detection", label: "检测技术", flag: "-r", control: "multiselect", options: [
      { value: "R", label: "渲染" }, { value: "E", label: "报错" }, { value: "B", label: "布尔盲注" }, { value: "T", label: "时间盲注" },
    ], quick: true },
    { id: "boolOk", group: "detection", label: "布尔成功正则", flag: "--bool-ok", control: "text" },
    { id: "boolErr", group: "detection", label: "布尔失败正则", flag: "--bool-err", control: "text" },
    { id: "blindDelay", group: "detection", label: "盲注检测延迟", flag: "--blind-delay", control: "number", min: 1 },
    { id: "verifyBlindDelay", group: "detection", label: "盲注验证延迟", flag: "--verify-blind-delay", control: "number", min: 1 },
    { id: "legacy", group: "detection", label: "包含旧版载荷", flag: "--legacy", control: "boolean" },
    { id: "generic", group: "detection", label: "尝试通用引擎载荷", flag: "--generic", control: "boolean" },
    { id: "runDetection", group: "detection", label: "交互模式启动时检测", flag: "--run", control: "boolean" },

    { id: "tplShell", group: "payload", label: "模板交互 Shell", flag: "-t", control: "boolean" },
    { id: "tplCode", group: "payload", label: "模板代码", flag: "-T", control: "textarea" },
    { id: "evalShell", group: "payload", label: "语言交互 Shell", flag: "-x", control: "boolean" },
    { id: "evalCode", group: "payload", label: "语言代码", flag: "-X", control: "textarea" },
    { id: "osShell", group: "payload", label: "系统交互 Shell", flag: "-s", control: "boolean" },
    { id: "osCommand", group: "payload", label: "系统命令", flag: "-S", control: "text" },
    { id: "bindShell", group: "payload", label: "绑定 Shell 端口", flag: "-B", control: "number", min: 1, max: 65535 },
    { id: "reverseShell", group: "payload", label: "反向 Shell 地址", flag: "-R", control: "text", placeholder: "HOST PORT", valueArity: 2 },
    { id: "remoteShell", group: "payload", label: "远端 Shell", flag: "--remote-shell", control: "text", placeholder: "/bin/sh" },
    { id: "forceOverwrite", group: "payload", label: "强制覆盖文件", flag: "-F", control: "boolean" },
    { id: "upload", group: "payload", label: "上传文件", flag: "-U", control: "text", placeholder: "LOCAL REMOTE", valueArity: 2 },
    { id: "download", group: "payload", label: "下载文件", flag: "-D", control: "text", placeholder: "REMOTE LOCAL", valueArity: 2 },

    { id: "module", group: "general", label: "模块信息", flag: "--module", control: "text" },
    { id: "config", group: "general", label: "配置文件或目录", flag: "--config", control: "file" },
    { id: "noColor", group: "general", label: "禁用彩色输出", flag: "--no-color", control: "boolean" },
  ],
};

const DIRSEARCH_SCHEMA: ToolParameterSchema = {
  toolId: "dirsearch",
  groups: [
    { id: "target", label: "目标", description: "目标 URL 与批量地址" },
    { id: "wordlist", label: "字典", description: "字典文件与扩展名" },
    { id: "filter", label: "过滤", description: "按状态码和响应大小筛选" },
    { id: "request", label: "请求", description: "方法、请求头、Cookie 与代理" },
    { id: "crawl", label: "递归", description: "目录递归与爬取" },
    { id: "performance", label: "性能", description: "线程、延迟与超时" },
  ],
  fields: [
    { id: "url", group: "target", label: "目标 URL", flag: "-u", control: "text", placeholder: "http://127.0.0.1/", quick: true },
    { id: "urlsFile", group: "target", label: "批量 URL 文件", flag: "--urls-file", control: "file" },

    { id: "wordlists", group: "wordlist", label: "字典文件", flag: "-w", control: "text", placeholder: "db/dicc.txt" },
    { id: "extensions", group: "wordlist", label: "扩展名", flag: "-e", control: "text", placeholder: "php,asp,html", quick: true },
    { id: "forceExtensions", group: "wordlist", label: "强制附加扩展名", flag: "-f", control: "boolean" },

    { id: "includeStatus", group: "filter", label: "包含状态码", flag: "-i", control: "text", placeholder: "200,301,403" },
    { id: "excludeStatus", group: "filter", label: "排除状态码", flag: "-x", control: "text", placeholder: "404,500" },
    { id: "excludeSizes", group: "filter", label: "排除响应大小", flag: "--exclude-sizes", control: "text", placeholder: "0B,123B" },

    { id: "method", group: "request", label: "请求方法", flag: "-m", control: "select", options: selectOptions("GET", "POST", "PUT", "HEAD"), quick: true },
    { id: "headers", group: "request", label: "附加请求头", flag: "-H", control: "textarea", repeatable: true, placeholder: "X-Forwarded-For: 127.0.0.1" },
    { id: "cookie", group: "request", label: "Cookie", flag: "--cookie", control: "textarea", placeholder: "session=..." },
    { id: "proxy", group: "request", label: "代理", flag: "--proxy", control: "text", placeholder: "http://127.0.0.1:8080" },

    { id: "recursive", group: "crawl", label: "递归扫描", flag: "-r", control: "boolean" },
    { id: "recursionDepth", group: "crawl", label: "递归深度", flag: "-R", control: "number", min: 1 },
    { id: "deepRecursive", group: "crawl", label: "深度递归", flag: "--deep-recursive", control: "boolean" },

    { id: "threads", group: "performance", label: "并发线程", flag: "-t", control: "number", min: 1, quick: true },
    { id: "delay", group: "performance", label: "请求间隔（秒）", flag: "--delay", control: "number", min: 0 },
    { id: "timeout", group: "performance", label: "超时（秒）", flag: "--timeout", control: "number", min: 1 },
  ],
};

const SUBFINDER_SCHEMA: ToolParameterSchema = {
  toolId: "subfinder",
  groups: [
    { id: "target", label: "目标", description: "单个域名或批量域名文件" },
    { id: "sources", label: "数据源", description: "启用全部源、指定或排除源" },
    { id: "output", label: "输出", description: "结构化 JSON 输出" },
    { id: "performance", label: "性能", description: "并发、超时与速率" },
    { id: "config", label: "配置", description: "配置文件与 provider key" },
  ],
  fields: [
    { id: "domain", group: "target", label: "目标域名", flag: "-d", control: "text", placeholder: "example.com", quick: true },
    { id: "domainList", group: "target", label: "域名列表文件", flag: "-dL", control: "file" },

    { id: "all", group: "sources", label: "启用全部源", flag: "-all", control: "boolean", quick: true },
    { id: "sources", group: "sources", label: "指定数据源", flag: "-s", control: "text", placeholder: "crtsh,dnsdumpster" },
    { id: "excludeSources", group: "sources", label: "排除数据源", flag: "-es", control: "text" },
    { id: "recursive", group: "sources", label: "递归枚举", flag: "-recursive", control: "boolean" },

    { id: "json", group: "output", label: "JSON 行输出", flag: "-oJ", control: "boolean", quick: true, description: "建议开启以稳定解析发现结果" },
    { id: "silent", group: "output", label: "仅输出子域", flag: "-silent", control: "boolean" },

    { id: "threads", group: "performance", label: "并发数", flag: "-t", control: "number", min: 1 },
    { id: "timeout", group: "performance", label: "超时（秒）", flag: "-timeout", control: "number", min: 1 },
    { id: "rateLimit", group: "performance", label: "速率限制", flag: "-rl", control: "number", min: 0 },

    { id: "config", group: "config", label: "配置文件", flag: "-config", control: "file" },
    { id: "providerConfig", group: "config", label: "Provider 配置", flag: "-pc", control: "file", description: "provider-config.yaml，含 API key" },
  ],
};

const NUCLEI_SCHEMA: ToolParameterSchema = {
  toolId: "nuclei",
  groups: [
    { id: "target", label: "目标", description: "单个 URL 或目标列表" },
    { id: "templates", label: "模板", description: "模板路径、标签与严重级别" },
    { id: "request", label: "请求", description: "请求头、代理与超时" },
    { id: "output", label: "输出", description: "结构化 JSONL 输出" },
    { id: "performance", label: "性能", description: "并发、速率与批量" },
  ],
  fields: [
    { id: "url", group: "target", label: "目标 URL", flag: "-u", control: "text", placeholder: "http://target/", quick: true },
    { id: "list", group: "target", label: "目标列表文件", flag: "-l", control: "file" },

    { id: "templates", group: "templates", label: "模板路径", flag: "-t", control: "text", placeholder: "cves/ 或本地模板目录", quick: true },
    { id: "tags", group: "templates", label: "标签", flag: "-tags", control: "text", placeholder: "cve,rce" },
    { id: "severity", group: "templates", label: "严重级别", flag: "-severity", control: "text", placeholder: "medium,high,critical", quick: true },
    { id: "excludeTags", group: "templates", label: "排除标签", flag: "-etags", control: "text" },

    { id: "headers", group: "request", label: "附加请求头", flag: "-H", control: "textarea", repeatable: true, placeholder: "Authorization: Bearer ..." },
    { id: "proxy", group: "request", label: "代理", flag: "-proxy", control: "text", placeholder: "http://127.0.0.1:8080" },
    { id: "timeout", group: "request", label: "超时（秒）", flag: "-timeout", control: "number", min: 1 },

    { id: "jsonl", group: "output", label: "JSONL 输出", flag: "-jsonl", control: "boolean", quick: true, description: "建议开启以稳定解析命中" },
    { id: "silent", group: "output", label: "静默模式", flag: "-silent", control: "boolean" },

    { id: "concurrency", group: "performance", label: "并发模板数", flag: "-c", control: "number", min: 1 },
    { id: "rateLimit", group: "performance", label: "速率限制", flag: "-rl", control: "number", min: 0 },
    { id: "bulkSize", group: "performance", label: "批量主机数", flag: "-bulk-size", control: "number", min: 1 },
  ],
};

const SCHEMAS: Record<string, ToolParameterSchema> = {
  sqlmap: SQLMAP_SCHEMA,
  sstimap: SSTIMAP_SCHEMA,
  dirsearch: DIRSEARCH_SCHEMA,
  subfinder: SUBFINDER_SCHEMA,
  nuclei: NUCLEI_SCHEMA,
};

export function getToolSchema(toolId: string): ToolParameterSchema {
  return SCHEMAS[toolId] ?? SQLMAP_SCHEMA;
}
