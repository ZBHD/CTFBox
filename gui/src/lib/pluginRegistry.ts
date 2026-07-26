import { z } from "zod";
import registryJson from "../../../tools/tool_registry.json";

export type PluginCategory = "web" | "crypto" | "misc";
export type PluginEdition = "original" | "cn";

export type PluginRunner =
  | { kind: "python"; launcher: string; sourceDirectory: string; entry: string }
  | { kind: "binary"; program: string }
  | { kind: "session"; sourceDirectory: string; entry: string };

export interface ToolPlugin {
  id: string;
  category: PluginCategory;
  name: string;
  description: string;
  editions?: readonly PluginEdition[];
  runner?: PluginRunner;
}

const pythonRunner = z.object({
  kind: z.literal("python"),
  launcher: z.string().regex(/^[A-Za-z0-9._-]+\.cmd$/),
  sourceDirectory: z.string().min(1),
  entry: z.string().regex(/^[A-Za-z0-9._-]+\.py$/),
});

const binaryRunner = z.object({
  kind: z.literal("binary"),
  program: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
});

const sessionRunner = z.object({
  kind: z.literal("session"),
  sourceDirectory: z.string().min(1),
  entry: z.string().regex(/^[A-Za-z0-9._-]+\.py$/),
});

const registrySchema = z.object({
  version: z.literal(1),
  tools: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    category: z.enum(["web", "crypto", "misc"]),
    name: z.string().min(1),
    description: z.string().min(1),
    editions: z.array(z.enum(["original", "cn"])).optional(),
    runner: z.discriminatedUnion("kind", [pythonRunner, binaryRunner, sessionRunner]).optional(),
  })),
});

const parsedRegistry = registrySchema.parse(registryJson);
const BUILT_IN_PLUGINS: readonly ToolPlugin[] = parsedRegistry.tools;

const PLUGINS_BY_ID = new Map(BUILT_IN_PLUGINS.map((plugin) => [plugin.id, plugin]));

export function listPlugins(category?: PluginCategory): readonly ToolPlugin[] {
  if (!category) return BUILT_IN_PLUGINS;
  return BUILT_IN_PLUGINS.filter((plugin) => plugin.category === category);
}

export function getPlugin(id: string): ToolPlugin | undefined {
  return PLUGINS_BY_ID.get(id);
}

// 命令预览与运行协议使用的 argv[0]。python 走 .cmd 启动器，binary 直接用程序名，
// session（webshell）走定制客户端、不经命令预览，返回 undefined。
export function runnerCommandName(plugin: ToolPlugin | undefined): string | undefined {
  const runner = plugin?.runner;
  if (!runner) return undefined;
  if (runner.kind === "python") return runner.launcher;
  if (runner.kind === "binary") return runner.program;
  return undefined;
}
