import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolModule } from "./tool-module.js";
import type { ToolContext } from "../tool-context.js";
import { ok } from "../tool-context.js";

export const tools: Tool[] = [
  {
    name: "printer_get_status",
    description:
      "Request a full status push from the printer and return it. Includes temperatures, print progress, AMS state, fan speeds, and more. Note: pushall should not be called more than once every 5 minutes on P1P.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "printer_get_cached_status",
    description:
      "Return the last cached printer status without requesting a new push. Faster and lighter than printer_get_status — use this for frequent polling.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "printer_get_version",
    description:
      "Get firmware and module version information for the connected printer",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export function createHandlers(
  ctx: ToolContext,
): Record<string, (args: any) => Promise<any>> {
  return {
    printer_get_status: async () => {
      const status = await ctx.requireMQTT().requestStatus();
      return ok(status);
    },

    printer_get_cached_status: async () => {
      const status = ctx.requireMQTT().getCachedStatus();
      return ok(status);
    },

    printer_get_version: async () => {
      return ok(await ctx.requireMQTT().getVersion());
    },
  };
}

const statusModule: ToolModule = { tools, createHandlers };
export default statusModule;
