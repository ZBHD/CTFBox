export type PluginCategory = "web" | "crypto" | "misc";
export type PluginEdition = "original" | "cn";

export interface ToolPlugin {
  id: string;
  category: PluginCategory;
  name: string;
  description: string;
  editions?: readonly PluginEdition[];
}

const BUILT_IN_PLUGINS: readonly ToolPlugin[] = [
  {
    id: "sqlmap",
    category: "web",
    name: "SQLmap",
    description: "SQL 注入检测与数据枚举",
    editions: ["original", "cn"],
  },
  {
    id: "sstimap",
    category: "web",
    name: "SSTImap",
    description: "模板注入检测与利用",
    editions: ["original", "cn"],
  },
  {
    id: "crypto",
    category: "crypto",
    name: "Crypto",
    description: "离线密码学与编码工具",
  },
  {
    id: "misc",
    category: "misc",
    name: "Misc",
    description: "文件、隐写和综合分析工具",
  },
];

const PLUGINS_BY_ID = new Map(BUILT_IN_PLUGINS.map((plugin) => [plugin.id, plugin]));

export function listPlugins(category?: PluginCategory): readonly ToolPlugin[] {
  if (!category) return BUILT_IN_PLUGINS;
  return BUILT_IN_PLUGINS.filter((plugin) => plugin.category === category);
}

export function getPlugin(id: string): ToolPlugin | undefined {
  return PLUGINS_BY_ID.get(id);
}
