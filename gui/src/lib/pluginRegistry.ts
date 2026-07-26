import { z } from "zod";
import registryJson from "../../../tools/tool_registry.json";

export type PluginCategory = "web" | "crypto" | "misc";
export type PluginEdition = "original" | "cn";

export interface ToolPlugin {
  id: string;
  category: PluginCategory;
  name: string;
  description: string;
  editions?: readonly PluginEdition[];
  runner?: {
    launcher: string;
    sourceDirectory: string;
    entry: string;
  };
}

const registrySchema = z.object({
  version: z.literal(1),
  tools: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    category: z.enum(["web", "crypto", "misc"]),
    name: z.string().min(1),
    description: z.string().min(1),
    editions: z.array(z.enum(["original", "cn"])).optional(),
    runner: z.object({
      launcher: z.string().regex(/^[A-Za-z0-9._-]+\.cmd$/),
      sourceDirectory: z.string().min(1),
      entry: z.string().regex(/^[A-Za-z0-9._-]+\.py$/),
    }).optional(),
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
