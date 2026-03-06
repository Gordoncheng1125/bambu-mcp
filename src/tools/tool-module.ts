import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "../tool-context.js";

export interface ToolModule {
  tools: Tool[];
  createHandlers(ctx: ToolContext): Record<string, (args: any) => Promise<any>>;
}
